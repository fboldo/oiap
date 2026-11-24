---
title: install-agent-plugin
description: Build and install an OIAP plugin from source on the user's machine, for any target, local or global.
---

`install-agent-plugin` builds an OIAP plugin from source at install time and
writes it to the target's install path. Use it for hosts that read files from
the user's project (Cline, Windsurf, OpenCode), and to install any target into a
specific project or user directory.

Consumers need no separate JSON declaration file or prebuilt bundle: the
installer discovers exported `definePlugin(...)` declarations directly from
TypeScript and JavaScript source files.

## Usage

List the installable plugin declarations in a repository:

```sh
npx install-agent-plugin your-org/your-plugin --list
```

Install a plugin into the target's local (project) directory:

```sh
npx install-agent-plugin your-org/your-plugin --plugin review-guard --agent cline
```

Install into the target's global user directory:

```sh
npx install-agent-plugin your-org/your-plugin --plugin review-guard --agent codex --global
```

Pin to a branch, tag or commit:

```sh
npx install-agent-plugin your-org/your-plugin --ref v1.0.0 --plugin review-guard --agent claude-code
```

Install from a local checkout during development:

```sh
npx install-agent-plugin . --plugin review-guard --agent vscode-copilot-chat --overwrite
```

## Options

| Option | Description |
| --- | --- |
| `-l`, `--list` | List OIAP `definePlugin` declarations without loading them. |
| `-p`, `--plugin <name>` | Plugin manifest id/name, export name, or `path#export` selector. |
| `-a`, `--agent <target>` | Target agent exporter. Alias: `--target`. |
| `-g`, `--global` | Install to the target's user-level path. |
| `--local`, `--project` | Install to the target's local/project path (the default). |
| `-o`, `--out <dir>` | Write the bundle to this directory instead of the target install path. |
| `--ref <ref>` | Git branch or tag for `owner/repo` sources. |
| `--dry-run` | Resolve source, plugin and agent without loading or writing. |
| `--install-deps` | Always install source package dependencies before loading the plugin. |
| `--no-install-deps` | Do not install source or runtime dependencies. |
| `--allow-install-scripts` | Allow package manager lifecycle scripts while installing dependencies. |
| `--overwrite` | Replace an existing install or `--out` directory. |
| `--json` | Print machine-readable output. |

## Install paths

The installer takes local and global destinations from each target profile when
the target documents a stable install location; each
[target page](/oiap/targets/) lists them. Pass `--out <dir>` to materialize the
bundle somewhere explicit for review, CI or debugging.

Some targets define only part of that contract. `vscode-copilot-chat` installs
locally under `.github/plugins/<pluginId>` but defines no global path, and
GitHub Copilot CLI manages its own install directory; use `--out` for those.

## Dependencies

When the plugin repository has a `package.json`, the installer installs
dependencies before loading the selected declaration:

- For cloned repositories, this happens in the temporary checkout.
- For local checkouts, it runs only when `node_modules` is missing, unless you
  pass `--install-deps`.
- Lockfiles choose Bun, pnpm, Yarn or npm.
- Lifecycle scripts are ignored unless you pass `--allow-install-scripts`.
- `--no-install-deps` turns dependency installation off.

## Hooks

When the bundle contains the generated hook runtime, the installer bundles hook
handlers from the original plugin source. Hook code can use normal TypeScript or
JavaScript imports, top-level constants and local helpers; the generated
`.oiap/runtime/hooks.mjs` is rewritten as a self-contained Node ESM module.
Declare runtime hook dependencies in the plugin package's `dependencies` or
`optionalDependencies`. See [Hooks and the runtime](/oiap/guides/hooks/).

## Document it for your users

```sh
npx install-agent-plugin <owner>/<repo> --plugin <id> --agent <target>
```

To give users your own install command instead, see
[Your own installer CLI](/oiap/guides/own-installer/).
