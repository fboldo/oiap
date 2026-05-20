import { constants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, relative, resolve } from "node:path";
import type { PluginDefinition } from "./authoring";
import type {
	HostProfile,
	InstallPathTemplate,
	InstallScope,
	PluginIr,
	RenderedFile,
	TargetBundle,
	TargetId,
} from "./primitives";

export type InstallPluginInput = PluginDefinition | PluginIr;

export type InstallPluginDeclaration =
	| InstallPluginInput
	| (() => InstallPluginInput | Promise<InstallPluginInput>);

export type InstallPluginScope = InstallScope;

export interface InstallPluginTarget {
	id: TargetId;
	profile?: HostProfile;
	exportBundle(plugin: InstallPluginInput): TargetBundle;
}

export type InstallPluginTargetInput = InstallPluginTarget | TargetId;

export interface InstallPluginOptions {
	plugin: InstallPluginDeclaration;
	target: InstallPluginTargetInput;
	outDir?: string;
	scope?: InstallPluginScope;
	overwrite?: boolean;
	cwd?: string;
	homeDir?: string;
}

export interface InstallPluginResult {
	plugin: InstallPluginInput;
	target: TargetId;
	scope: InstallPluginScope;
	outDir: string;
	explicitOutDir: boolean;
	files: string[];
	report: TargetBundle["report"];
}

interface BuiltInInstallTargetDefinition {
	id: TargetId;
	packageName: string;
	exportName: string;
	profileExportName: string;
}

const builtInInstallTargetDefinitions = {
	antigravity: {
		id: "antigravity",
		packageName: "@oiap/exporter-antigravity",
		exportName: "exportAntigravity",
		profileExportName: "antigravityProfile",
	},
	"claude-code": {
		id: "claude-code",
		packageName: "@oiap/exporter-claude-code",
		exportName: "exportClaudeCode",
		profileExportName: "claudeCodeProfile",
	},
	codex: {
		id: "codex",
		packageName: "@oiap/exporter-codex",
		exportName: "exportCodex",
		profileExportName: "codexProfile",
	},
	cursor: {
		id: "cursor",
		packageName: "@oiap/exporter-cursor",
		exportName: "exportCursor",
		profileExportName: "cursorProfile",
	},
	"gemini-cli": {
		id: "gemini-cli",
		packageName: "@oiap/exporter-gemini-cli",
		exportName: "exportGeminiCli",
		profileExportName: "geminiCliProfile",
	},
	openclaw: {
		id: "openclaw",
		packageName: "@oiap/exporter-openclaw",
		exportName: "exportOpenClaw",
		profileExportName: "openClawProfile",
	},
	opencode: {
		id: "opencode",
		packageName: "@oiap/exporter-opencode",
		exportName: "exportOpenCode",
		profileExportName: "openCodeProfile",
	},
	"vscode-copilot-chat": {
		id: "vscode-copilot-chat",
		packageName: "@oiap/exporter-vscode-copilot",
		exportName: "exportVsCodeCopilot",
		profileExportName: "vsCodeCopilotProfile",
	},
} satisfies Record<string, BuiltInInstallTargetDefinition>;

export type BuiltInInstallTarget = keyof typeof builtInInstallTargetDefinitions;

export const builtInInstallTargets = Object.keys(
	builtInInstallTargetDefinitions,
) as BuiltInInstallTarget[];

export function isBuiltInInstallTarget(
	target: string,
): target is BuiltInInstallTarget {
	return target in builtInInstallTargetDefinitions;
}

export async function loadInstallTarget(
	target: string,
): Promise<InstallPluginTarget | undefined> {
	if (!isBuiltInInstallTarget(target)) {
		return undefined;
	}

	const definition = builtInInstallTargetDefinitions[target];

	try {
		const moduleExports = (await import(definition.packageName)) as Record<
			string,
			unknown
		>;
		const exportBundle = moduleExports[definition.exportName];
		const profile = moduleExports[definition.profileExportName];

		if (!isExportBundleFunction(exportBundle)) {
			throw new Error(
				`${definition.packageName} does not export ${definition.exportName}.`,
			);
		}

		if (!isHostProfile(profile, definition.id)) {
			throw new Error(
				`${definition.packageName} does not export ${definition.profileExportName} for target ${definition.id}.`,
			);
		}

		return {
			id: definition.id,
			profile,
			exportBundle,
		};
	} catch (error) {
		throw new Error(
			`Failed to load exporter package ${definition.packageName} for target ${target}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

export async function installPlugin(
	options: InstallPluginOptions,
): Promise<InstallPluginResult> {
	const plugin = await resolvePluginDeclaration(options.plugin);
	const target = await resolveInstallPluginTarget(options.target);
	const bundle = target.exportBundle(plugin);
	const scope = options.scope ?? "local";
	const outDir = resolveInstallOutputDirectory({
		options,
		plugin,
		bundle,
		target,
		scope,
	});
	const files = await writeTargetBundle(
		bundle,
		outDir,
		options.overwrite ?? false,
	);

	return {
		plugin,
		target: target.id,
		scope,
		outDir,
		explicitOutDir: Boolean(options.outDir),
		files,
		report: bundle.report,
	};
}

function resolveInstallOutputDirectory(context: {
	options: InstallPluginOptions;
	plugin: InstallPluginInput;
	bundle: TargetBundle;
	target: InstallPluginTarget;
	scope: InstallPluginScope;
}): string {
	const { options, plugin, bundle, target, scope } = context;

	if (options.outDir) {
		return isAbsolute(options.outDir)
			? resolve(options.outDir)
			: resolve(options.cwd ?? process.cwd(), options.outDir);
	}

	const installPath = target.profile?.installSupport?.paths[scope];

	if (!installPath) {
		throw new Error(
			`Target ${target.id} profile does not define a ${scope} install path. Pass outDir to choose a destination.`,
		);
	}

	return resolveInstallPathTemplate(installPath, {
		cwd: resolve(options.cwd ?? process.cwd()),
		homeDir: resolve(options.homeDir ?? homedir()),
		pluginId: pluginDirectoryName(plugin, bundle, target.id),
		target: target.id,
	});
}

async function resolveInstallPluginTarget(
	target: InstallPluginTargetInput,
): Promise<InstallPluginTarget> {
	if (typeof target !== "string") {
		return target;
	}

	const resolved = await loadInstallTarget(target);

	if (!resolved) {
		throw new Error(
			`Unknown install target: ${target}. Available targets: ${builtInInstallTargets.join(", ")}`,
		);
	}

	return resolved;
}

function resolveInstallPathTemplate(
	template: InstallPathTemplate,
	context: {
		cwd: string;
		homeDir: string;
		pluginId: string;
		target: TargetId;
	},
): string {
	const baseDirectory = installPathBaseDirectory(template, context);
	const segments = template.segments.map((segment) =>
		installPathSegment(segment, context),
	);

	return resolve(join(baseDirectory, ...segments));
}

function installPathBaseDirectory(
	template: InstallPathTemplate,
	context: { cwd: string; homeDir: string },
): string {
	switch (template.base) {
		case "cwd":
			return context.cwd;
		case "home":
			return context.homeDir;
		case "xdg-config-home":
			return process.env.XDG_CONFIG_HOME
				? resolve(process.env.XDG_CONFIG_HOME)
				: resolve(context.homeDir, ".config");
	}
}

function installPathSegment(
	segment: string,
	context: { pluginId: string; target: TargetId },
): string {
	return segment
		.replaceAll("{pluginId}", context.pluginId)
		.replaceAll("{target}", context.target);
}

async function resolvePluginDeclaration(
	plugin: InstallPluginDeclaration,
): Promise<InstallPluginInput> {
	const resolved = typeof plugin === "function" ? await plugin() : plugin;

	if (!isPluginObject(resolved)) {
		throw new Error(
			"installPlugin expected an OIAP plugin declaration object or a function returning one.",
		);
	}

	return resolved;
}

async function writeTargetBundle(
	bundle: TargetBundle,
	outDir: string,
	overwrite: boolean,
): Promise<string[]> {
	const writtenFiles: string[] = [];

	if ((await pathExists(outDir)) && !overwrite) {
		throw new Error(
			`Output directory already exists: ${outDir}. Pass overwrite: true to replace it.`,
		);
	}

	assertSafeOutputDirectory(outDir);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });

	for (const file of bundle.files) {
		const filePath = resolveRenderedFilePath(outDir, file);
		await mkdir(dirname(filePath), { recursive: true });
		await writeRenderedFile(filePath, file);
		writtenFiles.push(filePath);
	}

	return writtenFiles;
}

function resolveRenderedFilePath(outDir: string, file: RenderedFile): string {
	const segments = file.path.split("/").filter(Boolean);

	if (
		file.path.includes("\0") ||
		file.path.startsWith("/") ||
		segments.some((segment) => segment === "." || segment === "..")
	) {
		throw new Error(`Refusing to write unsafe bundle path: ${file.path}`);
	}

	const filePath = resolve(outDir, ...segments);

	if (!isPathInside(outDir, filePath)) {
		throw new Error(`Refusing to write outside output directory: ${file.path}`);
	}

	return filePath;
}

async function writeRenderedFile(
	filePath: string,
	file: RenderedFile,
): Promise<void> {
	if (file.mode === undefined) {
		await writeFile(filePath, file.content);
		return;
	}

	await writeFile(filePath, file.content, { mode: file.mode });
}

function assertSafeOutputDirectory(outDir: string): void {
	const rootDirectory = parse(outDir).root;
	const currentDirectory = resolve(process.cwd());

	if (outDir === rootDirectory) {
		throw new Error(
			"Refusing to use filesystem root as an install output directory.",
		);
	}

	if (outDir === currentDirectory || isPathInside(outDir, currentDirectory)) {
		throw new Error(
			"Refusing to use the current working directory or one of its parents as an install output directory.",
		);
	}
}

function isPluginObject(plugin: unknown): plugin is InstallPluginInput {
	return (
		Boolean(plugin) && typeof plugin === "object" && !Array.isArray(plugin)
	);
}

function isExportBundleFunction(
	value: unknown,
): value is (plugin: InstallPluginInput) => TargetBundle {
	return typeof value === "function";
}

function isHostProfile(value: unknown, target: TargetId): value is HostProfile {
	if (!value || typeof value !== "object") {
		return false;
	}

	return "id" in value && (value as { id?: unknown }).id === target;
}

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath);

	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

function pluginDirectoryName(
	plugin: InstallPluginInput,
	bundle: TargetBundle,
	target: TargetId,
): string {
	const rawId = plugin.manifest?.id ?? bundle.package?.id ?? `${target}-plugin`;
	const slug = rawId
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return slug || "plugin";
}
