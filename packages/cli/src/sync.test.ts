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
} from "./sync";

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
						"commands/a.toml": "gemini command",
						"README.md": "readme",
						".oiap/bundle.json": "{}",
					}),
				],
				[
					"claude-code",
					bundle("claude-code", {
						".claude-plugin/plugin.json": "{}",
						"skills/a/SKILL.md": "A",
						"commands/a.md": "claude command",
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
		expect(paths).toContain("plugins/claude-code/commands/a.md");
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
					"openclaw",
					bundle("openclaw", {
						"skills/a/SKILL.md": "openclaw",
						".oiap/runtime/manifest.json": "openclaw",
					}),
				],
			]),
			"root",
		);

		expect(plan.notes).toContain(
			"openclaw uses the gemini-cli copy of 1 file(s) in skills/",
		);
		expect(plan.errors).toHaveLength(1);
		expect(plan.errors[0]).toContain(".oiap/runtime/manifest.json");
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

	test("writes, checks, removes stale files and protects hand-written files", async () => {
		const { repo, pluginFile } = fixture();
		const options = {
			inputPath: pluginFile,
			repoDir: repo,
			layout: "root" as const,
		};

		mkdirSync(join(repo, ".claude-plugin"), { recursive: true });
		writeFileSync(join(repo, ".claude-plugin", "plugin.json"), "{}\n");
		await expect(syncPluginFile({ ...options, check: false })).rejects.toThrow(
			"previous sync did not write: .claude-plugin/plugin.json (claude-code)",
		);

		const written = await syncPluginFile({
			...options,
			check: false,
			force: true,
		});
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
