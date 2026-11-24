/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportVsCodeCopilot } from "./exporter.ts";

const target = "vscode-copilot-chat";

describe("exportVsCodeCopilot", () => {
	test("renders a VS Code Copilot agent plugin bundle", () => {
		const bundle = exportVsCodeCopilot(sampleVsCodePlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe("plugin.json");
		expect(paths).toContain("plugin.json");
		expect(paths).toContain("commands/repo-status.prompt.md");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("skills/always-on/SKILL.md");
		expect(paths).toContain("skills/team-guidance/SKILL.md");
		expect(paths).toContain("agents/reviewer.agent.md");
		expect(paths).toContain("hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".mcp.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<VsCodePluginManifest>(bundle, "plugin.json");
		expect(manifest).toMatchObject({
			name: "sample-vscode",
			version: "1.2.3",
			description: "Exporter coverage fixture for VS Code Copilot.",
			skills: "skills/",
			commands: "commands/",
			agents: "agents/",
			hooks: "hooks.json",
			mcpServers: ".mcp.json",
		});

		const command = readText(bundle, "commands/repo-status.prompt.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain('agent: "agent"');
		expect(command).toContain("Use VS Code-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, "skills/always-on/SKILL.md");
		expect(alwaysOn).toContain("user-invocable: false");
		expect(alwaysOn).toContain("VS Code always-on guidance.");

		const ruleSkill = readText(bundle, "skills/team-guidance/SKILL.md");
		expect(ruleSkill).toContain("user-invocable: false");
		expect(ruleSkill).toContain("Prefer VS Code Copilot plugin docs.");

		const agent = readText(bundle, "agents/reviewer.agent.md");
		expect(agent).toContain('name: "Reviewer"');
		expect(agent).toContain('model: "gpt-5.1"');
		expect(agent).toContain("VS Code-specific agent instructions.");
	});

	test("maps hooks and reports Copilot-format path limitations", () => {
		const bundle = exportVsCodeCopilot(sampleVsCodePlugin);
		const hooks = readJson<VsCodeHooksConfig>(bundle, "hooks.json");
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);
		const preToolUse = first(hooks.hooks.PreToolUse, "PreToolUse hook");
		const preToolUseCommand = first(preToolUse.hooks, "PreToolUse command");

		const pluginRoot = "$" + "{PLUGIN_ROOT}";
		expect(preToolUse.matcher).toBe("Shell");
		expect(preToolUseCommand.command).toBe(
			`node "${pluginRoot}/.oiap/runtime/runner.mjs" run-hook --manifest "${pluginRoot}/.oiap/runtime/manifest.json" --target "${target}" --event "before_tool" --hook "pre-tool"`,
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
		expect(runtimeManifest.hooks["permission-check"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).toContain("rules");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).toContain("degraded-rules");
	});

	test("renders VS Code MCP config with top-level mcpServers", () => {
		const mcp = readJson<VsCodeMcpConfig>(
			exportVsCodeCopilot(sampleVsCodePlugin),
			".mcp.json",
		);

		expect(mcp.mcpServers.docs.command).toBe("docs-mcp");
		expect(mcp.mcpServers.docs.args).toEqual(["--stdio"]);
		expect(mcp.mcpServers.docs.env).toEqual({ DOCS_MODE: "plugin" });
	});
	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportVsCodeCopilot(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../agents/critic.agent.md.",
		);

		const agent = readText(bundle, "agents/critic.agent.md");
		expect(agent).toContain('tools: ["read","search"]');
		expect(agent).toContain("user-invocable: false");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
		expect(bundle.report.status).toBe("degraded");
	});

	test("keeps explicit agent tools over access", () => {
		const bundle = exportVsCodeCopilot({
			...bundleFilesPlugin,
			agents: [
				{
					...bundleFilesAgent,
					tools: [{ id: "read", kind: "tool" }],
				},
			],
		});

		expect(readText(bundle, "agents/critic.agent.md")).toContain(
			'tools: ["read"]',
		);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportVsCodeCopilot({
			...bundleFilesPlugin,
			resources: [{ path: "agents/critic.agent.md", content: "shadow" }],
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

const bundleFilesAgent = {
	id: "critic",
	name: "critic",
	description: "Read-only critic.",
	instructions: { id: "critic-body", kind: "instruction" },
	access: "read-only",
	targetMetadata: { [target]: { "user-invocable": false } },
} satisfies NonNullable<PluginDefinition["agents"]>[number];

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
	agents: [bundleFilesAgent],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

const sampleVsCodePlugin = {
	manifest: {
		id: "sample-vscode",
		name: "Sample VS Code",
		version: "1.2.3",
		description: "Exporter coverage fixture for VS Code Copilot.",
		categories: ["testing"],
		supportedTargets: [target],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { [target]: "repo-status" },
			helpText: "Summarize repository status.",
			examples: ["/sample-vscode:repo-status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Use generic status workflow.",
			hostOverrides: {
				[target]: "Use VS Code-specific status workflow.",
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
				[target]: "VS Code-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "VS Code always-on guidance.",
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
			path: ".github/instructions/team.instructions.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "Team guidance",
			content: "Prefer VS Code Copilot plugin docs.",
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

interface VsCodePluginManifest {
	name: string;
	version: string;
	description: string;
	skills?: string;
	commands?: string;
	agents?: string;
	hooks?: string;
	mcpServers?: string;
}

interface VsCodeHooksConfig {
	hooks: {
		PreToolUse: Array<{
			matcher: string;
			hooks: Array<{ command: string; timeout?: number }>;
		}>;
		SubagentStart?: unknown[];
	};
}

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string }>;
}

interface VsCodeMcpConfig {
	mcpServers: {
		docs: {
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
