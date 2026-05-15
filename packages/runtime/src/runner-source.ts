import { readFileSync } from "node:fs";

const runnerBundleUrl = new URL("../dist/runner.mjs", import.meta.url);

export function renderRunnerSource(): string {
	try {
		return readFileSync(runnerBundleUrl, "utf8");
	} catch (error) {
		throw new Error(
			"Missing bundled OIAP runtime runner. Run `bun run --cwd packages/runtime build:runner` before rendering hook runtime files.",
			{ cause: error },
		);
	}
}
