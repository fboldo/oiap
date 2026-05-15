# @oiap/exporter-codex

Codex target exporter for Open Interoperable Agent Plugins.

This package lowers OIAP plugin primitives into Codex-compatible plugin and
project-configuration files. The generated bundle uses the documented Codex
plugin layout where possible:

```text
.codex-plugin/plugin.json
skills/<skill>/SKILL.md
hooks/hooks.json
.mcp.json
```

Codex also has project-scoped surfaces that are not part of the plugin manifest,
so the exporter can emit companion files such as `AGENTS.md`, `.codex/agents/*.toml`,
and `.codex/rules/*.rules` when the OIAP plugin defines those surfaces.

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target codex --out ./build/codex
```

The exporter renders Codex command-hook configuration that calls the generated
`.oiap/runtime/runner.mjs` raw-JS hook runtime. Portable function handlers are
bundled into `.oiap/runtime/hooks.mjs`; unsupported lifecycle events and
non-portable target-module hooks are reported as degraded metadata.