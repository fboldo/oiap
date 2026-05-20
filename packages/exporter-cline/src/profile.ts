import { defineHostProfile } from "@oiap/core";

export const CLINE_TARGET = "cline" as const;

export const clineProfile = defineHostProfile({
	id: CLINE_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports project-local .cline and .clinerules assets plus an OIAP target manifest; Cline SDK plugin packaging is not generated yet.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Cline Markdown rules under .clinerules with optional paths frontmatter.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Cline project skills under .cline/skills/<name>/SKILL.md.",
	},
	commandSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Exports commands as user-invocable skills because Cline exposes custom slash invocation through enabled skills, not a separate command registry.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports Cline file hooks for matching lifecycle events and invokes the generated OIAP hook runtime from those files.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports project MCP configuration to .cline/mcp.json.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as reviewable OIAP evidence; Cline command and MCP approval controls require user review.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hooks are bundled into .oiap/runtime and called from Cline hook scripts; arbitrary target runtime modules are source-mapped.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter", "javascript"],
});
