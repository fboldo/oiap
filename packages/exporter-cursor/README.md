# @oiap/exporter-cursor

Cursor plugin exporter for Open Interoperable Agent Plugins.

The exporter renders a Cursor plugin directory with a required
`.cursor-plugin/plugin.json` manifest plus native Cursor component folders:

- `rules/` for `.mdc` rules.
- `skills/` for Agent Skills.
- `agents/` for custom agent prompts.
- `commands/` for agent-executable commands.
- `hooks/hooks.json` for command hooks backed by the OIAP generated runtime.
- `mcp.json` for MCP server definitions.

The output is a bundle artifact only. It does not install the plugin into a
Cursor profile, marketplace, or project.