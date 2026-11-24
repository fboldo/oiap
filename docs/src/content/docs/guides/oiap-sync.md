---
title: Ship with oiap sync
description: Generate and commit the files that git-installed hosts read, so users install your plugin with each host's own command.
---

Most agent hosts install plugins straight from a git repository:

```sh
claude plugin marketplace add owner/repo
codex plugin marketplace add owner/repo
copilot plugin marketplace add owner/repo
gemini extensions install <url>
agy plugin install <url>
```

They read their own manifest and component files from the default branch, so
those files have to be committed there. `oiap sync` generates them from your
OIAP definition, the same way a lockfile or generated client is committed next
to its source.

```sh
bunx @oiap/cli sync            # reads oiap.plugin.ts, writes host files, commit the result
bunx @oiap/cli sync --check    # CI: exit 1 if the committed files are out of date
```

With `@oiap/cli` installed in the project, `npx oiap sync` does the same.

## Which targets

`oiap sync` writes every target in the manifest's `supportedTargets` that
installs from git: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot CLI,
VS Code Copilot, OpenClaw and Antigravity. Pass `--target` to choose a subset:

```sh
npx oiap sync --target claude-code,codex
```

Cline, Windsurf and OpenCode install into a project; ship them with
[install-agent-plugin](/oiap/guides/install-agent-plugin/).

## Use the skills you already have

Most plugin repositories keep their skills in one folder that every host reads.
Point OIAP at it instead of rewriting the skills:

```ts
import { definePlugin, skillsFrom } from "@oiap/core";

export default definePlugin({
	manifest: {
		id: "my-skills",
		name: "My Skills",
		version: "1.2.0",
		description: "Skills for my team.",
		categories: ["productivity"],
		supportedTargets: ["claude-code", "codex", "cursor", "gemini-cli"],
	},
	skills: skillsFrom("skills"),
});
```

Each `skills/<name>/SKILL.md` stays exactly as you wrote it, frontmatter
included. `oiap sync` writes only the host manifests and catalogs around it,
never rewrites or deletes your skill files, and lets every host that reads the
root `skills/` share them.

## Layout

- Hosts that only install the repository root (Gemini CLI, Antigravity) go at
  the root and share files such as `skills/` when their copies match.
- Other hosts share the root when no host would load another host's files and
  none of their files would overwrite one you wrote, and move to
  `plugins/<target>/` otherwise. `--layout plugins` always uses
  `plugins/<target>/` for them.

```sh
npx oiap sync --layout plugins
```

## What it writes

- Each host's plugin files.
- The marketplace catalogs that point each host at its plugin:
  `.claude-plugin/marketplace.json`, `.agents/plugins/marketplace.json`,
  `.cursor-plugin/marketplace.json`, `.github/plugin/marketplace.json`.
- `.oiap/sync.json`, which records the generated files so later syncs remove
  stale ones.

It never overwrites a file it did not write unless you pass `--force`, and it
leaves your `README.md` alone. Versions come from `manifest.version`, so every
host manifest stays in lockstep.

## Caveats

- **OpenClaw** needs its own `package.json` and entry file. When your
  repository already has a `package.json`, OpenClaw moves to
  `plugins/openclaw/`; its `git:` install only reads the repository root, so
  users install it from a checkout or a published package instead.
- **Gemini CLI** installs the latest GitHub Release instead of the default
  branch when a repository has releases. Keep releases off a plugin repository
  that targets Gemini CLI, or attach the full tree to them.
- **Updates**: bump `manifest.version` when you release. Codex, Antigravity, and
  Claude Code (when the manifest has a version) only update installed plugins
  when it changes.

## Output

`oiap sync` prints one line per target with its location and status, then any
issues:

```text
claude-code: repository root (ok)
```

With `--check`, it writes nothing and lists missing, changed or stale files:

```text
Generated plugin files are out of date. Run `oiap sync` and commit the result:
```

It exits with status 1 when a target is unsupported, when sync hits an error,
or, with `--check`, when files are out of date. `--json` prints a
machine-readable summary.

## Keep it in sync in CI

Add the [OIAP GitHub Action](/oiap/guides/github-action/) to run
`oiap sync --check` on every pull request.

All flags: [CLI reference](/oiap/reference/cli/#oiap-sync).
