/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { discoverPluginDeclarations } from "./discovery";

describe("discoverPluginDeclarations", () => {
	test("discovers default definePlugin exports and static manifest metadata", async () => {
		const rootDir = await createFixture({
			"plugins/review/oiap.plugin.ts": `
import type { PluginDefinition } from "@oiap/core";
import { definePlugin } from "@oiap/core";

export default definePlugin({
	manifest: {
		id: "review-guard",
		name: "Review Guard",
		version: "1.0.0",
		description: "Review changes before merging.",
		categories: ["review"],
		supportedTargets: ["claude-code", "codex"],
	},
} satisfies PluginDefinition);
`,
		});

		const declarations = await discoverPluginDeclarations(rootDir);

		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toMatchObject({
			relativePath: "plugins/review/oiap.plugin.ts",
			exportName: "default",
			exportKind: "default",
			metadataStatus: "complete",
			manifest: {
				id: "review-guard",
				name: "Review Guard",
				version: "1.0.0",
				description: "Review changes before merging.",
				supportedTargets: ["claude-code", "codex"],
			},
		});
	});

	test("supports aliased named imports and namespace imports", async () => {
		const rootDir = await createFixture({
			"plugins/named.ts": `
import { definePlugin as makePlugin } from "@oiap/core";

export const namedPlugin = makePlugin({
	manifest: {
		id: "named-plugin",
		name: "Named Plugin",
		version: "1.0.0",
		description: "A named plugin export.",
		categories: ["test"],
		supportedTargets: ["codex"],
	},
});
`,
			"plugins/namespace.ts": `
import * as oiap from "@oiap/core";

const namespacePlugin = oiap.definePlugin({
	manifest: {
		id: "namespace-plugin",
		name: "Namespace Plugin",
		version: "1.0.0",
		description: "A namespace plugin export.",
		categories: ["test"],
		supportedTargets: ["cursor"],
	},
});

export { namespacePlugin as renamedPlugin };
`,
		});

		const declarations = await discoverPluginDeclarations(rootDir);

		expect(declarations).toHaveLength(2);
		expect(
			declarations.map((declaration) => ({
				exportName: declaration.exportName,
				id: declaration.manifest?.id,
				localName: declaration.localName,
			})),
		).toEqual([
			{
				exportName: "namedPlugin",
				id: "named-plugin",
				localName: "namedPlugin",
			},
			{
				exportName: "renamedPlugin",
				id: "namespace-plugin",
				localName: "namespacePlugin",
			},
		]);
	});

	test("ignores local definePlugin functions not imported as values from core", async () => {
		const rootDir = await createFixture({
			"plugins/local.ts": `
import type { PluginDefinition } from "@oiap/core";

function definePlugin(definition: PluginDefinition): PluginDefinition {
	return definition;
}

export default definePlugin({
	manifest: {
		id: "local-plugin",
		name: "Local Plugin",
		version: "1.0.0",
		description: "Should not be discovered.",
		categories: ["test"],
		supportedTargets: ["codex"],
	},
});
`,
		});

		await expect(discoverPluginDeclarations(rootDir)).resolves.toEqual([]);
	});

	test("skips non-source files even when scanning a direct file path", async () => {
		const rootDir = await createFixture({
			"README.md": `
\`\`\`ts
import { definePlugin } from "@oiap/core";

export default definePlugin({
	manifest: {
		id: "readme-plugin",
		name: "README Plugin",
		version: "1.0.0",
		description: "A documentation example.",
		categories: ["docs"],
		supportedTargets: ["codex"],
	},
});
\`\`\`
`,
		});

		await expect(
			discoverPluginDeclarations(join(rootDir, "README.md")),
		).resolves.toEqual([]);
	});

	test("can include unexported plugin calls for diagnostics", async () => {
		const rootDir = await createFixture({
			"plugins/unexported.ts": `
import { definePlugin } from "@oiap/core";

const manifest = {
	id: "unexported-plugin",
	name: "Unexported Plugin",
};

const localPlugin = definePlugin({ manifest });

void localPlugin;
`,
		});

		await expect(discoverPluginDeclarations(rootDir)).resolves.toEqual([]);

		const declarations = await discoverPluginDeclarations(rootDir, {
			includeUnexported: true,
		});

		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toMatchObject({
			exportKind: "unexported",
			localName: "localPlugin",
			metadataStatus: "unavailable",
		});
	});

	test("marks dynamic manifest fields as partial metadata", async () => {
		const rootDir = await createFixture({
			"plugins/dynamic.ts": `
import { definePlugin } from "@oiap/core";

const target = "codex";

export default definePlugin({
	manifest: {
		id: "dynamic-plugin",
		name: target,
		version: "1.0.0",
		description: "Has dynamic metadata.",
		categories: ["test"],
		supportedTargets: [target],
	},
});
`,
		});

		const declarations = await discoverPluginDeclarations(rootDir);

		expect(declarations).toHaveLength(1);
		expect(declarations[0]).toMatchObject({
			metadataStatus: "partial",
			manifest: {
				id: "dynamic-plugin",
				version: "1.0.0",
				description: "Has dynamic metadata.",
			},
		});
		expect(declarations[0]?.manifest?.name).toBeUndefined();
		expect(declarations[0]?.manifest?.supportedTargets).toBeUndefined();
	});
});

async function createFixture(files: Record<string, string>): Promise<string> {
	const rootDir = await mkdtemp(join(tmpdir(), "oiap-discovery-"));

	for (const [relativePath, content] of Object.entries(files)) {
		const filePath = join(rootDir, relativePath);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, content.trimStart());
	}

	return rootDir;
}
