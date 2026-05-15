import type { HookDefinition, PluginDefinition } from "@oiap/core";
import { definePlugin, hook } from "@oiap/core";

const explanatoryOutputHook = hook.sessionStart(
	"enable-explanatory-output-style",
	() => ({
		decision: "inject_context",
		content:
			"Use an explanatory output style for this session. Complete the user's task directly, while adding brief educational notes before or after meaningful implementation choices. Keep those notes specific to the current codebase, explain trade-offs and patterns, and avoid turning routine steps into general programming lectures. Use this shape when helpful: Insight: followed by two or three concise points. The explanatory notes belong in the conversation, not in generated code comments unless the code itself needs a comment.",
		priority: "normal",
	}),
	{ timeoutMs: 1_000, failureMode: "fail_open" },
) as HookDefinition;

export default definePlugin({
	manifest: {
		id: "explanatory-output-style",
		name: "Explanatory Output Style",
		version: "1.0.0",
		description:
			"Adds educational implementation notes about codebase patterns and trade-offs at the start of an agent session.",
		homepage:
			"https://github.com/anthropics/claude-code/tree/main/plugins/explanatory-output-style",
		categories: ["example", "output-style", "hooks"],
		supportedTargets: [
			"claude-code",
			"codex",
			"openclaw",
			"vscode-copilot-chat",
		],
	},
	hooks: [explanatoryOutputHook],
} satisfies PluginDefinition);
