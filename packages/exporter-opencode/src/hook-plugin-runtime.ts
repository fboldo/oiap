import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export interface OpenCodeHookDescriptor {
	id: string;
	event: string;
	targetEvent: string;
	match?: UnknownRecord;
	timeoutMs?: number;
	failureMode?: string;
}

export interface OpenCodeHookBridgeManifest {
	version: 1;
	target: string;
	hooks: OpenCodeHookDescriptor[];
}

export interface OpenCodeHookHandlers {
	"tool.execute.before"(input?: unknown, output?: unknown): Promise<void>;
	"tool.execute.after"(input?: unknown, output?: unknown): Promise<void>;
	event(payload?: unknown): Promise<void>;
}

export interface CreateOpenCodeHookHandlersOptions {
	ctx?: unknown;
	hookDescriptors: OpenCodeHookDescriptor[];
	runHook?: OpenCodeHookInvoker;
}

export type OpenCodeHookInvoker = (
	hook: OpenCodeHookDescriptor,
	payload: UnknownRecord,
) => Promise<HookResult>;

export interface RunHookRuntimeOptions {
	hook: OpenCodeHookDescriptor;
	payload: UnknownRecord;
	pluginRoot: string;
	runnerPath: string;
	manifestPath: string;
	target: string;
}

export interface HookResult extends UnknownRecord {
	decision?: string;
	message?: unknown;
	reason?: unknown;
	result?: unknown;
}

type UnknownRecord = Record<string, unknown>;

export async function loadHookDescriptors(
	descriptorPath: string,
): Promise<OpenCodeHookDescriptor[]> {
	const manifest = JSON.parse(
		await readFile(descriptorPath, "utf8"),
	) as OpenCodeHookBridgeManifest;

	return Array.isArray(manifest.hooks)
		? manifest.hooks.filter(isHookDescriptor)
		: [];
}

export function createOpenCodeHookHandlers(
	options: CreateOpenCodeHookHandlersOptions,
): OpenCodeHookHandlers {
	const runtime = createRuntime({
		ctx: options.ctx,
		hookDescriptors: options.hookDescriptors,
		runHook: options.runHook,
	});

	return {
		"tool.execute.before": async (input, output) => {
			await runtime.runHooks("tool.execute.before", input, output);
		},
		"tool.execute.after": async (input, output) => {
			await runtime.runHooks("tool.execute.after", input, output);
		},
		event: async (payload) => {
			const eventType = eventTypeFromPayload(payload);
			await runtime.runHooks(eventType, payload);
		},
	};
}

export function createRuntime(options: CreateOpenCodeHookHandlersOptions) {
	const ctx = asRecord(options.ctx);
	const runHook = options.runHook ?? defaultNoopHookInvoker;

	return {
		async runHooks(
			targetEvent: string | undefined,
			input?: unknown,
			output?: unknown,
		): Promise<void> {
			if (!targetEvent) {
				return;
			}

			const payload = createPayload(ctx, targetEvent, input, output);
			const matchingHooks = options.hookDescriptors.filter(
				(hook) =>
					hook.targetEvent === targetEvent && matchesHook(hook, payload),
			);

			for (const hook of matchingHooks) {
				const result = await runHook(hook, payload);
				applyHookResult(result, output);
			}
		},
	};
}

export function createPayload(
	ctx: UnknownRecord,
	targetEvent: string,
	input?: unknown,
	output?: unknown,
): UnknownRecord {
	const inputRecord = asRecord(input);
	const outputRecord = asRecord(output);
	const base = {
		workspace: {
			id: ctx.worktree ?? ctx.directory ?? process.cwd(),
			root: ctx.worktree ?? ctx.directory ?? process.cwd(),
		},
		opencode: {
			targetEvent,
			project: ctx.project,
			directory: ctx.directory,
			worktree: ctx.worktree,
			input,
			output,
		},
	};

	if (
		targetEvent === "tool.execute.before" ||
		targetEvent === "tool.execute.after"
	) {
		return {
			...base,
			tool: inputRecord.tool ?? inputRecord.name,
			args: outputRecord.args ?? inputRecord.args,
			result: outputRecord.result ?? outputRecord.output,
			error: outputRecord.error,
		};
	}

	if (targetEvent === "tui.prompt.append") {
		return {
			...base,
			prompt:
				inputRecord.prompt ??
				inputRecord.message ??
				inputRecord.text ??
				String(input ?? ""),
		};
	}

	if (targetEvent === "permission.asked") {
		return {
			...base,
			permission: inputRecord.permission ?? inputRecord.name,
			reason: inputRecord.reason,
			resources: inputRecord.resources,
		};
	}

	if (targetEvent === "session.created") {
		const session = asRecord(inputRecord.session);

		return {
			...base,
			sessionId: inputRecord.sessionId ?? inputRecord.id ?? session.id,
		};
	}

	if (targetEvent === "session.idle") {
		return {
			...base,
			reason: inputRecord.reason,
		};
	}

	return { ...base, payload: input, output };
}

export function matchesHook(
	hook: OpenCodeHookDescriptor,
	payload: UnknownRecord,
): boolean {
	const match = hook.match;

	if (!match || match.kind === "expression") {
		return true;
	}

	const tool = asRecord(match.tool);

	if (tool.name && tool.name !== payload.tool) {
		return false;
	}

	if (match.permission && match.permission !== payload.permission) {
		return false;
	}

	if (match.agentName && match.agentName !== payload.agentName) {
		return false;
	}

	return true;
}

export function runHookRuntime(
	options: RunHookRuntimeOptions,
): Promise<HookResult> {
	return new Promise((resolveHook, rejectHook) => {
		const child = spawn(
			process.env.OIAP_NODE ?? "node",
			[
				options.runnerPath,
				"run-hook",
				"--manifest",
				options.manifestPath,
				"--target",
				options.target,
				"--event",
				options.hook.event,
				"--hook",
				options.hook.id,
			],
			{
				cwd: options.pluginRoot,
				stdio: ["pipe", "pipe", "pipe"],
			},
		);
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", rejectHook);
		child.on("close", (exitCode) => {
			try {
				const result = parseRuntimeResult(stdout);

				if (exitCode && !result) {
					rejectHook(
						new Error(stderr.trim() || `OIAP hook ${options.hook.id} failed`),
					);
					return;
				}

				resolveHook(result ?? { decision: "noop" });
			} catch (error) {
				rejectHook(error);
			}
		});
		child.stdin.end(safeJson(options.payload));
	});
}

export function parseRuntimeResult(stdout: string): HookResult | undefined {
	const lines = stdout.trim().split(/\n+/).filter(Boolean).reverse();

	for (const line of lines) {
		try {
			const envelope = JSON.parse(line) as UnknownRecord;

			if (envelope && typeof envelope === "object" && "result" in envelope) {
				return envelope.result as HookResult;
			}
		} catch {}
	}

	return undefined;
}

export function applyHookResult(result: HookResult, output?: unknown): void {
	if (!result || result.decision === "allow" || result.decision === "noop") {
		return;
	}

	if (result.decision === "block") {
		throw new Error(
			String(
				result.message ??
					result.reason ??
					"OIAP hook blocked this OpenCode action",
			),
		);
	}

	if (
		result.decision === "replace_result" &&
		output &&
		typeof output === "object"
	) {
		(output as UnknownRecord).result = result.result;
	}
}

export function safeJson(value: unknown): string {
	const seen = new WeakSet<object>();

	return (
		JSON.stringify(value, (_key, nestedValue) => {
			if (typeof nestedValue === "function") {
				return undefined;
			}

			if (nestedValue && typeof nestedValue === "object") {
				if (seen.has(nestedValue)) {
					return "[Circular]";
				}

				seen.add(nestedValue);
			}

			return nestedValue;
		}) ?? "{}"
	);
}

function eventTypeFromPayload(payload: unknown): string | undefined {
	const record = asRecord(payload);
	const event = asRecord(record.event);

	return typeof event.type === "string"
		? event.type
		: typeof record.type === "string"
			? record.type
			: undefined;
}

function isHookDescriptor(value: unknown): value is OpenCodeHookDescriptor {
	const record = asRecord(value);

	return (
		typeof record.id === "string" &&
		typeof record.event === "string" &&
		typeof record.targetEvent === "string"
	);
}

function asRecord(value: unknown): UnknownRecord {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as UnknownRecord)
		: {};
}

async function defaultNoopHookInvoker(): Promise<HookResult> {
	return { decision: "noop" };
}
