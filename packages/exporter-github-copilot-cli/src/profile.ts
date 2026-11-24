import { defineHostProfile } from "@oiap/core";

export const GITHUB_COPILOT_CLI_TARGET = "github-copilot-cli" as const;

// Sources:
// - Plugin reference: https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
// - Hooks: https://docs.github.com/en/copilot/reference/hooks-reference
// - Custom agents: https://docs.github.com/en/copilot/reference/custom-agents-configuration
// - Skills: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills
// - MCP: https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
// - Changelog (plugin hook env vars, hook cwd, command files): https://github.com/github/copilot-cli/blob/main/changelog.md
export const gitHubCopilotCliProfile = defineHostProfile({
	id: GITHUB_COPILOT_CLI_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports a Copilot CLI plugin with a root plugin.json that declares component paths (legacy manifest format). See https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference.",
	},
	installSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Copilot CLI installs plugins itself with `copilot plugin install <path>` into ~/.copilot/installed-plugins/_direct/<source-id>/ and records them in its settings; copying files there does not register a plugin, and no project plugin directory is documented. Build with --out, then run `copilot plugin install <out>` or `copilot --plugin-dir <out>`.",
		paths: {},
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports Agent Skills folders (skills/<name>/SKILL.md with name and description) and ships supporting files beside SKILL.md. See https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills.",
	},
	commandSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports slash commands as Markdown command files in the manifest commands directory, with name and description frontmatter (changelog 0.0.399, 0.0.412, 0.0.417).",
	},
	ruleSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Copilot CLI plugins do not define a rules or custom-instruction component; OIAP rules are represented as model-invoked skills.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports hooks.json (version 1, camelCase events) whose bash and powershell commands locate the generated OIAP runner through the PLUGIN_ROOT environment variable (changelog 1.0.26). The runner writes Copilot CLI hook output fields (permissionDecision, additionalContext, modifiedResult, decision). See https://docs.github.com/en/copilot/reference/hooks-reference.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports plugin MCP servers in root .mcp.json under mcpServers with type local, http or sse.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as evidence; read-only agents map to the read and search tool aliases.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hook functions are emitted as raw JavaScript runner bundles; other runtime modules are still source-mapped.",
	},
	shellDialects: ["bash", "powershell"],
	configFormats: ["json", "markdown", "yaml-frontmatter", "javascript"],
});
