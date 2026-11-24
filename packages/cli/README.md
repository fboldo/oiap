# @oiap/cli

Command-line tooling for building Open Interoperable Agent Plugin bundles from a
plugin definition file.

```sh
bun run oiap build ./oiap.plugin.ts
```

By default, the CLI builds every registered target into `dist/oiap/<target>`. The
current registered targets are Antigravity, Claude Code, Cline, Codex, Cursor,
Gemini CLI, GitHub Copilot CLI, OpenClaw, OpenCode, VS Code Copilot, and
Windsurf.

The target output directory is cleaned before each build so stale files from an
older exporter run cannot remain in the generated plugin.

```sh
bun run oiap build ./oiap.plugin.ts --target antigravity --out ./build/antigravity
bun run oiap build ./oiap.plugin.ts --target claude-code --out ./build/claude
bun run oiap build ./oiap.plugin.ts --target cline --out ./build/cline
bun run oiap build ./oiap.plugin.ts --target codex --out ./build/codex
bun run oiap build ./oiap.plugin.ts --target cursor --out ./build/cursor
bun run oiap build ./oiap.plugin.ts --target gemini-cli --out ./build/gemini-cli
bun run oiap build ./oiap.plugin.ts --target github-copilot-cli --out ./build/github-copilot-cli
bun run oiap build ./oiap.plugin.ts --target openclaw --out ./build/openclaw
bun run oiap build ./oiap.plugin.ts --target opencode --out ./build/opencode
bun run oiap build ./oiap.plugin.ts --target vscode-copilot-chat --out ./build/vscode-copilot
bun run oiap build ./oiap.plugin.ts --target windsurf --out ./build/windsurf
```

## Sync a plugin repository

`oiap sync` writes the files that git-installed hosts read into the current
repository, so users can install the plugin with each host's own command. Commit
the result, and run `oiap sync --check` in CI (or the OIAP GitHub Action) to fail
when the committed files no longer match the definition.

```sh
bun run oiap sync                       # oiap.plugin.ts -> host files at the repository root
bun run oiap sync --check               # exit 1 when files are missing, changed, or stale
bun run oiap sync --layout plugins      # movable hosts under plugins/<target>/
bun run oiap sync --target claude-code,codex
```

Hosts that only install the repository root (Gemini CLI, Antigravity) always go
at the root. Other hosts share the root unless one host would load another
host's files or a file would overwrite one you wrote, in which case they move to
`plugins/<target>/`.
`.oiap/sync.json` records the generated files so later syncs remove stale ones;
files that a previous sync did not write are never overwritten without
`--force`.

## Build options

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