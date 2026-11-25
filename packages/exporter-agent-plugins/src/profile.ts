import { defineHostProfile } from "@oiap/core";

export const AGENT_PLUGINS_TARGET = "agent-plugins" as const;

/** Agent Plugins 1.0.0, the published release; 1.1.0 is a working draft. */
export const AGENT_PLUGINS_SPEC_VERSION = "1.0.0";

export const AGENT_PLUGINS_PLUGIN_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_SPEC_VERSION}/plugin.schema.json`;

export const AGENT_PLUGINS_MCP_SCHEMA = `https://agent-plugins.org/schemas/${AGENT_PLUGINS_SPEC_VERSION}/mcp.schema.json`;

// Agent Plugins is an open package format, not a host. Sources:
// - Spec 1.0.0: https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md
// - Schemas: https://agent-plugins.org/schemas/1.0.0/plugin.schema.json,
//   https://agent-plugins.org/schemas/1.0.0/mcp.schema.json
// - Agent Skills: https://agentskills.io/specification
// Hosts that read it (root plugin.json with this $schema):
// - GitHub Copilot CLI, ahead of .plugin/ and .claude-plugin/ manifests:
//   https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
// - VS Code, ahead of legacy metadata:
//   https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference
// - Codex, ahead of .codex-plugin/plugin.json (1.0.0 only):
//   https://developers.openai.com/codex/plugins/build
// - OpenClaw, after openclaw.plugin.json and client bundle markers (1.0.0 only):
//   https://github.com/openclaw/openclaw/blob/main/docs/plugins/bundles.md
// - Cursor, as an alternative to .cursor-plugin/plugin.json:
//   https://cursor.com/docs/reference/plugins
export const agentPluginsProfile = defineHostProfile({
	id: AGENT_PLUGINS_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports an Agent Plugins 1.0.0 package: root plugin.json with the canonical $schema and only the fields the closed manifest schema allows; client-specific data goes under `extensions` through manifest.targetMetadata['agent-plugins'].",
	},
	installSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Agent Plugins defines no install location; each host installs the directory its own way (for example `copilot plugin install <out>`, a Codex or Cursor marketplace, or `openclaw plugins install <out>`). Build with --out.",
		paths: {},
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Agent Skills folders at skills/<name>/SKILL.md (name matches the folder) with supporting files beside SKILL.md.",
	},
	commandSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Agent Plugins 1.0 defines only skills and MCP servers; commands are reported as not emitted.",
	},
	ruleSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Agent Plugins 1.0 has no rules or instruction component; rules are reported as not emitted.",
	},
	hookSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Hooks are a 1.1.0 working-draft component, not part of 1.0.0; hooks are reported as not emitted.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports root mcp.json in the Agent Plugins format: typed stdio, streamable-http and sse entries, with the PLUGIN_ROOT placeholder for bundled paths. Cursor does not expand the PLUGIN_ROOT and PLUGIN_DATA placeholders (https://cursor.com/docs/reference/plugins).",
	},
	permissionSupport: {
		supported: false,
		fidelity: "unsupported",
		notes:
			"Agent Plugins has no permission or policy surface; policies are reported as not emitted.",
	},
	runtimeSupport: {
		supported: false,
		fidelity: "unsupported",
		notes: "No runtime modules are generated for this format.",
	},
	shellDialects: ["posix", "bash", "zsh", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter"],
});
