# @oiap/exporter-agent-plugins

[Agent Plugins](https://github.com/agentplugins/agent-plugins-spec) 1.0.0
exporter for Open Interoperable Agent Plugins (target id `agent-plugins`).

Agent Plugins is a vendor-neutral package format. A directory with a root
`plugin.json` that declares
`"$schema": "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json"` is
read by GitHub Copilot CLI, VS Code, Codex, OpenClaw and Cursor.

The bundle holds only what the 1.0.0 specification defines:

- `plugin.json`: `$schema`, `name` (the plugin id, normalized to the spec's
  name rules), `version`, `description`, `author`, `homepage`, `repository`,
  `license`, `keywords` (or `categories`), and `extensions` when you add it.
- `skills/<name>/SKILL.md` and the skill's files, following
  [Agent Skills](https://agentskills.io/specification). Skills from
  `skillsFrom()` are written exactly as they are in the repository.
- `mcp.json`: MCP servers as typed `stdio`, `streamable-http` or `sse` entries.
  Bundled paths use `${PLUGIN_ROOT}`; a bundled command becomes `./<path>`.
- Plugin `resources` and `targetFiles["agent-plugins"]`, at the plugin root.
- `.oiap/`: build evidence (bundle, capability report, source map), which
  `oiap sync` leaves out.

Commands, workflows, agents, rules, hooks, permission policies and runtime
modules are not part of Agent Plugins 1.0. They are left out and reported as
degraded; export a host target (`claude-code`, `codex`, `cursor`,
`github-copilot-cli`, `vscode-copilot-chat`) for them.

## Host extensions

Put client-specific data under a reverse-domain namespace in `extensions`, and
client-specific files in a top-level directory with the same name:

```ts
definePlugin({
	manifest: {
		// ...
		targetMetadata: {
			"agent-plugins": {
				extensions: {
					"com.github.copilot": { agents: "./com.github.copilot/agents" },
				},
			},
		},
	},
	targetFiles: {
		"agent-plugins": [
			{ path: "com.github.copilot/agents/critic.agent.md", content: "..." },
		],
	},
});
```

`targetMetadata["agent-plugins"]` merges into `plugin.json` (`null` removes a
generated field). The manifest schema is closed, so any top-level field other
than the ten listed above is reported as an error. Target file paths are
relative to the plugin root.
