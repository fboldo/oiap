/// <reference types="bun" />

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { exportClaudeCode } from "@oiap/exporter-claude-code";
import { bundleHooksFromSource, loadPluginFile } from "./build.ts";

describe("bundleHooksFromSource", () => {
	const directories: string[] = [];

	afterEach(() => {
		for (const directory of directories.splice(0)) {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	test("keeps imports and helpers that copied function sources lose", async () => {
		// Inside the workspace so the plugin file can import @oiap/core.
		const directory = mkdtempSync(
			join(resolve(import.meta.dir, ".."), ".build-fixture-"),
		);
		directories.push(directory);
		const pluginFile = join(directory, "oiap.plugin.ts");
		writeFileSync(
			pluginFile,
			`import { allow, block, definePlugin, hook } from "@oiap/core";

const RISKY = ["rm -rf"];

function isRisky(command: string): boolean {
	return RISKY.some((pattern) => command.includes(pattern));
}

export default definePlugin({
	manifest: {
		id: "guard",
		name: "Guard",
		version: "1.0.0",
		description: "Blocks risky commands.",
		categories: [],
		supportedTargets: ["claude-code"],
	},
	hooks: [
		hook.beforeTool("guard", (context) => {
			const command = String(context.input.arguments.command ?? "");
			return isRisky(command) ? block({ reason: "Risky command" }) : allow();
		}),
	],
});
`,
		);

		const plugin = await loadPluginFile(pluginFile);
		const copied = exportClaudeCode(plugin);
		const bundled = await bundleHooksFromSource(copied, pluginFile);
		const hooksFile = bundled.files.find(
			(file) => file.path === ".oiap/runtime/hooks.mjs",
		);
		const copiedHooks = copied.files.find(
			(file) => file.path === ".oiap/runtime/hooks.mjs",
		);

		expect(String(copiedHooks?.content)).toContain("isRisky(command)");
		expect(String(copiedHooks?.content)).not.toContain("function isRisky");

		const modulePath = join(directory, "hooks.mjs");
		writeFileSync(modulePath, String(hooksFile?.content));
		const hooks = (await import(pathToFileURL(modulePath).href)) as Record<
			string,
			(context: unknown) => Promise<unknown> | unknown
		>;
		const handler = Object.values(hooks)[0];

		expect(
			await handler?.({ input: { arguments: { command: "rm -rf dist" } } }),
		).toMatchObject({ decision: "block", reason: "Risky command" });
		expect(
			await handler?.({ input: { arguments: { command: "ls" } } }),
		).toMatchObject({ decision: "allow" });
	});
});
