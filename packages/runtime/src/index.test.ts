/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { HookDefinition, RenderedFile } from "@oiap/core";
import { renderHookRuntimeFiles } from "./index";
import { renderRunnerSource } from "./runner-source";

describe("renderRunnerSource", () => {
	test("reads the bundled Bun runner artifact", async () => {
		const source = renderRunnerSource();
		const sourceFile = await readFile(
			new URL("../dist/runner.mjs", import.meta.url),
			"utf8",
		);

		expect(source).toBe(sourceFile);
		expect(source).toStartWith("#!/usr/bin/env node");
		expect(source).toContain("process.argv[2]");
		expect(source).not.toContain("interface HookRuntimeManifest");
		expect(source).toContain("function createHookContext(options)");
		expect(source).toContain("function mapHookFailure(options)");
	});
});

describe("renderHookRuntimeFiles", () => {
	test("renders portable raw-JS hook runtime files", () => {
		const runtime = renderHookRuntimeFiles({
			pluginId: "sample-plugin",
			target: "codex",
			hooks: [sampleHook],
			targetEvent: () => "PreToolUse",
		});
		const paths = runtime.files.map((file) => file.path);

		expect(paths).toEqual([
			".oiap/runtime/runner.mjs",
			".oiap/runtime/hooks.mjs",
			".oiap/runtime/manifest.json",
		]);
		expect(runtime.portableHookIds).toEqual(["pre-tool"]);
		expect(runtime.unsupportedHookIds).toEqual([]);
		expect(runtime.manifest.hooks["pre-tool"]?.exportName).toBe(
			"hook_pre_tool",
		);
		expect(runtime.manifest.hooks["pre-tool"]?.targetEvent).toBe("PreToolUse");
		expect(readText(runtime.files, ".oiap/runtime/hooks.mjs")).toContain(
			"export const hook_pre_tool = async (context) =>",
		);
	});

	test("executes generated hook functions with normalized context", async () => {
		const runtime = renderHookRuntimeFiles({
			pluginId: "sample-plugin",
			target: "codex",
			hooks: [sampleHook],
		});
		const root = await mkdtemp(join(tmpdir(), "oiap-runtime-"));

		for (const file of runtime.files) {
			await writeRenderedFile(root, file);
		}

		const result = await runNode(
			[
				join(root, ".oiap/runtime/runner.mjs"),
				"run-hook",
				"--manifest",
				join(root, ".oiap/runtime/manifest.json"),
				"--target",
				"codex",
				"--event",
				"before_tool",
				"--hook",
				"pre-tool",
			],
			JSON.stringify({
				input: {
					tool: { name: "Bash" },
					arguments: { command: "git status" },
				},
			}),
		);
		const output = JSON.parse(result.stdout) as RuntimeOutput;

		expect(result.exitCode).toBe(0);
		expect(output.oiap.runtime).toBe("generated-js");
		expect(output.oiap.hookId).toBe("pre-tool");
		expect(output.result.decision).toBe("allow");
		expect(output.result.annotations).toContainEqual({
			key: "tool",
			value: "Bash",
		});
		expect(output.result.annotations).toContainEqual({
			key: "command",
			value: "git status",
		});
	});
});

const sampleHook: HookDefinition = {
	kind: "oiap.hook",
	id: "pre-tool",
	event: "before_tool",
	timeoutMs: 2_500,
	handler: async (context) => {
		const input = context.input as {
			tool: { name: string };
			arguments: { command: string };
		};

		return {
			decision: "allow",
			annotations: [
				{ key: "tool", value: input.tool.name },
				{ key: "command", value: String(input.arguments.command) },
			],
		};
	},
};

interface RuntimeOutput {
	oiap: {
		runtime: string;
		hookId: string;
	};
	result: {
		decision: string;
		annotations?: Array<{ key: string; value: string }>;
	};
}

async function writeRenderedFile(
	root: string,
	file: RenderedFile,
): Promise<void> {
	const filePath = join(root, file.path);

	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, file.content, {
		mode: file.mode,
	});
}

function readText(files: RenderedFile[], path: string): string {
	const file = files.find((candidate) => candidate.path === path);

	if (!file || typeof file.content !== "string") {
		throw new Error(`Missing text file: ${path}`);
	}

	return file.content;
}

function runNode(
	args: string[],
	input: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn("node", args, {
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (exitCode) => {
			resolve({ exitCode: exitCode ?? 0, stdout, stderr });
		});
		child.stdin.end(input);
	});
}
