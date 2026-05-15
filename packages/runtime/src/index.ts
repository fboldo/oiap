import type {
	HookDefinition,
	HookEvent,
	RenderedFile,
	SourceRef,
	TargetId,
} from "@oiap/core";
import { renderRunnerSource } from "./runner-source";

export const OIAP_RUNTIME_ROOT = ".oiap/runtime";
export const OIAP_RUNTIME_MANIFEST_PATH = `${OIAP_RUNTIME_ROOT}/manifest.json`;
export const OIAP_RUNTIME_RUNNER_PATH = `${OIAP_RUNTIME_ROOT}/runner.mjs`;
export const OIAP_RUNTIME_HOOKS_PATH = `${OIAP_RUNTIME_ROOT}/hooks.mjs`;

export interface HookRuntimeRenderOptions {
	pluginId: string;
	target: TargetId;
	hooks: HookDefinition[];
	defaultTimeoutMs?: number;
	targetEvent?: (hook: HookDefinition) => string | undefined;
	runtimeRoot?: string;
}

export interface HookRuntimeRenderResult {
	files: RenderedFile[];
	manifest: HookRuntimeManifest;
	portableHookIds: string[];
	unsupportedHookIds: string[];
}

export interface HookRuntimeManifest {
	runtime: "oiap.generated-js-hook-runtime";
	version: 1;
	pluginId: string;
	target: TargetId;
	defaultTimeoutMs: number;
	hooks: Record<string, HookRuntimeHook>;
}

export interface HookRuntimeHook {
	id: string;
	event: HookEvent;
	targetEvent?: string;
	module: string;
	exportName?: string;
	timeoutMs: number;
	failureMode: HookDefinition["failureMode"];
	optional: boolean;
	handler: HookRuntimeHandlerDescriptor;
}

export type HookRuntimeHandlerDescriptor =
	| { kind: "function" }
	| {
			kind: "target-module";
			target: TargetId;
			entrypoint: string;
			symbol: string;
	  }
	| { kind: "unsupported"; reason: string };

interface HookRuntimeEntry {
	hook: HookRuntimeHook;
	handlerSource?: string;
}

export interface HookRuntimeCommandOptions {
	target: TargetId;
	event: HookEvent;
	hookId: string;
	runnerPath?: string;
	manifestPath?: string;
}

export function renderHookRuntimeFiles(
	options: HookRuntimeRenderOptions,
): HookRuntimeRenderResult {
	const runtimeRoot = options.runtimeRoot ?? OIAP_RUNTIME_ROOT;
	const entries = createHookRuntimeEntries(options);
	const manifest: HookRuntimeManifest = {
		runtime: "oiap.generated-js-hook-runtime",
		version: 1,
		pluginId: options.pluginId,
		target: options.target,
		defaultTimeoutMs: options.defaultTimeoutMs ?? 5_000,
		hooks: Object.fromEntries(
			entries.map((entry) => [entry.hook.id, entry.hook]),
		),
	};
	const files =
		entries.length > 0
			? [
					textFile(
						`${runtimeRoot}/runner.mjs`,
						renderRunnerSource(),
						sourceRef("oiap-runtime-runner", "runtime"),
						0o755,
					),
					textFile(
						`${runtimeRoot}/hooks.mjs`,
						renderHooksModule(entries),
						sourceRef("oiap-runtime-hooks", "runtime"),
					),
					jsonFile(
						`${runtimeRoot}/manifest.json`,
						manifest,
						sourceRef("oiap-runtime-manifest", "runtime"),
					),
				]
			: [];

	return {
		files,
		manifest,
		portableHookIds: entries
			.filter((entry) => entry.hook.handler.kind === "function")
			.map((entry) => entry.hook.id),
		unsupportedHookIds: entries
			.filter((entry) => entry.hook.handler.kind !== "function")
			.map((entry) => entry.hook.id),
	};
}

export function renderHookRuntimeCommand(
	options: HookRuntimeCommandOptions,
): string {
	const runnerPath = options.runnerPath ?? OIAP_RUNTIME_RUNNER_PATH;
	const manifestPath = options.manifestPath ?? OIAP_RUNTIME_MANIFEST_PATH;

	return [
		"node",
		quoteShellToken(runnerPath),
		"run-hook",
		"--manifest",
		quoteShellToken(manifestPath),
		"--target",
		quoteShellToken(options.target),
		"--event",
		quoteShellToken(options.event),
		"--hook",
		quoteShellToken(options.hookId),
	].join(" ");
}

export function isPortableHookRuntime(hook: HookDefinition): boolean {
	return serializeHookFunction(hook).ok;
}

export function portableHookIds(hooks: HookDefinition[]): string[] {
	return hooks.filter(isPortableHookRuntime).map((hook) => hook.id);
}

export function unsupportedHookIds(hooks: HookDefinition[]): string[] {
	return hooks
		.filter((hook) => !isPortableHookRuntime(hook))
		.map((hook) => hook.id);
}

function createHookRuntimeEntries(
	options: HookRuntimeRenderOptions,
): HookRuntimeEntry[] {
	const exportNames = new Set<string>();

	return options.hooks.map((hook) => {
		const serialized = serializeHookFunction(hook);
		const exportName = serialized.ok
			? reserveExportName(hook.id, exportNames)
			: undefined;
		const handler = serialized.ok
			? { kind: "function" as const }
			: handlerDescriptor(hook, serialized.reason);

		return {
			hook: {
				id: hook.id,
				event: hook.event,
				targetEvent: options.targetEvent?.(hook),
				module: "./hooks.mjs",
				exportName,
				timeoutMs: hook.timeoutMs ?? options.defaultTimeoutMs ?? 5_000,
				failureMode: hook.failureMode ?? "fail_closed",
				optional: hook.optional ?? false,
				handler,
			},
			handlerSource: serialized.ok ? serialized.source : undefined,
		};
	});
}

function serializeHookFunction(
	hook: HookDefinition,
): { ok: true; source: string } | { ok: false; reason: string } {
	if (typeof hook.handler !== "function") {
		return {
			ok: false,
			reason:
				"Hook handler is a target module reference, not a portable function.",
		};
	}

	const source = Function.prototype.toString.call(hook.handler).trim();

	if (isSerializableFunctionSource(source)) {
		return { ok: true, source };
	}

	return {
		ok: false,
		reason:
			"Hook handler source is not a serializable function expression. Use an arrow function or function expression for generated raw-JS runtime bundles.",
	};
}

function isSerializableFunctionSource(source: string): boolean {
	return (
		/^(async\s+)?function(\s|\*)/.test(source) ||
		/^(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(source)
	);
}

function handlerDescriptor(
	hook: HookDefinition,
	reason: string,
): HookRuntimeHandlerDescriptor {
	if (
		typeof hook.handler === "object" &&
		hook.handler.kind === "target-module"
	) {
		return {
			kind: "target-module",
			target: hook.handler.target,
			entrypoint: hook.handler.entrypoint,
			symbol: hook.handler.symbol,
		};
	}

	return { kind: "unsupported", reason };
}

function renderHooksModule(entries: HookRuntimeEntry[]): string {
	const lines = [
		"// Generated by @oiap/runtime. Do not edit.",
		...entries.flatMap((entry) => {
			if (!entry.handlerSource || !entry.hook.exportName) {
				return [];
			}

			return [
				"",
				`export const ${entry.hook.exportName} = ${entry.handlerSource};`,
			];
		}),
		"",
	];

	return lines.join("\n");
}

function reserveExportName(
	hookId: string,
	usedExportNames: Set<string>,
): string {
	const baseName = toIdentifier(`hook_${hookId}`);
	let candidate = baseName;
	let suffix = 2;

	while (usedExportNames.has(candidate)) {
		candidate = `${baseName}_${suffix}`;
		suffix += 1;
	}

	usedExportNames.add(candidate);
	return candidate;
}

function toIdentifier(value: string): string {
	const identifier = value
		.trim()
		.replace(/[^A-Za-z0-9_$]+/g, "_")
		.replace(/^_+|_+$/g, "");

	if (!identifier) {
		return "hook";
	}

	if (/^[A-Za-z_$]/.test(identifier)) {
		return identifier;
	}

	return `hook_${identifier}`;
}

function quoteShellToken(value: string): string {
	return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function jsonFile(
	path: string,
	value: unknown,
	source: SourceRef,
): RenderedFile {
	return textFile(path, `${JSON.stringify(value, null, "\t")}\n`, source);
}

function textFile(
	path: string,
	content: string,
	source: SourceRef,
	mode?: number,
): RenderedFile {
	return { path, content, mode, source };
}

function sourceRef(
	primitiveId: string,
	primitiveKind: string,
	path?: string,
): SourceRef {
	return { primitiveId, primitiveKind, path };
}
