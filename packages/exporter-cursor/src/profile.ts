import { defineHostProfile } from "@oiap/core";

export const CURSOR_TARGET = "cursor" as const;

export const cursorProfile = defineHostProfile({
	id: CURSOR_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports a Cursor plugin directory with .cursor-plugin/plugin.json.",
	},
	installSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Local installs use project .cursor/plugins; global installs use ~/.cursor/plugins.",
		paths: {
			local: { base: "cwd", segments: [".cursor", "plugins", "{pluginId}"] },
			global: { base: "home", segments: [".cursor", "plugins", "{pluginId}"] },
		},
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Cursor Agent Skills folders with SKILL.md metadata.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Cursor command markdown files in the commands directory.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Cursor .mdc rules with description, globs, and alwaysApply frontmatter.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports hooks/hooks.json command hooks that call the generated OIAP raw-JS hook runtime for documented Cursor hook events.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Cursor MCP server definitions in root mcp.json with top-level mcpServers.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as evidence for hooks and future policy-specific lowering.",
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
