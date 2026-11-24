/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportAntigravity } from "./exporter.ts";

const target = "antigravity";

describe("exportAntigravity", () => {
	test("renders a native Antigravity plugin", () => {
		const bundle = exportAntigravity(sampleAntigravityPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe(target);
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe(
			".antigravity-plugin/plugin.json",
		);
		expect(paths).toContain(".antigravity-plugin/plugin.json");
		expect(paths).not.toContain("plugin.json");
		expect(paths).toContain("skills/repo-status/SKILL.md");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("rules/always-on.md");
		expect(paths).toContain("rules/team-guidance.md");
		expect(paths).toContain("agents/reviewer.md");
		expect(paths).toContain("hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/hooks/pre-tool.json");
		expect(paths).toContain("mcp_config.json");
		expect(paths).toContain(".oiap/antigravity-permissions.json");
		expect(paths).toContain(".oiap/capability-report.json");
		expect(paths.some((path) => path.startsWith(".agents/"))).toBe(false);
		expect(paths.some((path) => path.startsWith("commands/"))).toBe(false);

		const manifest = readJson<Record<string, unknown>>(
			bundle,
			".antigravity-plugin/plugin.json",
		);
		expect(manifest).toEqual({
			$schema: "https://antigravity.google/schemas/v1/plugin.json",
			name: "sample-antigravity",
			displayName: "Sample Antigravity",
			description: "Exporter coverage fixture for Antigravity.",
			version: "1.2.3",
			author: { name: "OIAP" },
			keywords: ["testing"],
		});

		const command = readText(bundle, "skills/repo-status/SKILL.md");
		expect(command).toContain('name: "repo-status"');
		expect(command).toContain("disable-model-invocation: true");
		expect(command).toContain("Use Antigravity-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const alwaysOn = readText(bundle, "rules/always-on.md");
		expect(alwaysOn).toContain('trigger: "always_on"');
		expect(alwaysOn).toContain("Antigravity always-on guidance.");

		const rule = readText(bundle, "rules/team-guidance.md");
		expect(rule).toContain('trigger: "glob"');
		expect(rule).toContain('globs: "**/*.ts"');
		expect(rule).toContain("Prefer Antigravity docs.");

		const agent = readText(bundle, "agents/reviewer.md");
		expect(agent).toBe(
			[
				"---",
				'name: "reviewer"',
				'description: "Review generated changes."',
				"---",
				"",
				"Antigravity-specific agent instructions.",
			].join("\n"),
		);
		expect(bundle.report.issues).not.toContainEqual(
			expect.objectContaining({ code: "invalid-antigravity-plugin-manifest" }),
		);
	});

	test("renders hooks.json that runs the OIAP runner from the plugin root", () => {
		const bundle = exportAntigravity(sampleAntigravityPlugin);
		const hooks = readJson<
			Record<
				string,
				{
					enabled: boolean;
					PreToolUse: {
						matcher: string;
						hooks: { type: string; command: string; timeout: number }[];
					}[];
				}
			>
		>(bundle, "hooks.json");
		const group = hooks["sample-antigravity"];

		expect(group?.enabled).toBe(true);
		expect(group?.PreToolUse[0]?.matcher).toBe("Shell");
		expect(group?.PreToolUse[0]?.hooks[0]).toEqual({
			type: "command",
			command:
				'node "./.oiap/runtime/runner.mjs" run-hook --manifest "./.oiap/runtime/manifest.json" --target "antigravity" --event "before_tool" --hook "pre-tool"',
			timeout: 3,
		});
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
		expect(degradedKinds).toContain("policy");
		expect(degradedKinds).not.toContain("agents");
		expect(issueCodes).toContain("degraded-commands");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).toContain("degraded-policy");
		expect(
			bundle.report.mappedCapabilities.map((capability) => capability.kind),
		).toEqual(expect.arrayContaining(["agents", "hooks", "skills"]));
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportAntigravity(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../agents/critic.md.",
		);
		expect(readText(bundle, "agents/critic.md")).not.toContain("access");
		expect(readText(bundle, "README.md")).toContain("plugin root");
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).toContain("read-only-agent");
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportAntigravity({
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
		},
	],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

const sampleAntigravityPlugin = {
	manifest: {
		id: "sample-antigravity",
		name: "Sample Antigravity",
		version: "1.2.3",
		description: "Exporter coverage fixture for Antigravity.",
		categories: ["testing"],
		author: { name: "OIAP" },
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
