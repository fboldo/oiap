# @oiap/exporter-opencode

OpenCode target exporter for Open Interoperable Agent Plugins.

The exporter renders project-local OpenCode configuration and companion assets:

- `opencode.json` for schema, instruction references, MCP servers, and permissions.
- `AGENTS.md` and `.opencode/instructions/` for project rules.
- `.opencode/skills/` for native Agent Skills.
- `.opencode/commands/` for slash command prompt templates.
- `.opencode/agents/` for custom primary/subagent prompt files.
- `.opencode/plugins/oiap-hooks.js` for plugin hooks backed by the OIAP generated runtime.

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target opencode --out ./build/opencode
```

The output is a bundle artifact only. It does not install files into a user's
global OpenCode config directory or enable host-managed settings.