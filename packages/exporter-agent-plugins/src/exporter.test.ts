/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { PluginDefinition, TargetBundle } from "@oiap/core";
import { exportAgentPlugins } from "./exporter.ts";
import {
	AGENT_PLUGINS_MCP_SCHEMA,
	AGENT_PLUGINS_PLUGIN_SCHEMA,
} from "./profile.ts";

const fixtureDir = new URL("./fixtures/agent-plugins-1.0.0/", import.meta.url);
const pluginSchema = readFixture("plugin.schema.json");
const mcpSchema = readFixture("mcp.schema.json");

describe("vendored Agent Plugins 1.0.0 schemas", () => {
	test("match their recorded source and the exporter's schema ids", () => {
		const source = readFixture("source.json") as {
			files: Record<string, { url: string; sha256: string }>;
		};

		for (const [file, { url, sha256 }] of Object.entries(source.files)) {
			const bytes = readFileSync(new URL(file, fixtureDir));
			expect(createHash("sha256").update(bytes).digest("hex")).toBe(sha256);
			expect((readFixture(file) as { $id: string }).$id).toBe(url);
		}
		expect(pluginSchema.$id).toBe(AGENT_PLUGINS_PLUGIN_SCHEMA);
		expect(mcpSchema.$id).toBe(AGENT_PLUGINS_MCP_SCHEMA);
	});

	test("use only keywords the test validator implements", () => {
		expect(unknownKeywords(pluginSchema)).toEqual([]);
		expect(unknownKeywords(mcpSchema)).toEqual([]);
	});

	test("the test validator rejects what the schema rejects", () => {
		expect(
			schemaErrors(pluginSchema, {
				$schema: AGENT_PLUGINS_PLUGIN_SCHEMA,
				name: "ok",
			}),
		).toEqual([]);
		expect(
			schemaErrors(pluginSchema, {
				$schema: AGENT_PLUGINS_PLUGIN_SCHEMA,
				name: "Bad--Name",
				displayName: "x",
				author: { name: "a", twitter: "b" },
				extensions: { "com.example": true },
			}).length,
		).toBe(4);
		expect(
			schemaErrors(mcpSchema, {
				$schema: AGENT_PLUGINS_MCP_SCHEMA,
				mcpServers: {
					a: { type: "stdio", command: "x", env: { PLUGIN_ROOT: "/" } },
					b: { type: "http", url: "https://x" },
					c: { type: "stdio", command: "x", cwd: "data" },
				},
			}).length,
		).toBe(3);
	});
});

describe("exportAgentPlugins", () => {
	test("writes a schema-valid package with skills and mcp.json", () => {
		const bundle = exportAgentPlugins(skillsAndMcpPlugin);
		const paths = bundle.files.map((file) => file.path);

		expect(bundle.target).toBe("agent-plugins");
		expect(bundle.package?.manifestPath).toBe("plugin.json");
		expect(bundle.report.status).toBe("ok");
		expect(bundle.report.issues).toEqual([]);
		expect(paths.filter((path) => !path.startsWith(".oiap/")).sort()).toEqual([
			"bin/server",
			"mcp.json",
			"plugin.json",
			"skills/review-docs/SKILL.md",
			"skills/review-docs/references/guide.md",
		]);

		const manifest = readJson(bundle, "plugin.json");
		expect(schemaErrors(pluginSchema, manifest)).toEqual([]);
		expect(manifest).toEqual({
			$schema: AGENT_PLUGINS_PLUGIN_SCHEMA,
			name: "docs-kit",
			version: "1.2.0",
			description: "Review docs.",
			author: { name: "Docs Team", url: "https://example.com" },
			homepage: "https://example.com/docs",
			repository: "https://github.com/example/docs-kit",
			license: "MIT",
			keywords: ["docs", "review"],
		});

		expect(readText(bundle, "skills/review-docs/SKILL.md")).toBe(
			[
				"---",
				'name: "review-docs"',
				'description: "Review a document."',
				'license: "MIT"',
				"---",
				"",
				"Follow references/guide.md.",
			].join("\n"),
		);

		const mcp = readJson(bundle, "mcp.json");
		expect(schemaErrors(mcpSchema, mcp)).toEqual([]);
		expect(mcp).toEqual({
			$schema: AGENT_PLUGINS_MCP_SCHEMA,
			mcpServers: {
				local: {
					type: "stdio",
					command: "./bin/server",
					args: ["--config", "$" + "{PLUGIN_ROOT}/config.json"],
					env: { MODE: "docs" },
					cwd: "$" + "{PLUGIN_DATA}/cache",
				},
				remote: {
					type: "streamable-http",
					url: "https://docs.example.com/mcp",
					headers: { "X-Client": "oiap" },
				},
				legacy: { type: "sse", url: "https://docs.example.com/sse" },
			},
		});
	});

	test("normalizes the plugin name to the spec rules", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			manifest: { ...skillsAndMcpPlugin.manifest, id: "-Docs__Kit..Pro-" },
		});
		const manifest = readJson(bundle, "plugin.json");

		expect(manifest.name).toBe("docs-kit.pro");
		expect(schemaErrors(pluginSchema, manifest)).toEqual([]);
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"agent-plugins-name-normalized",
		);
	});

	test("leaves out fields the closed manifest does not have", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			manifest: {
				...skillsAndMcpPlugin.manifest,
				displayName: "Docs Kit",
				logo: "assets/logo.svg",
			},
			resources: [{ path: "assets/logo.svg", content: "<svg/>" }],
		});
		const manifest = readJson(bundle, "plugin.json");

		expect(schemaErrors(pluginSchema, manifest)).toEqual([]);
		expect(manifest.displayName).toBeUndefined();
		expect(bundle.report.status).toBe("ok");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"agent-plugins-manifest-field-not-emitted",
		);
	});

	test("degrades every component the format does not define", () => {
		const bundle = exportAgentPlugins(everythingPlugin);
		const paths = bundle.files.map((file) => file.path);
		const degraded = bundle.report.degradedCapabilities.map(
			(entry) => `${entry.capability.kind}:${entry.from}`,
		);

		expect(bundle.report.status).toBe("degraded");
		expect(degraded).toEqual(
			expect.arrayContaining([
				"skills:skill-invocation-control",
				"commands:commands",
				"commands:workflows",
				"agents:agents",
				"rules:project-context-rules",
				"hooks:hooks",
				"policy:permission-policies",
			]),
		);
		for (const entry of bundle.report.degradedCapabilities.filter(
			(item) => item.to === "not-emitted",
		)) {
			expect(entry.reason).toContain("github-copilot-cli");
			expect(entry.reason).toContain('targetFiles["agent-plugins"]');
		}
		expect(
			paths.filter(
				(path) =>
					!path.startsWith(".oiap/") &&
					!path.startsWith("skills/") &&
					path !== "plugin.json",
			),
		).toEqual([]);
		expect(readText(bundle, "skills/audit/SKILL.md")).not.toContain(
			"invocation",
		);
	});

	test("reports MCP settings the format cannot keep", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			tools: [
				{
					id: "api",
					transport: "mcp-http",
					tools: [],
					server: {
						url: "https://api.example.com/mcp",
						headers: { Authorization: "Bearer $" + "{API_TOKEN}" },
						auth: { mode: "header", secretRef: "API_TOKEN" },
					},
				},
				{
					id: "local",
					transport: "mcp-stdio",
					tools: [],
					server: {
						command: "server",
						env: { PLUGIN_ROOT: "/x", TOKEN: "$" + "{TOKEN}" },
						cwd: "../outside",
						includeTools: ["read"],
					},
				},
			],
		});
		const mcp = readJson(bundle, "mcp.json");
		const reason = bundle.report.degradedCapabilities.find(
			(entry) => entry.from === "oiap-mcp-server",
		)?.reason;

		expect(schemaErrors(mcpSchema, mcp)).toEqual([]);
		expect(mcp.mcpServers).toEqual({
			api: { type: "streamable-http", url: "https://api.example.com/mcp" },
			local: { type: "stdio", command: "server" },
		});
		expect(bundle.report.status).toBe("degraded");
		for (const lost of [
			"api: auth",
			"api: header Authorization",
			"local: includeTools",
			"local: env PLUGIN_ROOT",
			"local: env TOKEN",
			"local: cwd ../outside",
		]) {
			expect(reason).toContain(lost);
		}
	});

	test("flags MCP servers clients would skip", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			tools: [
				{
					id: "shell",
					transport: "mcp-stdio",
					tools: [],
					server: { command: "npx -y docs-server" },
				},
				{
					id: "plain",
					transport: "mcp-http",
					tools: [],
					server: { url: "http://docs.example.com/mcp" },
				},
			],
		});
		const issues = bundle.report.issues.filter(
			(issue) => issue.code === "agent-plugins-invalid-mcp-server",
		);

		expect(issues.map((issue) => issue.message)).toEqual([
			expect.stringContaining("shell"),
			expect.stringContaining("plain"),
		]);
		expect(bundle.report.status).toBe("degraded");
	});

	test("emits a skill from skillsFrom exactly as written", () => {
		const skillFile =
			"---\nname: review-docs\ndescription: Review.\nmetadata:\n  team: docs\n---\n\nBody.\n";
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			skills: skillsAndMcpPlugin.skills.map((skill) => ({
				...skill,
				source: { directory: "/repo/skills/review-docs", skillFile },
			})),
		});

		expect(readText(bundle, "skills/review-docs/SKILL.md")).toBe(skillFile);
		expect(readText(bundle, "skills/review-docs/references/guide.md")).toBe(
			"Guide",
		);
		expect(bundle.report.status).toBe("ok");
	});

	test("warns when an in-place skill breaks Agent Skills naming", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			skills: [
				{
					id: "Review",
					name: "Review Docs",
					description: "Review.",
					instructions: { id: "review-body", kind: "instruction" },
					source: {
						directory: "/repo/skills/Review",
						skillFile: "---\nname: Review Docs\ndescription: Review.\n---\n",
					},
				},
			],
		});

		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"agent-plugins-invalid-skill",
		);
		expect(bundle.report.status).toBe("degraded");
	});

	test("resolves resource references relative to the skill file", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			instructions: [
				{
					id: "review-body",
					purpose: "workflow",
					triggers: [],
					body: "Read $" + "{OIAP_PLUGIN_ROOT}/standards/style.md.",
				},
			],
			resources: [
				...skillsAndMcpPlugin.resources,
				{ path: "standards/style.md", content: "Style" },
			],
		});

		expect(readText(bundle, "skills/review-docs/SKILL.md")).toContain(
			"Read ../../standards/style.md.",
		);
		expect(
			bundle.report.degradedCapabilities.map((entry) => entry.from),
		).toEqual(["plugin-root-variable"]);
	});
});

describe("exportAgentPlugins target features", () => {
	test("drops primitives limited to other targets", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			skills: [
				...skillsAndMcpPlugin.skills,
				{
					id: "elsewhere",
					name: "elsewhere",
					description: "Only for Gemini.",
					instructions: { id: "review-body", kind: "instruction" },
					targets: ["gemini-cli"],
				},
				{
					id: "here",
					name: "here",
					description: "Only for this format.",
					instructions: { id: "review-body", kind: "instruction" },
					targets: ["agent-plugins"],
				},
			],
			agents: [
				{
					id: "claude-agent",
					name: "claude-agent",
					description: "Only for Claude.",
					instructions: { id: "review-body", kind: "instruction" },
					targets: ["claude-code"],
				},
			],
		});
		const paths = bundle.files.map((file) => file.path);
		const evidence = paths
			.filter((path) => path.startsWith(".oiap/"))
			.map((path) => readText(bundle, path))
			.join("\n");

		expect(paths.some((path) => path.includes("elsewhere"))).toBe(false);
		expect(evidence).not.toContain("elsewhere");
		expect(evidence).not.toContain("claude-agent");
		expect(paths).toContain("skills/here/SKILL.md");
		// The agent for another host is not reported as a degradation here.
		expect(bundle.report.status).toBe("ok");
	});

	test("merges manifest target metadata, extensions included, and removes null fields", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			manifest: {
				...skillsAndMcpPlugin.manifest,
				targetMetadata: {
					"agent-plugins": {
						version: null,
						homepage: "https://example.com/plugin",
						extensions: {
							"com.github.copilot": { agents: "./com.github.copilot/agents" },
						},
					},
					"claude-code": { homepage: "https://example.com/claude" },
				},
			},
		});
		const manifest = readJson(bundle, "plugin.json");

		expect("version" in manifest).toBe(false);
		expect(manifest.homepage).toBe("https://example.com/plugin");
		expect(manifest.extensions).toEqual({
			"com.github.copilot": { agents: "./com.github.copilot/agents" },
		});
		expect(schemaErrors(pluginSchema, manifest)).toEqual([]);
		expect(bundle.report.status).toBe("ok");
	});

	test("rejects target metadata that breaks the closed manifest", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			manifest: {
				...skillsAndMcpPlugin.manifest,
				targetMetadata: {
					"agent-plugins": { displayName: "Docs", extensions: { copilot: {} } },
				},
			},
		});
		const codes = bundle.report.issues.map((issue) => issue.code);

		expect(schemaErrors(pluginSchema, readJson(bundle, "plugin.json"))).toEqual(
			["/displayName: unexpected property"],
		);
		expect(codes).toContain("agent-plugins-unknown-manifest-field");
		expect(codes).toContain("agent-plugins-extension-namespace");
		expect(bundle.report.status).toBe("unsupported");
	});

	test("emits target files at the plugin root", () => {
		const agent = "---\nname: critic\ndescription: Critic.\n---\n\nCritique.\n";
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			targetFiles: {
				"agent-plugins": [
					{ path: "com.github.copilot/agents/critic.agent.md", content: agent },
					{
						path: "com.github.copilot/hooks/check.sh",
						content: "cat $" + "{OIAP_PLUGIN_ROOT}/bin/server\n",
						mode: 0o755,
					},
				],
				"claude-code": [{ path: "agents/critic.md", content: agent }],
			},
		});
		const paths = bundle.files.map((file) => file.path);
		const script = bundle.files.find(
			(file) => file.path === "com.github.copilot/hooks/check.sh",
		);

		expect(readText(bundle, "com.github.copilot/agents/critic.agent.md")).toBe(
			agent,
		);
		expect(script?.content).toBe("cat ../../bin/server\n");
		expect(script?.mode).toBe(0o755);
		expect(script?.source?.primitiveKind).toBe("target-file");
		expect(paths).not.toContain("agents/critic.md");
	});

	test("reports target files that shadow generated files", () => {
		const bundle = exportAgentPlugins({
			...skillsAndMcpPlugin,
			targetFiles: {
				"agent-plugins": [{ path: "plugin.json", content: "{}" }],
			},
		});

		expect(bundle.report.status).toBe("unsupported");
		expect(bundle.report.issues.map((issue) => issue.code)).toContain(
			"duplicate-bundle-file",
		);
	});
});

const skillsAndMcpPlugin = {
	manifest: {
		id: "docs-kit",
		name: "Docs Kit",
		version: "1.2.0",
		description: "Review docs.",
		homepage: "https://example.com/docs",
		repository: "https://github.com/example/docs-kit",
		license: "MIT",
		author: { name: "Docs Team", url: "https://example.com" },
		keywords: ["docs", "review"],
		categories: ["productivity"],
		supportedTargets: ["agent-plugins"],
	},
	instructions: [
		{
			id: "review-body",
			purpose: "workflow",
			triggers: [],
			body: "Follow references/guide.md.",
		},
	],
	skills: [
		{
			id: "review",
			name: "review-docs",
			description: "Review a document.",
			instructions: { id: "review-body", kind: "instruction" },
			files: [{ path: "references/guide.md", content: "Guide" }],
			targetMetadata: { "agent-plugins": { license: "MIT" } },
		},
	],
	tools: [
		{
			id: "local",
			transport: "mcp-stdio",
			tools: [],
			server: {
				command: "$" + "{OIAP_PLUGIN_ROOT}/bin/server",
				args: ["--config", "$" + "{OIAP_PLUGIN_ROOT}/config.json"],
				env: { MODE: "docs" },
				cwd: "$" + "{PLUGIN_DATA}/cache",
			},
		},
		{
			id: "remote",
			transport: "mcp-http",
			tools: [],
			server: {
				url: "https://docs.example.com/mcp",
				headers: { "X-Client": "oiap" },
			},
		},
		{
			id: "legacy",
			transport: "mcp-sse",
			tools: [],
			server: { url: "https://docs.example.com/sse" },
		},
	],
	resources: [{ path: "bin/server", content: "#!/bin/sh\n", mode: 0o755 }],
} satisfies PluginDefinition;

const everythingPlugin = {
	manifest: {
		...skillsAndMcpPlugin.manifest,
		id: "everything",
	},
	invocations: [
		{
			id: "status-invocation",
			canonical: "status",
			helpText: "Summarize status.",
			examples: [],
		},
	],
	instructions: [
		{ id: "audit-body", purpose: "workflow", triggers: [], body: "Audit." },
		{ id: "status-body", purpose: "command", triggers: [], body: "Status." },
		{ id: "agent-body", purpose: "agent", triggers: [], body: "Review." },
		{ id: "safety", purpose: "safety", triggers: [], body: "Be careful." },
	],
	commands: [
		{
			id: "status",
			invocation: { id: "status-invocation", kind: "invocation" },
			prompt: { id: "status-body", kind: "instruction" },
		},
	],
	workflows: [
		{
			id: "release",
			title: "Release",
			activation: { mode: "manual" },
			inputs: [],
			steps: [],
			outputs: [],
			failurePolicy: { mode: "fail_fast" },
		},
	],
	skills: [
		{
			id: "audit",
			name: "audit",
			description: "Audit.",
			instructions: { id: "audit-body", kind: "instruction" },
			modelInvocable: false,
		},
	],
	agents: [
		{
			id: "reviewer",
			name: "reviewer",
			description: "Reviewer.",
			instructions: { id: "agent-body", kind: "instruction" },
		},
	],
	hooks: [
		{
			kind: "oiap.hook",
			id: "pre-tool",
			event: "before_tool",
			handler: () => ({ decision: "allow" as const }),
		},
	],
	policies: [{ permissions: [{ kind: "network", access: "deny" }] }],
} satisfies PluginDefinition;

function readFixture(name: string): Record<string, unknown> {
	return JSON.parse(readFileSync(new URL(name, fixtureDir), "utf8"));
}

function readText(bundle: TargetBundle, path: string): string {
	const file = bundle.files.find((candidate) => candidate.path === path);

	if (!file || typeof file.content !== "string") {
		throw new Error(`Missing text file ${path}`);
	}

	return file.content;
}

// biome-ignore lint/suspicious/noExplicitAny: test JSON access
function readJson(bundle: TargetBundle, path: string): Record<string, any> {
	return JSON.parse(readText(bundle, path));
}

// A JSON Schema (2020-12) validator for the keywords the vendored schemas use.
// `unknownKeywords` fails the suite if a re-vendored schema needs more.
type Schema = Record<string, unknown>;

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KEYWORDS = new Set([
	"$defs",
	"$ref",
	"type",
	"const",
	"enum",
	"properties",
	"required",
	"additionalProperties",
	"propertyNames",
	"items",
	"minLength",
	"maxLength",
	"pattern",
	"oneOf",
	"not",
]);

function unknownKeywords(schema: unknown): string[] {
	if (!isObject(schema)) {
		return [];
	}

	return Object.entries(schema).flatMap(([key, value]) => {
		const own = ANNOTATIONS.has(key) || KEYWORDS.has(key) ? [] : [key];
		const children =
			key === "properties" || key === "$defs"
				? Object.values(value as Schema)
				: key === "oneOf"
					? (value as unknown[])
					: ["items", "additionalProperties", "propertyNames", "not"].includes(
								key,
							)
						? [value]
						: [];

		return [...own, ...children.flatMap(unknownKeywords)];
	});
}

function schemaErrors(root: Schema, value: unknown): string[] {
	return check(root, root, value, "");
}

function check(
	root: Schema,
	schema: Schema,
	value: unknown,
	at: string,
): string[] {
	if (typeof schema.$ref === "string") {
		const target = schema.$ref
			.replace(/^#\//, "")
			.split("/")
			.reduce<unknown>((node, key) => (node as Schema)[key], root);
		return check(root, target as Schema, value, at);
	}

	const errors: string[] = [];
	const fail = (message: string) => errors.push(`${at || "/"}: ${message}`);

	if (schema.type && !hasType(value, schema.type as string)) {
		fail(`expected ${schema.type}`);
		return errors;
	}
	if ("const" in schema && value !== schema.const) {
		fail(`expected ${JSON.stringify(schema.const)}`);
	}
	if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
		fail("not in enum");
	}
	if (typeof value === "string") {
		const length = [...value].length;
		if (typeof schema.minLength === "number" && length < schema.minLength) {
			fail("too short");
		}
		if (typeof schema.maxLength === "number" && length > schema.maxLength) {
			fail("too long");
		}
		if (
			typeof schema.pattern === "string" &&
			!new RegExp(schema.pattern, "u").test(value)
		) {
			fail(`does not match ${schema.pattern}`);
		}
	}
	if (Array.isArray(value) && isObject(schema.items)) {
		value.forEach((item, index) => {
			errors.push(
				...check(root, schema.items as Schema, item, `${at}/${index}`),
			);
		});
	}
	if (isObject(value)) {
		const properties = (schema.properties ?? {}) as Record<string, Schema>;
		for (const key of (schema.required ?? []) as string[]) {
			if (!(key in value)) {
				fail(`missing ${key}`);
			}
		}
		for (const [key, item] of Object.entries(value)) {
			const path = `${at}/${key}`;
			if (isObject(schema.propertyNames)) {
				errors.push(...check(root, schema.propertyNames, key, path));
			}
			const property = properties[key];
			if (property) {
				errors.push(...check(root, property, item, path));
			} else if (schema.additionalProperties === false) {
				errors.push(`${path}: unexpected property`);
			} else if (isObject(schema.additionalProperties)) {
				errors.push(...check(root, schema.additionalProperties, item, path));
			}
		}
	}
	if (Array.isArray(schema.oneOf)) {
		const matches = schema.oneOf.filter(
			(option) => check(root, option as Schema, value, at).length === 0,
		).length;
		if (matches !== 1) {
			fail(`matches ${matches} oneOf branches`);
		}
	}
	if (isObject(schema.not) && check(root, schema.not, value, at).length === 0) {
		fail("matches a forbidden schema");
	}

	return errors;
}

function hasType(value: unknown, type: string): boolean {
	switch (type) {
		case "object":
			return isObject(value);
		case "array":
			return Array.isArray(value);
		case "integer":
			return Number.isInteger(value);
		default:
			return typeof value === type;
	}
}

function isObject(value: unknown): value is Schema {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
