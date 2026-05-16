# @oiap/exporter-antigravity

Google Antigravity exporter for Open Interoperable Agent Plugins.

The exporter renders reviewable Antigravity workspace bundle artifacts:

- `.agents/rules/` workspace rules.
- `.agents/skills/` Agent Skills.
- `.agents/workflows/` workflow markdown for slash-invoked commands.
- `mcp_config.json` using Antigravity's documented `mcpServers` shape.
- `.oiap/` source maps, capability reports, hook/custom-agent metadata, and
  policy fragments.

The output is a bundle artifact only. It does not write to `~/.gemini`, mutate
Antigravity settings, or install MCP servers.