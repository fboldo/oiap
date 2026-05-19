import type {
	PluginDefinition,
	PluginIr,
	TargetBundle,
	TargetId,
} from "@oiap/core";
import {
	ANTIGRAVITY_TARGET,
	exportAntigravity,
} from "@oiap/exporter-antigravity";
import {
	CLAUDE_CODE_TARGET,
	exportClaudeCode,
} from "@oiap/exporter-claude-code";
import { CODEX_TARGET, exportCodex } from "@oiap/exporter-codex";
import { CURSOR_TARGET, exportCursor } from "@oiap/exporter-cursor";
import { exportGeminiCli, GEMINI_CLI_TARGET } from "@oiap/exporter-gemini-cli";
import { exportOpenClaw, OPENCLAW_TARGET } from "@oiap/exporter-openclaw";
import { exportOpenCode, OPENCODE_TARGET } from "@oiap/exporter-opencode";
import {
	exportVsCodeCopilot,
	VSCODE_COPILOT_TARGET,
} from "@oiap/exporter-vscode-copilot";

export type CliPluginInput = PluginDefinition | PluginIr;

export interface RegisteredExporter {
	target: TargetId;
	packageName: string;
	exportBundle(plugin: CliPluginInput): TargetBundle;
}

export const exporterRegistry = {
	[ANTIGRAVITY_TARGET]: {
		target: ANTIGRAVITY_TARGET,
		packageName: "@oiap/exporter-antigravity",
		exportBundle: exportAntigravity,
	},
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
	[CURSOR_TARGET]: {
		target: CURSOR_TARGET,
		packageName: "@oiap/exporter-cursor",
		exportBundle: exportCursor,
	},
	[GEMINI_CLI_TARGET]: {
		target: GEMINI_CLI_TARGET,
		packageName: "@oiap/exporter-gemini-cli",
		exportBundle: exportGeminiCli,
	},
	[OPENCLAW_TARGET]: {
		target: OPENCLAW_TARGET,
		packageName: "@oiap/exporter-openclaw",
		exportBundle: exportOpenClaw,
	},
	[OPENCODE_TARGET]: {
		target: OPENCODE_TARGET,
		packageName: "@oiap/exporter-opencode",
		exportBundle: exportOpenCode,
	},
	[VSCODE_COPILOT_TARGET]: {
		target: VSCODE_COPILOT_TARGET,
		packageName: "@oiap/exporter-vscode-copilot",
		exportBundle: exportVsCodeCopilot,
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
