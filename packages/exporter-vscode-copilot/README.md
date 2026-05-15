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

Copilot-format plugins do not currently define an official plugin-root token for
hook commands. The exporter therefore emits generated hook runtime files under
`.oiap/runtime/` and references them with plugin-relative paths in `hooks.json`,
while reporting the hook path behavior as degraded in the capability report.
