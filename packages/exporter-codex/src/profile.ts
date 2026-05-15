import { defineHostProfile } from "@oiap/core";

export const CODEX_TARGET = "codex" as const;

export const codexProfile = defineHostProfile({
	id: CODEX_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports a Codex plugin folder with .codex-plugin/plugin.json.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Codex skill folders with SKILL.md metadata.",
	},
	commandSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Codex has skills rather than a direct slash-command package surface; commands are exported as explicit skills.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports AGENTS.md and Codex .rules files for project-scoped usage.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports hooks/hooks.json commands that call the generated OIAP raw-JS hook runtime; plugin hooks require Codex plugin_hooks to be enabled.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports bundled MCP server configuration through .mcp.json and plugin manifest references.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports best-effort Codex execpolicy .rules plus capability evidence.",
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
