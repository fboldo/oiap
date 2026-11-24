/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type {
	AgentDefinition,
	PluginDefinition,
	RenderedFile,
	SkillAsset,
	TargetBundle,
} from "@oiap/core";
import { exportOpenCode } from "./exporter.ts";

describe("exportOpenCode", () => {
	test("renders an OpenCode project bundle", () => {
		const bundle = exportOpenCode(sampleOpenCodePlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("opencode");
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe("opencode.json");
		expect(paths).toContain("opencode.json");
		expect(paths).toContain("AGENTS.md");
		expect(paths).toContain(".opencode/instructions/team.md");
		expect(paths).toContain(".opencode/skills/audit-repo/SKILL.md");
		expect(paths).toContain(".opencode/commands/repo-status.md");
		expect(paths).toContain(".opencode/agents/reviewer.md");
		expect(paths).toContain(".opencode/plugins/oiap-hooks.js");
		expect(paths).toContain(".oiap/opencode-hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const config = readJson<OpenCodeConfig>(bundle, "opencode.json");
		const docsMcp = required(config.mcp.docs, "docs MCP server");
		expect(config.instructions).toEqual([".opencode/instructions/team.md"]);
		expect(docsMcp.type).toBe("local");
		expect(docsMcp.command).toEqual(["docs-mcp", "--stdio"]);
		expect(config.permission.bash).toEqual({ "rm -rf": "deny" });

		const command = readText(bundle, ".opencode/commands/repo-status.md");
		expect(command).toContain('description: "Summarize repository status."');
		expect(command).toContain("Use OpenCode-specific status workflow.");

		const skill = readText(bundle, ".opencode/skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain('compatibility: "opencode"');
		expect(skill).toContain("# Audit Repo");

		const agentsMd = readText(bundle, "AGENTS.md");
		expect(agentsMd).toContain("OpenCode always-on project guidance.");
		expect(agentsMd).toContain("Prefer OpenCode native docs.");

		const agent = readText(bundle, ".opencode/agents/reviewer.md");
		expect(agent).toContain('mode: "subagent"');
		expect(agent).toContain('model: "opencode/gpt-5.1-codex"');
		expect(agent).toContain("OpenCode-specific agent instructions.");
	});

	test("maps OpenCode hooks through the plugin bridge", () => {
		const bundle = exportOpenCode(sampleOpenCodePlugin);
		const plugin = readText(bundle, ".opencode/plugins/oiap-hooks.js");
		const bridgeManifest = readJson<OpenCodeHookBridgeManifest>(
			bundle,
			".oiap/opencode-hooks.json",
		);
		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);

		expect(plugin).toContain('"tool.execute.before"');
		expect(plugin).toContain('"--target"');
		expect(plugin).toContain('"opencode"');
		expect(plugin).toContain("run-hook");
		expect(plugin).not.toContain("const hookDescriptors = [");
		expect(bridgeManifest.hooks[0]?.targetEvent).toBe("tool.execute.before");
		expect(runtimeManifest.hooks["pre-tool"]?.targetEvent).toBe(
			"tool.execute.before",
		);
		expect(runtimeManifest.hooks["before-agent"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("hooks");
		expect(issueCodes).toContain("degraded-hooks");
	});

	test("renders remote OpenCode MCP config", () => {
		const config = readJson<OpenCodeConfig>(
			exportOpenCode(sampleOpenCodePlugin),
			"opencode.json",
		);
		const searchMcp = required(config.mcp.search, "search MCP server");

		expect(searchMcp.type).toBe("remote");
		expect(searchMcp.url).toBe("https://search.example.com/mcp");
		expect(searchMcp.headers).toEqual({
			Authorization: "Bearer {env:SEARCH_TOKEN}",
		});
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportOpenCode(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(
			readText(bundle, ".opencode/skills/review/references/guide.md"),
		).toBe("Guide");
		expect(readText(bundle, ".opencode/bundle-files/standards/style.md")).toBe(
			"Style",
		);
		expect(readText(bundle, ".opencode/skills/review/SKILL.md")).toContain(
			"Read ../../bundle-files/standards/style.md, then dispatch ../../agents/critic.md.",
		);
		expect(readText(bundle, "README.md")).toContain(".opencode/bundle-files/");

		const agent = readText(bundle, ".opencode/agents/critic.md");
		expect(agent).toContain('permission: {"edit":"deny","bash":"deny"}');
		expect(agent).toContain("temperature: 0.1");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
		expect(bundle.report.status).toBe("degraded");
	});

	test("maps invocation controls and degrades the ones OpenCode lacks", () => {
		const plugin = {
			...invocationPlugin,
			skills: [
				{ ...manualSkill, modelInvocable: false },
				{ ...backgroundSkill, userInvocable: false },
			],
			agents: [{ ...isolatedAgent, hostInstructions: "exclude" }],
		} satisfies PluginDefinition;
		const bundle = exportOpenCode(plugin);
		const degradations = bundle.report.degradedCapabilities;

		expect(readText(bundle, ".opencode/skills/manual/SKILL.md")).toContain(
			"disable-model-invocation: true",
		);
		expect(
			readText(bundle, ".opencode/skills/background/SKILL.md"),
		).not.toContain("disable-model-invocation");
		expect(degradations).toContainEqual(
			expect.objectContaining({
				capability: { kind: "skills", target: "opencode" },
				from: "userInvocable: false",
			}),
		);
		expect(degradations).toContainEqual(
			expect.objectContaining({
				capability: { kind: "agents", target: "opencode" },
				from: 'hostInstructions: "exclude"',
			}),
		);
		expect(bundle.report.status).toBe("degraded");
		expect(Object.keys(readJson<object>(bundle, "opencode.json"))).toEqual([
			"$schema",
		]);
	});

	test("reports ok when invocation controls are unset or mapped", () => {
		const bundle = exportOpenCode({
			...invocationPlugin,
			skills: [{ ...manualSkill, modelInvocable: false }],
			agents: [{ ...isolatedAgent, hostInstructions: "include" }],
		});

		expect(bundle.report.degradedCapabilities).toEqual([]);
		expect(bundle.report.status).toBe("ok");
	});

	test("keeps targetMetadata over mapped skill keys", () => {
		const bundle = exportOpenCode({
			...invocationPlugin,
			skills: [
				{
					...manualSkill,
					modelInvocable: false,
					targetMetadata: {
						opencode: { "disable-model-invocation": false },
					},
				},
			],
		});

		expect(readText(bundle, ".opencode/skills/manual/SKILL.md")).toContain(
			"disable-model-invocation: false",
		);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportOpenCode({
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
		author: { name: "Ada", email: "ada@example.com" },
		repository: "https://github.com/example/invocation",
		categories: [],
		supportedTargets: ["opencode"],
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
} satisfies PluginDefinition;

const bundleFilesPlugin = {
	manifest: {
		id: "bundle-files",
		name: "Bundle Files",
		version: "1.0.0",
		description: "Skill files, resources and path tokens.",
		categories: [],
		supportedTargets: ["opencode"],
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
			targetMetadata: { opencode: { temperature: 0.1 } },
		},
	],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

const sampleOpenCodePlugin = {
	manifest: {
		id: "sample-opencode",
		name: "Sample OpenCode",
		version: "1.2.3",
		description: "Exporter coverage fixture for OpenCode.",
		categories: ["testing"],
		supportedTargets: ["opencode"],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { opencode: "repo-status" },
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
				opencode: "Use OpenCode-specific status workflow.",
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
				opencode: "OpenCode-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				opencode: "OpenCode always-on project guidance.",
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
			model: "opencode/gpt-5.1-codex",
		},
	],
	rules: [
		{
			id: "agents-guidance",
			target: "opencode",
			path: "AGENTS.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "OpenCode project context",
			content: "Prefer OpenCode native docs.",
		},
		{
			id: "team-rule",
			target: "opencode",
			path: ".opencode/instructions/team.md",
			scope: "workspace",
			mergeStrategy: "replace-file",
			activation: "always",
			description: "OpenCode team rule",
			content: "Team rule content.",
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
			match: { tool: { name: "bash" } },
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
			},
		},
		{
			id: "search",
			transport: "mcp-http",
			tools: [],
			server: {
				httpUrl: "https://search.example.com/mcp",
				auth: {
					mode: "env",
					secretRef: "SEARCH_TOKEN",
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
			id: "opencode-hook-runner",
			target: "opencode",
			language: "javascript",
			purpose: "hook_handler",
			entrypoint: ".oiap/runtime/runner.mjs",
			generated: true,
		},
	],
} satisfies PluginDefinition;

interface OpenCodeConfig {
	instructions?: string[];
	mcp: Record<string, Record<string, unknown>>;
	permission: Record<string, unknown>;
}

interface RuntimeManifest {
	hooks: Record<string, { targetEvent?: string }>;
}

interface OpenCodeHookBridgeManifest {
	hooks: Array<{ targetEvent?: string }>;
}

function readText(bundle: TargetBundle, path: string): string {
	const file = findFile(bundle, path);

	if (typeof file.content !== "string") {
		throw new Error(`${path} is not a text file.`);
	}

	return file.content;
}

function readJson<TValue>(bundle: TargetBundle, path: string): TValue {
	return JSON.parse(readText(bundle, path)) as TValue;
}

function findFile(bundle: TargetBundle, path: string): RenderedFile {
	const file = bundle.files.find((candidate) => candidate.path === path);

	if (!file) {
		throw new Error(`Missing rendered file: ${path}`);
	}

	return file;
}

function required<TValue>(value: TValue | undefined, label: string): TValue {
	if (!value) {
		throw new Error(`Missing ${label}`);
	}

	return value;
}
