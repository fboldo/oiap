#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

type UnknownRecord = Record<string, unknown>;

interface ParsedArgs extends UnknownRecord {
	_: string[];
}

interface HookRuntimeManifest {
	pluginId: string;
	target: string;
	defaultTimeoutMs?: number;
	hooks?: Record<string, HookRuntimeHook>;
}

interface HookRuntimeHook {
	id: string;
	event: string;
	targetEvent?: string;
	module: string;
	exportName?: string;
	timeoutMs?: number;
	failureMode?: string;
	optional?: boolean;
	handler: {
		kind: string;
	};
}

interface HookContextOptions {
	manifest: HookRuntimeManifest;
	hook: HookRuntimeHook;
	target: string;
	event: string;
	payload: unknown;
	timeoutMs: number;
	signal: AbortSignal;
}

interface HookContext {
	event: string;
	hookId: string;
	pluginId: string;
	target: { id: string };
	input: unknown;
	workspace: {
		id: string;
		root: string;
		name?: string;
		metadata?: UnknownRecord;
	};
	agent: {
		id?: string;
		name?: string;
		model?: string;
		metadata?: UnknownRecord;
	};
	user?: {
		id?: string;
		name?: string;
		metadata?: UnknownRecord;
	};
	deadline: {
		startedAt: string;
		timeoutMs: number;
		deadlineAt: string;
	};
	signal: AbortSignal;
	services: ReturnType<typeof createHookServices>;
	log: ReturnType<typeof createLogger>;
}

interface HookResult extends UnknownRecord {
	decision: string;
	message?: unknown;
	reason?: unknown;
}

interface ServiceFetchOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: unknown;
}

interface ProcessRunOptions {
	cwd?: string;
	env?: Record<string, string | undefined>;
	maxOutputBytes?: number;
	timeoutMs?: number;
}

interface ProcessRunResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

interface MappedHookResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

const command = process.argv[2];

if (command !== "run-hook") {
	failUsage("Expected command: run-hook");
}

const args = parseArgs(process.argv.slice(3));
const manifestPath = resolve(process.cwd(), requiredArg(args, "manifest"));
const manifest = JSON.parse(
	await readFile(manifestPath, "utf8"),
) as HookRuntimeManifest;
const manifestDir = dirname(manifestPath);
const hookId = requiredArg(args, "hook");
const hook = manifest.hooks?.[hookId];

if (!hook) {
	fail(`Unknown OIAP hook: ${hookId}`, 64);
}

const target = stringArg(args, "target") ?? manifest.target;
const event = stringArg(args, "event") ?? hook.event;
const payload = await readJsonFromStdin();
const timeoutMs =
	numberArg(args, "timeout-ms") ??
	hook.timeoutMs ??
	manifest.defaultTimeoutMs ??
	5000;
const abortController = new AbortController();
const timeout = setTimeout(() => {
	abortController.abort(new Error(`OIAP hook timed out after ${timeoutMs}ms`));
}, timeoutMs);

try {
	const context = createHookContext({
		manifest,
		hook,
		target,
		event,
		payload,
		timeoutMs,
		signal: abortController.signal,
	});
	const handler = await loadHookHandler(manifestDir, hook);
	const result = await runWithAbort(
		Promise.resolve(handler(context)),
		abortController.signal,
	);
	validateHookResult(result);
	const mapped = mapHookResult({
		result,
		hook,
		target,
		format: stringArg(args, "format"),
	});

	writeMappedResult(mapped);
} catch (error) {
	const mapped = mapHookFailure({
		error,
		hook,
		target,
		format: stringArg(args, "format"),
	});

	writeMappedResult(mapped);
} finally {
	clearTimeout(timeout);
}

function writeMappedResult(mapped: MappedHookResult): void {
	if (mapped.stdout) {
		process.stdout.write(mapped.stdout);
	}

	if (mapped.stderr) {
		process.stderr.write(mapped.stderr);
	}

	process.exitCode = mapped.exitCode;
}

function parseArgs(rawArgs: string[]): ParsedArgs {
	const parsed: ParsedArgs = { _: [] };

	for (let index = 0; index < rawArgs.length; index += 1) {
		const token = rawArgs[index];

		if (!token) {
			continue;
		}

		if (!token.startsWith("--")) {
			parsed._.push(token);
			continue;
		}

		const key = token.slice(2);
		const nextToken = rawArgs[index + 1];

		if (!nextToken || nextToken.startsWith("--")) {
			parsed[key] = true;
			continue;
		}

		parsed[key] = nextToken;
		index += 1;
	}

	return parsed;
}

function requiredArg(args: ParsedArgs, key: string): string {
	const value = stringArg(args, key);

	if (!value) {
		fail(`Missing required argument --${key}`, 64);
	}

	return value;
}

function stringArg(args: ParsedArgs, key: string): string | undefined {
	const value = args[key];
	return typeof value === "string" ? value : undefined;
}

function numberArg(args: ParsedArgs, key: string): number | undefined {
	const value = stringArg(args, key);

	if (!value) {
		return undefined;
	}

	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

async function readJsonFromStdin(): Promise<unknown> {
	let input = "";

	for await (const chunk of process.stdin) {
		input += chunk.toString();
	}

	if (!input.trim()) {
		return {};
	}

	try {
		return JSON.parse(input) as unknown;
	} catch {
		return { raw: input };
	}
}

async function loadHookHandler(
	manifestDir: string,
	hook: HookRuntimeHook,
): Promise<(context: HookContext) => Promise<unknown> | unknown> {
	if (hook.handler.kind !== "function") {
		throw new Error(
			`Hook ${hook.id} is not bundled as a portable JavaScript function.`,
		);
	}

	if (!hook.exportName) {
		throw new Error(`Hook ${hook.id} is missing an export name.`);
	}

	const moduleUrl = pathToFileURL(resolve(manifestDir, hook.module)).href;
	const module = (await import(moduleUrl)) as Record<string, unknown>;
	const handler = module[hook.exportName];

	if (typeof handler !== "function") {
		throw new Error(`Hook export ${hook.exportName} is not a function.`);
	}

	return handler as (context: HookContext) => Promise<unknown> | unknown;
}

function createHookContext(options: HookContextOptions): HookContext {
	const startedAt = new Date();
	const deadlineAt = new Date(startedAt.getTime() + options.timeoutMs);
	const payload = isRecord(options.payload)
		? options.payload
		: { value: options.payload };

	return {
		event: options.event,
		hookId: options.hook.id,
		pluginId: options.manifest.pluginId,
		target: { id: options.target },
		input: normalizeHookInput(options.event, payload),
		workspace: normalizeWorkspace(payload),
		agent: normalizeAgent(payload),
		user: normalizeUser(payload),
		deadline: {
			startedAt: startedAt.toISOString(),
			timeoutMs: options.timeoutMs,
			deadlineAt: deadlineAt.toISOString(),
		},
		signal: options.signal,
		services: createHookServices(options.signal),
		log: createLogger(options.hook.id),
	};
}

function normalizeHookInput(event: string, payload: UnknownRecord): unknown {
	if (isRecord(payload.oiap) && isRecord(payload.oiap.input)) {
		return payload.oiap.input;
	}

	if (isRecord(payload.input)) {
		return payload.input;
	}

	if (event === "before_tool" || event === "after_tool") {
		return {
			tool: normalizeTool(
				payload.tool ?? payload.toolName ?? payload.tool_name ?? payload.name,
			),
			arguments: asRecord(
				payload.arguments ??
					payload.args ??
					payload.params ??
					payload.tool_input,
			),
			callId:
				typeof payload.callId === "string"
					? payload.callId
					: typeof payload.tool_use_id === "string"
						? payload.tool_use_id
						: undefined,
			result: payload.result ?? payload.tool_response,
			error: payload.error,
		};
	}

	if (event === "permission_request") {
		return {
			permission: String(payload.permission ?? payload.name ?? "unknown"),
			reason: typeof payload.reason === "string" ? payload.reason : undefined,
			resources: Array.isArray(payload.resources)
				? payload.resources
				: undefined,
			metadata: asOptionalRecord(payload.metadata),
		};
	}

	if (event === "user_prompt_submit") {
		return {
			prompt: String(payload.prompt ?? payload.message ?? ""),
			conversationId:
				typeof payload.conversationId === "string"
					? payload.conversationId
					: undefined,
			metadata: asOptionalRecord(payload.metadata),
		};
	}

	if (event === "before_agent" || event === "after_agent") {
		const agent = asRecord(payload.agent);

		return {
			agentName: String(
				payload.agentName ?? payload.agent_type ?? agent.name ?? "agent",
			),
			task: String(payload.task ?? payload.prompt ?? ""),
			status: payload.status,
			result: payload.result,
			error: payload.error,
			metadata: asOptionalRecord(payload.metadata),
		};
	}

	if (event === "session_start") {
		return {
			sessionId: String(payload.sessionId ?? payload.id ?? "session"),
			metadata: asOptionalRecord(payload.metadata),
		};
	}

	if (event === "stop") {
		return {
			reason: typeof payload.reason === "string" ? payload.reason : undefined,
			metadata: asOptionalRecord(payload.metadata),
		};
	}

	return payload;
}

function normalizeTool(value: unknown): {
	name: string;
	id?: string;
	metadata?: UnknownRecord;
} {
	if (isRecord(value)) {
		return {
			name: String(value.name ?? "tool"),
			id: typeof value.id === "string" ? value.id : undefined,
			metadata: asOptionalRecord(value.metadata),
		};
	}

	return { name: String(value ?? "tool") };
}

function normalizeWorkspace(payload: UnknownRecord): HookContext["workspace"] {
	const workspace = isRecord(payload.workspace) ? payload.workspace : {};

	return {
		id: String(workspace.id ?? process.cwd()),
		root: String(workspace.root ?? process.cwd()),
		name: typeof workspace.name === "string" ? workspace.name : undefined,
		metadata: asOptionalRecord(workspace.metadata),
	};
}

function normalizeAgent(payload: UnknownRecord): HookContext["agent"] {
	const agent = isRecord(payload.agent) ? payload.agent : {};

	return {
		id: typeof agent.id === "string" ? agent.id : undefined,
		name: typeof agent.name === "string" ? agent.name : undefined,
		model: typeof agent.model === "string" ? agent.model : undefined,
		metadata: asOptionalRecord(agent.metadata),
	};
}

function normalizeUser(payload: UnknownRecord): HookContext["user"] {
	if (!isRecord(payload.user)) {
		return undefined;
	}

	return {
		id: typeof payload.user.id === "string" ? payload.user.id : undefined,
		name: typeof payload.user.name === "string" ? payload.user.name : undefined,
		metadata: asOptionalRecord(payload.user.metadata),
	};
}

function createHookServices(signal: AbortSignal) {
	const secrets = {
		async get(ref: string): Promise<string> {
			const value = process.env[ref];

			if (value === undefined) {
				throw new Error(`Missing secret environment variable: ${ref}`);
			}

			return value;
		},
		async getJson(ref: string): Promise<unknown> {
			return JSON.parse(await secrets.get(ref)) as unknown;
		},
	};

	return {
		fetch: {
			async json(
				url: string | URL,
				options: ServiceFetchOptions = {},
			): Promise<unknown> {
				const response = await fetch(url, toFetchOptions(options, signal));
				return response.json() as Promise<unknown>;
			},
			async text(
				url: string | URL,
				options: ServiceFetchOptions = {},
			): Promise<string> {
				const response = await fetch(url, toFetchOptions(options, signal));
				return response.text();
			},
		},
		db: unsupportedService("db"),
		exec: { run: runProcess },
		mcp: unsupportedService("mcp"),
		secrets,
		cache: createMemoryCache(),
		schedule: unsupportedService("schedule"),
	};
}

function toFetchOptions(options: ServiceFetchOptions, signal: AbortSignal) {
	return {
		method: options.method,
		headers: options.headers,
		body:
			typeof options.body === "string"
				? options.body
				: options.body === undefined
					? undefined
					: JSON.stringify(options.body),
		signal,
	};
}

function runProcess(
	command: string,
	args: string[] = [],
	options: ProcessRunOptions = {},
): Promise<ProcessRunResult> {
	return new Promise((resolveProcess, rejectProcess) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			env: { ...process.env, ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024;
		const processTimeout = options.timeoutMs
			? setTimeout(() => child.kill("SIGTERM"), options.timeoutMs)
			: undefined;

		child.stdout?.on("data", (chunk: Buffer | string) => {
			stdout = appendOutput(stdout, chunk, maxOutputBytes);
		});
		child.stderr?.on("data", (chunk: Buffer | string) => {
			stderr = appendOutput(stderr, chunk, maxOutputBytes);
		});
		child.on("error", rejectProcess);
		child.on("close", (exitCode) => {
			if (processTimeout) {
				clearTimeout(processTimeout);
			}

			resolveProcess({ exitCode: exitCode ?? 0, stdout, stderr });
		});
	});
}

function appendOutput(
	current: string,
	chunk: Buffer | string,
	maxOutputBytes: number,
): string {
	const next = current + chunk.toString();
	return next.length > maxOutputBytes ? next.slice(-maxOutputBytes) : next;
}

function unsupportedService(
	name: string,
): Record<string, (...args: unknown[]) => Promise<never>> {
	return new Proxy(
		{} as Record<string, (...args: unknown[]) => Promise<never>>,
		{
			get() {
				return async () => {
					throw new Error(
						`OIAP runtime service is not available in generated JS runner: ${name}`,
					);
				};
			},
		},
	);
}

function createMemoryCache() {
	const cache = new Map<string, { value: unknown; expiresAt?: number }>();

	return {
		async get(key: string): Promise<unknown> {
			return cache.get(key)?.value;
		},
		async set(
			key: string,
			value: unknown,
			options: { ttlMs?: number } = {},
		): Promise<void> {
			cache.set(key, {
				value,
				expiresAt: options.ttlMs ? Date.now() + options.ttlMs : undefined,
			});
		},
		async delete(key: string): Promise<void> {
			cache.delete(key);
		},
	};
}

function createLogger(hookId: string) {
	const write = (level: string, message: string, metadata?: unknown): void => {
		const record = { level, hookId, message, metadata };
		process.stderr.write(`${JSON.stringify(record)}\n`);
	};

	return {
		debug: (message: string, metadata?: unknown) =>
			write("debug", message, metadata),
		info: (message: string, metadata?: unknown) =>
			write("info", message, metadata),
		warn: (message: string, metadata?: unknown) =>
			write("warn", message, metadata),
		error: (message: string, metadata?: unknown) =>
			write("error", message, metadata),
	};
}

function runWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) {
		return Promise.reject(signal.reason ?? new Error("OIAP hook aborted"));
	}

	return Promise.race([
		promise,
		new Promise<T>((_, rejectPromise) => {
			signal.addEventListener(
				"abort",
				() => rejectPromise(signal.reason ?? new Error("OIAP hook aborted")),
				{ once: true },
			);
		}),
	]);
}

function validateHookResult(result: unknown): asserts result is HookResult {
	if (!isRecord(result) || typeof result.decision !== "string") {
		throw new Error("Hook result must be an object with a decision string.");
	}

	const allowedDecisions = new Set<string>([
		"allow",
		"block",
		"ask",
		"modify",
		"inject_context",
		"replace_result",
		"schedule",
		"noop",
	]);

	if (!allowedDecisions.has(result.decision)) {
		throw new Error(`Unsupported hook decision: ${result.decision}`);
	}
}

function mapHookResult(options: {
	result: HookResult;
	hook: HookRuntimeHook;
	target: string;
	format?: string;
}): MappedHookResult {
	if (options.target === "vscode-copilot-chat") {
		return mapVsCodeHookResult(options.result, options.hook);
	}

	if (options.target === "cursor") {
		return mapCursorHookResult(options.result, options.hook);
	}

	const envelope = {
		oiap: {
			runtime: "generated-js",
			hookId: options.hook.id,
			event: options.hook.event,
			target: options.target,
		},
		result: options.result,
	};
	const stdout = `${JSON.stringify(envelope)}\n`;
	const shouldBlockHost =
		(options.target === "claude-code" || options.target === "codex") &&
		options.result.decision === "block";

	return {
		stdout,
		stderr: shouldBlockHost ? `${blockMessage(options.result)}\n` : "",
		exitCode: shouldBlockHost ? 2 : 0,
	};
}

function mapHookFailure(options: {
	error: unknown;
	hook: HookRuntimeHook;
	target: string;
	format?: string;
}): MappedHookResult {
	const message = errorMessage(options.error);
	const decision = failureDecision(options.hook, message);

	if (options.target === "vscode-copilot-chat") {
		return mapVsCodeHookFailure(decision, options.hook, message);
	}

	if (options.target === "cursor") {
		return mapCursorHookFailure(decision, options.hook, message);
	}

	const envelope = {
		oiap: {
			runtime: "generated-js",
			hookId: options.hook.id,
			event: options.hook.event,
			target: options.target,
			error: message,
		},
		result: decision,
	};
	const exitCode = decision.decision === "block" ? 2 : 0;

	return {
		stdout: `${JSON.stringify(envelope)}\n`,
		stderr: `${message}\n`,
		exitCode,
	};
}

function mapVsCodeHookResult(
	result: HookResult,
	hook: HookRuntimeHook,
): MappedHookResult {
	if (result.decision === "block") {
		return {
			stdout: "",
			stderr: `${blockMessage(result)}\n`,
			exitCode: 2,
		};
	}

	return {
		stdout: `${JSON.stringify(vsCodeHookOutput(result, hook))}\n`,
		stderr: "",
		exitCode: 0,
	};
}

function mapVsCodeHookFailure(
	decision: HookResult,
	hook: HookRuntimeHook,
	message: string,
): MappedHookResult {
	if (decision.decision === "block") {
		return {
			stdout: "",
			stderr: `${message}\n`,
			exitCode: 2,
		};
	}

	return {
		stdout: `${JSON.stringify({
			...vsCodeHookOutput(decision, hook),
			systemMessage: `OIAP hook failure: ${message}`,
		})}\n`,
		stderr: `${message}\n`,
		exitCode: 0,
	};
}

function mapCursorHookResult(
	result: HookResult,
	hook: HookRuntimeHook,
): MappedHookResult {
	return {
		stdout: `${JSON.stringify(cursorHookOutput(result, hook))}\n`,
		stderr: "",
		exitCode: 0,
	};
}

function mapCursorHookFailure(
	decision: HookResult,
	hook: HookRuntimeHook,
	message: string,
): MappedHookResult {
	return {
		stdout: `${JSON.stringify(cursorHookOutput(decision, hook))}\n`,
		stderr: `${message}\n`,
		exitCode: decision.decision === "block" ? 2 : 0,
	};
}

function cursorHookOutput(
	result: HookResult,
	hook: HookRuntimeHook,
): UnknownRecord {
	const hookEventName = hook.targetEvent ?? hook.event;

	if (isCursorPermissionEvent(hookEventName)) {
		return {
			permission: cursorPermission(result, hookEventName),
			user_message: cursorUserMessage(result),
			agent_message: cursorAgentMessage(result),
		};
	}

	if (hookEventName === "beforeSubmitPrompt") {
		return result.decision === "block"
			? { continue: false, user_message: cursorUserMessage(result) }
			: { continue: true };
	}

	if (hookEventName === "postToolUse") {
		if (result.decision === "inject_context") {
			return { additional_context: resultString(result, "content") };
		}

		if (result.decision === "replace_result") {
			return { updated_mcp_tool_output: result.result };
		}
	}

	if (hookEventName === "sessionStart") {
		return {
			env: asOptionalRecord(result.env),
			additional_context:
				result.decision === "inject_context"
					? resultString(result, "content")
					: undefined,
		};
	}

	if (hookEventName === "stop" || hookEventName === "subagentStop") {
		return result.decision === "inject_context"
			? { followup_message: resultString(result, "content") }
			: {};
	}

	if (hookEventName === "preCompact") {
		return { user_message: cursorUserMessage(result) };
	}

	return {};
}

function isCursorPermissionEvent(hookEventName: string): boolean {
	return new Set([
		"preToolUse",
		"subagentStart",
		"beforeShellExecution",
		"beforeMCPExecution",
		"beforeReadFile",
		"beforeTabFileRead",
	]).has(hookEventName);
}

function cursorPermission(
	result: HookResult,
	hookEventName: string,
): "allow" | "deny" | "ask" {
	if (result.decision === "block") {
		return "deny";
	}

	if (result.decision === "ask") {
		return hookEventName === "beforeShellExecution" ||
			hookEventName === "beforeMCPExecution" ||
			hookEventName === "preToolUse"
			? "ask"
			: "deny";
	}

	return "allow";
}

function cursorUserMessage(result: HookResult): string | undefined {
	return (
		resultMessage(result) ??
		(result.decision === "block" ? blockMessage(result) : undefined)
	);
}

function cursorAgentMessage(result: HookResult): string | undefined {
	return resultMessage(result);
}

function vsCodeHookOutput(result: HookResult, hook: HookRuntimeHook) {
	const hookEventName = hook.targetEvent ?? hook.event;

	if (hookEventName === "PreToolUse") {
		if (result.decision === "allow" || result.decision === "ask") {
			return {
				hookSpecificOutput: {
					hookEventName,
					permissionDecision: result.decision === "ask" ? "ask" : "allow",
					permissionDecisionReason: resultMessage(result),
				},
			};
		}

		if (result.decision === "inject_context") {
			return {
				hookSpecificOutput: {
					hookEventName,
					additionalContext: resultString(result, "content"),
				},
			};
		}
	}

	if (result.decision === "inject_context") {
		return {
			hookSpecificOutput: {
				hookEventName,
				additionalContext: resultString(result, "content"),
			},
		};
	}

	if (result.decision === "modify") {
		return {
			systemMessage:
				resultMessage(result) ??
				"OIAP hook requested input modification that is not directly representable in VS Code hook output.",
		};
	}

	return { continue: true };
}

function resultMessage(result: HookResult): string | undefined {
	const message = result.message ?? result.reason;
	return typeof message === "string" ? message : undefined;
}

function resultString(result: HookResult, key: string): string | undefined {
	const value = result[key];
	return typeof value === "string" ? value : undefined;
}

function failureDecision(hook: HookRuntimeHook, message: string): HookResult {
	if (
		hook.optional ||
		hook.failureMode === "fail_open" ||
		hook.failureMode === "log_only"
	) {
		return {
			decision: "allow",
			annotations: [{ key: "oiap.runtime.failure", value: message }],
		};
	}

	if (hook.failureMode === "ask_user") {
		return { decision: "ask", message };
	}

	if (hook.failureMode === "use_fallback_rule") {
		return { decision: "noop" };
	}

	return { decision: "block", reason: message, message };
}

function blockMessage(result: HookResult): string {
	return String(
		result.message ?? result.reason ?? "OIAP hook blocked execution.",
	);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): UnknownRecord {
	return isRecord(value) ? value : {};
}

function asOptionalRecord(value: unknown): UnknownRecord | undefined {
	return isRecord(value) ? value : undefined;
}

function isRecord(value: unknown): value is UnknownRecord {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function failUsage(message: string): never {
	fail(
		`${message}\nUsage: node .oiap/runtime/runner.mjs run-hook --manifest .oiap/runtime/manifest.json --target <target> --event <event> --hook <hook-id>`,
		64,
	);
}

function fail(message: string, exitCode: number): never {
	process.stderr.write(`${message}\n`);
	process.exit(exitCode);
}
