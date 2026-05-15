/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportCodex } from "./exporter";

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
});

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
