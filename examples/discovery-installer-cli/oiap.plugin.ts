import type { PluginDefinition } from "@oiap/core";
import { definePlugin, markdownFile } from "@oiap/core";

const installerPrompt = markdownFile("prompts/discovery-installer.md", {
	baseUrl: import.meta.url,
});

export default definePlugin({
	manifest: {
		id: "discovery-installer-cli",
		name: "Discovery Installer CLI",
		version: "1.0.0",
		description:
			"Demonstrates a plugin-owned installation command built on OIAP discovery primitives.",
		categories: ["example", "discovery", "installer", "commands"],
		supportedTargets: [
			"claude-code",
			"codex",
			"opencode",
			"vscode-copilot-chat",
		],
	},
	invocations: [
		{
			id: "discovery-installer-invocation",
			canonical: "discovery-installer",
			targetAliases: {
				"claude-code": "discovery-installer",
				codex: "discovery-installer",
				opencode: "discovery-installer",
				"vscode-copilot-chat": "discovery-installer",
			},
			helpText:
				"Explain how this repository discovers and installs its OIAP plugin declaration.",
			examples: [
				"/discovery-installer",
				"/discovery-installer Show the Codex install path",
			],
		},
	],
	instructions: [
		{
			id: "discovery-installer-prompt",
			purpose: "command",
			triggers: ["discovery installer", "plugin install", "definePlugin scan"],
			body: installerPrompt,
		},
	],
	commands: [
		{
			id: "discovery-installer-command",
			invocation: {
				id: "discovery-installer-invocation",
				kind: "invocation",
			},
			prompt: { id: "discovery-installer-prompt", kind: "instruction" },
		},
	],
} satisfies PluginDefinition);
