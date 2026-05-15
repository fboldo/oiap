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
    PluginManifest,
    ProjectRule,
    RuntimeModule,
    SkillAsset,
    TargetId,
    ToolSurface,
    Workflow,
} from "./primitives";

export const CURRENT_OIAP_CORE_VERSION = "0.0.0";

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
	targetModules?: Partial<Record<TargetId, TargetModuleRef | TargetModuleRef[]>>;
}

export type DefinedPlugin<TDefinition extends PluginDefinition = PluginDefinition> = TDefinition & {
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

export function defineManifest<const TManifest extends PluginManifest>(manifest: TManifest): TManifest {
	return manifest;
}

export function defineHostProfile<const TProfile extends HostProfile>(profile: TProfile): TProfile {
	return profile;
}

export function defineExporter<const TExporter extends PlatformExporter>(exporter: TExporter): TExporter {
	return exporter;
}