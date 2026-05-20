# Discovery Installer CLI

This example shows what to do if you want to provide the installation of the
plugin using your own CLI, without maintaining a separate JSON declaration file.

The repository contains a normal OIAP source declaration in `oiap.plugin.ts` and
a plugin-owned CLI in `install.ts`. The CLI imports the plugin declaration,
maps its own target shortcuts, and calls `installPlugin()` from `@oiap/core`.

The author-owned CLI can stay small:

```ts
import { installPlugin } from "@oiap/core";
import plugin from "./oiap.plugin";

await installPlugin({
   plugin,
   target: "codex",
   scope: "local",
   overwrite: true,
});
```

Install with the default Codex target shortcut:

```sh
bun examples/discovery-installer-cli/install.ts --overwrite
```

Install to the target's global user path:

```sh
bun examples/discovery-installer-cli/install.ts --global --overwrite
```

Install with an explicit target shortcut:

```sh
bun examples/discovery-installer-cli/install.ts vscode --overwrite
```

The default install path comes from the target's local/project install path. Pass
`--out <dir>` only when you want to materialize the bundle somewhere explicit for
review or debugging.

The important pattern is:

1. Import the plugin declaration from `oiap.plugin.ts`.
2. Parse CLI arguments in whatever shape fits your project.
3. Resolve any target shortcuts to OIAP target ids.
4. Pass the plugin, target id, scope, and overwrite flag to `installPlugin()`.