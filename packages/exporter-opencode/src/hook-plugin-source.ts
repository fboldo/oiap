import { readFileSync } from "node:fs";

const hookPluginBundleUrl = new URL("../dist/hook-plugin.mjs", import.meta.url);

export function renderHookPluginSource(): string {
	try {
		return readFileSync(hookPluginBundleUrl, "utf8");
	} catch (error) {
		throw new Error(
			"Missing bundled OpenCode hook plugin. Run `bun run --cwd packages/exporter-opencode build:hook-plugin` before rendering OpenCode hook plugin files.",
			{ cause: error },
		);
	}
}
