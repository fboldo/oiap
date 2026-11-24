# @oiap/exporter-vscode-copilot

VS Code Copilot agent plugin exporter for Open Interoperable Agent Plugins.

This package lowers OIAP plugin primitives into the VS Code Copilot agent plugin
layout documented for Copilot-format plugins:

```text
plugin.json
commands/<command>.prompt.md
skills/<skill>/SKILL.md
agents/<agent>.agent.md
hooks.json
.mcp.json
```

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target vscode-copilot-chat --out ./build/vscode-copilot
```

The exporter emits root `plugin.json` metadata, prompt files for slash commands,
Agent Skills folders, custom agent files, root `hooks.json`, and root `.mcp.json`
where the source plugin defines those surfaces.

Copilot-format plugins expand `${PLUGIN_ROOT}` in hook commands and MCP
configuration ([agent plugin reference](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference)).
The exporter emits generated hook runtime files under `.oiap/runtime/` and
references them through `${PLUGIN_ROOT}` in `hooks.json`, because hooks run
from the workspace, not the plugin directory.
