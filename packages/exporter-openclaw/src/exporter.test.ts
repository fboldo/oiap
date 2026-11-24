/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { PluginDefinition, RenderedFile, TargetBundle } from "@oiap/core";
import { exportOpenClaw } from "./exporter.ts";

describe("exportOpenClaw", () => {
	test("renders a native OpenClaw plugin package", () => {
		const bundle = exportOpenClaw(sampleOpenClawPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("openclaw");
		expect(bundle.format).toBe("directory");
		expect(bundle.package?.manifestPath).toBe("openclaw.plugin.json");
		expect(paths).toContain("package.json");
		expect(paths).toContain("openclaw.plugin.json");
		expect(paths).toContain("index.ts");
		expect(paths).toContain("skills/repo-status/SKILL.md");
		expect(paths).toContain("skills/audit-repo/SKILL.md");
		expect(paths).toContain("skills/always-on/SKILL.md");
		expect(paths).toContain("skills/workspace-policy/SKILL.md");
		expect(paths).toContain(".oiap/runtime/runner.mjs");
		expect(paths).toContain(".oiap/runtime/hooks.mjs");
		expect(paths).toContain(".oiap/runtime/manifest.json");
		expect(paths).toContain(".openclaw/mcp.json");
		expect(paths).toContain(".openclaw/policy.json");
		expect(paths).toContain(".oiap/capability-report.json");

		const packageJson = readJson<OpenClawPackageJson>(bundle, "package.json");
		expect(packageJson.openclaw.extensions).toEqual(["./index.ts"]);
		expect(packageJson.openclaw.compat.pluginApi).toBe(">=2026.3.24-beta.2");

		const manifest = readJson<OpenClawManifest>(bundle, "openclaw.plugin.json");
		expect(manifest.id).toBe("sample-openclaw");
		expect(manifest.configSchema.type).toBe("object");
		expect(manifest.skills).toEqual(["./skills"]);
		expect(manifest.contracts.tools).toEqual(["docs_search"]);
		expect(manifest.commandAliases[0]).toEqual({
			name: "repo-status",
			kind: "runtime-slash",
		});
		expect(manifest.activation.onStartup).toBe(true);
		expect(manifest.activation.onCommands).toEqual(["repo-status"]);
		expect(manifest.activation.onCapabilities).toEqual(["tool", "hook"]);
	});

	test("renders OpenClaw entrypoint, skills, hooks, and evidence files", () => {
		const bundle = exportOpenClaw(sampleOpenClawPlugin);
		const entrypoint = readText(bundle, "index.ts");
		const commandSkill = readText(bundle, "skills/repo-status/SKILL.md");
		const alwaysOnSkill = readText(bundle, "skills/always-on/SKILL.md");
		const mcp = readJson<OpenClawMcpEvidence>(bundle, ".openclaw/mcp.json");

		expect(entrypoint).toContain(
			'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
		);
		expect(entrypoint).toContain('api.on("before_tool_call"');
		expect(entrypoint).toContain('runOiapHook({ hookId: "pre-tool"');
		expect(entrypoint).toContain('"timeoutMs":2500');
		expect(entrypoint).toContain("api.registerTool(registration);");

		const runtimeManifest = readJson<RuntimeManifest>(
			bundle,
			".oiap/runtime/manifest.json",
		);
		const runtimeHook = runtimeManifest.hooks["pre-tool"];
		expect(runtimeHook?.event).toBe("before_tool");
		expect(runtimeHook?.targetEvent).toBe("before_tool_call");
		expect(commandSkill).toContain('name: "repo-status"');
		expect(commandSkill).toContain("user-invocable: true");
		expect(commandSkill).toContain("Use OpenClaw-specific status workflow.");
		expect(alwaysOnSkill).toContain('metadata: {"openclaw":{"always":true}}');
		expect(alwaysOnSkill).toContain("OpenClaw always-on project guidance.");
		expect(mcp.mcp.servers.docs.command).toBe("docs-mcp");
		expect(mcp.mcp.servers.docs.args).toEqual(["--stdio"]);
	});

	test("reports degraded runtime surfaces honestly", () => {
		const bundle = exportOpenClaw(sampleOpenClawPlugin);
		const degradedKinds = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.capability.kind,
		);
		const issueCodes = bundle.report.issues.map((issue) => issue.code);

		expect(bundle.report.status).toBe("degraded");
		expect(degradedKinds).toContain("commands");
		expect(degradedKinds).toContain("rules");
		expect(degradedKinds).not.toContain("hooks");
		expect(degradedKinds).toContain("mcp");
		expect(degradedKinds).toContain("agents");
		expect(degradedKinds).toContain("policy");
		expect(degradedKinds).not.toContain("runtime");
		expect(issueCodes).toContain("degraded-commands");
		expect(issueCodes).not.toContain("degraded-hooks");
		expect(issueCodes).not.toContain("degraded-runtime");
	});

	test("ships skill files and resources and resolves bundle paths", () => {
		const bundle = exportOpenClaw(bundleFilesPlugin);
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => degradation.from,
		);

		expect(readText(bundle, "skills/review/references/guide.md")).toBe("Guide");
		expect(readText(bundle, "standards/style.md")).toBe("Style");
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"Read ../../standards/style.md, then dispatch ../../.oiap/agents/critic.json.",
		);
		expect(
			readJson<{ access?: string; instructions?: string }>(
				bundle,
				".oiap/agents/critic.json",
			),
		).toMatchObject({
			access: "read-only",
			instructions: "Critique the document.",
		});
		expect(bundle.report.status).toBe("degraded");
		expect(degradations).toContain("plugin-root-variable");
		expect(degradations).toContain("read-only-agent");
	});

	test("maps manifest metadata, icon and skill invocation", () => {
		const icon = new Uint8Array([137, 80, 78, 71]);
		const bundle = exportOpenClaw({
			...bundleFilesPlugin,
			manifest: {
				...bundleFilesPlugin.manifest,
				displayName: "Bundle Files Plugin",
				keywords: ["review"],
				logo: "branding/logo.png",
				author: { name: "Acme", email: "dev@acme.example" },
				repository: "https://github.com/acme/bundle-files",
			},
			resources: [
				...bundleFilesPlugin.resources,
				{ path: "branding/logo.png", content: icon },
			],
			skills: [
				...bundleFilesPlugin.skills.map((skill) => ({
					...skill,
					modelInvocable: false,
				})),
				...bundleFilesPlugin.skills.map((skill) => ({
					...skill,
					id: "hidden",
					name: "hidden",
					userInvocable: false,
					targetMetadata: { openclaw: { "user-invocable": true } },
				})),
			],
			agents: bundleFilesPlugin.agents.map((agent) => ({
				...agent,
				hostInstructions: "exclude" as const,
			})),
		});
		const packageJson = readJson(bundle, "package.json");
		const manifest = readJson(bundle, "openclaw.plugin.json");
		const degradations = bundle.report.degradedCapabilities.map(
			(degradation) => [degradation.capability.kind, degradation.from],
		);

		expect(packageJson).toMatchObject({
			keywords: ["review"],
			author: { name: "Acme", email: "dev@acme.example" },
			repository: {
				type: "git",
				url: "https://github.com/acme/bundle-files",
			},
		});
		expect(manifest.name).toBe("Bundle Files Plugin");
		expect(manifest).not.toHaveProperty("logo");
		expect(readText(bundle, "index.ts")).toContain(
			'name: "Bundle Files Plugin"',
		);
		expect(findFile(bundle, "assets/icon.png").content).toEqual(icon);
		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"disable-model-invocation: true",
		);
		expect(readText(bundle, "skills/review/SKILL.md")).not.toContain(
			"user-invocable",
		);
		expect(readText(bundle, "skills/hidden/SKILL.md")).toContain(
			"user-invocable: true",
		);
		expect(readJson(bundle, ".oiap/agents/critic.json").hostInstructions).toBe(
			"exclude",
		);
		expect(degradations).toContainEqual([
			"agents",
			"agent-without-host-instructions",
		]);
		expect(degradations).not.toContainEqual(["skills", "user-only-skill"]);
		expect(degradations).not.toContainEqual(["skills", "model-only-skill"]);
	});

	test("writes user-invocable: false and warns about a non-PNG logo", () => {
		const bundle = exportOpenClaw({
			...bundleFilesPlugin,
			manifest: { ...bundleFilesPlugin.manifest, logo: "standards/style.md" },
			skills: bundleFilesPlugin.skills.map((skill) => ({
				...skill,
				userInvocable: false,
			})),
		});
		const paths = bundle.files.map((file) => file.path);

		expect(readText(bundle, "skills/review/SKILL.md")).toContain(
			"user-invocable: false",
		);
		expect(paths).not.toContain("assets/icon.png");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"unmapped-logo",
		);
		expect(
			bundle.report.degradedCapabilities.map((degradation) => degradation.from),
		).not.toContain("agent-without-host-instructions");
	});

	test("reports duplicate bundle files", () => {
		const bundle = exportOpenClaw({
			...bundleFilesPlugin,
			resources: [{ path: "openclaw.plugin.json", content: "{}" }],
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
		supportedTargets: ["openclaw"],
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

const sampleOpenClawPlugin = {
	manifest: {
		id: "sample-openclaw",
		name: "Sample OpenClaw",
		version: "1.2.3",
		description: "Exporter coverage fixture for OpenClaw.",
		categories: ["testing"],
		supportedTargets: ["openclaw"],
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			targetAliases: { openclaw: "repo-status" },
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
				openclaw: "Use OpenClaw-specific status workflow.",
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
			body: "Review generated changes.",
		},
		{
			id: "always-on",
			purpose: "always_on",
			triggers: ["always"],
			body: "Generic always-on guidance.",
			hostOverrides: {
				openclaw: "OpenClaw always-on project guidance.",
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
		},
	],
	rules: [
		{
			id: "workspace-policy",
			target: "openclaw",
			path: "AGENTS.md",
			scope: "workspace",
			mergeStrategy: "append-section",
			activation: "always",
			description: "OpenClaw project policy",
			content: "Prefer OpenClaw native plugin docs.",
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
	],
	tools: [
		{
			id: "docs",
			transport: "mcp-stdio",
			tools: [
				{
					name: "docs_search",
					description: "Search documentation.",
					inputSchema: {
						type: "object",
						additionalProperties: false,
						properties: { query: { type: "string" } },
					},
				},
			],
			server: {
				command: "docs-mcp",
				args: ["--stdio"],
			},
		},
	],
	policies: [
		{
			permissions: [
				{
					kind: "process",
					access: "ask",
					resources: ["git status"],
					reason: "Status checks need command approval.",
				},
			],
		},
	],
	runtimeModules: [
		{
			id: "openclaw-hook-runner",
			target: "openclaw",
			language: "typescript",
			purpose: "hook_handler",
			entrypoint: "src/hooks.ts",
			generated: true,
		},
	],
} satisfies PluginDefinition;

interface OpenClawPackageJson {
	openclaw: {
		extensions: string[];
		compat: {
			pluginApi: string;
		};
	};
}

interface OpenClawManifest {
	id: string;
	configSchema: {
		type: string;
	};
	skills: string[];
	contracts: {
		tools: string[];
	};
	commandAliases: Array<{ name: string; kind: string }>;
	activation: {
		onStartup: boolean;
		onCommands: string[];
		onCapabilities: string[];
	};
}

interface OpenClawMcpEvidence {
	mcp: {
		servers: {
			docs: {
				command: string;
				args: string[];
			};
		};
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
