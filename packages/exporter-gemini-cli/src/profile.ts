import { defineHostProfile } from "@oiap/core";

export const GEMINI_CLI_TARGET = "gemini-cli" as const;

export const geminiCliProfile = defineHostProfile({
	id: GEMINI_CLI_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports a Gemini CLI extension directory with root gemini-extension.json.",
	},
	installSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Local installs use project .gemini/extensions; global installs use ~/.gemini/extensions.",
		paths: {
			local: { base: "cwd", segments: [".gemini", "extensions", "{pluginId}"] },
			global: {
				base: "home",
				segments: [".gemini", "extensions", "{pluginId}"],
			},
		},
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Gemini CLI Agent Skills folders with SKILL.md metadata.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes: "Exports Gemini CLI custom command TOML files under commands/.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports GEMINI.md and manifest-listed context files for extension-scoped instructions.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports hooks/hooks.json command hooks that call the generated OIAP raw-JS hook runtime for Gemini CLI hook events.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Gemini CLI extension mcpServers entries in gemini-extension.json.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports Gemini Policy Engine TOML rules for deny and ask policies; allow policies are retained as evidence because extension policies cannot auto-approve.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hook functions are emitted as raw JavaScript runner bundles; other runtime modules are still source-mapped.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "toml", "markdown", "yaml-frontmatter", "javascript"],
});
