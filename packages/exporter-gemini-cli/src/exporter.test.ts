/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportGeminiCli } from "./exporter";

describe("exportGeminiCli", () => {
	test("renders a Gemini CLI extension bundle", () => {
		const bundle = exportGeminiCli(sampleGeminiPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("gemini-cli");
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe("gemini-extension.json");
		expect(paths).toContain("gemini-extension.json");
		expect(paths).toContain("commands/repo/status.toml");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("hooks/hooks.json");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain("GEMINI.md");
		expect(paths).toContain("agents/reviewer.md");
		expect(paths).toContain("policies/oiap-policy.toml");
		expect(paths).toContain(".oiap/capability-report.json");

		const manifest = readJson<GeminiExtensionManifest>(
			bundle,
			"gemini-extension.json",
		);
		expect(manifest.name).toBe("sample-gemini");
		expect(manifest.version).toBe("1.2.3");
		expect(manifest.contextFileName).toBe("GEMINI.md");
		expect(manifest.excludeTools).toEqual(["run_shell_command(rm -rf)"]);
		expect(manifest.mcpServers.docs.command).toBe("docs-mcp");
		expect(manifest.mcpServers.docs.args).toEqual(["--stdio"]);
		expect(manifest.mcpServers.docs.includeTools).toEqual(["search"]);
		expect(manifest.mcpServers.docs.env.DOCS_TOKEN).toBe("$" + "{DOCS_TOKEN}");
		expect(manifest.settings?.[0]?.envVar).toBe("DOCS_TOKEN");

		const command = readText(bundle, "commands/repo/status.toml");
		expect(command).toContain('description = "Summarize repository status."');
		expect(command).toContain("Use Gemini-specific status workflow.");

		const skill = readText(bundle, "skills/audit-repo/SKILL.md");
		expect(skill).toContain('name: "audit-repo"');
		expect(skill).toContain("# Audit Repo");

		const geminiMd = readText(bundle, "GEMINI.md");
		expect(geminiMd).toContain("Gemini always-on project guidance.");
		expect(geminiMd).toContain("Prefer Gemini CLI extension docs.");

		const agent = readText(bundle, "agents/reviewer.md");
		expect(agent).toContain('name: "reviewer"');
		expect(agent).toContain("Gemini-specific agent instructions.");

		const policy = readText(bundle, "policies/oiap-policy.toml");
		expect(policy).toContain('toolName = "run_shell_command"');
		expect(policy).toContain('commandPrefix = "rm -rf"');
		expect(policy).toContain('decision = "deny"');
	});

	test("maps Gemini CLI hooks and reports expected degradations", () => {
		const bundle = exportGeminiCli(sampleGeminiPlugin);
		const hooks = readJson<GeminiHooksConfig>(bundle, "hooks/hooks.json");
		const extensionPath = "$" + "{extensionPath}";
		const pathSeparator = "$" + "{/}";
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);
		const beforeTool = first(hooks.hooks.BeforeTool, "BeforeTool hook");
		const beforeToolCommand = first(beforeTool.hooks, "BeforeTool command");

		expect(beforeTool.matcher).toBe("write_file");
		expect(beforeToolCommand.command).toBe(
			`node "${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}runner.mjs" run-hook --manifest "${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}manifest.json" --target "gemini-cli" --event "before_tool" --hook "pre-tool"`,
		);
		expect(beforeToolCommand.timeout).toBe(2500);
		expect(hooks.hooks.PermissionRequest).toBeUndefined();

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const runtimeHook = runtimeManifest.hooks["pre-tool"];
		expect(runtimeHook?.event).toBe("before_tool");
		expect(runtimeHook?.targetEvent).toBe("BeforeTool");
		expect(runtimeManifest.hooks["permission-gate"]).toBeUndefined();
		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("agents");
		expect(degradedKinds).toContain("hooks");
		expect(degradedKinds).toContain("policy");
		expect(degradedKinds).not.toContain("commands");
		expect(issueCodes).toContain("degraded-agents");
		expect(issueCodes).toContain("degraded-hooks");
		expect(issueCodes).toContain("degraded-policy");
	});
});

const sampleGeminiPlugin = {
	manifest: {
		id: "sample-gemini",
		name: "Sample Gemini",
		version: "1.2.3",
		description: "Exporter coverage fixture for Gemini CLI.",
		categories: ["testing"],
		supportedTargets: ["gemini-cli"],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { "gemini-cli": "repo:status" },
			helpText: "Summarize repository status.",
			examples: ["/repo:status"],
		},
	],
	instructions: [
		{
			id: "status-prompt",
			purpose: "command",
			triggers: ["status"],
			body: "Use generic status workflow.",
			hostOverrides: {
				"gemini-cli": "Use Gemini-specific status workflow.",
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
				"gemini-cli": "Gemini-specific agent instructions.",
			},
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				"gemini-cli": "Gemini always-on project guidance.",
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
			id: "gemini-guidance",
			target: "gemini-cli",
			path: "GEMINI.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "Gemini project context",
			content: "Prefer Gemini CLI extension docs.",
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
			match: { tool: { name: "write_file" } },
			timeoutMs: 2500,
		},
		{
			kind: "oiap.hook",
			id: "permission-gate",
			event: "permission_request",
			handler: () => ({ decision: "allow" as const }),
			match: { permission: "shell" },
		},
	],
	tools: [
		{
			id: "docs",
			transport: "mcp-stdio",
			tools: [{ name: "search", description: "Search documentation." }],
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
				{
					kind: "process",
					access: "allow",
					resources: ["git status"],
				},
			],
			secrets: {
				allowedRefs: ["DOCS_TOKEN"],
				redactLogs: true,
			},
		},
	],
	runtimeModules: [
		{
			id: "gemini-hook-runner",
			target: "gemini-cli",
			language: "typescript",
			purpose: "hook_handler",
			entrypoint: "src/hooks.ts",
			generated: true,
		},
	],
} satisfies PluginDefinition;

interface GeminiExtensionManifest {
	name: string;
	version: string;
	contextFileName?: string | string[];
	excludeTools?: string[];
	mcpServers: {
		docs: {
			command: string;
			args: string[];
			includeTools: string[];
			env: Record<string, string>;
		};
	};
	settings?: Array<{ envVar: string }>;
}

interface GeminiHooksConfig {
	hooks: {
		BeforeTool: Array<{
			matcher: string;
			hooks: Array<{ command: string; timeout?: number }>;
		}>;
		PermissionRequest?: unknown;
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
