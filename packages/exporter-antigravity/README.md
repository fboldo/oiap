# @oiap/exporter-antigravity

Google Antigravity exporter for Open Interoperable Agent Plugins.

The exporter renders a native Antigravity plugin, installable with
`agy plugin install <path or GitHub URL>` or `/plugin` in the app
([plugins](https://antigravity.google/docs/plugins.md),
[build plugins](https://antigravity.google/docs/build-plugins.md)):

- `.antigravity-plugin/plugin.json`: the manifest, with schema-valid keys only.
  It takes precedence over a root `plugin.json`, which other hosts also read.
- `skills/<name>/SKILL.md`: skills, with `SkillAsset.files` beside them.
  Commands and workflows become skills too, since plugins do not load
  `commands/`; invoke them with `/<skill-name>`.
- `agents/<name>.md`: custom agents and subagents with `name` and
  `description` frontmatter
  ([subagents](https://antigravity.google/docs/subagents/)). Gemini CLI reads
  the same folder with a strict schema, so other keys come only from
  `targetMetadata.antigravity`.
- `rules/<name>.md`: rules with `trigger` and comma-separated `globs`
  frontmatter.
- `hooks.json` and `.oiap/runtime/`: lifecycle hooks that run the OIAP hook
  runner from the plugin root; the runner answers with Antigravity hook
  responses (`decision`, `injectSteps`).
- `mcp_config.json`: MCP servers under `mcpServers`.
- Plugin `resources` at the plugin root.
- `.oiap/`: source map, capability report, permission fragments, and policy
  evidence.

Antigravity installs plugins to `~/.gemini/config/plugins/<plugin-name>`
(global) or `.agents/plugins/` (workspace). The exporter itself writes only
the bundle.
