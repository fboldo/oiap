/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type {
	AgentDefinition,
	PluginDefinition,
	SkillAsset,
	TargetBundle,
} from "@oiap/core";
import { exportWindsurf } from "./exporter.ts";
import { windsurfProfile } from "./profile.ts";

const target = "windsurf";

describe("exportWindsurf", () => {
	test("renders a Windsurf workspace bundle", () => {
		const bundle = exportWindsurf(samplePlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".oiap/windsurf-target.json");
		for (const path of [
			".oiap/windsurf-target.json",
			".windsurf/rules/always-on.md",
			".windsurf/rules/team-guidance.md",
			".windsurf/skills/audit-repo/SKILL.md",
			".windsurf/skills/repo-status/SKILL.md",
			".devin/agents/reviewer.md",
			".devin/hooks.v1.json",
			".devin/hooks/oiap-sample-windsurf.cjs",
			".oiap/hooks/pre-tool.json",
			".oiap/runtime/runner.mjs",
			".oiap/runtime/hooks.mjs",
			".oiap/runtime/manifest.json",
			".devin/mcp_config.json",
			".oiap/mcp.json",
			".oiap/policy.json",
			".oiap/README.md",
			".oiap/bundle.json",
			".oiap/capability-report.json",
			".oiap/source-map.json",
		]) {
			expect(paths).toContain(path);
		}
		expect(paths.some((path) => path.startsWith(".windsurf/workflows/"))).toBe(
			false,
		);

		expect(
			readJson<Record<string, unknown>>(bundle, ".oiap/windsurf-target.json"),
		).toMatchObject({
			name: "sample-windsurf",
			version: "1.2.3",
			description: "Exporter coverage fixture for Windsurf.",
			target,
			rules: ".windsurf/rules/",
			skills: ".windsurf/skills/",
			commands: ".windsurf/skills/",
			agents: ".devin/agents/",
			hooks: ".devin/hooks.v1.json",
			mcp: ".devin/mcp_config.json",
			policies: ".oiap/policy.json",
		});

		const command = readText(bundle, ".windsurf/skills/repo-status/SKILL.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain('triggers: ["user"]');
		expect(command).toContain("Use Windsurf-specific status workflow.");
		expect(command).toContain("- /repo-status");

		const skill = readText(bundle, ".windsurf/skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain('description: "Audit repo workflows."');
		expect(skill).not.toContain("triggers:");

		const alwaysOn = readText(bundle, ".windsurf/rules/always-on.md");
		expect(alwaysOn).toContain('trigger: "always_on"');
		expect(alwaysOn).toContain("Windsurf always-on guidance.");

		const rule = readText(bundle, ".windsurf/rules/team-guidance.md");
		expect(rule).toContain('trigger: "glob"');
		expect(rule).toContain('globs: "**/*.ts"');
		expect(rule).toContain('description: "Team guidance"');
		expect(rule).toContain("Prefer Windsurf project docs.");

		const agent = readText(bundle, ".devin/agents/reviewer.md");
		expect(agent).toContain('name: "reviewer"');
		expect(agent).toContain('model: "gpt-5.1"');
		expect(agent).toContain('allowed-tools: ["docs"]');
		expect(agent).toContain("Windsurf-specific agent instructions.");

		expect(readText(bundle, ".oiap/README.md")).toContain(
			"`.devin/hooks.v1.json`",
		);
	});

	test("maps hooks to .devin/hooks.v1.json through the OIAP runtime", () => {
		const bundle = exportWindsurf(samplePlugin);
		const config = readJson<HooksConfig>(bundle, ".devin/hooks.v1.json");
		const bridge = bundle.files.find(
			(file) => file.path === ".devin/hooks/oiap-sample-windsurf.cjs",
		);
		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);

		expect(Object.keys(config).sort()).toEqual([
			"PermissionRequest",
			"PreToolUse",
		]);
		expect(config.PreToolUse?.[0]).toEqual({
			matcher: "",
			hooks: [
				{
					type: "command",
					command:
						'node "$DEVIN_PROJECT_DIR/.devin/hooks/oiap-sample-windsurf.cjs" PreToolUse',
					timeout: 4,
				},
			],
		});
		expect(bridge?.mode).toBe(0o755);
		expect(bridge?.content).toContain('"id": "pre-tool"');
		expect(bridge?.content).toContain('"windsurf"');
		expect(bridge?.content).toContain('resolve(__dirname, "..", "..")');
		expect(runtimeManifest.hooks["pre-tool"]?.event).toBe("before_tool");
		expect(runtimeManifest.hooks["pre-tool"]?.targetEvent).toBe("PreToolUse");
		expect(runtimeManifest.hooks["permission-check"]?.targetEvent).toBe(
			"PermissionRequest",
		);
		expect(runtimeManifest.hooks["agent-start"]).toBeUndefined();
	});

	test("reports degraded surfaces", () => {
		const bundle = exportWindsurf(samplePlugin);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const degradedFrom = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).toContain("commands");
		expect(degradedKinds).toContain("agents");
		expect(degradedKinds).toContain("mcp");
		expect(degradedKinds).toContain("policy");
		expect(degradedFrom).toContain("before_agent");
	});

	test("renders MCP config with top-level mcpServers", () => {
		const mcp = readJson<McpConfig>(
			exportWindsurf(samplePlugin),
			".devin/mcp_config.json",
		);

		expect(mcp.mcpServers.docs).toEqual({
			command: "docs-mcp",
			args: ["--stdio"],
			env: { DOCS_MODE: "plugin" },
		});
		expect(mcp.mcpServers.remote).toEqual({
			url: "https://mcp.example.com/sse",
			transport: "sse",
			headers: { Authorization: "Bearer token" },
			disabledTools: ["delete_all"],
		});
	});

	test("reports ok for a plugin with only native surfaces", () => {
		const bundle = exportWindsurf({
			manifest: samplePlugin.manifest,
			instructions: samplePlugin.instructions,
			skills: samplePlugin.skills,
		});

		expect(bundle.report.status).toBe("ok");
		expect(bundle.report.degradedCapabilities).toEqual([]);
	});

	test("renders structured workflows as user-invocable skills", () => {
		const bundle = exportWindsurf({
			manifest: samplePlugin.manifest,
			workflows: [
				{
					id: "release",
					title: "Release",
					activation: { mode: "manual" },
					inputs: [],
					steps: [
						{ kind: "read_file", path: "CHANGELOG.md" },
						{ kind: "ask_user", prompt: "Ship it?" },
					],
					outputs: [],
					failurePolicy: { mode: "fail_fast" },
				},
			],
		});
		const skill = readText(bundle, ".windsurf/skills/release/SKILL.md");

		expect(skill).toContain('triggers: ["user"]');
		expect(skill).toContain("1. Read `CHANGELOG.md`.");
		expect(skill).toContain("2. Ask the user: Ship it?");
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportWindsurf(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(
			readText(bundle, ".windsurf/skills/review/references/guide.md"),
		).toBe("Guide");
		expect(readText(bundle, ".windsurf/bundle-files/standards/style.md")).toBe(
			"Style",
		);
		expect(readText(bundle, ".windsurf/skills/review/SKILL.md")).toContain(
			"Read ../../bundle-files/standards/style.md, then dispatch ../../../.devin/agents/critic.md.",
		);
		const agent = readText(bundle, ".devin/agents/critic.md");
		expect(agent).toContain('allowed-tools: ["read","grep","glob"]');
		expect(agent).toContain("maxIterations: 5");
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
		expect(bundle.report.issues.map((issue) => issue.code)).not.toContain(
			"unresolved-path-token",
		);
	});

	test("maps skill invocation controls to triggers", () => {
		const bundle = exportWindsurf({
			...invocationPlugin,
			skills: [
				{ ...manualSkill, modelInvocable: false },
				{ ...backgroundSkill, userInvocable: false },
			],
		});

		expect(readText(bundle, ".windsurf/skills/manual/SKILL.md")).toContain(
			'triggers: ["user"]',
		);
		expect(readText(bundle, ".windsurf/skills/background/SKILL.md")).toContain(
			'triggers: ["model"]',
		);
		expect(
			readText(
				exportWindsurf(invocationPlugin),
				".windsurf/skills/manual/SKILL.md",
			),
		).not.toContain("triggers");
		expect(
			bundle.report.degradedCapabilities.map(
				(degradation) => degradation.capability.kind,
			),
		).not.toContain("skills");
	});

	test("keeps targetMetadata over mapped triggers", () => {
		const bundle = exportWindsurf({
			...invocationPlugin,
			skills: [
				{
					...manualSkill,
					modelInvocable: false,
					targetMetadata: { windsurf: { triggers: ["user", "model"] } },
				},
			],
		});

		expect(readText(bundle, ".windsurf/skills/manual/SKILL.md")).toContain(
			'triggers: ["user","model"]',
		);
	});

	test("degrades agents that exclude host instructions", () => {
		const excluded = exportWindsurf({
			...invocationPlugin,
			agents: [{ ...isolatedAgent, hostInstructions: "exclude" }],
		});
		const included = exportWindsurf({
			...invocationPlugin,
			agents: [{ ...isolatedAgent, hostInstructions: "include" }],
		});
		const fromValues = (bundle: TargetBundle) =>
			bundle.report.degradedCapabilities.map((degradation) => degradation.from);

		expect(excluded.report.degradedCapabilities).toContainEqual(
			expect.objectContaining({
				capability: { kind: "agents", target },
				from: 'hostInstructions: "exclude"',
			}),
		);
		expect(excluded.report.status).toBe("degraded");
		expect(fromValues(included)).not.toContain('hostInstructions: "exclude"');
	});

	test("records publisher metadata in the target manifest", () => {
		const bundle = exportWindsurf(invocationPlugin);
		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".oiap/windsurf-target.json",
		);

		expect(manifest.displayName).toBe("Invocation Controls");
		expect(manifest.keywords).toEqual(["review"]);
		expect(manifest.author).toEqual({ name: "Ada", email: "ada@example.com" });
		expect(manifest.repository).toBe("https://github.com/example/invocation");
		expect(manifest.logo).toBe(".windsurf/invocation/assets/logo.svg");
		expect(readText(bundle, ".windsurf/invocation/assets/logo.svg")).toBe(
			"<svg/>",
		);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportWindsurf({
			...bundleFilesPlugin,
			skills: bundleFilesPlugin.skills.map((skill) => ({
				...skill,
				files: [{ path: "SKILL.md", content: "shadow" }],
			})),
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});

	test("profile declares install paths", () => {
		expect(windsurfProfile.installSupport?.paths).toEqual({
			local: { base: "cwd", segments: [".windsurf", "plugins", "{pluginId}"] },
			global: {
				base: "home",
				segments: [".codeium", "windsurf", "plugins", "{pluginId}"],
			},
		});
	});
});

const manualSkill = {
	id: "manual",
	name: "manual",
	description: "Run only when asked.",
	instructions: { id: "manual-body", kind: "instruction" },
} satisfies SkillAsset;

const backgroundSkill = {
	id: "background",
	name: "background",
	description: "Background knowledge.",
	instructions: { id: "background-body", kind: "instruction" },
} satisfies SkillAsset;

const isolatedAgent = {
	id: "isolated",
	name: "isolated",
	description: "Runs without project instructions.",
	instructions: { id: "isolated-body", kind: "instruction" },
} satisfies AgentDefinition;

const invocationPlugin = {
	manifest: {
		id: "invocation",
		name: "Invocation",
		displayName: "Invocation Controls",
		version: "1.0.0",
		description: "Skill and agent invocation controls.",
		keywords: ["review"],
		logo: "assets/logo.svg",
		author: { name: "Ada", email: "ada@example.com" },
		repository: "https://github.com/example/invocation",
		categories: ["testing"],
		supportedTargets: [target],
	},
	instructions: [
		{ id: "manual-body", purpose: "command", triggers: [], body: "Manual." },
		{
			id: "background-body",
			purpose: "always_on",
			triggers: [],
			body: "Background.",
		},
		{ id: "isolated-body", purpose: "agent", triggers: [], body: "Isolated." },
	],
	skills: [manualSkill, backgroundSkill],
	agents: [isolatedAgent],
	resources: [{ path: "assets/logo.svg", content: "<svg/>" }],
} satisfies PluginDefinition;

const bundleFilesPlugin = {
	manifest: {
		id: "bundle-files",
		name: "Bundle Files",
		version: "1.0.0",
		description: "Skill files, resources and path tokens.",
		categories: [],
		supportedTargets: [target],
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
			targetMetadata: { [target]: { maxIterations: 5 } },
		},
	],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

const samplePlugin = {
	manifest: {
		id: "sample-windsurf",
		name: "Sample Windsurf",
		version: "1.2.3",
		description: "Exporter coverage fixture for Windsurf.",
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
				[target]: "Use Windsurf-specific status workflow.",
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
				[target]: "Windsurf-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "Windsurf always-on guidance.",
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
			tools: [{ id: "docs", kind: "tool" }],
		},
	],
	rules: [
		{
			id: "team-guidance",
			target,
			path: ".windsurf/rules/team-guidance.md",
			scope: "workspace",
			mergeStrategy: "frontmatter-file",
			activation: "glob",
			globs: ["**/*.ts"],
			description: "Team guidance",
			content: "Prefer Windsurf project docs.",
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
		{
			kind: "oiap.hook",
			id: "agent-start",
			event: "before_agent",
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
				includeTools: ["search_docs"],
				cwd: ".",
			},
		},
		{
			id: "remote",
			transport: "mcp-sse",
			tools: [],
			server: {
				url: "https://mcp.example.com/sse",
				headers: { Authorization: "Bearer token" },
				excludeTools: ["delete_all"],
			},
		},
	],
	policies: [
		{
			permissions: [
				{
					kind: "process",
					access: "ask",
					resources: ["docs-mcp"],
					reason: "Docs server can execute local process IO.",
				},
			],
		},
	],
	runtimeModules: [],
} satisfies PluginDefinition;

type HooksConfig = Record<
	string,
	{
		matcher: string;
		hooks: { type: string; command: string; timeout?: number }[];
	}[]
>;

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string } | undefined>;
}

interface McpConfig {
	mcpServers: Record<string, Record<string, unknown>>;
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
