/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import {
	applyHookResult,
	createOpenCodeHookHandlers,
	createPayload,
	matchesHook,
	parseRuntimeResult,
	safeJson,
} from "./hook-plugin-runtime";

describe("OpenCode hook plugin runtime", () => {
	test("dispatches matching direct tool hooks", async () => {
		const calls: Array<{ hookId: string; payload: Record<string, unknown> }> =
			[];
		const handlers = createOpenCodeHookHandlers({
			ctx: { directory: "/repo", worktree: "/repo" },
			hookDescriptors: [
				{
					id: "pre-tool",
					event: "before_tool",
					targetEvent: "tool.execute.before",
					match: { tool: { name: "bash" } },
				},
			],
			runHook: async (hook, payload) => {
				calls.push({ hookId: hook.id, payload });
				return { decision: "noop" };
			},
		});

		await handlers["tool.execute.before"](
			{ tool: "bash" },
			{ args: { command: "git status" } },
		);

		expect(calls).toEqual([
			{
				hookId: "pre-tool",
				payload: expect.objectContaining({
					tool: "bash",
					args: { command: "git status" },
				}),
			},
		]);
	});

	test("creates normalized payloads for prompt events", () => {
		const payload = createPayload({ directory: "/repo" }, "tui.prompt.append", {
			message: "Ship it",
		});

		expect(payload.prompt).toBe("Ship it");
		expect(payload.workspace).toEqual({ id: "/repo", root: "/repo" });
	});

	test("matches tool and permission hook filters", () => {
		expect(
			matchesHook(
				{
					id: "pre-tool",
					event: "before_tool",
					targetEvent: "tool.execute.before",
					match: { tool: { name: "bash" } },
				},
				{ tool: "bash" },
			),
		).toBe(true);
		expect(
			matchesHook(
				{
					id: "permission",
					event: "permission_request",
					targetEvent: "permission.asked",
					match: { permission: "edit" },
				},
				{ permission: "bash" },
			),
		).toBe(false);
	});

	test("parses runtime envelopes after log lines", () => {
		expect(
			parseRuntimeResult(
				'{"level":"info","message":"log"}\n{"oiap":{},"result":{"decision":"allow"}}\n',
			),
		).toEqual({ decision: "allow" });
	});

	test("applies block and replace-result decisions", () => {
		expect(() =>
			applyHookResult({ decision: "block", reason: "Denied" }),
		).toThrow("Denied");

		const output = { result: "before" };
		applyHookResult({ decision: "replace_result", result: "after" }, output);

		expect(output.result).toBe("after");
	});

	test("serializes circular payloads safely", () => {
		const payload: Record<string, unknown> = { name: "payload" };
		payload.self = payload;

		expect(safeJson(payload)).toContain('"self":"[Circular]"');
	});
});
