import { defineHostProfile } from "@oiap/core";

export const OPENCLAW_TARGET = "openclaw" as const;

export const openClawProfile = defineHostProfile({
	id: OPENCLAW_TARGET,
	verification: "official",
	packageSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports a native OpenClaw plugin package with package.json and openclaw.plugin.json.",
	},
	skillSupport: {
		supported: true,
		fidelity: "native",
		notes:
			"Exports OpenClaw AgentSkills-compatible SKILL.md folders and declares them in the plugin manifest.",
	},
	commandSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Commands are exported as user-invocable skills plus commandAliases metadata until registerCommand lowering is implemented.",
	},
	ruleSupport: {
		supported: true,
		fidelity: "fallback",
		notes: "Project rules are represented as always-on OpenClaw plugin skills.",
	},
	hookSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Exports native api.on registrations that call the generated OIAP raw-JS hook runtime.",
	},
	mcpSupport: {
		supported: true,
		fidelity: "fallback",
		notes:
			"MCP server metadata is emitted as evidence; native OpenClaw plugin MCP bridging is not generated yet.",
	},
	permissionSupport: {
		supported: true,
		fidelity: "partial",
		notes:
			"Permission policies are emitted as evidence for future hook/policy lowering.",
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
