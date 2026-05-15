import type { HookCapabilities } from "./capabilities";
import type { JsonObject, JsonValue, TargetId } from "./primitives";
import type { HookResult } from "./results";

export type Awaitable<TValue> = TValue | Promise<TValue>;

export type HookEvent =
	| "session_start"
	| "user_prompt_submit"
	| "before_tool"
	| "permission_request"
	| "after_tool"
	| "before_agent"
	| "after_agent"
	| "stop";

export interface HookContext<E extends HookEvent = HookEvent> {
	event: E;
	hookId: string;
	pluginId: string;
	target: TargetInfo;
	input: HookInput<E>;
	workspace: WorkspaceContext;
	agent: AgentContext;
	user?: UserContext;
	deadline: Deadline;
	signal: HookAbortSignal;
	services: HookServices;
	log: HookLogger;
}

export type HookFunction<E extends HookEvent = HookEvent> = (context: HookContext<E>) => Awaitable<HookResult>;

export type HookHandler<E extends HookEvent = HookEvent> = HookFunction<E> | TargetModuleRef;

export interface HookDefinition<E extends HookEvent = HookEvent, TId extends string = string> {
	kind: "oiap.hook";
	id: TId;
	event: E;
	handler: HookHandler<E>;
	match?: HookMatcher<E>;
	timeoutMs?: number;
	failureMode?: HookFailureMode;
	capabilities?: HookCapabilities;
	optional?: boolean;
	fallback?: HookFallback;
}

export interface HookOptions<E extends HookEvent = HookEvent> {
	match?: HookMatcher<E>;
	timeoutMs?: number;
	failureMode?: HookFailureMode;
	capabilities?: HookCapabilities;
	optional?: boolean;
	fallback?: HookFallback;
}

export type HookFailureMode = "fail_closed" | "fail_open" | "ask_user" | "use_fallback_rule" | "log_only";

export type HookMatcher<E extends HookEvent = HookEvent> = Partial<HookInput<E>> | HookMatcherExpression;

export interface HookMatcherExpression {
	kind: "expression";
	expression: string;
}

export interface HookFallback {
	kind: "rule" | "instruction" | "noop";
	ref?: string;
	reason?: string;
}

export interface TargetModuleRef<TTarget extends TargetId = TargetId> {
	kind: "target-module";
	target: TTarget;
	entrypoint: string;
	symbol: string;
	returns: "HookResult";
	metadata?: JsonObject;
}

export interface TargetModuleOptions {
	entrypoint: string;
	symbol: string;
	metadata?: JsonObject;
}

export interface TargetInfo {
	id: TargetId;
	profile?: string;
	version?: string;
}

export interface WorkspaceContext {
	id: string;
	root: string;
	name?: string;
	metadata?: JsonObject;
}

export interface AgentContext {
	id?: string;
	name?: string;
	model?: string;
	metadata?: JsonObject;
}

export interface UserContext {
	id?: string;
	name?: string;
	metadata?: JsonObject;
}

export interface Deadline {
	startedAt: string;
	timeoutMs: number;
	deadlineAt: string;
}

export interface HookAbortSignal {
	readonly aborted: boolean;
	readonly reason?: unknown;
	throwIfAborted?: () => void;
}

export interface HookLogger {
	debug(message: string, metadata?: JsonObject): void;
	info(message: string, metadata?: JsonObject): void;
	warn(message: string, metadata?: JsonObject): void;
	error(message: string, metadata?: JsonObject): void;
}

export interface HookServices {
	fetch: HookFetch;
	db: HookDatabaseClient;
	exec: HookProcessRunner;
	mcp: HookMcpClient;
	secrets: HookSecretStore;
	cache: HookCache;
	schedule: HookScheduler;
}

export interface HookFetch {
	json<TResult = JsonValue>(url: string, options?: HookFetchOptions): Promise<TResult>;
	text(url: string, options?: HookFetchOptions): Promise<string>;
}

export interface HookFetchOptions {
	method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	headers?: Record<string, string>;
	body?: JsonValue | string;
	signal?: HookAbortSignal;
	timeoutMs?: number;
}

export interface HookDatabaseClient {
	query<TResult = JsonValue>(ref: string, operation: string | JsonObject, parameters?: JsonObject): Promise<TResult>;
	transaction<TResult>(ref: string, handler: HookDatabaseTransactionHandler<TResult>): Promise<TResult>;
}

export type HookDatabaseTransactionHandler<TResult> = (transaction: HookDatabaseTransaction) => Awaitable<TResult>;

export interface HookDatabaseTransaction {
	query<TResult = JsonValue>(operation: string | JsonObject, parameters?: JsonObject): Promise<TResult>;
	insert<TResult = JsonValue>(table: string, values: JsonObject): Promise<TResult>;
	update<TResult = JsonValue>(table: string, values: JsonObject, where: JsonObject): Promise<TResult>;
}

export interface HookProcessRunner {
	run(command: string, args?: string[], options?: HookProcessOptions): Promise<HookProcessResult>;
}

export interface HookProcessOptions {
	cwd?: string;
	env?: Record<string, string>;
	timeoutMs?: number;
	signal?: HookAbortSignal;
	maxOutputBytes?: number;
}

export interface HookProcessResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

export interface HookMcpClient {
	callTool<TResult = JsonValue>(serverRef: string, toolName: string, args?: JsonObject): Promise<TResult>;
	readResource<TResult = JsonValue>(serverRef: string, uri: string): Promise<TResult>;
}

export interface HookSecretStore {
	get(ref: string): Promise<string>;
	getJson<TResult = JsonValue>(ref: string): Promise<TResult>;
}

export interface HookCache {
	get<TResult = JsonValue>(key: string): Promise<TResult | undefined>;
	set(key: string, value: JsonValue, options?: HookCacheOptions): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface HookCacheOptions {
	ttlMs?: number;
}

export interface HookScheduler {
	job(job: HookScheduledJob): Promise<HookScheduledJobRef>;
}

export interface HookScheduledJob {
	id: string;
	name: string;
	payload?: JsonValue;
	runAfterMs?: number;
	dedupeKey?: string;
}

export interface HookScheduledJobRef {
	id: string;
	status: "scheduled" | "skipped";
}

export interface SessionStartInput {
	sessionId: string;
	metadata?: JsonObject;
}

export interface UserPromptSubmitInput {
	prompt: string;
	conversationId?: string;
	metadata?: JsonObject;
}

export interface ToolInput {
	name: string;
	id?: string;
	metadata?: JsonObject;
}

export interface BeforeToolInput {
	tool: ToolInput;
	arguments: JsonObject;
	callId?: string;
}

export interface PermissionRequestInput {
	permission: string;
	reason?: string;
	resources?: string[];
	metadata?: JsonObject;
}

export interface AfterToolInput extends BeforeToolInput {
	result?: JsonValue;
	error?: HookErrorLike;
}

export interface BeforeAgentInput {
	agentName: string;
	task: string;
	metadata?: JsonObject;
}

export interface AfterAgentInput extends BeforeAgentInput {
	status: "completed" | "failed" | "cancelled";
	result?: JsonValue;
	error?: HookErrorLike;
}

export interface StopInput {
	reason?: string;
	metadata?: JsonObject;
}

export interface HookErrorLike {
	message: string;
	code?: string;
	metadata?: JsonObject;
}

export interface HookInputByEvent {
	session_start: SessionStartInput;
	user_prompt_submit: UserPromptSubmitInput;
	before_tool: BeforeToolInput;
	permission_request: PermissionRequestInput;
	after_tool: AfterToolInput;
	before_agent: BeforeAgentInput;
	after_agent: AfterAgentInput;
	stop: StopInput;
}

export type HookInput<E extends HookEvent> = HookInputByEvent[E];

export const hook = {
	sessionStart: createHookFactory("session_start"),
	userPromptSubmit: createHookFactory("user_prompt_submit"),
	beforeTool: createHookFactory("before_tool"),
	permissionRequest: createHookFactory("permission_request"),
	afterTool: createHookFactory("after_tool"),
	beforeAgent: createHookFactory("before_agent"),
	afterAgent: createHookFactory("after_agent"),
	stop: createHookFactory("stop"),
};

export function targetModule<const TTarget extends TargetId>(
	target: TTarget,
	options: TargetModuleOptions,
): TargetModuleRef<TTarget> {
	return { kind: "target-module", target, returns: "HookResult", ...options };
}

function createHookFactory<const TEvent extends HookEvent>(event: TEvent) {
	return <const TId extends string>(
		id: TId,
		handler: HookHandler<TEvent>,
		options: HookOptions<TEvent> = {},
	): HookDefinition<TEvent, TId> => {
		return { kind: "oiap.hook", id, event, handler, ...options };
	};
}