---
title: CLI reference
description: oiap build, oiap sync and oiap targets, with every flag.
---

The `@oiap/cli` package installs the `oiap` binary.

```sh
npm install --save-dev @oiap/cli @oiap/core
npx oiap --help
```

```text
oiap build <plugin-file> [--target all|<target>] [--out <dir>] [--export <name>] [--json]
oiap sync [plugin-file] [--check] [--layout root|plugins] [--target <targets>] [--repo <dir>] [--force] [--json]
oiap targets [--json]
```

Every command accepts `-h` or `--help`. Options take a value as the next
argument or inline (`--target=codex`).

## `oiap build`

Builds target bundles from an OIAP plugin file.

```sh
npx oiap build oiap.plugin.ts --target claude-code --out dist/claude-code
npx oiap build oiap.plugin.ts --out dist/oiap
```

| Option | Description |
| --- | --- |
| `-t`, `--target <target>` | Target to build. Defaults to `all`. |
| `-o`, `--out <dir>` | Output directory. Defaults to `dist/oiap`. |
| `-e`, `--export <name>` | Plugin export name. Defaults to `default`, then `plugin`. |
| `--json` | Print a machine-readable build summary. |

- With `--target all`, each target goes to `<out>/<target>`. With one target,
  the bundle goes to `<out>` itself.
- The output directory is cleaned before each build so stale files cannot
  remain. It must be inside the current directory and cannot be the current
  directory itself.
- The command writes bundle files only; it does not install them into a host.
- Exits with status 1 when any target's report status is `unsupported`.

## `oiap sync`

Writes the files that git-installed hosts read into the repository, plus their
marketplace catalogs and `.oiap/sync.json`. Commit the result. See
[Ship with oiap sync](/oiap/guides/oiap-sync/).

```sh
npx oiap sync
npx oiap sync --check
npx oiap sync --layout plugins
npx oiap sync --target claude-code,codex
```

| Option | Description |
| --- | --- |
| `[plugin-file]` | Plugin file. Defaults to `oiap.plugin.ts`. |
| `--check` | Write nothing; exit 1 if the committed files are out of date. |
| `--layout <layout>` | `root` (default): hosts share the root where they can. `plugins`: hosts that support it go under `plugins/<target>/`. |
| `-t`, `--target <list>` | Comma-separated targets. Defaults to the manifest's `supportedTargets`. Can be repeated. |
| `--repo <dir>` | Repository directory. Defaults to the current directory. |
| `--force` | Overwrite files that a previous sync did not write. |
| `-e`, `--export <name>` | Plugin export name. Defaults to `default`, then `plugin`. |
| `--json` | Print a machine-readable summary (`placements`, `notes`, `errors`, `differences`, `written`, `removed`). |

Sync writes Gemini CLI, Antigravity, OpenClaw, Claude Code, Codex, Cursor,
GitHub Copilot CLI and VS Code Copilot. Other targets install into a project;
use [install-agent-plugin](/oiap/guides/install-agent-plugin/) for them.

Exits with status 1 when sync reports an error, when a target is
`unsupported`, or, with `--check`, when files are out of date.

## `oiap targets`

Lists registered exporter targets and their packages.

```sh
npx oiap targets
npx oiap targets --json
```

| Option | Description |
| --- | --- |
| `--json` | Print `{ "targets": [...] }`. |

See [Targets](/oiap/targets/) for every target id.

## Inside this repository

Contributors run the CLI from source:

```sh
bun run oiap targets
bun run oiap build examples/security-guidance/oiap.plugin.ts --target claude-code --out dist/dev/security-guidance
```

## Related

- [`install-agent-plugin`](/oiap/guides/install-agent-plugin/) options.
- [`@oiap/cli` package README](/oiap/reference/packages/cli/).
