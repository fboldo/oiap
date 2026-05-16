/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportAntigravity } from "./exporter";

const target = "antigravity";

describe("exportAntigravity", () => {
	test("renders Antigravity workspace bundle assets", () => {
		const bundle = exportAntigravity(sampleAntigravityPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".oiap/antigravity-target.json");
		expect(paths).toContain(".oiap/antigravity-target.json");
		expect(paths).toContain(".agents/workflows/repo-status.md");
		expect(paths).toContain(".agents/skills/audit-repo/SKILL.md");
		expect(paths).toContain(".agents/rules/always-on.md");
		expect(paths).toContain(".agents/rules/team-guidance.md");
		expect(paths).toContain(".oiap/agents/reviewer.json");
		expect(paths).toContain(".oiap/hooks/pre-tool.json");
		expect(paths).toContain("mcp_config.json");
		expect(paths).toContain(".oiap/antigravity-permissions.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<AntigravityTargetManifest>(
			bundle,
			".oiap/antigravity-target.json",
		);
		expect(manifest).toMatchObject({
			name: "sample-antigravity",
			displayName: "Sample Antigravity",
			target,
			rules: ".agents/rules/",
			skills: ".agents/skills/",
			workflows: ".agents/workflows/",
			mcpConfig: "mcp_config.json",
		});

		const workflow = readText(bundle, ".agents/workflows/repo-status.md");
		expect(workflow).toContain('name: "repo-status"');
		expect(workflow).toContain("Use Antigravity-specific status workflow.");

		const skill = readText(bundle, ".agents/skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, ".agents/rules/always-on.md");
		expect(alwaysOn).toContain('activation: "always"');
		expect(alwaysOn).toContain("Antigravity always-on guidance.");

		const rule = readText(bundle, ".agents/rules/team-guidance.md");
		expect(rule).toContain('activation: "glob"');
		expect(rule).toContain('globs: ["**/*.ts"]');
		expect(rule).toContain("Prefer Antigravity docs.");

		const agent = readJson<AntigravityAgentMetadata>(
			bundle,
			".oiap/agents/reviewer.json",
		);
		expect(agent.name).toBe("Reviewer");
		expect(agent.instructions).toContain(
			"Antigravity-specific agent instructions.",
		);
	});

	test("renders Antigravity MCP config and permission fragments", () => {
		const bundle = exportAntigravity(sampleAntigravityPlugin);
		const mcp = readJson<AntigravityMcpConfig>(bundle, "mcp_config.json");
		const permissions = readJson<AntigravityPermissions>(
			bundle,
			".oiap/antigravity-permissions.json",
		);

		expect(mcp.mcpServers.docs.command).toBe("docs-mcp");
		expect(mcp.mcpServers.docs.args).toEqual(["--stdio"]);
		expect(mcp.mcpServers.docs.env).toEqual({ DOCS_MODE: "plugin" });
		expect(mcp.mcpServers.docs.disabledTools).toEqual(["delete"]);
		expect(permissions.permissions.deny).toContain("command(rm -rf)");
		expect(permissions.permissions.ask).toContain("mcp(*)");
		expect(permissions.permissions.allow).toContain("read_url(example.com)");
	});

	test("reports documented Antigravity degradations honestly", () => {
		const bundle = exportAntigravity(sampleAntigravityPlugin);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);

		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("commands");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).toContain("agents");
		expect(degradedKinds).toContain("policy");
		expect(issueCodes).toContain("degraded-commands");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).toContain("degraded-agents");
		expect(issueCodes).toContain("degraded-policy");
	});
});

const sampleAntigravityPlugin = {
	manifest: {
		id: "sample-antigravity",
		name: "Sample Antigravity",
		version: "1.2.3",
		description: "Exporter coverage fixture for Antigravity.",
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
				[target]: "Use Antigravity-specific status workflow.",
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
				[target]: "Antigravity-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "Antigravity always-on guidance.",
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
			model: "gemini-3-pro",
		},
	],
	rules: [
		{
			id: "team-guidance",
			target,
			path: ".agents/rules/team-guidance.md",
			scope: "workspace",
			mergeStrategy: "frontmatter-file",
			activation: "glob",
			globs: ["**/*.ts"],
			description: "Team guidance",
			content: "Prefer Antigravity docs.",
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
				excludeTools: ["delete"],
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
				{
					kind: "mcp",
					access: "ask",
					resources: ["*"],
				},
				{
					kind: "network",
					access: "allow",
					resources: ["example.com"],
				},
			],
		},
	],
	runtimeModules: [],
} satisfies PluginDefinition;

interface AntigravityTargetManifest {
	name: string;
	displayName: string;
	target: string;
	rules?: string;
	skills?: string;
	workflows?: string;
	mcpConfig?: string;
}

interface AntigravityAgentMetadata {
	name: string;
	instructions: string;
}

interface AntigravityMcpConfig {
	mcpServers: {
		docs: {
			command: string;
			args: string[];
			env?: Record<string, string>;
			disabledTools?: string[];
		};
	};
}

interface AntigravityPermissions {
	permissions: {
		allow: string[];
		deny: string[];
		ask: string[];
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
