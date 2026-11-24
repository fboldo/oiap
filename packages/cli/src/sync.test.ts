/// <reference types="bun" />

import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RenderedFile, TargetBundle } from "@oiap/core";
import {
	planSync,
	SYNC_LOCK_PATH,
	selectSyncTargets,
	syncPluginFile,
} from "./sync.ts";

interface SyncLockShape {
	files: Record<string, string>;
}

const manifest = {
	id: "sample",
	name: "Sample",
	version: "1.0.0",
	description: "Sync fixture.",
	categories: ["testing"],
	supportedTargets: [],
};

function bundle(target: string, files: Record<string, string>): TargetBundle {
	return {
		target,
		format: "directory",
		files: Object.entries(files).map(
			([path, content]): RenderedFile => ({ path, content }),
		),
		report: {
			target,
			status: "ok",
			mappedCapabilities: [],
			degradedCapabilities: [],
			unsupportedCapabilities: [],
			issues: [],
		},
	};
}

describe("planSync", () => {
	test("shares the root when hosts agree and moves hosts that would load foreign files", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"gemini-cli",
					bundle("gemini-cli", {
						"gemini-extension.json": "{}",
						"skills/a/SKILL.md": "A",
						"agents/a.md": "gemini agent",
						"README.md": "readme",
						".oiap/bundle.json": "{}",
					}),
				],
				[
					"claude-code",
					bundle("claude-code", {
						".claude-plugin/plugin.json": "{}",
						"skills/a/SKILL.md": "A",
						"agents/a.md": "claude agent",
					}),
				],
				[
					"codex",
					bundle("codex", {
						".codex-plugin/plugin.json": "{}",
						"skills/a/SKILL.md": "A",
					}),
				],
			]),
			"root",
		);
		const paths = plan.files.map((file) => file.path);

		expect(plan.errors).toEqual([]);
		expect(
			Object.fromEntries(
				plan.placements.map((placement) => [
					placement.target,
					placement.directory,
				]),
			),
		).toEqual({
			"gemini-cli": "",
			"claude-code": "plugins/claude-code",
			codex: "",
		});
		expect(paths).toContain("plugins/claude-code/agents/a.md");
		expect(paths).toContain(".codex-plugin/plugin.json");
		expect(paths).not.toContain("README.md");
		expect(paths).not.toContain(".oiap/bundle.json");
		expect(paths).toContain(SYNC_LOCK_PATH);

		const claudeMarketplace = JSON.parse(
			String(
				plan.files.find(
					(file) => file.path === ".claude-plugin/marketplace.json",
				)?.content,
			),
		);
		expect(claudeMarketplace.plugins[0].source).toBe("./plugins/claude-code");
		const codexMarketplace = JSON.parse(
			String(
				plan.files.find(
					(file) => file.path === ".agents/plugins/marketplace.json",
				)?.content,
			),
		);
		expect(codexMarketplace.plugins[0].source).toBe("./");
	});

	test("puts every movable host under plugins/ with the plugins layout", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				["codex", bundle("codex", { ".codex-plugin/plugin.json": "{}" })],
			]),
			"plugins",
		);

		expect(plan.placements[0]?.directory).toBe("plugins/codex");
		expect(plan.files.map((file) => file.path)).toContain(
			".agents/plugins/marketplace.json",
		);
	});

	test("lets root-only hosts share one copy and rejects clashing hook runtimes", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"gemini-cli",
					bundle("gemini-cli", {
						"skills/a/SKILL.md": "gemini",
						".oiap/runtime/manifest.json": "gemini",
					}),
				],
				[
					"antigravity",
					bundle("antigravity", {
						"skills/a/SKILL.md": "antigravity",
						".oiap/runtime/manifest.json": "antigravity",
					}),
				],
			]),
			"root",
		);

		expect(plan.notes).toContain(
			"antigravity uses the gemini-cli copy of 1 file(s) in skills/",
		);
		expect(plan.errors).toHaveLength(1);
		expect(plan.errors[0]).toContain(".oiap/runtime/manifest.json");
	});
});

describe("planSync catalogs", () => {
	test("uses marketplace settings and per-host overrides", () => {
		const plan = planSync(
			{
				manifest: {
					...manifest,
					author: { name: "Clerk" },
					keywords: ["auth"],
					marketplace: {
						name: "sample-skills",
						description: "Sample skills catalog.",
						targetMetadata: {
							"claude-code": { entry: { version: null } },
						},
					},
				},
			},
			new Map([
				[
					"claude-code",
					bundle("claude-code", { ".claude-plugin/plugin.json": "{}" }),
				],
			]),
			"root",
		);
		const catalog = JSON.parse(
			String(
				plan.files.find(
					(file) => file.path === ".claude-plugin/marketplace.json",
				)?.content,
			),
		);

		expect(catalog).toEqual({
			name: "sample-skills",
			owner: { name: "Clerk" },
			metadata: { description: "Sample skills catalog." },
			plugins: [
				{
					name: "sample",
					source: "./",
					description: "Sync fixture.",
					author: { name: "Clerk" },
					keywords: ["auth"],
					category: "testing",
				},
			],
		});
	});
});

describe("planSync with Agent Plugins", () => {
	test("keeps Codex at the root and serves Copilot through the root manifest", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"agent-plugins",
					bundle("agent-plugins", {
						"plugin.json":
							'{"$schema":"https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"}',
						"skills/a/SKILL.md": "A",
					}),
				],
				[
					"codex",
					bundle("codex", {
						".codex-plugin/plugin.json": "{}",
						"skills/a/SKILL.md": "A",
					}),
				],
			]),
			"root",
		);
		const copilotCatalog = JSON.parse(
			String(
				plan.files.find(
					(file) => file.path === ".github/plugin/marketplace.json",
				)?.content,
			),
		);

		expect(plan.placements.map((placement) => placement.directory)).toEqual([
			"",
			"",
		]);
		expect(copilotCatalog.plugins[0].source).toBe("./");
	});
});

describe("planSync read patterns", () => {
	test("keeps Claude at the root next to Gemini TOML commands", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"gemini-cli",
					bundle("gemini-cli", { "commands/plan.toml": "gemini" }),
				],
				[
					"claude-code",
					bundle("claude-code", { ".claude-plugin/plugin.json": "{}" }),
				],
			]),
			"root",
		);

		expect(plan.placements.map((placement) => placement.directory)).toEqual([
			"",
			"",
		]);
	});
});

describe("planSync with author files", () => {
	test("moves a host whose root files would overwrite the author's", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"openclaw",
					bundle("openclaw", {
						"openclaw.plugin.json": "{}",
						"package.json": "{}",
					}),
				],
			]),
			"root",
			new Map([["package.json", Buffer.from('{"name":"author"}')]]),
		);

		expect(plan.placements[0]?.directory).toBe("plugins/openclaw");
		expect(plan.files.map((file) => file.path)).toContain(
			"plugins/openclaw/package.json",
		);
	});
});

describe("planSync with identical author files", () => {
	test("shares them, keeps the host at the root, and leaves them out of the output", () => {
		const plan = planSync(
			{ manifest },
			new Map([
				[
					"claude-code",
					bundle("claude-code", {
						".claude-plugin/plugin.json": "{}",
						"skills/a/SKILL.md": "Authored",
					}),
				],
			]),
			"root",
			new Map([["skills/a/SKILL.md", Buffer.from("Authored")]]),
		);
		const lock = JSON.parse(
			String(plan.files.find((file) => file.path === SYNC_LOCK_PATH)?.content),
		);

		expect(plan.placements[0]?.directory).toBe("");
		expect(plan.files.map((file) => file.path)).not.toContain(
			"skills/a/SKILL.md",
		);
		expect(Object.keys(lock.files)).not.toContain("skills/a/SKILL.md");
	});
});

describe("selectSyncTargets", () => {
	test("defaults to supported git-installed targets and rejects project-only ones", () => {
		expect(
			selectSyncTargets({
				manifest: {
					...manifest,
					supportedTargets: ["cline", "codex", "claude-code"],
				},
			}),
		).toEqual(["claude-code", "codex"]);
		expect(() => selectSyncTargets({ manifest }, ["cline"])).toThrow(
			"use install-agent-plugin",
		);
	});
});

describe("syncPluginFile", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	function fixture(): { repo: string; pluginFile: string } {
		// The plugin file lives inside the workspace so it can import @oiap/core.
		const repo = mkdtempSync(join(tmpdir(), "oiap-sync-"));
		const pluginDir = mkdtempSync(
			join(resolve(import.meta.dir, ".."), ".sync-fixture-"),
		);
		directories.push(repo, pluginDir);
		const pluginFile = join(pluginDir, "oiap.plugin.ts");
		writeFileSync(
			pluginFile,
			`export default ${JSON.stringify({
				manifest: { ...manifest, supportedTargets: ["claude-code", "codex"] },
				skills: [
					{
						id: "review",
						name: "review",
						description: "Review a document.",
						instructions: { id: "review-body", kind: "instruction" },
					},
				],
				instructions: [
					{
						id: "review-body",
						purpose: "workflow",
						triggers: [],
						body: "Review it.",
					},
				],
			})};\n`,
		);
		return { repo, pluginFile };
	}

	test("uses the repository's own skills in place", async () => {
		// The repository lives inside the workspace so its plugin file can import @oiap/core.
		const repo = mkdtempSync(
			join(resolve(import.meta.dir, ".."), ".sync-in-place-"),
		);
		directories.push(repo);
		const skillFile = [
			"---",
			"name: review",
			"description: Review a document.",
			"license: MIT",
			"metadata:",
			"  owner: docs-team",
			"---",
			"",
			"Read references/guide.md, then review.",
			"",
		].join("\n");
		mkdirSync(join(repo, "skills", "review", "references"), {
			recursive: true,
		});
		writeFileSync(join(repo, "skills", "review", "SKILL.md"), skillFile);
		writeFileSync(
			join(repo, "skills", "review", "references", "guide.md"),
			"Guide",
		);
		writeFileSync(
			join(repo, "oiap.plugin.ts"),
			`import { definePlugin, skillsFrom } from "@oiap/core";

export default definePlugin({
	manifest: ${JSON.stringify({
		...manifest,
		supportedTargets: ["gemini-cli", "claude-code", "codex", "cursor"],
	})},
	skills: skillsFrom("skills"),
});
`,
		);
		const options = {
			inputPath: join(repo, "oiap.plugin.ts"),
			repoDir: repo,
			layout: "root" as const,
		};

		const first = await syncPluginFile({ ...options, check: false });
		const lock = JSON.parse(
			readFileSync(join(repo, SYNC_LOCK_PATH), "utf8"),
		) as SyncLockShape;

		expect(
			Object.fromEntries(
				first.plan.placements.map((placement) => [
					placement.target,
					placement.directory,
				]),
			),
		).toEqual({
			"gemini-cli": "",
			"claude-code": "",
			codex: "",
			cursor: "",
		});
		expect(
			readFileSync(join(repo, "skills", "review", "SKILL.md"), "utf8"),
		).toBe(skillFile);
		expect(first.written).not.toContain("skills/review/SKILL.md");
		expect(
			Object.keys(lock.files).some((path) => path.startsWith("skills/")),
		).toBe(false);

		const second = await syncPluginFile({ ...options, check: true });
		expect(second.differences).toEqual([]);
	});

	test("keeps a stale file the author changed", async () => {
		const { repo, pluginFile } = fixture();
		const options = {
			inputPath: pluginFile,
			repoDir: repo,
			layout: "root" as const,
		};

		await syncPluginFile({ ...options, check: false });
		writeFileSync(
			join(repo, ".codex-plugin", "plugin.json"),
			'{"edited":true}\n',
		);
		const narrowed = await syncPluginFile({
			...options,
			targets: ["claude-code"],
			check: false,
		});

		expect(narrowed.removed).not.toContain(".codex-plugin/plugin.json");
		expect(existsSync(join(repo, ".codex-plugin", "plugin.json"))).toBe(true);
		expect(narrowed.plan.notes.join("\n")).toContain(
			"Kept .codex-plugin/plugin.json",
		);
	});

	test("writes, checks, removes stale files and protects hand-written files", async () => {
		const { repo, pluginFile } = fixture();
		const options = {
			inputPath: pluginFile,
			repoDir: repo,
			layout: "root" as const,
		};

		mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
		writeFileSync(join(repo, ".claude-plugin", "plugin.json"), "{}\n");
		const moved = await syncPluginFile({ ...options, check: false });
		expect(
			moved.plan.placements.find(
				(placement) => placement.target === "claude-code",
			)?.directory,
		).toBe("plugins/claude-code");
		expect(
			readFileSync(join(repo, ".claude-plugin", "plugin.json"), "utf8"),
		).toBe("{}\n");
		rmSync(join(repo, ".claude-plugin", "plugin.json"));

		const written = await syncPluginFile({ ...options, check: false });
		expect(written.written).toContain(".claude-plugin/plugin.json");
		expect(existsSync(join(repo, "skills", "review", "SKILL.md"))).toBe(true);

		const clean = await syncPluginFile({ ...options, check: true });
		expect(clean.differences).toEqual([]);

		writeFileSync(join(repo, "skills", "review", "SKILL.md"), "edited");
		const dirty = await syncPluginFile({ ...options, check: true });
		expect(dirty.differences).toEqual([
			{ path: "skills/review/SKILL.md", kind: "changed" },
		]);

		const narrowed = await syncPluginFile({
			...options,
			targets: ["claude-code"],
			check: false,
		});
		expect(narrowed.removed).toContain(".codex-plugin/plugin.json");
		expect(existsSync(join(repo, ".codex-plugin"))).toBe(false);
		expect(
			JSON.parse(readFileSync(join(repo, SYNC_LOCK_PATH), "utf8")).targets,
		).toEqual({ "claude-code": { directory: "", status: "ok" } });
	});
});
