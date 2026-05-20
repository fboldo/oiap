# @oiap/cli

Command-line tooling for building Open Interoperable Agent Plugin bundles from a
plugin definition file.

```sh
bun run oiap build ./oiap.plugin.ts
```

By default, the CLI builds every registered target into `dist/oiap/<target>`. The
current registered targets are Antigravity, Claude Code, Cline, Codex, Cursor,
Gemini CLI, OpenClaw, OpenCode, and VS Code Copilot.

The target output directory is cleaned before each build so stale files from an
older exporter run cannot remain in the generated plugin.

```sh
bun run oiap build ./oiap.plugin.ts --target antigravity --out ./build/antigravity
bun run oiap build ./oiap.plugin.ts --target claude-code --out ./build/claude
bun run oiap build ./oiap.plugin.ts --target cline --out ./build/cline
bun run oiap build ./oiap.plugin.ts --target codex --out ./build/codex
bun run oiap build ./oiap.plugin.ts --target cursor --out ./build/cursor
bun run oiap build ./oiap.plugin.ts --target gemini-cli --out ./build/gemini-cli
bun run oiap build ./oiap.plugin.ts --target openclaw --out ./build/openclaw
bun run oiap build ./oiap.plugin.ts --target opencode --out ./build/opencode
bun run oiap build ./oiap.plugin.ts --target vscode-copilot-chat --out ./build/vscode-copilot
```

Plugin files can export the plugin as `default` or as a named `plugin` export.
Use `--export <name>` to choose another export.

```ts
import { allow, definePlugin, hook } from "@oiap/core";

export default definePlugin({
	manifest: {
		id: "hello-claude",
		name: "Hello Claude",
		version: "0.0.0",
		description: "Small CLI build smoke plugin.",
		categories: ["example"],
		supportedTargets: ["claude-code"],
	},
	hooks: [hook.beforeTool("allow-all", () => allow())],
});
```

The CLI writes generated bundle files only. It does not install the bundle into a
host application.