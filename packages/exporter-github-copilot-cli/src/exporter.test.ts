/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportGitHubCopilotCli } from "./exporter";

const target = "github-copilot-cli";

describe("exportGitHubCopilotCli", () => {
	test("renders a GitHub Copilot CLI plugin bundle", () => {
		const bundle = exportGitHubCopilotCli(sampleCopilotCliPlugin);
		const paths = bundle.files.map((file) => file.path).sort();

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.id).toBe("github-copilot-cli-plugin");
		expect(bundle.package?.manifestPath).toBe("plugin.json");
		expect(paths).toEqual(
			[
				"plugin.json",
				"README.md",
				"commands/repo-status.md",
				"skills/audit-repo/SKILL.md",
				"skills/always-on/SKILL.md",
				"skills/team-guidance/SKILL.md",
				"agents/reviewer.agent.md",
				"hooks.json",
				".mcp.json",
				".oiap/hooks/pre-tool.json",
				".oiap/hooks/permission-check.json",
				".oiap/hooks/session-banner.json",
				".oiap/runtime/runner.mjs",
				".oiap/runtime/hooks.mjs",
				".oiap/runtime/manifest.json",
				".oiap/policy.json",
				".oiap/runtime-modules.json",
				".oiap/bundle.json",
				".oiap/capability-report.json",
				".oiap/source-map.json",
			].sort(),
		);

		const manifest = readJson<CopilotCliPluginManifest>(bundle, "plugin.json");
		expect(manifest).toEqual({
			name: "sample-copilot-cli",
			version: "1.2.3",
			description: "Exporter coverage fixture for GitHub Copilot CLI.",
			keywords: ["testing"],
			category: "testing",
			skills: "skills/",
			commands: "commands/",
			agents: "agents/",
			hooks: "hooks.json",
			mcpServers: ".mcp.json",
		});

		const command = readText(bundle, "commands/repo-status.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain('description: "Summarize repository status."');
		expect(command).not.toContain("agent:");
		expect(command).toContain("Use Copilot CLI-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, "skills/always-on/SKILL.md");
		expect(alwaysOn).not.toContain("user-invocable");
		expect(alwaysOn).toContain("Copilot CLI always-on guidance.");

		const ruleSkill = readText(bundle, "skills/team-guidance/SKILL.md");
		expect(ruleSkill).toContain('description: "Team guidance"');
		expect(ruleSkill).toContain("Prefer Copilot CLI plugin docs.");

		const agent = readText(bundle, "agents/reviewer.agent.md");
		expect(agent).toContain('name: "Reviewer"');
		expect(agent).toContain('model: "gpt-5.1"');
		expect(agent).not.toContain("tools:");
		expect(agent).toContain("Copilot CLI-specific agent instructions.");

		const readme = readText(bundle, "README.md");
		expect(readme).toContain("copilot plugin install");

		const evidence = readJson<{ target: string; exporter: string }>(
			bundle,
			".oiap/bundle.json",
		);
		expect(evidence.target).toBe(target);
		expect(evidence.exporter).toBe("@oiap/exporter-github-copilot-cli");
	});

	test("maps hooks to Copilot CLI events with PLUGIN_ROOT commands", () => {
		const bundle = exportGitHubCopilotCli(sampleCopilotCliPlugin);
		const hooks = readJson<CopilotCliHooksConfig>(bundle, "hooks.json");
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);
		const preToolUse = first(hooks.hooks.preToolUse, "preToolUse hook");
		const permission = first(
			hooks.hooks.permissionRequest,
			"permissionRequest hook",
		);
		const sessionStart = first(hooks.hooks.sessionStart, "sessionStart hook");

		expect(hooks.version).toBe(1);
		expect(Object.keys(hooks.hooks).sort()).toEqual([
			"permissionRequest",
			"preToolUse",
			"sessionStart",
		]);
		expect(preToolUse).toEqual({
			type: "command",
			bash: `node "$PLUGIN_ROOT/.oiap/runtime/runner.mjs" run-hook --manifest "$PLUGIN_ROOT/.oiap/runtime/manifest.json" --target "${target}" --event "before_tool" --hook "pre-tool"`,
			powershell: `node "$env:PLUGIN_ROOT/.oiap/runtime/runner.mjs" run-hook --manifest "$env:PLUGIN_ROOT/.oiap/runtime/manifest.json" --target "${target}" --event "before_tool" --hook "pre-tool"`,
			timeoutSec: 3,
			matcher: "bash",
		});
		expect(permission.matcher).toBeUndefined();
		expect(sessionStart.matcher).toBeUndefined();

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		expect(runtimeManifest.hooks["pre-tool"]?.targetEvent).toBe("preToolUse");
		expect(runtimeManifest.hooks["permission-check"]?.targetEvent).toBe(
			"permissionRequest",
		);
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("all-hook-decisions");
		expect(degradations).toContain("matched-hook");
		expect(degradations).toContain("always-on-instruction-rule");
		expect(degradations).not.toContain("plugin-root-token-command");
		expect(degradations).not.toContain("all-oiap-hook-events");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).toContain("degraded-rules");
	});

	test("renders Copilot CLI MCP config with typed servers", () => {
		const bundle = exportGitHubCopilotCli({
			...sampleCopilotCliPlugin,
			tools: [
				...sampleCopilotCliPlugin.tools,
				{
					id: "remote",
					transport: "mcp-http",
					tools: [],
					server: {
						url: "https://example.com/mcp",
						headers: { Authorization: "Bearer token" },
						includeTools: ["search"],
					},
				},
				{
					id: "events",
					transport: "mcp-sse",
					tools: [],
					server: { url: "https://example.com/sse", excludeTools: ["drop"] },
				},
			],
		});
		const mcp = readJson<CopilotCliMcpConfig>(bundle, ".mcp.json");

		expect(mcp.mcpServers.docs).toEqual({
			type: "local",
			command: "docs-mcp",
			args: ["--stdio"],
			env: { DOCS_MODE: "plugin" },
			tools: ["*"],
		});
		expect(mcp.mcpServers.remote).toEqual({
			type: "http",
			url: "https://example.com/mcp",
			headers: { Authorization: "Bearer token" },
			tools: ["search"],
		});
		expect(mcp.mcpServers.events).toEqual({
			type: "sse",
			url: "https://example.com/sse",
			tools: ["*"],
		});
		expect(
			bundle.report.degradedCapabilities.map((degradation) => degradation.from),
		).toContain("mcp-exclude-tools");
	});

	test("reports ok when nothing degrades", () => {
		const bundle = exportGitHubCopilotCli({
			manifest: sampleCopilotCliPlugin.manifest,
			instructions: sampleCopilotCliPlugin.instructions.filter(
				(instruction) => instruction.id === "audit-instructions",
			),
			skills: sampleCopilotCliPlugin.skills,
			tools: sampleCopilotCliPlugin.tools,
		});

		expect(bundle.report.status).toBe("ok");
		expect(bundle.report.degradedCapabilities).toEqual([]);
		expect(bundle.report.issues).toEqual([]);
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportGitHubCopilotCli(bundleFilesPlugin);
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
		expect(agent).toContain("include-custom-instructions: false");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
		expect(bundle.report.status).toBe("degraded");
	});

	test("keeps explicit agent tools over access", () => {
		const bundle = exportGitHubCopilotCli({
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
		const bundle = exportGitHubCopilotCli({
			...bundleFilesPlugin,
			resources: [{ path: "agents/critic.agent.md", content: "shadow" }],
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});

	test("reports path tokens that cannot be resolved", () => {
		const bundle = exportGitHubCopilotCli({
			...bundleFilesPlugin,
			resources: [
				{
					path: "standards/style.md",
					content: "See $" + "{OIAP_AGENT_FILE:ghost}.",
				},
			],
		});
		const issueCodes = bundle.report.issues.map((issue) => issue.code);

		expect(bundle.report.status).toBe("unsupported");
		expect(issueCodes).toContain("unresolved-path-token");
	});
});

const bundleFilesAgent = {
	id: "critic",
	name: "critic",
	description: "Read-only critic.",
	instructions: { id: "critic-body", kind: "instruction" },
	access: "read-only",
	targetMetadata: {
		[target]: {
			"user-invocable": false,
			"include-custom-instructions": false,
		},
	},
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

const sampleCopilotCliPlugin = {
	manifest: {
		id: "sample-copilot-cli",
		name: "Sample Copilot CLI",
		version: "1.2.3",
		description: "Exporter coverage fixture for GitHub Copilot CLI.",
		categories: ["testing"],
		supportedTargets: [target],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { [target]: "repo-status" },
			helpText: "Summarize repository status.",
			examples: ["/sample-copilot-cli:repo-status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Use generic status workflow.",
			hostOverrides: {
				[target]: "Use Copilot CLI-specific status workflow.",
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
				[target]: "Copilot CLI-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "Copilot CLI always-on guidance.",
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
			content: "Prefer Copilot CLI plugin docs.",
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
			id: "permission-check",
			event: "permission_request",
			handler: () => ({ decision: "allow" as const }),
		},
		{
			kind: "oiap.hook",
			id: "session-banner",
			event: "session_start",
			handler: () => ({ decision: "noop" as const }),
			match: { agentName: "reviewer" },
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

interface CopilotCliPluginManifest {
	name: string;
	version: string;
	description: string;
	keywords?: string[];
	category?: string;
	skills?: string;
	commands?: string;
	agents?: string;
	hooks?: string;
	mcpServers?: string;
}

interface CopilotCliHookEntry {
	type: string;
	bash: string;
	powershell: string;
	timeoutSec?: number;
	matcher?: string;
}

interface CopilotCliHooksConfig {
	version: number;
	hooks: Record<string, CopilotCliHookEntry[] | undefined>;
}

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string }>;
}

interface CopilotCliMcpConfig {
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

function first<TValue>(values: TValue[] | undefined, label: string): TValue {
	const value = values?.[0];

	if (!value) {
		throw new Error(`Missing ${label}`);
	}

	return value;
}
