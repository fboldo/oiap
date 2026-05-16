import { defineHostProfile } from "@oiap/core";

export const ANTIGRAVITY_TARGET = "antigravity" as const;

export const antigravityProfile = defineHostProfile({
	id: ANTIGRAVITY_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Antigravity does not document a native plugin package manifest; exports a reviewable workspace bundle with OIAP metadata.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports workspace Agent Skills under .agents/skills.",
	},
	commandSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports commands as workflow markdown for Antigravity slash workflows; the official docs do not currently document the workflow filesystem directory.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports workspace rules under .agents/rules as Markdown files.",
	},
	hookSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Antigravity docs do not expose a hook lifecycle or hook configuration file; hooks are emitted as metadata only.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports mcp_config.json with Antigravity's documented top-level mcpServers object.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports documented Antigravity permission resource strings as reviewable OIAP policy fragments; settings placement remains user-controlled.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Antigravity does not document runtime plugin adapters; runtime modules are source-mapped as metadata.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter"],
});
