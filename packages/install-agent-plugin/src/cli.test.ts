/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { DiscoveredPluginDeclaration } from "@oiap/core";
import {
	InstallAgentPluginError,
	parseInstallAgentPluginArgs,
	runInstallAgentPlugin,
	selectPluginDeclaration,
} from "./cli";

describe("parseInstallAgentPluginArgs", () => {
	test("parses list commands", () => {
		expect(
			parseInstallAgentPluginArgs([
				"owner/repo",
				"--list",
				"--ref",
				"main",
				"--json",
			]),
		).toEqual({
			kind: "install",
			source: "owner/repo",
			pluginSelector: undefined,
			agent: undefined,
			outDir: undefined,
			scope: "local",
			ref: "main",
			list: true,
			dryRun: false,
			json: true,
			overwrite: false,
			dependencyInstall: "auto",
			allowInstallScripts: false,
		});
	});

	test("parses plugin materialization commands", () => {
		expect(
			parseInstallAgentPluginArgs([
				".",
				"--plugin=review-guard",
				"--agent",
				"claude-code",
				"--out",
				"dist/review-guard",
				"--overwrite",
				"--global",
			]),
		).toMatchObject({
			kind: "install",
			source: ".",
			pluginSelector: "review-guard",
			agent: "claude-code",
			outDir: "dist/review-guard",
			scope: "global",
			overwrite: true,
			dependencyInstall: "auto",
			allowInstallScripts: false,
		});
	});

	test("parses dependency installation flags", () => {
		expect(
			parseInstallAgentPluginArgs([
				"owner/repo",
				"--plugin",
				"review-guard",
				"--agent",
				"codex",
				"--install-deps",
				"--allow-install-scripts",
			]),
		).toMatchObject({
			dependencyInstall: "always",
			allowInstallScripts: true,
		});

		expect(
			parseInstallAgentPluginArgs([
				"owner/repo",
				"--plugin",
				"review-guard",
				"--agent",
				"codex",
				"--no-install-deps",
			]),
		).toMatchObject({
			dependencyInstall: "never",
			allowInstallScripts: false,
		});
	});
});

describe("selectPluginDeclaration", () => {
	test("selects by manifest id, name, export, and path selector", () => {
		const declaration = pluginDeclaration({ exportName: "default" });
		const declarations = [declaration];

		expect(selectPluginDeclaration(declarations, "review-guard")).toBe(
			declaration,
		);
		expect(selectPluginDeclaration(declarations, "Review Guard")).toBe(
			declaration,
		);
		expect(selectPluginDeclaration(declarations, "default")).toBe(declaration);
		expect(
			selectPluginDeclaration(
				declarations,
				"plugins/review/oiap.plugin.ts#default",
			),
		).toBe(declaration);
	});

	test("throws for ambiguous selectors", () => {
		const declarations = [
			pluginDeclaration({ exportName: "default" }),
			pluginDeclaration({
				exportName: "plugin",
				relativePath: "plugins/other/oiap.plugin.ts",
			}),
		];

		expect(() => selectPluginDeclaration(declarations, "review-guard")).toThrow(
			InstallAgentPluginError,
		);
	});

	test("throws for unexported declarations", () => {
		expect(() =>
			selectPluginDeclaration(
				[
					pluginDeclaration({
						exportKind: "unexported",
						exportName: undefined,
					}),
				],
				"review-guard",
			),
		).toThrow(InstallAgentPluginError);
	});
});

describe("runInstallAgentPlugin", () => {
	test("installs source dependencies and bundles hook imports", async () => {
		const tempDir = await mkdtemp(join(tmpdir(), "oiap-install-agent-"));
		const sourceDir = join(tempDir, "source");
		const outDir = join(tempDir, "out");

		try {
			await writeDependencyFixture(sourceDir);

			const result = await runInstallAgentPlugin({
				kind: "install",
				source: sourceDir,
				pluginSelector: "dependency-plugin",
				agent: "codex",
				outDir,
				scope: "local",
				ref: undefined,
				list: false,
				dryRun: false,
				json: false,
				overwrite: false,
				dependencyInstall: "auto",
				allowInstallScripts: false,
			});

			expect(result.kind).toBe("materialize");
			if (result.kind === "materialize") {
				expect(result.target).toBe("codex");
				expect(result.files.some((file) => file.endsWith("plugin.json"))).toBe(
					true,
				);
				expect(
					result.files.some((file) => file.endsWith(".oiap/runtime/hooks.mjs")),
				).toBe(true);

				const hooksPath = join(outDir, ".oiap", "runtime", "hooks.mjs");
				const hooksSource = await readFile(hooksPath, "utf8");
				expect(hooksSource).toContain("Loaded through a source dependency.");
				expect(hooksSource).not.toContain('from "plugin-helper"');

				const hooksModule = (await import(
					`${pathToFileURL(hooksPath).href}?${Date.now()}`
				)) as {
					hook_runtime_dependency_hook(context: unknown): Promise<{
						decision: string;
						message: string;
					}>;
				};
				expect(
					await hooksModule.hook_runtime_dependency_hook({}),
				).toMatchObject({
					decision: "allow",
					message: "Loaded through a source dependency.",
				});
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	});
});

function pluginDeclaration(
	overrides: Partial<DiscoveredPluginDeclaration> = {},
): DiscoveredPluginDeclaration {
	return {
		filePath: "/repo/plugins/review/oiap.plugin.ts",
		relativePath: "plugins/review/oiap.plugin.ts",
		exportName: "default",
		exportKind: "default",
		localName: undefined,
		line: 4,
		column: 16,
		metadataStatus: "complete",
		manifest: {
			id: "review-guard",
			name: "Review Guard",
			version: "1.0.0",
			description: "Reviews changes.",
			supportedTargets: ["claude-code", "codex"],
		},
		...overrides,
	};
}

async function writeDependencyFixture(sourceDir: string): Promise<void> {
	await mkdir(join(sourceDir, "fake-core"), { recursive: true });
	await mkdir(join(sourceDir, "plugin-helper"), { recursive: true });

	await writeFile(
		join(sourceDir, "package.json"),
		JSON.stringify(
			{
				type: "module",
				dependencies: {
					"@oiap/core": "file:./fake-core",
					"plugin-helper": "file:./plugin-helper",
				},
			},
			null,
			"\t",
		),
	);
	await writeFile(
		join(sourceDir, "fake-core", "package.json"),
		JSON.stringify(
			{
				name: "@oiap/core",
				version: "0.0.0-test",
				type: "module",
				exports: "./index.js",
			},
			null,
			"\t",
		),
	);
	await writeFile(
		join(sourceDir, "fake-core", "index.js"),
		"export function definePlugin(plugin) { return plugin; }\n",
	);
	await writeFile(
		join(sourceDir, "plugin-helper", "package.json"),
		JSON.stringify({
			name: "plugin-helper",
			version: "0.0.0-test",
			type: "module",
			exports: "./index.js",
		}),
	);
	await writeFile(
		join(sourceDir, "plugin-helper", "index.js"),
		'export const description = "Loaded through a source dependency.";\n',
	);
	await writeFile(
		join(sourceDir, "hooks.js"),
		[
			'import { description } from "plugin-helper";',
			"",
			"const hookMessage = description;",
			"",
			"export const dependencyHooks = [",
			"\t{",
			'\t\tkind: "oiap.hook",',
			'\t\tid: "runtime-dependency-hook",',
			'\t\tevent: "before_tool",',
			"\t\thandler: async () => {",
			'\t\t\treturn { decision: "allow", message: hookMessage };',
			"\t\t},",
			"\t},",
			"];",
			"",
		].join("\n"),
	);
	await writeFile(
		join(sourceDir, "oiap.plugin.js"),
		[
			'import { definePlugin } from "@oiap/core";',
			'import { dependencyHooks } from "./hooks.js";',
			"",
			"export default definePlugin({",
			"\tmanifest: {",
			'\t\tid: "dependency-plugin",',
			'\t\tname: "Dependency Plugin",',
			'\t\tversion: "1.0.0",',
			'\t\tdescription: "Loads hooks from normal JavaScript modules.",',
			'\t\tcategories: ["test"],',
			'\t\tsupportedTargets: ["codex"],',
			"\t},",
			"\thooks: dependencyHooks,",
			"});",
			"",
		].join("\n"),
	);
}
