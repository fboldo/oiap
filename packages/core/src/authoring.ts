import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { HookDefinition, TargetModuleRef } from "./hooks";
import type {
	AgentDefinition,
	Artifact,
	CommandAsset,
	CommandRecipe,
	DelegationStrategy,
	HostProfile,
	InstructionModule,
	Invocation,
	PermissionPolicy,
	PlatformExporter,
	PluginIr,
	PluginManifest,
	ProjectRule,
	RuntimeModule,
	SkillAsset,
	TargetId,
	ToolSurface,
	Workflow,
} from "./primitives";

export const CURRENT_OIAP_CORE_VERSION = "0.0.0";

export interface MarkdownFileOptions {
	baseDir?: string;
	baseUrl?: string | URL;
}

export interface PluginDefinition {
	manifest?: PluginManifest;
	invocations?: Invocation[];
	instructions?: InstructionModule[];
	commands?: CommandAsset[];
	workflows?: Workflow[];
	rules?: ProjectRule[];
	skills?: SkillAsset[];
	hooks?: HookDefinition[];
	agents?: AgentDefinition[];
	tools?: ToolSurface[];
	artifacts?: Artifact[];
	recipes?: CommandRecipe[];
	delegationStrategies?: DelegationStrategy[];
	policies?: PermissionPolicy[];
	runtimeModules?: RuntimeModule[];
	targetModules?: Partial<
		Record<TargetId, TargetModuleRef | TargetModuleRef[]>
	>;
}

export type DefinedPlugin<
	TDefinition extends PluginDefinition = PluginDefinition,
> = TDefinition & {
	readonly kind: "oiap.plugin";
	readonly oiapVersion: string;
};

export function definePlugin<const TDefinition extends PluginDefinition>(
	definition: TDefinition,
): DefinedPlugin<TDefinition> {
	return {
		...definition,
		kind: "oiap.plugin",
		oiapVersion: CURRENT_OIAP_CORE_VERSION,
	} as DefinedPlugin<TDefinition>;
}

export function markdownFile(
	filePath: string | URL,
	options: MarkdownFileOptions = {},
): string {
	const resolvedPath = resolveMarkdownFilePath(filePath, options);

	if (!existsSync(resolvedPath)) {
		throw new Error(`Markdown file not found: ${resolvedPath}`);
	}

	return readFileSync(resolvedPath, "utf8");
}

export function toPluginIr(definition: PluginDefinition): PluginIr {
	return {
		manifest: definition.manifest,
		invocations: definition.invocations ?? [],
		instructions: definition.instructions ?? [],
		commands: definition.commands ?? [],
		workflows: definition.workflows ?? [],
		rules: definition.rules ?? [],
		skills: definition.skills ?? [],
		hooks: definition.hooks ?? [],
		agents: definition.agents ?? [],
		tools: definition.tools ?? [],
		artifacts: definition.artifacts ?? [],
		recipes: definition.recipes ?? [],
		delegationStrategies: definition.delegationStrategies ?? [],
		policies: definition.policies ?? [],
		runtimeModules: definition.runtimeModules ?? [],
	};
}

export function defineManifest<const TManifest extends PluginManifest>(
	manifest: TManifest,
): TManifest {
	return manifest;
}

export function defineHostProfile<const TProfile extends HostProfile>(
	profile: TProfile,
): TProfile {
	return profile;
}

export function defineExporter<const TExporter extends PlatformExporter>(
	exporter: TExporter,
): TExporter {
	return exporter;
}

function resolveMarkdownFilePath(
	filePath: string | URL,
	options: MarkdownFileOptions,
): string {
	if (filePath instanceof URL) {
		return fileURLToPath(filePath);
	}

	if (isAbsolute(filePath)) {
		return filePath;
	}

	const baseDir =
		options.baseDir ??
		(options.baseUrl ? dirname(fileURLToPath(options.baseUrl)) : undefined) ??
		inferCallerDirectory() ??
		process.cwd();

	return resolve(baseDir, filePath);
}

function inferCallerDirectory(): string | undefined {
	const stack = new Error().stack;

	if (!stack) {
		return undefined;
	}

	const authoringFile = fileURLToPath(import.meta.url);

	for (const line of stack.split("\n").slice(1)) {
		const filePath = stackFrameFilePath(line);

		if (!filePath || filePath === authoringFile) {
			continue;
		}

		return dirname(filePath);
	}

	return undefined;
}

function stackFrameFilePath(line: string): string | undefined {
	const match = line.match(/\(?((?:file:\/\/)?\/.*?):\d+:\d+\)?$/);
	const rawPath = match?.[1];

	if (!rawPath) {
		return undefined;
	}

	try {
		return rawPath.startsWith("file://") ? fileURLToPath(rawPath) : rawPath;
	} catch {
		return undefined;
	}
}
