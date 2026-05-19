#!/usr/bin/env bun
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { BuildSummary, TargetBuildResult } from "./build";
import { buildPluginFile } from "./build";
import { exporterRegistry, registeredTargets } from "./registry";

type CliCommand = BuildCommand | TargetsCommand | HelpCommand;

interface BuildCommand {
	kind: "build";
	inputPath: string;
	target: string;
	outDir: string;
	exportName?: string;
	json: boolean;
}

interface TargetsCommand {
	kind: "targets";
	json: boolean;
}

interface HelpCommand {
	kind: "help";
	topic?: "build" | "targets";
}

interface OptionValue {
	value: string;
	nextIndex: number;
}

class CliError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

export async function main(args = process.argv.slice(2)): Promise<void> {
	const command = parseCliArgs(args);

	switch (command.kind) {
		case "build":
			await runBuild(command);
			return;
		case "targets":
			runTargets(command);
			return;
		case "help":
			printHelp(command.topic);
			return;
	}
}

function parseCliArgs(args: string[]): CliCommand {
	const command = args[0];

	if (!command || isHelpFlag(command)) {
		return { kind: "help" };
	}

	if (command === "build") {
		return parseBuildArgs(args.slice(1));
	}

	if (command === "targets") {
		return parseTargetsArgs(args.slice(1));
	}

	throw new CliError(`Unknown command: ${command}`);
}

function parseBuildArgs(args: string[]): CliCommand {
	let target = "all";
	let outDir = "dist/oiap";
	let exportName: string | undefined;
	let json = false;
	const positionals: string[] = [];

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (!argument) {
			continue;
		}

		if (isHelpFlag(argument)) {
			return { kind: "help", topic: "build" };
		}

		const option = splitOption(argument);

		switch (option.name) {
			case "--target":
			case "-t": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				target = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			case "--out":
			case "-o": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				outDir = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			case "--export":
			case "-e": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				exportName = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			case "--json":
				json = true;
				break;
			default:
				if (argument.startsWith("-")) {
					throw new CliError(`Unknown build option: ${argument}`);
				}

				positionals.push(argument);
		}
	}

	const inputPath = positionals[0];

	if (!inputPath) {
		throw new CliError("Missing plugin file. Usage: oiap build <plugin-file>");
	}

	if (positionals.length > 1) {
		throw new CliError(
			`Expected one plugin file, received: ${positionals.join(", ")}`,
		);
	}

	return { kind: "build", inputPath, target, outDir, exportName, json };
}

function parseTargetsArgs(args: string[]): CliCommand {
	let json = false;

	for (const argument of args) {
		if (isHelpFlag(argument)) {
			return { kind: "help", topic: "targets" };
		}

		if (argument === "--json") {
			json = true;
			continue;
		}

		throw new CliError(`Unknown targets option: ${argument}`);
	}

	return { kind: "targets", json };
}

async function runBuild(command: BuildCommand): Promise<void> {
	const summary = await buildPluginFile(command);

	if (command.json) {
		console.log(JSON.stringify(summary, null, "\t"));
	} else {
		printBuildSummary(summary);
	}

	if (summary.builds.some((build) => build.report.status === "unsupported")) {
		process.exitCode = 1;
	}
}

function runTargets(command: TargetsCommand): void {
	if (command.json) {
		console.log(JSON.stringify({ targets: registeredTargets }, null, "\t"));
		return;
	}

	console.log("Available targets:");

	for (const target of registeredTargets) {
		console.log(`- ${target} (${exporterRegistry[target].packageName})`);
	}
}

function printBuildSummary(summary: BuildSummary): void {
	for (const build of summary.builds) {
		console.log(
			`Built ${build.target} -> ${displayPath(build.outDir)} (${build.files.length} files, ${build.report.status})`,
		);
		printIssues(build);
	}
}

function printIssues(build: TargetBuildResult): void {
	for (const issue of build.report.issues) {
		const message = `  ${issue.severity}: ${issue.code} - ${issue.message}`;

		if (issue.severity === "error") {
			console.error(message);
		} else {
			console.warn(message);
		}
	}
}

function printHelp(topic?: "build" | "targets"): void {
	if (topic === "build") {
		console.log(buildHelpText);
		return;
	}

	if (topic === "targets") {
		console.log(targetsHelpText);
		return;
	}

	console.log(generalHelpText);
}

function splitOption(argument: string): { name: string; value?: string } {
	const separatorIndex = argument.indexOf("=");

	if (separatorIndex === -1) {
		return { name: argument };
	}

	return {
		name: argument.slice(0, separatorIndex),
		value: argument.slice(separatorIndex + 1),
	};
}

function readOptionValue(
	args: string[],
	index: number,
	inlineValue: string | undefined,
	name: string,
): OptionValue {
	if (inlineValue !== undefined) {
		return { value: inlineValue, nextIndex: index };
	}

	const value = args[index + 1];

	if (!value || value.startsWith("-")) {
		throw new CliError(`Missing value for ${name}`);
	}

	return { value, nextIndex: index + 1 };
}

function isHelpFlag(argument: string): boolean {
	return argument === "--help" || argument === "-h";
}

function displayPath(path: string): string {
	const relativePath = relative(process.cwd(), path);

	if (!relativePath || relativePath.startsWith("..")) {
		return path;
	}

	return relativePath;
}

function isCliEntrypoint(): boolean {
	const entrypoint = process.argv[1];

	if (!entrypoint) {
		return false;
	}

	return pathToFileURL(resolve(entrypoint)).href === import.meta.url;
}

const generalHelpText = `Usage:
	oiap build <plugin-file> [--target all|antigravity|claude-code|codex|cursor|gemini-cli|openclaw|vscode-copilot-chat] [--out <dir>] [--export <name>] [--json]
  oiap targets [--json]

Commands:
  build    Build target bundles from an OIAP plugin file.
  targets  List registered exporter targets.
`;

const buildHelpText = `Usage:
  oiap build <plugin-file> [options]

Options:
  -t, --target <target>  Target to build. Defaults to all.
  -o, --out <dir>        Output directory. Defaults to dist/oiap.
  -e, --export <name>    Plugin export name. Defaults to default, then plugin.
  --json                 Print a machine-readable build summary.
`;

const targetsHelpText = `Usage:
  oiap targets [--json]
`;

if (isCliEntrypoint()) {
	main().catch((error: unknown) => {
		if (error instanceof CliError) {
			console.error(error.message);
			process.exitCode = error.exitCode;
			return;
		}

		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
