/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportCline } from "./exporter";

const target = "cline";

describe("exportCline", () => {
	test("renders a Cline project bundle", () => {
		const bundle = exportCline(sampleClinePlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(".oiap/cline-target.json");
		expect(paths).toContain(".oiap/cline-target.json");
		expect(paths).toContain(".clinerules/always-on.md");
		expect(paths).toContain(".clinerules/team-guidance.md");
		expect(paths).toContain(".cline/skills/audit-repo/SKILL.md");
		expect(paths).toContain(".cline/skills/repo-status/SKILL.md");
		expect(paths).toContain(".cline/agents/reviewer.yaml");
		expect(paths).toContain(".cline/hooks/PreToolUse.cjs");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".cline/mcp.json");
		expect(paths).toContain(".oiap/policy.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<ClineTargetManifest>(
			bundle,
			".oiap/cline-target.json",
		);
		expect(manifest).toMatchObject({
			name: "sample-cline",
			version: "1.2.3",
			description: "Exporter coverage fixture for Cline.",
			rules: ".clinerules/",
			skills: ".cline/skills/",
			commands: ".cline/skills/",
			agents: ".cline/agents/",
			hooks: ".cline/hooks/",
			mcp: ".cline/mcp.json",
			policies: ".oiap/policy.json",
		});

		const command = readText(bundle, ".cline/skills/repo-status/SKILL.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain('oiap-kind: "command"');
		expect(command).toContain("Use Cline-specific status workflow.");

		const skill = readText(bundle, ".cline/skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, ".clinerules/always-on.md");
		expect(alwaysOn).toContain('purpose: "always_on"');
		expect(alwaysOn).toContain("Cline always-on guidance.");

		const rule = readText(bundle, ".clinerules/team-guidance.md");
		expect(rule).toContain('paths: ["**/*.ts"]');
		expect(rule).toContain("Prefer Cline project docs.");

		const agent = readText(bundle, ".cline/agents/reviewer.yaml");
		expect(agent).toContain('name: "reviewer"');
		expect(agent).toContain('modelId: "gpt-5.1"');
		expect(agent).toContain("Cline-specific agent instructions.");
		expect(agent).toContain("## OIAP Tool References");
	});

	test("maps Cline hooks and reports degraded events", () => {
		const bundle = exportCline(sampleClinePlugin);
		const hookScript = readText(bundle, ".cline/hooks/PreToolUse.cjs");
		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);

		expect(hookScript).toContain('"id": "pre-tool"');
		expect(hookScript).toContain('"--target"');
		expect(hookScript).toContain('"cline"');
		expect(runtimeManifest.hooks["pre-tool"]?.event).toBe("before_tool");
		expect(runtimeManifest.hooks["pre-tool"]?.targetEvent).toBe("tool_call");
		expect(runtimeManifest.hooks["permission-check"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).toContain("commands");
		expect(degradedKinds).toContain("agents");
		expect(degradedKinds).toContain("mcp");
		expect(degradedKinds).toContain("policy");
	});

	test("renders Cline MCP config with top-level mcpServers", () => {
		const mcp = readJson<ClineMcpConfig>(
			exportCline(sampleClinePlugin),
			".cline/mcp.json",
		);

		expect(mcp.mcpServers.docs.command).toBe("docs-mcp");
		expect(mcp.mcpServers.docs.args).toEqual(["--stdio"]);
		expect(mcp.mcpServers.docs.env).toEqual({ DOCS_MODE: "plugin" });
		expect(mcp.mcpServers.docs.autoApprove).toEqual([]);
	});
});

const sampleClinePlugin = {
	manifest: {
		id: "sample-cline",
		name: "Sample Cline",
		version: "1.2.3",
		description: "Exporter coverage fixture for Cline.",
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
				[target]: "Use Cline-specific status workflow.",
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
				[target]: "Cline-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				[target]: "Cline always-on guidance.",
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
			path: ".cline/rules/team-guidance.md",
			scope: "workspace",
			mergeStrategy: "frontmatter-file",
			activation: "glob",
			globs: ["**/*.ts"],
			description: "Team guidance",
			content: "Prefer Cline project docs.",
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
				includeTools: ["search_docs"],
				cwd: ".",
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

interface ClineTargetManifest {
	name: string;
	version: string;
	description: string;
	rules?: string;
	skills?: string;
	commands?: string;
	agents?: string;
	hooks?: string;
	mcp?: string;
	policies?: string;
}

interface RuntimeManifest {
	hooks: Record<string, { event: string; targetEvent?: string } | undefined>;
}

interface ClineMcpConfig {
	mcpServers: {
		docs: {
			command: string;
			args: string[];
			env?: Record<string, string>;
			autoApprove?: string[];
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
