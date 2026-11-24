---
title: Your own installer CLI
description: Give users your own install command by calling installPlugin() from @oiap/core.
---

`install-agent-plugin` has no library API. To ship your own install command,
import `installPlugin()` from `@oiap/core`, shape the CLI however you want, and
pass it the plugin declaration and a target id.

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

## Options

| Option | Description |
| --- | --- |
| `plugin` | The plugin definition, or a function that returns it (sync or async). |
| `target` | A built-in target id, or a custom target object with `id`, `profile` and `exportBundle`. |
| `scope` | `"local"` (project) or `"global"` (user). Paths come from the target profile. |
| `outDir` | Write the bundle here instead of the profile's install path. |
| `overwrite` | Replace an existing directory. Without it, an existing directory is an error. |
| `cwd`, `homeDir` | Base directories for local and global paths. |

It returns the target, scope, output directory, written files and the
[capability report](/oiap/guides/capability-reports/).

## Exporter packages

Core resolves a built-in target id by dynamically loading the matching exporter
package (for example `@oiap/exporter-codex`). Add the exporter packages for the
targets your CLI supports to its runtime `dependencies`.

## The pattern

1. Import the plugin declaration from `oiap.plugin.ts`.
2. Parse CLI arguments in whatever shape fits your project.
3. Resolve any target shortcuts to OIAP target ids.
4. Pass the plugin, target id, scope and overwrite flag to `installPlugin()`.

The [discovery-installer-cli example](/oiap/examples/discovery-installer-cli/)
implements this with `node:util` `parseArgs`, target shortcuts such as
`claude` and `vscode`, and `--global`, `--out` and `--overwrite` flags.

## Discovering declarations

To find plugins in a directory without executing them, as
`install-agent-plugin --list` does, use `discoverPluginDeclarations()`:

```ts
import { discoverPluginDeclarations } from "@oiap/core";

const declarations = await discoverPluginDeclarations(".");
```

Discovery scans TypeScript and JavaScript source files for `definePlugin(...)`
calls imported from `@oiap/core`, extracts static manifest fields when possible,
and reports dynamic manifest metadata as partial instead of executing plugin
code.
