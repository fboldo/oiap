# install-agent-plugin

Executable CLI for discovering OIAP plugin declarations in a repository.

```sh
npx install-agent-plugin owner/repo --list
npx install-agent-plugin owner/repo --plugin review-guard --agent claude-code
npx install-agent-plugin owner/repo --plugin review-guard --agent claude-code --global
```

The CLI discovers `definePlugin(...)` calls directly from TypeScript and
JavaScript source files through `@oiap/core`; it does not require a separate JSON
declaration file.

Before loading the selected plugin declaration, the installer installs source
dependencies when it clones a repository or when a local checkout has a
`package.json` but no `node_modules`. Lockfiles are used to choose Bun, pnpm,
Yarn, or npm; lifecycle scripts are ignored unless you pass
`--allow-install-scripts`. Use `--no-install-deps` to disable dependency
installation.

When the exported bundle contains the generated OIAP hook runtime, the installer
bundles hook handler modules from the original plugin source. Hook code can use
normal TypeScript or JavaScript imports, top-level constants, and local helpers;
the generated `.oiap/runtime/hooks.mjs` is rewritten as a self-contained Node ESM
module for the selected plugin.

This package does not expose a library API. If you want to provide the
installation of the plugin using your own CLI, import `installPlugin()` from
`@oiap/core`, shape the CLI however you want, and pass the selected plugin
declaration and target id to that function:

```ts
#!/usr/bin/env node
import { installPlugin } from "@oiap/core";
import plugin from "./oiap.plugin";

await installPlugin({
	plugin,
	target: "codex",
	scope: process.argv.includes("--global") ? "global" : "local",
	overwrite: true,
});
```

If your own CLI only supports a subset of targets, include the exporter packages
for those targets in that CLI package's runtime dependencies.

The default scope is local/project installation. Use `--global` for the target's
user-level path. Install paths are inherited from the selected target profile.
Pass `--out <dir>` only when you want to materialize a bundle in an explicit
directory for review, CI, or debugging.