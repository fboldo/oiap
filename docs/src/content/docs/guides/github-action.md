---
title: GitHub Action
description: Fail pull requests when the files committed by oiap sync no longer match the plugin definition.
---

The OIAP GitHub Action (`fboldo/oiap`) checks that the files committed by
[`oiap sync`](/oiap/guides/oiap-sync/) match your plugin definition, and that
every target can be exported. It installs your dependencies, runs
`oiap sync --check`, annotates degraded or unsupported targets, and writes a
summary to the job. It never commits.

```yaml
# .github/workflows/plugin.yml
name: Plugin
on: [pull_request]
jobs:
  oiap:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: fboldo/oiap@v0.4.0
        with:
          plugin: oiap.plugin.ts
```

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `plugin` | `oiap.plugin.ts` | Path to the OIAP plugin file, relative to `working-directory`. |
| `layout` | `root` | Repository layout used by `oiap sync`: `root` or `plugins`. |
| `targets` | `""` | Comma-separated targets. Defaults to the manifest's `supportedTargets`. |
| `working-directory` | `.` | Repository directory that holds the plugin file and its generated files. |
| `oiap-version` | `""` | `@oiap/cli` version. Defaults to the version matching the action's tag (`vX.Y.Z`), or `latest` when the action is not used from a release tag. |
| `install-dependencies` | `"true"` | Run `bun install` first when the directory has a `package.json`. |

Use the same `layout` and `targets` you pass to `oiap sync` locally.

## What it does

1. Sets up Bun.
2. Runs `bun install` in `working-directory` when it has a `package.json` and
   `install-dependencies` is `true`.
3. Runs `bunx @oiap/cli@<version> sync <plugin> --check --layout <layout> --json`.
4. Writes a job summary with one row per target (location and status), and
   emits annotations: an error or warning for each target issue, and an error
   when generated files are out of date.
5. Fails the step when `oiap sync --check` fails.

When the check fails, run `oiap sync` locally and commit the result.
