import type {
	PluginDefinition,
	PluginIr,
	TargetBundle,
	TargetId,
} from "@oiap/core";
import {
	CLAUDE_CODE_TARGET,
	exportClaudeCode,
} from "@oiap/exporter-claude-code";
import { CODEX_TARGET, exportCodex } from "@oiap/exporter-codex";
import { exportOpenClaw, OPENCLAW_TARGET } from "@oiap/exporter-openclaw";

export type CliPluginInput = PluginDefinition | PluginIr;

export interface RegisteredExporter {
	target: TargetId;
	packageName: string;
	exportBundle(plugin: CliPluginInput): TargetBundle;
}

export const exporterRegistry = {
	[CLAUDE_CODE_TARGET]: {
		target: CLAUDE_CODE_TARGET,
		packageName: "@oiap/exporter-claude-code",
		exportBundle: exportClaudeCode,
	},
	[CODEX_TARGET]: {
		target: CODEX_TARGET,
		packageName: "@oiap/exporter-codex",
		exportBundle: exportCodex,
	},
	[OPENCLAW_TARGET]: {
		target: OPENCLAW_TARGET,
		packageName: "@oiap/exporter-openclaw",
		exportBundle: exportOpenClaw,
	},
} satisfies Record<string, RegisteredExporter>;

export type RegisteredTarget = keyof typeof exporterRegistry;

export const registeredTargets = Object.keys(
	exporterRegistry,
) as RegisteredTarget[];

export function getRegisteredExporter(
	target: string,
): RegisteredExporter | undefined {
	return exporterRegistry[target as RegisteredTarget];
}
