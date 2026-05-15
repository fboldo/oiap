# @oiap/exporter-claude-code

Claude Code target exporter for Open Interoperable Agent Plugins.

This package lowers OIAP plugin primitives into a Claude Code plugin directory.
The generated bundle follows Claude's plugin layout: `.claude-plugin/plugin.json`
at the plugin root, with `skills/`, `commands/`, `agents/`, `hooks/hooks.json`,
`.mcp.json`, and `settings.json` as root-level plugin files when those surfaces
are present.

```ts
import { definePlugin, hook, allow } from "@oiap/core";
import { exportClaudeCode } from "@oiap/exporter-claude-code";

const plugin = definePlugin({
	manifest: {
		id: "hello-claude",
		name: "Hello Claude",
		version: "0.0.0",
		description: "Small Claude Code exporter smoke plugin.",
		categories: ["example"],
		supportedTargets: ["claude-code"],
	},
	hooks: [hook.beforeTool("allow-all", () => allow())],
});

const bundle = exportClaudeCode(plugin);
```

Most authors should use the CLI instead of importing the exporter directly:

```sh
bun run oiap build ./oiap.plugin.ts --target claude-code --out ./build/claude
```

The exporter renders valid Claude hook configuration that calls the generated
`.oiap/runtime/runner.mjs` raw-JS hook runtime. Portable function handlers are
bundled into `.oiap/runtime/hooks.mjs`; non-portable target-module hooks are
reported as degraded metadata.