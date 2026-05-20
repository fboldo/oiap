/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import type { DiscoveredPluginDeclaration } from "@oiap/core";
import {
	InstallAgentPluginError,
	parseInstallAgentPluginArgs,
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
