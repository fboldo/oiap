/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportCursor } from "./exporter";

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
});

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
