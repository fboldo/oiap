import { defineHostProfile } from "@oiap/core";

export const OPENCODE_TARGET = "opencode" as const;

export const openCodeProfile = defineHostProfile({
	id: OPENCODE_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports a project-local OpenCode config bundle with opencode.json and .opencode companion assets; npm plugin packaging is not generated yet.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports OpenCode Agent Skills under .opencode/skills/<name>/SKILL.md with OpenCode-compatible frontmatter.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports OpenCode command markdown files under .opencode/commands/.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports AGENTS.md and opencode.json instruction references for project rules.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports a bundled JavaScript OpenCode plugin, compiled from TypeScript source, that forwards supported events to the generated OIAP raw-JS hook runtime.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports OpenCode local and remote MCP server definitions in opencode.json.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports OpenCode permission rules for common process, filesystem, network, path, and destructive-action policies.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hook functions are emitted as raw JavaScript runner bundles and called from an OpenCode TypeScript plugin.",
	},
	shellDialects: ["posix", "bash", "zsh", "fish", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter", "javascript"],
});
