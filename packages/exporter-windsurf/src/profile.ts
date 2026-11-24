import { defineHostProfile } from "@oiap/core";

export const WINDSURF_TARGET = "windsurf" as const;

/**
 * Windsurf was renamed Devin Desktop in 2026. docs.windsurf.com redirects to
 * docs.devin.ai/desktop. Sources:
 * - Customizations (rules, skills, hooks): https://docs.devin.ai/desktop/cascade/memories
 * - Workflows: https://docs.devin.ai/desktop/cascade/workflows
 * - Rules: https://docs.devin.ai/cli/extensibility/rules.md
 * - Skills: https://docs.devin.ai/cli/extensibility/skills/overview.md
 * - Hooks: https://docs.devin.ai/cli/extensibility/hooks/overview.md
 * - MCP: https://docs.devin.ai/cli/extensibility/mcp/configuration.md
 * - Subagents: https://docs.devin.ai/cli/subagents.md
 */
export const windsurfProfile = defineHostProfile({
	id: WINDSURF_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Windsurf documents no workspace plugin manifest; exports a workspace bundle (.windsurf/ and .devin/) with an OIAP target manifest. Sources: https://docs.devin.ai/desktop/cascade/memories",
	},
	installSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Windsurf documents no plugin directory. Local installs stage the bundle in project .windsurf/plugins; global installs use ~/.codeium/windsurf/plugins. Copy .windsurf/ and .devin/ into the workspace root to activate.",
		paths: {
			local: {
				base: "cwd",
				segments: [".windsurf", "plugins", "{pluginId}"],
			},
			global: {
				base: "home",
				segments: [".codeium", "windsurf", "plugins", "{pluginId}"],
			},
		},
	},
	ruleSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports .windsurf/rules/*.md with trigger (always_on, manual, model_decision, glob), description and globs frontmatter. Sources: https://docs.devin.ai/cli/extensibility/rules.md, https://docs.devin.ai/desktop/cascade/memories",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports .windsurf/skills/<name>/SKILL.md with supporting files beside it. Source: https://docs.devin.ai/cli/extensibility/skills/overview.md",
	},
	commandSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"Exports commands as user-only skills (triggers: [user]) invoked as /name. Cascade workflows are not emitted because Devin Local does not support them and the docs say to migrate workflows to skills. Source: https://docs.devin.ai/desktop/cascade/workflows",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports .devin/hooks.v1.json command hooks (SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Stop) that call the generated OIAP runtime. The legacy Cascade .windsurf/hooks.json event list is no longer documented. Source: https://docs.devin.ai/cli/extensibility/hooks/overview.md",
	},
	mcpSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports project MCP config to .devin/mcp_config.json with a top-level mcpServers object. Source: https://docs.devin.ai/cli/extensibility/mcp/configuration.md",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as reviewable OIAP evidence; Windsurf permission controls require user review.",
	},
	runtimeSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Portable hooks are bundled into .oiap/runtime and called from a generated Node bridge; arbitrary target runtime modules are source-mapped.",
	},
	shellDialects: ["posix", "bash", "zsh"],
	configFormats: ["json", "markdown", "yaml-frontmatter", "javascript"],
});
