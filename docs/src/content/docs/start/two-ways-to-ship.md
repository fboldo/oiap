---
title: Two ways to ship a plugin
description: Commit host files with oiap sync, or build at install time with install-agent-plugin. Most plugins use both.
---

You write the plugin once in `oiap.plugin.ts`. How users get it depends on the
host.

| | Commit host files with `oiap sync` | Build at install time with `install-agent-plugin` |
| --- | --- | --- |
| How it works | You run `oiap sync` and commit the generated host files; the [OIAP GitHub Action](/oiap/guides/github-action/) fails pull requests when they are out of date. | Users run `npx install-agent-plugin owner/repo --agent <target>`, which builds the bundle from your source on their machine. You can also wrap it in your own CLI with `installPlugin()`. |
| Users install with | Each host's own command: `claude plugin marketplace add owner/repo`, `codex plugin marketplace add`, `copilot plugin marketplace add`, `gemini extensions install`, `agy plugin install` | `install-agent-plugin`, or your CLI |
| Updates | The host's own update, from your default branch | Users run the installer again |
| Best for | Hosts that install from git: Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot CLI, VS Code Copilot, Antigravity, OpenClaw | Hosts that read files from the user's project: Cline, Windsurf, OpenCode; installing into a specific project or user directory |

Most plugins use both: commit synced files so each host's native install works,
and document `install-agent-plugin` for project-local hosts.

## 1. Commit host files with `oiap sync`

Most agent hosts install plugins straight from a git repository and read their
own manifest and component files from the default branch. `oiap sync` generates
those files from your definition, the same way a lockfile or generated client is
committed next to its source.

```sh
npx oiap sync            # reads oiap.plugin.ts, writes host files; commit the result
npx oiap sync --check    # CI: exit 1 if the committed files are out of date
```

Then check every pull request with the GitHub Action:

```yaml
- uses: fboldo/oiap@v0.4.0
  with:
    plugin: oiap.plugin.ts
```

Read more: [Ship with `oiap sync`](/oiap/guides/oiap-sync/),
[GitHub Action](/oiap/guides/github-action/).

## 2. Build at install time with `install-agent-plugin`

Cline, Windsurf, OpenCode and other hosts that read files from the user's
project do not install from git. `install-agent-plugin` discovers the
`definePlugin(...)` declarations in your repository, builds the selected one for
the requested target on the user's machine, and writes it to the target's
install path.

```sh
npx install-agent-plugin your-org/your-plugin --list
npx install-agent-plugin your-org/your-plugin --plugin review-guard --agent cline
```

It works for every target, so it is also the way to install into a specific
project or user directory.

Read more: [install-agent-plugin](/oiap/guides/install-agent-plugin/),
[Your own installer CLI](/oiap/guides/own-installer/).

## Checklist for plugin authors

1. Export a `definePlugin(...)` declaration from `oiap.plugin.ts`.
2. Keep the manifest `id`, `version`, `author` and `supportedTargets` accurate.
   Bump `version` when you release: Codex, Antigravity, and Claude Code (when
   the manifest has a version) only update installed plugins when it changes.
3. Run `oiap sync` and commit the generated files; add the OIAP GitHub Action
   so pull requests fail when they are out of date.
4. Document each host's install command, and
   `npx install-agent-plugin <owner>/<repo> --plugin <id> --agent <target>` for
   project-local hosts.
