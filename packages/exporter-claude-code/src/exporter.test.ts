/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportClaudeCode } from "./exporter.ts";

describe("exportClaudeCode", () => {
	test("renders an official Claude Code plugin bundle", () => {
		const bundle = exportClaudeCode(sampleClaudePlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("claude-code");
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".claude-plugin/plugin.json");
		expect(paths).toContain(".claude-plugin/plugin.json");
		expect(paths).toContain("commands/repo-status.md");
		expect(paths).toContain("skills/audit-skill/SKILL.md");
		expect(paths).toContain("agents/reviewer.md");
		expect(paths).toContain("hooks/hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".mcp.json");
		expect(paths).toContain(".oiap/capability-report.json");
		expect(paths).not.toContain("package/plugin.json");
		expect(paths).not.toContain("CLAUDE.md");

		const manifest = readJson<ClaudePluginManifest>(
			bundle,
			".claude-plugin/plugin.json",
		);
		expect(manifest.name).toBe("sample-claude");
		expect(manifest.version).toBe("1.2.3");
		expect(manifest.description).toBe(
			"Exporter coverage fixture for Claude Code.",
		);

		const command = readText(bundle, "commands/repo-status.md");
		expect(command).toContain('allowed-tools: "Bash(git status:*)"');
		expect(command).toContain("Run git status and summarize it.");

		const hooks = readJson<ClaudeHooksConfig>(bundle, "hooks/hooks.json");
		const claudePluginRoot = "$" + "{CLAUDE_PLUGIN_ROOT}";
		const preToolUse = first(hooks.hooks.PreToolUse, "PreToolUse hook");
		const preToolUseCommand = first(preToolUse.hooks, "PreToolUse command");
		expect(preToolUse.matcher).toBe("Bash");
		expect(preToolUseCommand.command).toBe(
			`node "${claudePluginRoot}/.oiap/runtime/runner.mjs" run-hook --manifest "${claudePluginRoot}/.oiap/runtime/manifest.json" --target "claude-code" --event "before_tool" --hook "pre-tool"`,
		);

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const runtimeHook = runtimeManifest.hooks["pre-tool"];
		expect(runtimeHook?.event).toBe("before_tool");
		expect(runtimeHook?.targetEvent).toBe("PreToolUse");

		const mcp = readJson<ClaudeMcpConfig>(bundle, ".mcp.json");
		expect(mcp.mcpServers.docs.command).toBe("docs-mcp");
		expect(mcp.mcpServers.docs.args).toEqual(["--stdio"]);
	});

	test("reports degraded capabilities for unsupported plugin surfaces", () => {
		const bundle = exportClaudeCode(sampleClaudePlugin);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);

		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("rules");
		expect(degradedKinds).not.toContain("hooks");
		expect(degradedKinds).not.toContain("runtime");
		expect(issueCodes).toContain("degraded-rules");
		expect(issueCodes).not.toContain("degraded-hooks");
		expect(issueCodes).not.toContain("degraded-runtime");
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportClaudeCode(bundleFilesPlugin);
		const pluginRoot = "$" + "{CLAUDE_PLUGIN_ROOT}";

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			`Read ${pluginRoot}/standards/style.md, then dispatch ${pluginRoot}/agents/critic.md.`,
		);
		expect(readText(bundle, "agents/critic.md")).toContain(
			'tools: "Read,Grep,Glob"',
		);
		expect(bundle.report.status).toBe("ok");
	});

	test("maps manifest metadata, skill invocation and host instructions", () => {
		const bundle = exportClaudeCode(hostFieldsPlugin);
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".claude-plugin/plugin.json",
		);

		expect(manifest.displayName).toBe("Bundle Files Pro");
		expect(manifest.keywords).toEqual(["review", "docs"]);
		expect(manifest.author).toEqual({
			name: "Docs Team",
			email: "docs@example.com",
			url: "https://example.com",
		});
		expect(manifest.repository).toBe("https://github.com/example/bundle");
		expect(manifest.icon).toBe("./assets/logo.svg");
		expect(manifest.logo).toBeUndefined();
		expect(readText(bundle, "assets/logo.svg")).toBe("<svg/>");

		const skill = readText(bundle, "skills/review/SKILL.md");
		expect(skill).toContain("disable-model-invocation: true");
		expect(skill).toContain("user-invocable: false");

		expect(readText(bundle, "agents/critic.md")).toContain(
			"omitClaudeMd: true",
		);
		expect(bundle.report.status).toBe("ok");
	});

	test("omits invocation and host-instruction keys by default", () => {
		const bundle = exportClaudeCode(bundleFilesPlugin);

		expect(readText(bundle, "skills/review/SKILL.md")).not.toContain(
			"invocation",
		);
		expect(readText(bundle, "agents/critic.md")).not.toContain("omitClaudeMd");
	});

	test("targetMetadata overrides mapped frontmatter", () => {
		const bundle = exportClaudeCode({
			...hostFieldsPlugin,
			agents: hostFieldsPlugin.agents.map((agent) => ({
				...agent,
				targetMetadata: { "claude-code": { omitClaudeMd: false } },
			})),
		});

		expect(readText(bundle, "agents/critic.md")).toContain(
			"omitClaudeMd: false",
		);
	});

	test("writes remote MCP servers in Claude's format and reports dropped fields", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			tools: [
				{
					id: "docs",
					transport: "mcp-http",
					tools: [],
					server: {
						url: "https://docs.example.com/mcp",
						headers: { Authorization: "Bearer $" + "{DOCS_TOKEN}" },
						auth: { mode: "header", secretRef: "DOCS_TOKEN" },
					},
				},
			],
		});
		const mcp = JSON.parse(readText(bundle, ".mcp.json"));

		expect(mcp.mcpServers.docs).toEqual({
			type: "http",
			url: "https://docs.example.com/mcp",
			headers: { Authorization: "Bearer $" + "{DOCS_TOKEN}" },
		});
		expect(
			bundle.report.degradedCapabilities.map((entry) => entry.from),
		).toContain("oiap-mcp-server");
	});

	test("emits a skill from skillsFrom exactly as written", () => {
		const skillFile =
			"---\nname: review\ndescription: Review.\nlicense: MIT\n---\n\nBody.\n";
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			skills: bundleFilesPlugin.skills.map((skill) => ({
				...skill,
				source: { directory: "/repo/skills/review", skillFile },
			})),
		});

		expect(readText(bundle, "skills/review/SKILL.md")).toBe(skillFile);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			resources: [{ path: "agents/critic.md", content: "shadow" }],
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

describe("exportClaudeCode target features", () => {
	test("drops primitives limited to other targets", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			skills: [
				...bundleFilesPlugin.skills,
				{
					id: "elsewhere",
					name: "elsewhere",
					description: "Only for Gemini.",
					instructions: { id: "review-body", kind: "instruction" },
					targets: ["gemini-cli"],
				},
				{
					id: "here",
					name: "here",
					description: "Only for this host.",
					instructions: { id: "review-body", kind: "instruction" },
					targets: ["claude-code"],
				},
			],
			agents: [
				...bundleFilesPlugin.agents,
				{
					id: "gemini-agent",
					name: "gemini-agent",
					description: "Only for Gemini.",
					instructions: { id: "critic-body", kind: "instruction" },
					targets: ["gemini-cli"],
				},
			],
		});
		const paths = bundle.files.map((file) => file.path);
		const evidence = paths
			.filter((path) => path.startsWith(".oiap/"))
			.map((path) => readText(bundle, path))
			.join("\n");

		expect(paths.some((path) => path.includes("elsewhere"))).toBe(false);
		expect(paths.some((path) => path.includes("gemini-agent"))).toBe(false);
		expect(evidence).not.toContain("elsewhere");
		expect(evidence).not.toContain("gemini-agent");
		expect(paths).toContain("skills/here/SKILL.md");
	});

	test("merges manifest target metadata and removes null fields", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				targetMetadata: {
					"claude-code": { version: null, homepage: "https://example.com/x" },
					"gemini-cli": { homepage: "https://example.com/gemini" },
				},
			},
		});
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".claude-plugin/plugin.json",
		);

		expect("version" in manifest).toBe(false);
		expect(manifest.homepage).toBe("https://example.com/x");
		expect(manifest.description).toBe(bundleFilesPlugin.manifest.description);
	});

	test("emits target files at the plugin root with resolved paths", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			targetFiles: {
				"claude-code": [
					{
						path: "scripts/check.sh",
						content: "cat $" + "{OIAP_PLUGIN_ROOT}/standards/style.md\n",
						mode: 0o755,
					},
				],
				"gemini-cli": [{ path: "scripts/gemini.sh", content: "echo\n" }],
			},
		});
		const paths = bundle.files.map((file) => file.path);
		const script = bundle.files.find(
			(file) => file.path === "scripts/check.sh",
		);

		expect(script?.content).toBe(
			`cat ${"$" + "{CLAUDE_PLUGIN_ROOT}/standards/style.md"}\n`,
		);
		expect(script?.mode).toBe(0o755);
		expect(script?.source?.primitiveKind).toBe("target-file");
		expect(paths).not.toContain("scripts/gemini.sh");
	});

	test("reports target files that shadow generated files", () => {
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			targetFiles: { "claude-code": [{ path: "README.md", content: "mine" }] },
		});

		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});

	test("emits an agent from agentsFrom exactly as written", () => {
		const content =
			"---\nname: critic\ndescription: Critic.\ncolor: red\n---\n\nCritique.\n";
		const bundle = exportClaudeCode({
			...bundleFilesPlugin,
			agents: bundleFilesPlugin.agents.map((agent) => ({
				...agent,
				source: { file: "/repo/agents/critic.md", content },
			})),
		});

		expect(readText(bundle, "agents/critic.md")).toBe(content);
	});

	test("uses the Claude Code host override of a command prompt", () => {
		const bundle = exportClaudeCode({
			...sampleClaudePlugin,
			instructions: sampleClaudePlugin.instructions.map((instruction) =>
				instruction.id === "status-prompt"
					? {
							...instruction,
							hostOverrides: { "claude-code": "Claude-specific prompt." },
						}
					: instruction,
			),
		});
		const command = readText(bundle, "commands/repo-status.md");

		expect(command).toContain("Claude-specific prompt.");
		expect(command).not.toContain("Run git status and summarize it.");
	});
});

const bundleFilesPlugin = {
	manifest: {
		id: "bundle-files",
		name: "Bundle Files",
		version: "1.0.0",
		description: "Skill files, resources and path tokens.",
		categories: [],
		supportedTargets: ["claude-code"],
	},
	instructions: [
		{
			id: "review-body",
			purpose: "workflow",
			triggers: [],
			body:
				"Read $" +
				"{OIAP_PLUGIN_ROOT}/standards/style.md, then dispatch $" +
				"{OIAP_AGENT_FILE:critic}.",
		},
		{
			id: "critic-body",
			purpose: "agent",
			triggers: [],
			body: "Critique the document.",
		},
	],
	skills: [
		{
			id: "review",
			name: "review",
			description: "Review a document.",
			instructions: { id: "review-body", kind: "instruction" },
			files: [{ path: "references/guide.md", content: "Guide" }],
		},
	],
	agents: [
		{
			id: "critic",
			name: "critic",
			description: "Read-only critic.",
			instructions: { id: "critic-body", kind: "instruction" },
			access: "read-only",
		},
	],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

const hostFieldsPlugin = {
	...bundleFilesPlugin,
	manifest: {
		...bundleFilesPlugin.manifest,
		displayName: "Bundle Files Pro",
		keywords: ["review", "docs"],
		logo: "assets/logo.svg",
		author: {
			name: "Docs Team",
			email: "docs@example.com",
			url: "https://example.com",
		},
		repository: "https://github.com/example/bundle",
	},
	skills: bundleFilesPlugin.skills.map((skill) => ({
		...skill,
		modelInvocable: false,
		userInvocable: false,
	})),
	agents: bundleFilesPlugin.agents.map((agent) => ({
		...agent,
		hostInstructions: "exclude" as const,
	})),
	resources: [
		...bundleFilesPlugin.resources,
		{ path: "assets/logo.svg", content: "<svg/>" },
	],
} satisfies PluginDefinition;

const sampleClaudePlugin = {
	manifest: {
		id: "sample-claude",
		name: "Sample Claude",
		version: "1.2.3",
		description: "Exporter coverage fixture for Claude Code.",
		categories: ["testing"],
		supportedTargets: ["claude-code"],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { "claude-code": "repo-status" },
			helpText: "Summarize repository status.",
			examples: ["/sample-claude:repo-status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Run git status and summarize it.",
		},
		{
			id: "audit-instructions",
			purpose: "workflow",
			triggers: ["audit"],
			body: "Audit the repo carefully.",
		},
		{
			id: "agent-instructions",
			purpose: "agent",
			triggers: ["review"],
			body: "Review generated changes.",
		},
		{
			id: "safety-instructions",
			purpose: "safety",
			triggers: ["always"],
			body: "Never commit generated files.",
		},
	],
	commands: [
		{
			id: "status-command",
			invocation: { id: "status-invocation", kind: "invocation" },
			prompt: { id: "status-prompt", kind: "instruction" },
			targetMetadata: {
				"claude-code": {
					"allowed-tools": "Bash(git status:*)",
				},
			},
		},
	],
	skills: [
		{
			id: "audit-skill",
			name: "audit",
			description: "Audit repo workflows.",
			instructions: { id: "audit-instructions", kind: "instruction" },
		},
	],
	agents: [
		{
			id: "reviewer",
			name: "Reviewer",
			description: "Review generated changes.",
			instructions: { id: "agent-instructions", kind: "instruction" },
			model: "sonnet",
		},
	],
	rules: [
		{
			id: "claude-context",
			target: "claude-code",
			path: "CLAUDE.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "Claude project context",
			content: "Always include a concise status summary.",
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
			match: { tool: { name: "Bash" } },
			timeoutMs: 5_000,
		},
	],
	tools: [
		{
			id: "docs",
			transport: "mcp-stdio",
			tools: [],
			server: {
				command: "docs-mcp",
				args: ["--stdio"],
			},
		},
	],
	policies: [
		{
			permissions: [
				{
					kind: "process",
					access: "ask",
					resources: ["git status"],
					reason: "Status checks need command approval.",
				},
			],
		},
	],
	runtimeModules: [
		{
			id: "claude-hook-runner",
			target: "claude-code",
			language: "typescript",
			purpose: "hook_handler",
			entrypoint: "src/hooks.ts",
			generated: true,
		},
	],
} satisfies PluginDefinition;

interface ClaudePluginManifest {
	name: string;
	version: string;
	description: string;
}

interface ClaudeHooksConfig {
	hooks: {
		PreToolUse: Array<{
			matcher: string;
			hooks: Array<{ command: string }>;
		}>;
	};
}

interface ClaudeMcpConfig {
	mcpServers: {
		docs: {
			command: string;
			args: string[];
		};
	};
}

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string } | undefined>;
}

function readJson<TJson = Record<string, unknown>>(
	bundle: TargetBundle,
	path: string,
): TJson {
	return JSON.parse(readText(bundle, path)) as TJson;
}

function readText(bundle: TargetBundle, path: string): string {
	const file = findFile(bundle, path);

	if (typeof file.content !== "string") {
		throw new Error(`${path} is not a text file`);
	}

	return file.content;
}

function findFile(bundle: TargetBundle, path: string): RenderedFile {
	const file = bundle.files.find((candidate) => candidate.path === path);

	if (!file) {
		throw new Error(`Missing generated file: ${path}`);
	}

	return file;
}

function first<TValue>(values: TValue[], label: string): TValue {
	const value = values[0];

	if (!value) {
		throw new Error(`Missing ${label}`);
	}

	return value;
}
