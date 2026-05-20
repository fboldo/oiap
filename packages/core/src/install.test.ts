/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostProfile, PluginDefinition, TargetBundle } from "./index";
import { type InstallPluginTarget, installPlugin } from "./install";

describe("installPlugin", () => {
	test("exports and writes a target bundle for a plugin declaration", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "oiap-install-plugin-"));
		const outDir = join(tempDir, "codex");

		try {
			const result = await installPlugin({
				plugin: pluginDeclaration,
				target: testTarget(),
				outDir,
			});

			expect(result.target).toBe("codex");
			expect(result.files).toHaveLength(1);
			expect(await readFile(join(outDir, "plugin.json"), "utf8")).toBe(
				'{"id":"review-guard"}',
			);
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("refuses to replace an existing output directory without overwrite", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "oiap-install-plugin-"));
		const outDir = join(tempDir, "codex");

		try {
			await installPlugin({
				plugin: pluginDeclaration,
				target: testTarget(),
				outDir,
			});

			await expect(
				installPlugin({
					plugin: pluginDeclaration,
					target: testTarget(),
					outDir,
				}),
			).rejects.toThrow("Output directory already exists");

			await installPlugin({
				plugin: pluginDeclaration,
				target: testTarget(),
				outDir,
				overwrite: true,
			});
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("uses target install paths for local and global scopes", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "oiap-install-plugin-"));
		const cwd = join(tempDir, "project");
		const homeDir = join(tempDir, "home");
		const target = testTarget(undefined, testProfile());

		try {
			const localResult = await installPlugin({
				plugin: pluginDeclaration,
				target,
				cwd,
				homeDir,
			});

			expect(localResult.scope).toBe("local");
			expect(localResult.explicitOutDir).toBe(false);
			expect(
				await readFile(
					join(cwd, ".codex", "plugins", "review-guard", "plugin.json"),
					"utf8",
				),
			).toBe('{"id":"review-guard"}');

			const globalResult = await installPlugin({
				plugin: pluginDeclaration,
				target,
				cwd,
				homeDir,
				scope: "global",
			});

			expect(globalResult.scope).toBe("global");
			expect(
				await readFile(
					join(homeDir, ".codex", "plugins", "review-guard", "plugin.json"),
					"utf8",
				),
			).toBe('{"id":"review-guard"}');
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});

	test("requires outDir when the target has no install path for the selected scope", async () => {
		await expect(
			installPlugin({
				plugin: pluginDeclaration,
				target: testTarget(),
			}),
		).rejects.toThrow("does not define a local install path");
	});

	test("throws for unknown target ids", async () => {
		await expect(
			installPlugin({
				plugin: pluginDeclaration,
				target: "missing-target",
			}),
		).rejects.toThrow("Unknown install target");
	});

	test("refuses unsafe bundle paths", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "oiap-install-plugin-"));

		try {
			await expect(
				installPlugin({
					plugin: pluginDeclaration,
					target: testTarget({ path: "../escape.txt", content: "no" }),
					outDir: join(tempDir, "codex"),
				}),
			).rejects.toThrow("Refusing to write unsafe bundle path");
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

const pluginDeclaration: PluginDefinition = {
	manifest: {
		id: "review-guard",
		name: "Review Guard",
		version: "1.0.0",
		description: "Reviews changes.",
		categories: ["review"],
		supportedTargets: ["codex"],
	},
};

function testTarget(
	file: TargetBundle["files"][number] = {
		path: "plugin.json",
		content: '{"id":"review-guard"}',
	},
	profile?: HostProfile,
): InstallPluginTarget {
	return {
		id: "codex",
		profile,
		exportBundle: () => ({
			target: "codex",
			format: "directory",
			files: [file],
			report: {
				target: "codex",
				status: "ok",
				mappedCapabilities: [],
				degradedCapabilities: [],
				unsupportedCapabilities: [],
				issues: [],
			},
		}),
	};
}

function testProfile(): HostProfile {
	return {
		id: "codex",
		verification: "official",
		installSupport: {
			supported: true,
			fidelity: "native",
			paths: {
				local: {
					base: "cwd",
					segments: [".codex", "plugins", "{pluginId}"],
				},
				global: {
					base: "home",
					segments: [".codex", "plugins", "{pluginId}"],
				},
			},
		},
		shellDialects: ["posix"],
		configFormats: ["json"],
	};
}
