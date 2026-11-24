/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportCursor } from "./exporter.ts";

const target = "cursor";

describe("exportCursor", () => {
	test("renders a Cursor plugin bundle", () => {
		const bundle = exportCursor(sampleCursorPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".cursor-plugin/plugin.json");
		expect(paths).toContain(".cursor-plugin/plugin.json");
		expect(paths).toContain("commands/repo-status.md");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("rules/always-on.mdc");
		expect(paths).toContain("rules/team-guidance.mdc");
		expect(paths).toContain("agents/reviewer.md");
		expect(paths).toContain("hooks/hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain("mcp.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<CursorPluginManifest>(
			bundle,
			".cursor-plugin/plugin.json",
		);
		expect(manifest).toMatchObject({
			name: "sample-cursor",
			version: "1.2.3",
			description: "Exporter coverage fixture for Cursor.",
			rules: "rules/",
			skills: "skills/",
			commands: "commands/",
			agents: "agents/",
			hooks: "hooks/hooks.json",
			mcpServers: "mcp.json",
		});

		const command = readText(bundle, "commands/repo-status.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain("Use Cursor-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, "rules/always-on.mdc");
		expect(alwaysOn).toContain("alwaysApply: true");
		expect(alwaysOn).toContain("Cursor always-on guidance.");

		const rule = readText(bundle, "rules/team-guidance.mdc");
		expect(rule).toContain('globs: ["**/*.ts"]');
		expect(rule).toContain("Prefer Cursor plugin docs.");

		const agent = readText(bundle, "agents/reviewer.md");
		expect(agent).toContain('name: "reviewer"');
		expect(agent).toContain("Cursor-specific agent instructions.");
		expect(agent).toContain("Preferred model: gpt-5.1");
	});

	test("locates the runner through CURSOR_PLUGIN_ROOT for stop hooks", () => {
		const bundle = exportCursor({
			...sampleCursorPlugin,
			hooks: [
				{
					kind: "oiap.hook",
					id: "on-stop",
					event: "stop",
					handler: () => ({ decision: "allow" as const }),
				},
			],
		});
		const hooks = readJson<{
			hooks: Record<string, Array<{ command: string }>>;
		}>(bundle, "hooks/hooks.json");

		expect(first(hooks.hooks.stop ?? [], "stop hook").command).toBe(
			`node "$CURSOR_PLUGIN_ROOT/.oiap/runtime/runner.mjs" run-hook --manifest "$CURSOR_PLUGIN_ROOT/.oiap/runtime/manifest.json" --target "${target}" --event "stop" --hook "on-stop"`,
		);
		expect(
			bundle.report.degradedCapabilities.map((entry) => entry.from),
		).toContain("plugin-directory-command");
	});

	test("maps Cursor hooks and reports unsupported hook events", () => {
		const bundle = exportCursor(sampleCursorPlugin);
		const hooks = readJson<CursorHooksConfig>(bundle, "hooks/hooks.json");
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);
		const preToolUse = first(hooks.hooks.preToolUse, "preToolUse hook");

		expect(preToolUse.matcher).toBe("Shell");
		expect(preToolUse.failClosed).toBe(true);
		expect(preToolUse.command).toBe(
			`node ".oiap/runtime/runner.mjs" run-hook --manifest ".oiap/runtime/manifest.json" --target "${target}" --event "before_tool" --hook "pre-tool"`,
		);
		expect(preToolUse.timeout).toBe(3);
		expect(hooks.hooks.permissionRequest).toBeUndefined();

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const runtimeHook = runtimeManifest.hooks["pre-tool"];
		expect(runtimeHook?.event).toBe("before_tool");
		expect(runtimeHook?.targetEvent).toBe("preToolUse");
		expect(runtimeManifest.hooks["permission-check"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("hooks");
		expect(issueCodes).toContain("degraded-hooks");
	});

	test("renders Cursor MCP config with top-level mcpServers", () => {
		const mcp = readJson<CursorMcpConfig>(
			exportCursor(sampleCursorPlugin),
			"mcp.json",
		);

		expect(mcp.mcpServers.docs.type).toBe("stdio");
		expect(mcp.mcpServers.docs.command).toBe("docs-mcp");
		expect(mcp.mcpServers.docs.args).toEqual(["--stdio"]);
		expect(mcp.mcpServers.docs.env).toEqual({ DOCS_MODE: "plugin" });
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportCursor(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../agents/critic.md.",
		);
		expect(readText(bundle, "agents/critic.md")).toContain("readonly: true");
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
	});

	test("maps manifest metadata and skill invocation", () => {
		const bundle = exportCursor(hostFieldsPlugin);
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".cursor-plugin/plugin.json",
		);

		expect(manifest.displayName).toBe("Bundle Files Pro");
		expect(manifest.keywords).toEqual(["review", "docs"]);
		expect(manifest.author).toEqual({
			name: "Docs Team",
			email: "docs@example.com",
		});
		expect(manifest.repository).toBe("https://github.com/example/bundle");
		expect(manifest.logo).toBe("assets/logo.svg");
		expect(readText(bundle, "assets/logo.svg")).toBe("<svg/>");

		const skill = readText(bundle, "skills/review/SKILL.md");
		expect(skill).toContain("disable-model-invocation: true");
		expect(skill).not.toContain("user-invocable");
		expect(readText(bundle, "agents/critic.md")).not.toContain("omit");
	});

	test("degrades model-only skills and agents without host instructions", () => {
		const bundle = exportCursor(hostFieldsPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => `${degradation.capability.kind}:${degradation.from}`,
		);

		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("skills:model-only-skill");
		expect(degradations).toContain("agents:agent-without-host-instructions");

		const plain = exportCursor(bundleFilesPlugin);
		const plainDegradations = plain.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);
		expect(plainDegradations).not.toContain("model-only-skill");
		expect(plainDegradations).not.toContain("agent-without-host-instructions");
		expect(readText(plain, "skills/review/SKILL.md")).not.toContain(
			"disable-model-invocation",
		);
	});

	test("targetMetadata overrides mapped skill frontmatter", () => {
		const bundle = exportCursor({
			...hostFieldsPlugin,
			skills: hostFieldsPlugin.skills.map((skill) => ({
				...skill,
				targetMetadata: { cursor: { "disable-model-invocation": false } },
			})),
		});

		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"disable-model-invocation: false",
		);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportCursor({
			...bundleFilesPlugin,
			resources: [{ path: "agents/critic.md", content: "shadow" }],
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

describe("exportCursor target features", () => {
	test("drops primitives limited to other targets", () => {
		const bundle = exportCursor({
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
					targets: ["cursor"],
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
		const bundle = exportCursor({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				targetMetadata: {
					cursor: { version: null, homepage: "https://example.com/x" },
					"gemini-cli": { homepage: "https://example.com/gemini" },
				},
			},
		});
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".cursor-plugin/plugin.json",
		);

		expect("version" in manifest).toBe(false);
		expect(manifest.homepage).toBe("https://example.com/x");
		expect(manifest.description).toBe(bundleFilesPlugin.manifest.description);
	});

	test("emits target files at the plugin root with resolved paths", () => {
		const bundle = exportCursor({
			...bundleFilesPlugin,
			targetFiles: {
				cursor: [
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
		const bundle = exportCursor({
			...bundleFilesPlugin,
			targetFiles: { cursor: [{ path: "README.md", content: "mine" }] },
		});

		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});

	test("emits an agent from agentsFrom exactly as written", () => {
		const content =
			"---\nname: critic\ndescription: Critic.\ncolor: red\n---\n\nCritique.\n";
		const bundle = exportCursor({
			...bundleFilesPlugin,
			agents: bundleFilesPlugin.agents.map((agent) => ({
				...agent,
				source: { file: "/repo/agents/critic.md", content },
			})),
		});

		expect(readText(bundle, "agents/critic.md")).toBe(content);
	});
});

const bundleFilesPlugin = {
	manifest: {
		id: "bundle-files",
		name: "Bundle Files",
		version: "1.0.0",
		description: "Skill files, resources and path tokens.",
		categories: [],
		supportedTargets: ["cursor"],
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

const sampleCursorPlugin = {
	manifest: {
		id: "sample-cursor",
		name: "Sample Cursor",
		version: "1.2.3",
		description: "Exporter coverage fixture for Cursor.",
		categories: ["testing"],
		supportedTargets: [target],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { [target]: "repo-status" },
			helpText: "Summarize repository status.",
			examples: ["/repo-status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Use generic status workflow.",
			hostOverrides: {
				[target]: "Use Cursor-specific status workflow.",
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
				[target]: "Cursor-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "Cursor always-on guidance.",
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
			model: "gpt-5.1",
		},
	],
	rules: [
		{
			id: "team-guidance",
			target,
			path: ".cursor/rules/team-guidance.mdc",
			scope: "workspace",
			mergeStrategy: "frontmatter-file",
			activation: "glob",
			globs: ["**/*.ts"],
			description: "Team guidance",
			content: "Prefer Cursor plugin docs.",
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
			match: { tool: { name: "Shell" } },
			timeoutMs: 2_500,
		},
		{
			kind: "oiap.hook",
			id: "permission-check",
			event: "permission_request",
			handler: () => ({ decision: "allow" as const }),
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
				env: { DOCS_MODE: "plugin" },
			},
		},
	],
	policies: [],
	runtimeModules: [],
} satisfies PluginDefinition;

interface CursorPluginManifest {
	name: string;
	version: string;
	description: string;
	rules?: string;
	skills?: string;
	commands?: string;
	agents?: string;
	hooks?: string;
	mcpServers?: string;
}

interface CursorHooksConfig {
	hooks: {
		preToolUse: Array<{
			type: string;
			command: string;
			matcher?: string;
			timeout?: number;
			failClosed?: boolean;
		}>;
		permissionRequest?: unknown[];
	};
}

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string } | undefined>;
}

interface CursorMcpConfig {
	mcpServers: {
		docs: {
			type: string;
			command: string;
			args: string[];
			env?: Record<string, string>;
		};
	};
}

function readJson<TValue>(bundle: TargetBundle, path: string): TValue {
	return JSON.parse(readText(bundle, path)) as TValue;
}

function readText(bundle: TargetBundle, path: string): string {
	const file = bundle.files.find((candidate) => candidate.path === path);

	if (!file || typeof file.content !== "string") {
		throw new Error(`Missing text file: ${path}`);
	}

	return file.content;
}

function first<TValue>(values: TValue[] | undefined, label: string): TValue {
	const value = values?.[0];

	if (!value) {
		throw new Error(`Missing ${label}`);
	}

	return value;
}
