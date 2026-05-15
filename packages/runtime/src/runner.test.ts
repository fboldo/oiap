/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runnerPath = fileURLToPath(
	new URL("../dist/runner.mjs", import.meta.url),
);

describe("runner", () => {
	test("executes a bundled hook with normalized tool context", async () => {
		const fixture = await writeRunnerFixture({
			hooksSource: `
export async function inspectContext(context) {
	return {
		decision: "allow",
		annotations: [
			{ key: "plugin", value: context.pluginId },
			{ key: "target", value: context.target.id },
			{ key: "tool", value: context.input.tool.name },
			{ key: "command", value: context.input.arguments.command },
			{ key: "workspace", value: context.workspace.root },
		],
	};
}
`,
			hook: {
				id: "inspect-context",
				event: "before_tool",
				exportName: "inspectContext",
			},
		});

		const result = await runRunner(fixture, {
			input: JSON.stringify({
				toolName: "Shell",
				args: { command: "pwd" },
				workspace: { id: "workspace-id", root: "/repo" },
			}),
		});
		const output = parseRunnerOutput(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(output.oiap).toEqual({
			runtime: "generated-js",
			hookId: "inspect-context",
			event: "before_tool",
			target: "codex",
		});
		expect(output.result).toMatchObject({ decision: "allow" });
		expect(output.result.annotations).toContainEqual({
			key: "plugin",
			value: "runner-test",
		});
		expect(output.result.annotations).toContainEqual({
			key: "target",
			value: "codex",
		});
		expect(output.result.annotations).toContainEqual({
			key: "tool",
			value: "Shell",
		});
		expect(output.result.annotations).toContainEqual({
			key: "command",
			value: "pwd",
		});
		expect(output.result.annotations).toContainEqual({
			key: "workspace",
			value: "/repo",
		});
	});

	test("maps block decisions to host-blocking process output", async () => {
		const fixture = await writeRunnerFixture({
			hooksSource: `
export async function blockTool() {
	return { decision: "block", message: "Blocked by policy" };
}
`,
			hook: {
				id: "block-tool",
				event: "before_tool",
				exportName: "blockTool",
			},
		});

		const result = await runRunner(fixture, {
			input: JSON.stringify({ toolName: "Shell" }),
		});
		const output = parseRunnerOutput(result.stdout);

		expect(result.exitCode).toBe(2);
		expect(result.stderr).toBe("Blocked by policy\n");
		expect(output.result).toEqual({
			decision: "block",
			message: "Blocked by policy",
		});
	});

	test("maps VS Code hook results to VS Code hook output", async () => {
		const fixture = await writeRunnerFixture({
			target: "vscode-copilot-chat",
			hooksSource: `
export async function askForToolReview(context) {
	return {
		decision: "ask",
		message: "Review " + context.input.tool.name + " " + context.input.arguments.command,
	};
}
`,
			hook: {
				id: "ask-tool",
				event: "before_tool",
				targetEvent: "PreToolUse",
				exportName: "askForToolReview",
			},
		});

		const result = await runRunner(fixture, {
			input: JSON.stringify({
				tool_name: "run_in_terminal",
				tool_input: { command: "pwd" },
			}),
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			hookSpecificOutput: {
				hookEventName: "PreToolUse",
				permissionDecision: "ask",
				permissionDecisionReason: "Review run_in_terminal pwd",
			},
		});
	});

	test("turns fail-open hook failures into allow results", async () => {
		const fixture = await writeRunnerFixture({
			hooksSource: `
export async function failOpen() {
	throw new Error("temporary service outage");
}
`,
			hook: {
				id: "fail-open",
				event: "before_tool",
				exportName: "failOpen",
				failureMode: "fail_open",
			},
		});

		const result = await runRunner(fixture, {
			input: JSON.stringify({ toolName: "Shell" }),
		});
		const output = parseRunnerOutput(result.stdout);

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("temporary service outage\n");
		expect(output.result).toEqual({
			decision: "allow",
			annotations: [
				{
					key: "oiap.runtime.failure",
					value: "temporary service outage",
				},
			],
		});
	});
});

interface RunnerFixtureOptions {
	target?: string;
	hooksSource: string;
	hook: {
		id: string;
		event: string;
		targetEvent?: string;
		exportName: string;
		failureMode?: string;
	};
}

interface RunnerFixture {
	manifestPath: string;
	hookId: string;
	event: string;
	target: string;
}

interface RunnerOutput {
	oiap: {
		runtime: string;
		hookId: string;
		event: string;
		target: string;
		error?: string;
	};
	result: {
		decision: string;
		message?: string;
		reason?: string;
		annotations?: Array<{ key: string; value: string }>;
	};
}

async function writeRunnerFixture(
	options: RunnerFixtureOptions,
): Promise<RunnerFixture> {
	const root = await mkdtemp(join(tmpdir(), "oiap-runner-"));
	const manifestPath = join(root, "manifest.json");
	const target = options.target ?? "codex";

	await writeFile(join(root, "hooks.mjs"), options.hooksSource);
	await writeFile(
		manifestPath,
		JSON.stringify(
			{
				runtime: "oiap.generated-js-hook-runtime",
				version: 1,
				pluginId: "runner-test",
				target,
				defaultTimeoutMs: 1000,
				hooks: {
					[options.hook.id]: {
						id: options.hook.id,
						event: options.hook.event,
						targetEvent: options.hook.targetEvent,
						module: "./hooks.mjs",
						exportName: options.hook.exportName,
						timeoutMs: 1000,
						failureMode: options.hook.failureMode ?? "fail_closed",
						optional: false,
						handler: { kind: "function" },
					},
				},
			},
			null,
			2,
		),
	);

	return {
		manifestPath,
		hookId: options.hook.id,
		event: options.hook.event,
		target,
	};
}

function runRunner(
	fixture: RunnerFixture,
	options: { input?: string } = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			"node",
			[
				runnerPath,
				"run-hook",
				"--manifest",
				fixture.manifestPath,
				"--target",
				fixture.target,
				"--event",
				fixture.event,
				"--hook",
				fixture.hookId,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
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
		child.stdin.end(options.input ?? "");
	});
}

function parseRunnerOutput(stdout: string): RunnerOutput {
	return JSON.parse(stdout) as RunnerOutput;
}
