# @oiap/exporter-openclaw

OpenClaw target exporter for Open Interoperable Agent Plugins.

This package lowers OIAP primitives into a native OpenClaw plugin package. The
generated bundle uses OpenClaw's documented native plugin surfaces where OIAP can
describe them safely:

```text
package.json
openclaw.plugin.json
index.ts
skills/<skill>/SKILL.md
```

The exporter also emits `.openclaw/` evidence files for MCP and policy metadata
that OpenClaw does not load directly from a native plugin today, and `.oiap/`
source maps and capability reports.

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target openclaw --out ./build/openclaw
```

The generated `index.ts` registers OpenClaw hooks that call
`.oiap/runtime/runner.mjs`. Portable function handlers are bundled into
`.oiap/runtime/hooks.mjs`; tool handlers still use placeholders until OIAP tool
runtime generation exists.