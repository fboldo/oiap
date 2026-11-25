/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportCodex } from "./exporter.ts";

describe("exportCodex", () => {
	test("renders a Codex plugin bundle with project companions", () => {
		const bundle = exportCodex(sampleCodexPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("codex");
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".codex-plugin/plugin.json");
		expect(paths).toContain(".codex-plugin/plugin.json");
		expect(paths).toContain("skills/repo-status/SKILL.md");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("hooks/hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".mcp.json");
		expect(paths).toContain("AGENTS.md");
		expect(paths).toContain(".codex/agents/reviewer.toml");
		expect(paths).toContain(".codex/rules/team.rules");
		expect(paths).toContain(".codex/rules/oiap.rules");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<CodexPluginManifest>(
			bundle,
			".codex-plugin/plugin.json",
		);
		expect(manifest.name).toBe("sample-codex");
		expect(manifest.skills).toBe("./skills/");
		expect(manifest.hooks).toBe("./hooks/hooks.json");
		expect(manifest.mcpServers).toBe("./.mcp.json");
		expect(manifest.commands).toBeUndefined();

		const commandSkill = readText(bundle, "skills/repo-status/SKILL.md");
		expect(commandSkill).toContain('name: "repo-status"');
		expect(commandSkill).toContain("Use Codex-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const agentsMd = readText(bundle, "AGENTS.md");
		expect(agentsMd).toContain("Codex always-on project guidance.");
		expect(agentsMd).toContain("Prefer Codex native docs.");

		const agent = readText(bundle, ".codex/agents/reviewer.toml");
		expect(agent).toContain('name = "reviewer"');
		expect(agent).toContain(
			'developer_instructions = "Codex-specific agent instructions."',
		);

		const teamRules = readText(bundle, ".codex/rules/team.rules");
		expect(teamRules).toContain("team_rule()");

		const policyRules = readText(bundle, ".codex/rules/oiap.rules");
		expect(policyRules).toContain('decision = "forbidden"');
		expect(policyRules).toContain('pattern = ["rm", "-rf"]');
	});

	test("maps Codex hooks and reports expected degradations", () => {
		const bundle = exportCodex(sampleCodexPlugin);
		const hooks = readJson<CodexHooksConfig>(bundle, "hooks/hooks.json");
		const pluginRoot = "$" + "{PLUGIN_ROOT}";
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);
		const preToolUse = first(hooks.hooks.PreToolUse, "PreToolUse hook");
		const preToolUseCommand = first(preToolUse.hooks, "PreToolUse command");

		expect(preToolUse.matcher).toBe("Bash");
		expect(preToolUseCommand.command).toBe(
			`node "${pluginRoot}/.oiap/runtime/runner.mjs" run-hook --manifest "${pluginRoot}/.oiap/runtime/manifest.json" --target "codex" --event "before_tool" --hook "pre-tool"`,
		);
		expect(preToolUseCommand.timeout).toBe(3);
		expect(hooks.hooks.SubagentStart).toBeUndefined();

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const runtimeHook = runtimeManifest.hooks["pre-tool"];
		expect(runtimeHook?.event).toBe("before_tool");
		expect(runtimeHook?.targetEvent).toBe("PreToolUse");
		expect(runtimeManifest.hooks["before-agent"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("commands");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).not.toContain("runtime");
		expect(issueCodes).toContain("degraded-commands");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).not.toContain("degraded-runtime");
	});

	test("renders Codex MCP config as a direct server map", () => {
		const mcp = readJson<CodexMcpConfig>(
			exportCodex(sampleCodexPlugin),
			".mcp.json",
		);

		expect(mcp.docs.command).toBe("docs-mcp");
		expect(mcp.docs.args).toEqual(["--stdio"]);
		expect(mcp.docs.enabled_tools).toEqual(["search"]);
		expect(mcp.docs.bearer_token_env_var).toBe("DOCS_TOKEN");
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportCodex(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../.codex/agents/critic.toml.",
		);
		expect(readText(bundle, ".codex/agents/critic.toml")).not.toContain(
			"sandbox_mode",
		);
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).toContain("read-only-agent");
	});

	test("renders agent targetMetadata as valid TOML", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			agents: bundleFilesPlugin.agents.map((agent) => ({
				...agent,
				targetMetadata: {
					codex: {
						nickname_candidates: ["Critic"],
						nested: { a: 1, "b.c": "x" },
						dropped: null,
					},
				},
			})),
		});
		const agentFile = bundle.files.find((file) =>
			file.path.startsWith(".codex/agents/"),
		);
		const parsed = Bun.TOML.parse(String(agentFile?.content)) as Record<
			string,
			unknown
		>;

		expect(parsed.nickname_candidates).toEqual(["Critic"]);
		expect(parsed.nested).toEqual({ a: 1, "b.c": "x" });
		expect("dropped" in parsed).toBe(false);
	});

	test("maps manifest metadata and skill invocation policy", () => {
		const bundle = exportCodex(hostFieldsPlugin);
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".codex-plugin/plugin.json",
		);

		expect(manifest.keywords).toEqual(["review", "docs"]);
		expect(manifest.author).toEqual({
			name: "Docs Team",
			email: "docs@example.com",
			url: "https://example.com",
		});
		expect(manifest.repository).toBe("https://github.com/example/bundle");
		expect(manifest.displayName).toBeUndefined();
		expect(manifest.logo).toBeUndefined();
		expect(manifest.interface).toEqual({
			displayName: "Bundle Files Pro",
			shortDescription: "Skill files, resources and path tokens.",
			developerName: "Docs Team",
			websiteURL: "https://example.com/bundle",
			logo: "./assets/logo.svg",
		});
		expect(readText(bundle, "assets/logo.svg")).toBe("<svg/>");
		expect(readText(bundle, "skills/review/agents/openai.yaml")).toBe(
			"policy:\n  allow_implicit_invocation: false\n",
		);
		expect(readText(bundle, "skills/review/SKILL.md")).not.toContain(
			"invocation",
		);
	});

	test("degrades model-only skills and agents without host instructions", () => {
		const bundle = exportCodex(hostFieldsPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => `${degradation.capability.kind}:${degradation.from}`,
		);

		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("skills:model-only-skill");
		expect(degradations).toContain("agents:agent-without-host-instructions");

		const plain = exportCodex(bundleFilesPlugin);
		const plainDegradations = plain.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);
		expect(plainDegradations).not.toContain("model-only-skill");
		expect(plainDegradations).not.toContain("agent-without-host-instructions");
		expect(
			plain.files.some((file) => file.path.endsWith("agents/openai.yaml")),
		).toBe(false);
	});

	test("keeps hyphens in agent names", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			agents: [
				{
					id: "EGM-Style",
					name: "egm-style",
					description: "Style agent.",
					instructions: { id: "critic-body", kind: "instruction" },
				},
				{
					id: "snake_case agent",
					name: "snake",
					description: "Snake agent.",
					instructions: { id: "critic-body", kind: "instruction" },
				},
			],
		});

		expect(
			Bun.TOML.parse(readText(bundle, ".codex/agents/egm-style.toml")),
		).toMatchObject({ name: "egm-style" });
		expect(
			Bun.TOML.parse(readText(bundle, ".codex/agents/snake-case-agent.toml")),
		).toMatchObject({ name: "snake_case-agent" });
	});

	test("merges the user-only policy into a skill's own openai.yaml", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			skills: bundleFilesPlugin.skills.map((skill) => ({
				...skill,
				modelInvocable: false,
				files: [
					...(skill.files ?? []),
					{
						path: "agents/openai.yaml",
						content: 'interface:\n  display_name: "Review"\n',
					},
				],
			})),
		});
		const policyFiles = bundle.files.filter((file) =>
			file.path.endsWith("agents/openai.yaml"),
		);

		expect(policyFiles).toHaveLength(1);
		expect(String(policyFiles[0]?.content)).toBe(
			'interface:\n  display_name: "Review"\npolicy:\n  allow_implicit_invocation: false\n',
		);
		expect(bundle.report.issues.map((issue) => issue.code)).not.toContain(
			"duplicate-bundle-file",
		);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			resources: [{ path: ".codex/agents/critic.toml", content: "shadow" }],
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

describe("exportCodex target features", () => {
	test("drops primitives limited to other targets", () => {
		const bundle = exportCodex({
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
					targets: ["codex"],
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
		const bundle = exportCodex({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				targetMetadata: {
					codex: { version: null, homepage: "https://example.com/x" },
					"gemini-cli": { homepage: "https://example.com/gemini" },
				},
			},
		});
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".codex-plugin/plugin.json",
		);

		expect("version" in manifest).toBe(false);
		expect(manifest.homepage).toBe("https://example.com/x");
		expect(manifest.description).toBe(bundleFilesPlugin.manifest.description);
	});

	test("merges nested manifest overrides", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				targetMetadata: { codex: { interface: { displayName: "Custom" } } },
			},
		});
		const manifest = readJson<{
			interface: Record<string, unknown>;
		}>(bundle, ".codex-plugin/plugin.json");

		expect(manifest.interface.displayName).toBe("Custom");
		expect(manifest.interface.shortDescription).toBe(
			bundleFilesPlugin.manifest.description,
		);
	});

	test("emits target files at the plugin root with resolved paths", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			targetFiles: {
				codex: [
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

		expect(script?.content).toBe(`cat ${"../standards/style.md"}\n`);
		expect(script?.mode).toBe(0o755);
		expect(script?.source?.primitiveKind).toBe("target-file");
		expect(paths).not.toContain("scripts/gemini.sh");
	});

	test("reports target files that shadow generated files", () => {
		const bundle = exportCodex({
			...bundleFilesPlugin,
			targetFiles: { codex: [{ path: "README.md", content: "mine" }] },
		});

		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

const bundleFilesPlugin = {
	manifest: {
		id: "bundle-files",
		name: "Bundle Files",
		version: "1.0.0",
		description: "Skill files, resources and path tokens.",
		categories: [],
		supportedTargets: ["codex"],
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
		homepage: "https://example.com/bundle",
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

const sampleCodexPlugin = {
	manifest: {
		id: "sample-codex",
		name: "Sample Codex",
		version: "1.2.3",
		description: "Exporter coverage fixture for Codex.",
		categories: ["testing"],
		supportedTargets: ["codex"],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { codex: "repo-status" },
			helpText: "Summarize repository status.",
			examples: ["@sample-codex repo-status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Use generic status workflow.",
			hostOverrides: {
				codex: "Use Codex-specific status workflow.",
			},
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
			body: "Generic agent instructions.",
			hostOverrides: {
				codex: "Codex-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				codex: "Codex always-on project guidance.",
			},
		},
	],
	commands: [
		{
			id: "status-command",
			invocation: { id: "status-invocation", kind: "invocation" },
			prompt: { id: "status-prompt", kind: "instruction" },
		},
	],
	skills: [
		{
			id: "audit_repo",
			name: "Audit Repo",
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
			model: "gpt-5.1-codex",
		},
	],
	rules: [
		{
			id: "agents-guidance",
			target: "codex",
			path: "AGENTS.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "Codex project context",
			content: "Prefer Codex native docs.",
		},
		{
			id: "team-rule",
			target: "codex",
			path: ".codex/rules/team.rules",
			scope: "workspace",
			mergeStrategy: "replace-file",
			activation: "always",
			description: "Codex rule",
			content: "team_rule()",
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
			match: { tool: { name: "Bash" } },
			timeoutMs: 2_500,
		},
		{
			kind: "oiap.hook",
			id: "before-agent",
			event: "before_agent",
			handler: () => ({ decision: "allow" as const }),
			match: { agentName: "Reviewer" },
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
				includeTools: ["search"],
				auth: {
					mode: "env",
					secretRef: "DOCS_TOKEN",
				},
			},
		},
	],
	policies: [
		{
			permissions: [
				{
					kind: "process",
					access: "deny",
					resources: ["rm -rf"],
					reason: "Do not allow destructive deletion.",
				},
			],
		},
	],
	runtimeModules: [
		{
			id: "codex-hook-runner",
			target: "codex",
			language: "typescript",
			purpose: "hook_handler",
			entrypoint: "src/hooks.ts",
			generated: true,
		},
	],
} satisfies PluginDefinition;

interface CodexPluginManifest {
	name: string;
	skills?: string;
	hooks?: string;
	mcpServers?: string;
	commands?: unknown;
}

interface CodexHooksConfig {
	hooks: {
		PreToolUse: Array<{
			matcher: string;
			hooks: Array<{ command: string; timeout?: number }>;
		}>;
		SubagentStart?: unknown;
	};
}

interface CodexMcpConfig {
	docs: {
		command: string;
		args: string[];
		enabled_tools: string[];
		bearer_token_env_var: string;
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
