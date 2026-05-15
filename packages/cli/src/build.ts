import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RenderedFile, TargetBundle } from "@oiap/core";
import type { CliPluginInput } from "./registry";
import { getRegisteredExporter, registeredTargets } from "./registry";

export interface BuildPluginFileOptions {
	inputPath: string;
	target: string;
	outDir: string;
	exportName?: string;
}

export interface BuildSummary {
	inputPath: string;
	builds: TargetBuildResult[];
}

export interface TargetBuildResult {
	target: string;
	outDir: string;
	files: string[];
	report: TargetBundle["report"];
}

export async function buildPluginFile(
	options: BuildPluginFileOptions,
): Promise<BuildSummary> {
	const plugin = await loadPluginFile(options.inputPath, options.exportName);
	const targets = resolveTargetSelection(options.target);
	const inputPath = resolve(options.inputPath);
	const builds: TargetBuildResult[] = [];

	for (const target of targets) {
		const exporter = getRegisteredExporter(target);

		if (!exporter) {
			throw new Error(`No exporter registered for target: ${target}`);
		}

		const bundle = exporter.exportBundle(plugin);
		const outDir = resolveOutputDir(options.outDir, options.target, target);
		const files = await writeTargetBundle(bundle, outDir);

		builds.push({ target, outDir, files, report: bundle.report });
	}

	return { inputPath, builds };
}

export async function loadPluginFile(
	inputPath: string,
	exportName?: string,
): Promise<CliPluginInput> {
	const absoluteInputPath = resolve(inputPath);
	const moduleUrl = pathToFileURL(absoluteInputPath).href;
	const moduleExports = (await import(moduleUrl)) as Record<string, unknown>;
	const exportedValue = selectPluginExport(moduleExports, exportName);
	const plugin = await resolvePluginExport(exportedValue);

	if (!isPluginObject(plugin)) {
		throw new Error(
			`Plugin file must export an OIAP plugin object or a function returning one: ${inputPath}`,
		);
	}

	return plugin;
}

export async function writeTargetBundle(
	bundle: TargetBundle,
	outDir: string,
): Promise<string[]> {
	const absoluteOutDir = resolve(outDir);
	const writtenFiles: string[] = [];
	await resetOutputDirectory(absoluteOutDir);

	for (const file of bundle.files) {
		const filePath = resolveRenderedFilePath(absoluteOutDir, file);
		await mkdir(dirname(filePath), { recursive: true });
		await writeRenderedFile(filePath, file);
		writtenFiles.push(filePath);
	}

	return writtenFiles;
}

function resolveTargetSelection(target: string): string[] {
	if (target === "all") {
		return [...registeredTargets];
	}

	if (getRegisteredExporter(target)) {
		return [target];
	}

	throw new Error(
		`Unknown target: ${target}. Available targets: all, ${registeredTargets.join(", ")}`,
	);
}

function resolveOutputDir(
	outDir: string,
	targetSelection: string,
	target: string,
): string {
	if (targetSelection === "all") {
		return resolve(outDir, target);
	}

	return resolve(outDir);
}

function selectPluginExport(
	moduleExports: Record<string, unknown>,
	exportName?: string,
): unknown {
	if (exportName) {
		if (exportName in moduleExports) {
			return moduleExports[exportName];
		}

		throw new Error(
			`Plugin file does not export "${exportName}". Available exports: ${formatExportNames(moduleExports)}`,
		);
	}

	if ("default" in moduleExports) {
		return moduleExports.default;
	}

	if ("plugin" in moduleExports) {
		return moduleExports.plugin;
	}

	throw new Error(
		`Plugin file must export default or plugin. Available exports: ${formatExportNames(moduleExports)}`,
	);
}

async function resolvePluginExport(exportedValue: unknown): Promise<unknown> {
	if (typeof exportedValue === "function") {
		return exportedValue();
	}

	return exportedValue;
}

function isPluginObject(plugin: unknown): plugin is CliPluginInput {
	return (
		Boolean(plugin) && typeof plugin === "object" && !Array.isArray(plugin)
	);
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

async function resetOutputDirectory(outDir: string): Promise<void> {
	assertSafeOutputDirectory(outDir);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(outDir, { recursive: true });
}

function assertSafeOutputDirectory(outDir: string): void {
	const currentDirectory = resolve(process.cwd());
	const rootDirectory = parse(outDir).root;

	if (outDir === rootDirectory) {
		throw new Error(
			"Refusing to clean filesystem root as an OIAP output directory.",
		);
	}

	if (outDir === currentDirectory || isPathInside(outDir, currentDirectory)) {
		throw new Error(
			"Refusing to clean the current workspace as an OIAP output directory.",
		);
	}

	if (!isPathInside(currentDirectory, outDir)) {
		throw new Error(
			"Refusing to clean an OIAP output directory outside the current workspace.",
		);
	}
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

function isPathInside(parentPath: string, childPath: string): boolean {
	const relativePath = relative(parentPath, childPath);

	return (
		relativePath === "" ||
		(!relativePath.startsWith("..") && !isAbsolute(relativePath))
	);
}

function formatExportNames(moduleExports: Record<string, unknown>): string {
	const exportNames = Object.keys(moduleExports);

	return exportNames.length > 0 ? exportNames.join(", ") : "none";
}
