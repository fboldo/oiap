import { defineHostProfile } from "@oiap/core";

export const VSCODE_COPILOT_TARGET = "vscode-copilot-chat" as const;

export const vsCodeCopilotProfile = defineHostProfile({
	id: VSCODE_COPILOT_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports a VS Code Copilot-format agent plugin with root plugin.json.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Agent Skills folders with SKILL.md metadata.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports slash commands as VS Code prompt files in a manifest commands directory.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Plugin-scoped always-on instructions are not documented; OIAP rules are represented as model-invoked skills.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports root hooks.json commands that call the generated OIAP raw-JS hook runtime. Copilot-format plugins do not define a plugin-root token.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports plugin MCP server definitions in root .mcp.json with top-level mcpServers.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as evidence for hooks and future policy lowering.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hook functions are emitted as raw JavaScript runner bundles; other runtime modules are still source-mapped.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter", "javascript"],
});
