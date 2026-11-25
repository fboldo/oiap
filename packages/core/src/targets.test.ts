/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentsFrom, toPluginIr } from "./authoring.ts";
import { mergeTargetMetadata, scopeToTarget } from "./targets.ts";

describe("mergeTargetMetadata", () => {
	test("merges objects deeply, replaces values and deletes on null", () => {
		const base: Record<string, unknown> = {
			name: "x",
			version: "1.0.0",
			interface: { displayName: "X", category: "Tools" },
			keywords: ["a"],
		};
		expect(
			mergeTargetMetadata(base, {
				version: null,
				interface: { brandColor: "#000", category: null },
				keywords: ["b"],
			}),
		).toEqual({
			name: "x",
			interface: { displayName: "X", brandColor: "#000" },
			keywords: ["b"],
		});
	});
});

describe("scopeToTarget", () => {
	test("keeps primitives without targets and those that list the target", () => {
		const ir = toPluginIr({
			commands: [
				{
					id: "everywhere",
					invocation: { id: "i", kind: "invocation" },
				},
				{
					id: "gemini-only",
					targets: ["gemini-cli"],
					invocation: { id: "i", kind: "invocation" },
				},
			],
		});

		expect(
			scopeToTarget(ir, "claude-code").commands.map((command) => command.id),
		).toEqual(["everywhere"]);
		expect(
			scopeToTarget(ir, "gemini-cli").commands.map((command) => command.id),
		).toEqual(["everywhere", "gemini-only"]);
	});
});

describe("scopeToTarget instructions", () => {
	test("drops instructions only used by scoped-out primitives", () => {
		const ir = toPluginIr({
			instructions: [
				{ id: "only-gemini", purpose: "workflow", triggers: [], body: "G" },
				{ id: "shared", purpose: "workflow", triggers: [], body: "S" },
				{ id: "rule", purpose: "always_on", triggers: [], body: "R" },
			],
			skills: [
				{
					id: "g",
					name: "g",
					description: "G",
					targets: ["gemini-cli"],
					instructions: { id: "only-gemini", kind: "instruction" },
				},
				{
					id: "s",
					name: "s",
					description: "S",
					instructions: { id: "shared", kind: "instruction" },
				},
			],
		});

		expect(
			scopeToTarget(ir, "claude-code").instructions.map((entry) => entry.id),
		).toEqual(["shared", "rule"]);
	});
});

describe("agentsFrom", () => {
	test("reads agent files in place and synthesizes their instructions", () => {
		const root = mkdtempSync(join(tmpdir(), "oiap-agents-"));
		const content =
			"---\nname: reviewer\ndescription: Reviews code.\nmodel: sonnet\ntools: Read, Grep\n---\n\nReview carefully.\n";
		writeFileSync(join(root, "reviewer.md"), content);
		writeFileSync(join(root, "notes.txt"), "ignored");

		const agents = agentsFrom(root);
		const ir = toPluginIr({ agents });

		expect(agents).toMatchObject([
			{
				id: "reviewer",
				name: "reviewer",
				description: "Reviews code.",
				model: "sonnet",
				source: { content },
			},
		]);
		expect(ir.instructions).toEqual([
			{
				id: "reviewer-agent-source",
				purpose: "agent",
				triggers: ["reviewer"],
				body: "Review carefully.\n",
			},
		]);
	});
});
