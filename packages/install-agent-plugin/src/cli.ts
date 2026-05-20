#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import {
	builtInInstallTargets,
	type DiscoveredPluginDeclaration,
	discoverPluginDeclarations,
	type InstallPluginResult,
	type InstallPluginScope,
	installPlugin,
	isBuiltInInstallTarget,
} from "@oiap/core";
import { bundleInstalledHookRuntime } from "./hook-bundler";
import { loadPluginFile } from "./plugin-loader";

const execFileAsync = promisify(execFile);

export type InstallAgentPluginCommand = InstallCommand | HelpCommand;

export type DependencyInstallMode = "auto" | "always" | "never";

export interface InstallCommand {
	kind: "install";
	source: string;
	pluginSelector?: string;
	agent?: string;
	outDir?: string;
	scope: InstallPluginScope;
	ref?: string;
	list: boolean;
	dryRun: boolean;
	json: boolean;
	overwrite: boolean;
	dependencyInstall: DependencyInstallMode;
	allowInstallScripts: boolean;
}

export interface HelpCommand {
	kind: "help";
}

export type InstallAgentPluginResult =
	| ListResult
	| MaterializeResult
	| DryRunResult;

export interface ListResult {
	kind: "list";
	source: ResolvedPluginSourceSummary;
	declarations: DiscoveredPluginDeclaration[];
}

export interface DryRunResult {
	kind: "dry-run";
	source: ResolvedPluginSourceSummary;
	declaration: DiscoveredPluginDeclaration;
	target: string;
	scope: InstallPluginScope;
}

export interface MaterializeResult {
	kind: "materialize";
	source: ResolvedPluginSourceSummary;
	declaration: DiscoveredPluginDeclaration;
	target: string;
	scope: InstallPluginScope;
	outDir: string;
	explicitOutDir: boolean;
	files: string[];
	report: InstallPluginResult["report"];
}

export interface ResolvedPluginSourceSummary {
	input: string;
	directory: string;
	ref?: string;
	temporary: boolean;
}

interface ResolvedPluginSource extends ResolvedPluginSourceSummary {
	cleanup(): Promise<void>;
}

interface OptionValue {
	value: string;
	nextIndex: number;
}

interface DependencyInstallOptions {
	mode: DependencyInstallMode;
	allowScripts: boolean;
}

interface DependencyInstallPlan {
	command: string;
	args: string[];
	cwd: string;
	label: string;
}

export class InstallAgentPluginError extends Error {
	readonly exitCode: number;

	constructor(message: string, exitCode = 1) {
		super(message);
		this.exitCode = exitCode;
	}
}

export async function main(args = process.argv.slice(2)): Promise<void> {
	const command = parseInstallAgentPluginArgs(args);

	if (command.kind === "help") {
		printHelp();
		return;
	}

	const result = await runInstallAgentPlugin(command);

	if (command.json) {
		console.log(JSON.stringify(result, null, "\t"));
		return;
	}

	printResult(result);

	if (result.kind === "materialize" && result.report.status === "unsupported") {
		process.exitCode = 1;
	}
}

export function parseInstallAgentPluginArgs(
	args: string[],
): InstallAgentPluginCommand {
	if (args.length === 0 || args.some((argument) => isHelpFlag(argument))) {
		return { kind: "help" };
	}

	let source: string | undefined;
	let pluginSelector: string | undefined;
	let agent: string | undefined;
	let outDir: string | undefined;
	let scope: InstallPluginScope = "local";
	let ref: string | undefined;
	let list = false;
	let dryRun = false;
	let json = false;
	let overwrite = false;
	let dependencyInstall: DependencyInstallMode = "auto";
	let allowInstallScripts = false;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];

		if (!argument) {
			continue;
		}

		const option = splitOption(argument);

		switch (option.name) {
			case "--install-deps":
				dependencyInstall = "always";
				break;
			case "--no-install-deps":
				dependencyInstall = "never";
				break;
			case "--allow-install-scripts":
				allowInstallScripts = true;
				break;
			case "--global":
			case "-g":
				scope = "global";
				break;
			case "--local":
			case "--project":
				scope = "local";
				break;
			case "--plugin":
			case "-p": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				pluginSelector = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			case "--agent":
			case "--target":
			case "-a":
			case "-t": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				agent = parsed.value;
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
			case "--ref": {
				const parsed = readOptionValue(args, index, option.value, option.name);
				ref = parsed.value;
				index = parsed.nextIndex;
				break;
			}
			case "--list":
			case "-l":
				list = true;
				break;
			case "--dry-run":
				dryRun = true;
				break;
			case "--json":
				json = true;
				break;
			case "--overwrite":
				overwrite = true;
				break;
			default:
				if (argument.startsWith("-")) {
					throw new InstallAgentPluginError(`Unknown option: ${argument}`);
				}

				if (source) {
					throw new InstallAgentPluginError(
						`Expected one source, received: ${source}, ${argument}`,
					);
				}

				source = argument;
		}
	}

	if (!source) {
		throw new InstallAgentPluginError(
			"Missing source. Usage: install-agent-plugin <owner/repo|path>",
		);
	}

	return {
		kind: "install",
		source,
		pluginSelector,
		agent,
		outDir,
		scope,
		ref,
		list,
		dryRun,
		json,
		overwrite,
		dependencyInstall,
		allowInstallScripts,
	};
}

export async function runInstallAgentPlugin(
	command: InstallCommand,
): Promise<InstallAgentPluginResult> {
	const source = await resolvePluginSource(command);

	try {
		const declarations = await discoverPluginDeclarations(source.directory);

		if (command.list) {
			return { kind: "list", source: sourceSummary(source), declarations };
		}

		if (!command.pluginSelector) {
			throw new InstallAgentPluginError(
				"Missing --plugin. Use --list to inspect installable plugin declarations.",
			);
		}

		if (!command.agent) {
			throw new InstallAgentPluginError(
				`Missing --agent. Available agents: ${builtInInstallTargets.join(", ")}`,
			);
		}

		if (!isBuiltInInstallTarget(command.agent)) {
			throw new InstallAgentPluginError(
				`Unknown agent: ${command.agent}. Available agents: ${builtInInstallTargets.join(", ")}`,
			);
		}

		const declaration = selectPluginDeclaration(
			declarations,
			command.pluginSelector,
		);

		if (command.dryRun) {
			return {
				kind: "dry-run",
				source: sourceSummary(source),
				declaration,
				target: command.agent,
				scope: command.scope,
			};
		}

		await installSourceDependencies(source, {
			mode: command.dependencyInstall,
			allowScripts: command.allowInstallScripts,
		});

		const plugin = await loadPluginFile(
			declaration.filePath,
			exportNameForLoad(declaration),
		);
		const installResult = await installPlugin({
			plugin,
			target: command.agent,
			outDir: command.outDir,
			scope: command.scope,
			overwrite: command.overwrite,
		});
		const bundledHookFiles = await bundleInstalledHookRuntime({
			pluginFilePath: declaration.filePath,
			declaration,
			outDir: installResult.outDir,
		});

		return {
			kind: "materialize",
			source: sourceSummary(source),
			declaration,
			target: installResult.target,
			scope: installResult.scope,
			outDir: installResult.outDir,
			explicitOutDir: installResult.explicitOutDir,
			files: [...installResult.files, ...bundledHookFiles],
			report: installResult.report,
		};
	} finally {
		await source.cleanup();
	}
}

export function selectPluginDeclaration(
	declarations: readonly DiscoveredPluginDeclaration[],
	selector: string,
): DiscoveredPluginDeclaration {
	const matches = declarations.filter((declaration) =>
		matchesPluginSelector(declaration, selector),
	);

	if (matches.length === 0) {
		throw new InstallAgentPluginError(
			`No plugin declaration matched "${selector}". Use --list to inspect available plugins.`,
		);
	}

	if (matches.length > 1) {
		throw new InstallAgentPluginError(
			`Plugin selector "${selector}" is ambiguous: ${matches.map(formatDeclarationSelector).join(", ")}`,
		);
	}

	const declaration = matches[0];

	if (!declaration) {
		throw new InstallAgentPluginError(
			`No plugin declaration matched "${selector}".`,
		);
	}

	if (declaration.exportKind === "unexported") {
		throw new InstallAgentPluginError(
			`Plugin declaration "${selector}" is not exported and cannot be installed.`,
		);
	}

	return declaration;
}

async function resolvePluginSource(
	command: InstallCommand,
): Promise<ResolvedPluginSource> {
	const localPath = resolve(expandUserPath(command.source));

	if (await pathExists(localPath)) {
		const localStats = await stat(localPath);

		if (!localStats.isDirectory()) {
			throw new InstallAgentPluginError(
				`Source must be a repository directory: ${command.source}`,
			);
		}

		return {
			input: command.source,
			directory: localPath,
			ref: command.ref,
			temporary: false,
			cleanup: async () => {},
		};
	}

	if (!isGitHubShorthand(command.source)) {
		throw new InstallAgentPluginError(
			`Source must be a local directory or GitHub shorthand owner/repo: ${command.source}`,
		);
	}

	const tempDirectory = await mktempRepositoryDirectory();
	const repositoryDirectory = join(tempDirectory, "repo");
	const repositoryUrl = `https://github.com/${command.source}.git`;
	const cloneArgs = ["clone", "--depth", "1"];

	if (command.ref) {
		cloneArgs.push("--branch", command.ref);
	}

	cloneArgs.push(repositoryUrl, repositoryDirectory);

	try {
		await execFileAsync("git", cloneArgs, { timeout: 120_000 });
	} catch (error) {
		await rm(tempDirectory, { recursive: true, force: true });
		throw new InstallAgentPluginError(
			`Failed to clone ${command.source}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	return {
		input: command.source,
		directory: repositoryDirectory,
		ref: command.ref,
		temporary: true,
		cleanup: async () => {
			await rm(tempDirectory, { recursive: true, force: true });
		},
	};
}

async function installSourceDependencies(
	source: ResolvedPluginSource,
	options: DependencyInstallOptions,
): Promise<void> {
	const plan = await sourceDependencyInstallPlan(source, options);

	if (!plan) {
		return;
	}

	await runDependencyInstall(plan);
}

async function sourceDependencyInstallPlan(
	source: ResolvedPluginSource,
	options: DependencyInstallOptions,
): Promise<DependencyInstallPlan | undefined> {
	if (options.mode === "never") {
		return undefined;
	}

	if (!(await pathExists(join(source.directory, "package.json")))) {
		return undefined;
	}

	if (
		options.mode === "auto" &&
		!source.temporary &&
		(await pathExists(join(source.directory, "node_modules")))
	) {
		return undefined;
	}

	return await packageManagerInstallPlan(
		source.directory,
		options.allowScripts,
	);
}

async function packageManagerInstallPlan(
	directory: string,
	allowScripts: boolean,
): Promise<DependencyInstallPlan> {
	if (await pathExists(join(directory, "bun.lock"))) {
		return {
			command: "bun",
			args: [
				"install",
				"--frozen-lockfile",
				...ignoreScriptsArgs("bun", allowScripts),
			],
			cwd: directory,
			label: "bun install",
		};
	}

	if (await pathExists(join(directory, "bun.lockb"))) {
		return {
			command: "bun",
			args: [
				"install",
				"--frozen-lockfile",
				...ignoreScriptsArgs("bun", allowScripts),
			],
			cwd: directory,
			label: "bun install",
		};
	}

	if (await pathExists(join(directory, "pnpm-lock.yaml"))) {
		return {
			command: "pnpm",
			args: [
				"install",
				"--frozen-lockfile",
				...ignoreScriptsArgs("pnpm", allowScripts),
			],
			cwd: directory,
			label: "pnpm install",
		};
	}

	if (await pathExists(join(directory, "yarn.lock"))) {
		return {
			command: "yarn",
			args: [
				"install",
				"--frozen-lockfile",
				...ignoreScriptsArgs("yarn", allowScripts),
			],
			cwd: directory,
			label: "yarn install",
		};
	}

	if (
		(await pathExists(join(directory, "package-lock.json"))) ||
		(await pathExists(join(directory, "npm-shrinkwrap.json")))
	) {
		return {
			command: "npm",
			args: ["ci", ...ignoreScriptsArgs("npm", allowScripts)],
			cwd: directory,
			label: "npm ci",
		};
	}

	return {
		command: "npm",
		args: ["install", ...ignoreScriptsArgs("npm", allowScripts)],
		cwd: directory,
		label: "npm install",
	};
}

function ignoreScriptsArgs(
	packageManager: "bun" | "npm" | "pnpm" | "yarn",
	allowScripts: boolean,
): string[] {
	if (allowScripts) {
		return [];
	}

	switch (packageManager) {
		case "bun":
		case "npm":
		case "pnpm":
		case "yarn":
			return ["--ignore-scripts"];
	}
}

async function runDependencyInstall(
	plan: DependencyInstallPlan,
): Promise<void> {
	try {
		await execFileAsync(plan.command, plan.args, {
			cwd: plan.cwd,
			timeout: 300_000,
			maxBuffer: 1024 * 1024 * 10,
		});
	} catch (error) {
		throw new InstallAgentPluginError(
			`Failed to install dependencies with ${plan.label}: ${formatProcessError(error)}`,
		);
	}
}

function formatProcessError(error: unknown): string {
	if (!error || typeof error !== "object") {
		return String(error);
	}

	const processError = error as {
		message?: unknown;
		stderr?: unknown;
		stdout?: unknown;
	};
	const stderr =
		typeof processError.stderr === "string" ? processError.stderr.trim() : "";
	const stdout =
		typeof processError.stdout === "string" ? processError.stdout.trim() : "";

	return (
		stderr ||
		stdout ||
		(typeof processError.message === "string"
			? processError.message
			: String(error))
	);
}

function matchesPluginSelector(
	declaration: DiscoveredPluginDeclaration,
	selector: string,
): boolean {
	const candidates = [
		declaration.manifest?.id,
		declaration.manifest?.name,
		declaration.exportName,
		declaration.localName,
		declaration.relativePath,
		formatDeclarationSelector(declaration),
	];

	return candidates.some((candidate) => candidate === selector);
}

function formatDeclarationSelector(
	declaration: DiscoveredPluginDeclaration,
): string {
	return declaration.exportName
		? `${declaration.relativePath}#${declaration.exportName}`
		: declaration.relativePath;
}

function exportNameForLoad(
	declaration: DiscoveredPluginDeclaration,
): string | undefined {
	return declaration.exportName === "default"
		? undefined
		: declaration.exportName;
}

function sourceSummary(
	source: ResolvedPluginSource,
): ResolvedPluginSourceSummary {
	return {
		input: source.input,
		directory: source.directory,
		ref: source.ref,
		temporary: source.temporary,
	};
}

function printResult(result: InstallAgentPluginResult): void {
	if (result.kind === "list") {
		printDeclarationList(result);
		return;
	}

	if (result.kind === "dry-run") {
		console.log(
			`Selected ${displayDeclaration(result.declaration)} for ${result.target} (${result.scope} scope).`,
		);
		return;
	}

	console.log(
		`${result.explicitOutDir ? "Materialized" : "Installed"} ${displayDeclaration(result.declaration)} for ${result.target} (${result.scope} scope) -> ${displayPath(result.outDir)} (${result.files.length} files, ${result.report.status})`,
	);

	for (const issue of result.report.issues) {
		const message = `  ${issue.severity}: ${issue.code} - ${issue.message}`;

		if (issue.severity === "error") {
			console.error(message);
		} else {
			console.warn(message);
		}
	}
}

function printDeclarationList(result: ListResult): void {
	if (result.declarations.length === 0) {
		console.log(`No OIAP plugin declarations found in ${result.source.input}.`);
		return;
	}

	console.log(`Installable plugins in ${result.source.input}:`);

	for (const declaration of result.declarations) {
		const targets =
			declaration.manifest?.supportedTargets?.join(", ") ?? "unknown";
		console.log(
			`- ${displayDeclaration(declaration)} (${formatDeclarationSelector(declaration)})`,
		);
		console.log(`  targets: ${targets}`);
		console.log(`  metadata: ${declaration.metadataStatus}`);
	}
}

function displayDeclaration(declaration: DiscoveredPluginDeclaration): string {
	return (
		declaration.manifest?.id ??
		declaration.manifest?.name ??
		declaration.exportName ??
		declaration.relativePath
	);
}

function printHelp(): void {
	console.log(helpText);
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
		throw new InstallAgentPluginError(`Missing value for ${name}`);
	}

	return { value, nextIndex: index + 1 };
}

function isHelpFlag(argument: string): boolean {
	return argument === "--help" || argument === "-h";
}

function isGitHubShorthand(source: string): boolean {
	return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source);
}

function expandUserPath(filePath: string): string {
	if (filePath === "~") {
		return homedir();
	}

	if (filePath.startsWith("~/")) {
		return join(homedir(), filePath.slice(2));
	}

	return filePath;
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function mktempRepositoryDirectory(): Promise<string> {
	await mkdir(tmpdir(), { recursive: true });

	return await mkdtemp(join(tmpdir(), "oiap-install-"));
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

const helpText = `Usage:
  install-agent-plugin <owner/repo|path> --list [--ref <ref>] [--json]
	install-agent-plugin <owner/repo|path> --plugin <name> --agent <target> [-g] [--out <dir>] [--ref <ref>] [--overwrite] [--json]

Options:
  -l, --list              List OIAP definePlugin declarations without loading them.
  -p, --plugin <name>     Plugin manifest id/name, export name, or path#export selector.
  -a, --agent <target>    Target agent exporter. Alias: --target.
	-g, --global            Install to the target's user-level path. Defaults to the local/project path.
	--local, --project      Install to the target's local/project path.
	-o, --out <dir>         Override the target install path and write the selected bundle to a directory.
  --ref <ref>             Git branch or tag for owner/repo sources.
  --dry-run               Resolve source, plugin, and agent without loading or writing.
	--install-deps           Always install source package dependencies before loading the plugin.
	--no-install-deps        Do not install source or runtime dependencies.
	--allow-install-scripts  Allow package manager lifecycle scripts while installing dependencies.
	--overwrite             Replace an existing install or --out directory.
  --json                  Print machine-readable output.

By default, plugins install to the selected target's local/project directory. The installer installs dependencies for cloned repositories and local checkouts without node_modules, ignoring lifecycle scripts unless --allow-install-scripts is passed. Use --global for user-level installation or --out for a reviewable bundle directory.
`;

if (isCliEntrypoint()) {
	main().catch((error: unknown) => {
		if (error instanceof InstallAgentPluginError) {
			console.error(error.message);
			process.exitCode = error.exitCode;
			return;
		}

		console.error(error instanceof Error ? error.message : String(error));
		process.exitCode = 1;
	});
}
