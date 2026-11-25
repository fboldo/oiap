/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportGeminiCli } from "./exporter.ts";

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
		expect(paths).toContain(".oiap/runtime/gemini-cli/runner.mjs");
		expect(paths).toContain(".oiap/runtime/gemini-cli/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/gemini-cli/manifest.json");
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
			`node "${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}gemini-cli${pathSeparator}runner.mjs" run-hook --manifest "${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}gemini-cli${pathSeparator}manifest.json" --target "gemini-cli" --event "before_tool" --hook "pre-tool"`,
		);
		expect(beforeToolCommand.timeout).toBe(2500);
		expect(hooks.hooks.PermissionRequest).toBeUndefined();

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/gemini-cli/manifest.json",
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

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportGeminiCli(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../agents/critic.md.",
		);
		expect(readText(bundle, "agents/critic.md")).toContain(
			'tools: ["read_file","read_many_files","list_directory","glob","grep_search"]',
		);
		expect(readText(bundle, "agents/critic.md")).toContain("max_turns: 5");
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).not.toContain("read-only-agent");
	});

	test("degrades invocation controls and host-instruction isolation", () => {
		const skill = first(bundleFilesPlugin.skills, "skill");
		const agent = first(bundleFilesPlugin.agents, "agent");
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				displayName: "Bundle Files Plugin",
				keywords: ["review"],
				logo: "assets/logo.svg",
				author: { name: "Acme" },
				repository: "https://github.com/acme/bundle-files",
			},
			resources: [
				...bundleFilesPlugin.resources,
				{ path: "assets/logo.svg", content: "<svg/>" },
			],
			skills: [
				{ ...skill, modelInvocable: false },
				{ ...skill, id: "hidden", name: "hidden", userInvocable: false },
			],
			agents: [{ ...agent, hostInstructions: "exclude" }],
		});
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => [degradation.capability.kind, degradation.from],
		);
		const manifest = readJson(bundle, "gemini-extension.json");

		expect(degradations).toContainEqual(["skills", "user-only-skill"]);
		expect(degradations).toContainEqual(["skills", "model-only-skill"]);
		expect(degradations).toContainEqual([
			"agents",
			"agent-without-host-instructions",
		]);
		expect(Object.keys(manifest).sort()).toEqual([
			"description",
			"name",
			"version",
		]);
		expect(readText(bundle, "skills/review/SKILL.md")).not.toContain(
			"disable-model-invocation",
		);
	});

	test("does not degrade invocation controls left at their defaults", () => {
		const degradations = exportGeminiCli(
			bundleFilesPlugin,
		).report.degradedCapabilities.map((degradation) => degradation.from);

		expect(degradations).not.toContain("user-only-skill");
		expect(degradations).not.toContain("model-only-skill");
		expect(degradations).not.toContain("agent-without-host-instructions");
	});

	test("drops primitives limited to other targets", () => {
		const skill = first(bundleFilesPlugin.skills, "skill");
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			skills: [
				skill,
				{
					...skill,
					id: "claude-only",
					name: "claude-only",
					targets: ["claude-code"],
				},
			],
		});
		const paths = bundle.files.map((file) => file.path);

		expect(paths).toContain("skills/review/SKILL.md");
		expect(paths.some((path) => path.includes("claude-only"))).toBe(false);
		expect(JSON.stringify(bundle.report)).not.toContain("claude-only");
	});

	test("merges manifest targetMetadata and removes null fields", () => {
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				targetMetadata: {
					"gemini-cli": { version: null, plan: { directory: "plans" } },
					"claude-code": { description: "Not for Gemini." },
				},
			},
		});
		const manifest = readJson(bundle, "gemini-extension.json");

		expect(manifest.version).toBeUndefined();
		expect(manifest.plan).toEqual({ directory: "plans" });
		expect(manifest.description).toBe(
			"Skill files, resources and path tokens.",
		);
	});

	test("emits target files at the extension root", () => {
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			targetFiles: {
				"gemini-cli": [{ path: "hooks/check.sh", content: "#!/bin/sh\n" }],
				"claude-code": [{ path: "hooks/claude.sh", content: "#!/bin/sh\n" }],
			},
		});
		const paths = bundle.files.map((file) => file.path);

		expect(readText(bundle, "hooks/check.sh")).toBe("#!/bin/sh\n");
		expect(paths).not.toContain("hooks/claude.sh");
	});

	test("emits an in-place agent file unchanged", () => {
		const agent = first(bundleFilesPlugin.agents, "agent");
		const content = "---\nname: critic\ncustom: kept\n---\n\nAs written.\n";
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			agents: [{ ...agent, source: { file: "agents/critic.md", content } }],
		});

		expect(readText(bundle, "agents/critic.md")).toBe(content);
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportGeminiCli({
			...bundleFilesPlugin,
			resources: [{ path: "agents/critic.md", content: "shadow" }],
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
		supportedTargets: ["gemini-cli"],
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
			targetMetadata: { "gemini-cli": { max_turns: 5 } },
		},
	],
	resources: [{ path: "standards/style.md", content: "Style" }],
} satisfies PluginDefinition;

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
