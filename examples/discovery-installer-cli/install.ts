#!/usr/bin/env bun
import { parseArgs } from "node:util";
import { installPlugin } from "@oiap/core";
import plugin from "./oiap.plugin";

const targetAliases = {
	claude: "claude-code",
	vscode: "vscode-copilot-chat",
} as const;

const { positionals, values } = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		global: { type: "boolean", short: "g" },
		target: { type: "string", short: "t" },
		out: { type: "string", short: "o" },
		overwrite: { type: "boolean" },
	},
});
const targetName = values.target ?? positionals[0] ?? "codex";
const target =
	targetName in targetAliases
		? targetAliases[targetName as keyof typeof targetAliases]
		: targetName;

const result = await installPlugin({
	plugin,
	target,
	scope: values.global ? "global" : "local",
	outDir: values.out,
	overwrite: values.overwrite ?? false,
});

console.log(
	`${result.explicitOutDir ? "Materialized" : "Installed"} ${plugin.manifest.id} for ${result.target} (${result.scope} scope) -> ${result.outDir} (${result.files.length} files, ${result.report.status})`,
);
