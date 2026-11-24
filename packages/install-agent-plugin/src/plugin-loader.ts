import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { InstallPluginInput } from "@oiap/core";

export async function loadPluginFile(
	inputPath: string,
	exportName?: string,
): Promise<InstallPluginInput> {
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

function isPluginObject(plugin: unknown): plugin is InstallPluginInput {
	return (
		Boolean(plugin) && typeof plugin === "object" && !Array.isArray(plugin)
	);
}

function formatExportNames(moduleExports: Record<string, unknown>): string {
	const exportNames = Object.keys(moduleExports);

	return exportNames.length > 0 ? exportNames.join(", ") : "none";
}
