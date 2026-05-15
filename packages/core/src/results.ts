import type {
	JsonPatchOperation,
	ScheduledJob,
	ScheduledJobRef,
} from "./primitives";

export interface DecisionAnnotation {
	key: string;
	value: string;
}

export interface DecisionChoice {
	id: string;
	label: string;
	description?: string;
}

export type HookResult =
	| AllowHookResult
	| BlockHookResult
	| AskHookResult
	| ModifyHookResult
	| InjectContextHookResult
	| ReplaceResultHookResult
	| ScheduleHookResult
	| NoopHookResult;

export interface AllowHookResult {
	decision: "allow";
	annotations?: DecisionAnnotation[];
}

export interface BlockHookResult {
	decision: "block";
	reason: string;
	message?: string;
	retryable?: boolean;
}

export interface AskHookResult {
	decision: "ask";
	message: string;
	choices?: DecisionChoice[];
	defaultChoice?: string;
}

export interface ModifyHookResult {
	decision: "modify";
	patch: JsonPatchOperation[];
	reason?: string;
}

export interface InjectContextHookResult {
	decision: "inject_context";
	content: string;
	priority?: "low" | "normal" | "high";
}

export interface ReplaceResultHookResult {
	decision: "replace_result";
	result: unknown;
}

export interface ScheduleHookResult {
	decision: "schedule";
	job: ScheduledJob | ScheduledJobRef;
}

export interface NoopHookResult {
	decision: "noop";
}

export type AllowOptions = Omit<AllowHookResult, "decision">;

export type BlockOptions = Omit<BlockHookResult, "decision">;

export type AskOptions = Omit<AskHookResult, "decision">;

export type ModifyOptions = Omit<ModifyHookResult, "decision">;

export type InjectContextOptions = Omit<InjectContextHookResult, "decision">;

export type ReplaceResultOptions = Omit<ReplaceResultHookResult, "decision">;

export type ScheduleOptions = Omit<ScheduleHookResult, "decision">;

export function allow(options: AllowOptions = {}): AllowHookResult {
	return { decision: "allow", ...options };
}

export function block(options: BlockOptions): BlockHookResult {
	return { decision: "block", ...options };
}

export function ask(options: AskOptions): AskHookResult {
	return { decision: "ask", ...options };
}

export function modify(options: ModifyOptions): ModifyHookResult {
	return { decision: "modify", ...options };
}

export function injectContext(
	options: InjectContextOptions,
): InjectContextHookResult {
	return { decision: "inject_context", ...options };
}

export function replaceResult(
	options: ReplaceResultOptions,
): ReplaceResultHookResult {
	return { decision: "replace_result", ...options };
}

export function schedule(options: ScheduleOptions): ScheduleHookResult {
	return { decision: "schedule", ...options };
}

export function noop(): NoopHookResult {
	return { decision: "noop" };
}
