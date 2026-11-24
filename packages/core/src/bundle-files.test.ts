/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pluginFiles, skillsFrom, toPluginIr } from "./authoring.ts";
import {
	agentAccessDegradation,
	bundleFileFindings,
	PLUGIN_ROOT_TOKEN,
	renderPluginFiles,
	resolveBundlePaths,
	unresolvedTokenIssues,
} from "./bundle-files.ts";
import type { RenderedFile } from "./primitives.ts";

const agentToken = "$" + "{OIAP_AGENT_FILE:reviewer}";

describe("resolveBundlePaths", () => {
	const files: RenderedFile[] = [
		{
			path: "skills/review/SKILL.md",
			content: `Read ${PLUGIN_ROOT_TOKEN}/standards/style.md and ${agentToken}.`,
		},
		{ path: ".oiap/source-map.json", content: PLUGIN_ROOT_TOKEN },
		{ path: ".oiap/agents/reviewer.json", content: PLUGIN_ROOT_TOKEN },
	];

	test("uses the host root variable when there is one", () => {
		const root = "$" + "{CLAUDE_PLUGIN_ROOT}";
		const [skill, evidence, agentMetadata] = resolveBundlePaths(files, {
			resourceRoot: "",
			rootVariable: root,
			agentFiles: { reviewer: "agents/reviewer.md" },
		});

		expect(skill?.content).toBe(
			`Read ${root}/standards/style.md and ${root}/agents/reviewer.md.`,
		);
		expect(evidence?.content).toBe(PLUGIN_ROOT_TOKEN);
		expect(agentMetadata?.content).toBe(root);
	});

	test("falls back to paths relative to the containing file", () => {
		const [skill] = resolveBundlePaths(files, {
			resourceRoot: ".tool/egm",
			agentFiles: { reviewer: ".tool/agents/reviewer.md" },
		});

		expect(skill?.content).toBe(
			"Read ../../.tool/egm/standards/style.md and ../../.tool/agents/reviewer.md.",
		);
	});

	test("leaves unknown agent tokens in place", () => {
		const [skill] = resolveBundlePaths(files, {
			resourceRoot: "",
			agentFiles: {},
		});

		expect(skill?.content).toContain(agentToken);
	});
});

describe("renderPluginFiles", () => {
	test("places files under a bundle directory", () => {
		const rendered = renderPluginFiles(
			[{ path: "references/a.md", content: "a" }],
			"skills/review",
			{ primitiveId: "review", primitiveKind: "skill-file" },
		);

		expect(rendered).toEqual([
			{
				path: "skills/review/references/a.md",
				content: "a",
				mode: undefined,
				source: {
					primitiveId: "review",
					primitiveKind: "skill-file",
					path: "references/a.md",
				},
			},
		]);
	});
});

describe("renderPluginFiles path safety", () => {
	const source = { primitiveId: "review", primitiveKind: "skill-file" };

	for (const path of [
		".oiap/x.md",
		"../x.md",
		"/x.md",
		"a/./b.md",
		"a//b.md",
		"C:/x.md",
		"a\\b.md",
		"",
	]) {
		test(`rejects ${JSON.stringify(path)}`, () => {
			expect(() =>
				renderPluginFiles([{ path, content: "x" }], "skills/review", source),
			).toThrow("Plugin file path must be relative");
		});
	}
});

describe("bundleFileFindings", () => {
	const ir = toPluginIr({
		instructions: [
			{
				id: "review-body",
				purpose: "workflow",
				triggers: [],
				body: `Read ${PLUGIN_ROOT_TOKEN}/x.md and $\{OIAP_AGENT_FILE:ghost}.`,
			},
		],
		skills: [
			{
				id: "review",
				name: "review",
				description: "Review",
				instructions: { id: "review-body", kind: "instruction" },
				assets: [{ id: "old", kind: "package-asset", path: "old.md" }],
				files: [{ path: "references/a.md", content: "a" }],
			},
		],
	});

	test("reports missing file support and relative paths", () => {
		const { degradations, issues } = bundleFileFindings(ir, {
			target: "sample",
			files: false,
			rootVariable: false,
		});

		expect(degradations.map((entry) => entry.from)).toEqual([
			"bundled-plugin-files",
			"plugin-root-variable",
		]);
		expect(issues.map((issue) => issue.code)).toEqual([
			"skill-assets-not-bundled",
		]);
	});

	test("is quiet when the target supports both", () => {
		const { degradations } = bundleFileFindings(ir, {
			target: "sample",
			files: true,
			rootVariable: true,
		});

		expect(degradations).toEqual([]);
	});
});

describe("bundleFileUsage sources", () => {
	test("finds tokens in rules", () => {
		const { degradations } = bundleFileFindings(
			toPluginIr({
				rules: [
					{
						id: "r",
						target: "sample",
						path: "rules/r.md",
						scope: "workspace",
						mergeStrategy: "frontmatter-file",
						activation: "always",
						content: `Read ${PLUGIN_ROOT_TOKEN}/a.md`,
					},
				],
			}),
			{ target: "sample", files: true, rootVariable: false },
		);

		expect(degradations.map((entry) => entry.from)).toEqual([
			"plugin-root-variable",
		]);
	});
});

describe("unresolvedTokenIssues", () => {
	test("reports tokens left outside evidence files", () => {
		const issues = unresolvedTokenIssues([
			{ path: "AGENTS.md", content: `See ${agentToken}` },
			{ path: ".oiap/source-map.json", content: agentToken },
			{ path: "icon.png", content: new Uint8Array([1]) },
		]);

		expect(issues).toEqual([
			{
				severity: "error",
				code: "unresolved-path-token",
				message: `AGENTS.md still contains ${agentToken}; the referenced agent may not exist or the exporter does not resolve this file.`,
				path: "AGENTS.md",
			},
		]);
	});
});

describe("agentAccessDegradation", () => {
	test("only reports read-only agents", () => {
		const agent = {
			id: "a",
			name: "a",
			description: "a",
			instructions: { id: "a", kind: "instruction" as const },
		};

		expect(agentAccessDegradation("sample", [agent], "no control")).toEqual([]);
		expect(
			agentAccessDegradation(
				"sample",
				[{ ...agent, access: "read-only" }],
				"no control",
			)[0]?.reason,
		).toBe("1 read-only agent(s) are not restricted: no control");
	});
});

describe("pluginFiles", () => {
	test("reads text and binary files with a prefix and filter", () => {
		const root = mkdtempSync(join(tmpdir(), "oiap-files-"));
		mkdirSync(join(root, "nested"));
		writeFileSync(join(root, "nested", "a.md"), "text");
		writeFileSync(join(root, "icon.bin"), new Uint8Array([0xff, 0xfe]));
		writeFileSync(join(root, "skip.md"), "skip");
		writeFileSync(join(root, "run.sh"), "\uFEFFecho", { mode: 0o755 });

		const files = pluginFiles(root, {
			prefix: "assets",
			include: (path) => path !== "skip.md",
		});

		expect(files.map((file) => file.path)).toEqual([
			"assets/icon.bin",
			"assets/nested/a.md",
			"assets/run.sh",
		]);
		expect(files[0]?.content).toBeInstanceOf(Uint8Array);
		expect(files[1]?.content).toBe("text");
		expect(files[1]?.mode).toBeUndefined();
		expect(files[2]?.content).toBe("\uFEFFecho");
		expect(files[2]?.mode).toBe(0o755);
	});
});

describe("skillsFrom", () => {
	test("reads skills in place and synthesizes their instructions", () => {
		const root = mkdtempSync(join(tmpdir(), "oiap-skills-"));
		mkdirSync(join(root, "review", "references"), { recursive: true });
		mkdirSync(join(root, "not-a-skill"));
		const skillFile =
			"---\nname: review\ndescription: Review a document.\ndisable-model-invocation: true\nlicense: MIT\n---\n\nRead the guide.\n";
		writeFileSync(join(root, "review", "SKILL.md"), skillFile);
		writeFileSync(join(root, "review", "references", "guide.md"), "Guide");

		const skills = skillsFrom(root);
		const ir = toPluginIr({ skills });

		expect(skills).toHaveLength(1);
		expect(skills[0]).toMatchObject({
			id: "review",
			name: "review",
			description: "Review a document.",
			modelInvocable: false,
			files: [{ path: "references/guide.md", content: "Guide" }],
			source: { skillFile },
		});
		expect(ir.instructions).toEqual([
			{
				id: "review-skill-source",
				purpose: "workflow",
				triggers: ["review"],
				body: "Read the guide.\n",
			},
		]);
	});

	test("requires a description", () => {
		const root = mkdtempSync(join(tmpdir(), "oiap-skills-"));
		mkdirSync(join(root, "bad"));
		writeFileSync(join(root, "bad", "SKILL.md"), "---\nname: bad\n---\n");

		expect(() => skillsFrom(root)).toThrow("needs a description");
	});
});
