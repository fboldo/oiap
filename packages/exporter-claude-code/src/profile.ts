import { defineHostProfile } from "@oiap/core";

export const CLAUDE_CODE_TARGET = "claude-code" as const;

export const claudeCodeProfile = defineHostProfile({
	id: CLAUDE_CODE_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes: "Claude Code is treated as a first-class package target.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports skill folders with SKILL.md metadata.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports command markdown files.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports CLAUDE.md instruction content.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports hook configuration that calls the generated OIAP raw-JS hook runtime.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports MCP server declarations into a Claude-oriented settings file.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes: "Exports policy evidence in the OIAP capability report.",
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
