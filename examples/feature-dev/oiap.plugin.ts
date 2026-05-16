import type { PluginDefinition } from "@oiap/core";
import { definePlugin, markdownFile } from "@oiap/core";

const featureDevPrompt = markdownFile("prompts/feature-dev.md");
const codeExplorerInstructions = markdownFile("agents/code-explorer.md");
const codeArchitectInstructions = markdownFile("agents/code-architect.md");
const codeReviewerInstructions = markdownFile("agents/code-reviewer.md");

export default definePlugin({
	manifest: {
		id: "feature-dev",
		name: "Feature Dev",
		version: "1.0.0",
		description:
			"Guided feature development workflow with codebase exploration, architecture design, implementation approval, and quality review agents.",
		homepage:
			"https://github.com/anthropics/claude-code/tree/main/plugins/feature-dev",
		categories: ["example", "workflow", "agents", "commands"],
		supportedTargets: [
			"antigravity",
			"claude-code",
			"codex",
			"openclaw",
			"vscode-copilot-chat",
		],
	},
	invocations: [
		{
			id: "feature-dev-invocation",
			canonical: "feature-dev",
			targetAliases: {
				antigravity: "feature-dev",
				"claude-code": "feature-dev",
				codex: "feature-dev",
				openclaw: "feature-dev",
				"vscode-copilot-chat": "feature-dev",
			},
			helpText:
				"Run a structured feature development workflow with exploration, architecture, implementation, and review phases.",
			examples: [
				"/feature-dev Add a dashboard filter for active projects",
				"/feature-dev Build keyboard navigation for the board view",
			],
		},
	],
	instructions: [
		{
			id: "feature-dev-command-prompt",
			purpose: "command",
			triggers: ["feature-dev", "new feature", "feature workflow"],
			body: featureDevPrompt,
		},
		{
			id: "code-explorer-instructions",
			purpose: "agent",
			triggers: ["explore codebase", "trace implementation"],
			body: codeExplorerInstructions,
		},
		{
			id: "code-architect-instructions",
			purpose: "agent",
			triggers: ["design feature architecture", "implementation blueprint"],
			body: codeArchitectInstructions,
		},
		{
			id: "code-reviewer-instructions",
			purpose: "agent",
			triggers: ["review code", "quality review"],
			body: codeReviewerInstructions,
		},
	],
	commands: [
		{
			id: "feature-dev-command",
			invocation: { id: "feature-dev-invocation", kind: "invocation" },
			prompt: { id: "feature-dev-command-prompt", kind: "instruction" },
			targetMetadata: {
				antigravity: {
					description:
						"Guided feature development with codebase understanding and architecture focus",
				},
				"claude-code": {
					description:
						"Guided feature development with codebase understanding and architecture focus",
					"argument-hint": "Optional feature description",
				},
				"vscode-copilot-chat": {
					description:
						"Guided feature development with codebase understanding and architecture focus",
					"argument-hint": "Optional feature description",
				},
			},
		},
	],
	agents: [
		{
			id: "code-explorer",
			name: "code-explorer",
			description:
				"Deeply analyzes existing code paths, architecture layers, patterns, dependencies, and key files before feature design.",
			instructions: { id: "code-explorer-instructions", kind: "instruction" },
			model: "sonnet",
		},
		{
			id: "code-architect",
			name: "code-architect",
			description:
				"Designs implementation blueprints based on existing codebase patterns, data flow, integration points, and build sequence.",
			instructions: { id: "code-architect-instructions", kind: "instruction" },
			model: "sonnet",
		},
		{
			id: "code-reviewer",
			name: "code-reviewer",
			description:
				"Reviews changes for high-confidence bugs, security risks, convention gaps, test gaps, and maintainability issues.",
			instructions: { id: "code-reviewer-instructions", kind: "instruction" },
			model: "sonnet",
		},
	],
} satisfies PluginDefinition);
