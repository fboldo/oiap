import { defineHostProfile } from "@oiap/core";

export const ANTIGRAVITY_TARGET = "antigravity" as const;

const PLUGINS_DOC = "https://antigravity.google/docs/plugins.md";
const BUILD_PLUGINS_DOC = "https://antigravity.google/docs/build-plugins.md";

export const antigravityProfile = defineHostProfile({
	id: ANTIGRAVITY_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes: `Exports a native plugin with .antigravity-plugin/plugin.json (schema-valid keys only), installable with agy plugin install or /plugin. ${BUILD_PLUGINS_DOC}`,
	},
	installSupport: {
		supported: true,
		fidelity: "native",
		notes: `Global installs use ~/.gemini/config/plugins/<plugin-name>; workspace installs use .agents/plugins/ at the workspace root. ${PLUGINS_DOC}`,
		paths: {
			local: { base: "cwd", segments: [".agents", "plugins", "{pluginId}"] },
			global: {
				base: "home",
				segments: [".gemini", "config", "plugins", "{pluginId}"],
			},
		},
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes: `Exports skills under skills/<name>/SKILL.md with bundled files beside them. ${BUILD_PLUGINS_DOC}`,
	},
	commandSupport: {
		supported: true,
		fidelity: "fallback",
		notes: `Antigravity plugins do not load commands/; commands and workflows are exported as skills invoked with /<skill-name>. ${BUILD_PLUGINS_DOC}`,
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes: `Exports rules under rules/ with trigger (always_on, model_decision, glob, manual) and comma-separated globs frontmatter. ${BUILD_PLUGINS_DOC}`,
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes: `Exports root hooks.json calling the OIAP runner from the plugin root (the documented hook cwd); the runner writes Antigravity hook responses (decision, injectSteps). ${BUILD_PLUGINS_DOC}`,
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes: `Exports mcp_config.json with a top-level mcpServers object; servers are namespaced <plugin-name>_<server>. ${BUILD_PLUGINS_DOC}`,
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports documented Antigravity permission resource strings as reviewable OIAP policy fragments; plugins have no permission file.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Hooks run the generated OIAP raw-JS runner under .oiap/runtime/; other runtime modules are source-mapped as metadata.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter"],
});
