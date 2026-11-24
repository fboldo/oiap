---
name: create-plugin
description: Use this skill when the user needs to write, scaffold, or improve an OIAP agent plugin in TypeScript, create an oiap.plugin.ts file, define commands, instructions, skills, hooks, agents, or policies, or build target bundles with the OIAP CLI.
---

# Create OIAP Plugin

Use this skill when the user needs to write an agent plugin in TypeScript using
OIAP.

OIAP lets plugin authors define a plugin once and export host-native bundles for
multiple agent platforms. Treat OIAP as an external SDK and CLI unless the user
is explicitly working inside the OIAP source repository.

## First Response

Start by identifying the plugin shape the user wants:

- What should the plugin help an agent do?
- Which targets matter first, such as `claude-code`, `codex`, `cursor`,
  `openclaw`, `vscode-copilot-chat`, or `antigravity`?
- Does the plugin need commands, always-on instructions, skills, hooks, agents,
  MCP tools, executable recipes, or policies?
- How will users install it: with each host's own git install (commit host
  files with `oiap sync`), with `install-agent-plugin`, or both? See
  [Ship the Plugin](#ship-the-plugin).

If the request is already clear, do not over-interview. Scaffold the smallest
useful plugin and explain where to extend it.

## Install OIAP

For normal plugin projects, use the published OIAP CLI and SDK.

Use the existing project package manager in commands and examples. If the
project already uses `bun`, `pnpm`, `yarn`, or `npm`, follow that choice
instead of switching tools. Only fall back to `npm` when the project has no
clear package manager yet.

Install the OIAP packages with that package manager. For example:

```sh
# npm
npm install --save-dev @oiap/cli @oiap/core

# pnpm
pnpm add -D @oiap/cli @oiap/core

# yarn
yarn add --dev @oiap/cli @oiap/core

# bun
bun add --dev @oiap/cli @oiap/core
```

Use `npx oiap` in examples and instructions:

```sh
npx oiap targets
npx oiap build oiap.plugin.ts --target claude-code --out dist/claude-code
npx oiap build oiap.plugin.ts --out dist/oiap
```

Do not tell users to clone the OIAP repository unless they are contributing to
OIAP itself.

## Authoring Rules

- Create an `oiap.plugin.ts` file that exports `definePlugin(...)` as the
  default export.
- Import from `@oiap/core`; avoid repository-relative imports.
- Put larger prompts and agent instructions in Markdown files and load them with
  `markdownFile("path.md", { baseUrl: import.meta.url })`.
- Keep target-specific overrides small. Prefer portable primitives first.
- Declare `supportedTargets` honestly. Use only targets the user wants to build
  or verify.
- Include policies when hooks, tools, scripts, network access, file writes,
  secrets, or destructive actions are involved.
- Build target bundles into `dist/` for review. Don't commit `dist/`; commit the
  files `oiap sync` writes instead.

## Project Shape

Use this default layout for a new plugin:

```text
my-plugin/
  package.json
  tsconfig.json
  oiap.plugin.ts
  prompts/
    command.md
```

Add only the folders needed by the plugin:

```text
agents/       Custom agent instruction Markdown
prompts/      Command, skill, workflow, and safety prompts
schemas/      JSON schemas for invocation or tool arguments
recipes/      Executable command recipe source files
policies/     Permission and safety policy helpers
```

## Workflow

1. Decide the plugin intent and target platforms.
2. Choose the smallest primitive set that represents the behavior.
3. Create or update `package.json`, `tsconfig.json`, `oiap.plugin.ts`, and any
   prompt Markdown files.
4. Run `npx oiap targets` so the user can see available exporters.
5. Build at least one requested target with `npx oiap build`.
6. Review generated capability reports and mention any degraded or unsupported
   capabilities.
7. Set up shipping: run `npx oiap sync` and add the GitHub Action, document
   `install-agent-plugin` for project-local hosts, or both.

## Ship the Plugin

OIAP supports two ways to get a plugin to users. Most plugins use both.

1. **Commit host files with `oiap sync`.** For hosts that install from git
   (Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot CLI, VS Code
   Copilot, Antigravity, OpenClaw). Run `npx oiap sync`, commit the generated
   files and `.oiap/sync.json`, and add a pull-request workflow that uses the
   OIAP GitHub Action (`uses: fboldo/oiap@<version>`), which runs
   `oiap sync --check`. Users then install with each host's own command, such as
   `claude plugin marketplace add owner/repo`.
2. **Build at install time with `install-agent-plugin`.** For hosts that read
   files from the user's project (Cline, Windsurf, OpenCode), or to install into
   a specific project or user directory. Document
   `npx install-agent-plugin owner/repo --plugin <id> --agent <target>`. To offer
   your own install command, call `installPlugin()` from `@oiap/core` in a small
   CLI.

Bump `manifest.version` on each release: several hosts only update installed
plugins when it changes.

## Primitive Selection

Use this mapping when deciding what to create:

| User need | OIAP primitive |
| --- | --- |
| Slash command or named action | `invocations`, `instructions`, `commands` |
| Reusable prompt bundle | `instructions`, `skills` |
| Always-on repository guidance | `rules` or always-on `instructions` |
| Pre/post lifecycle behavior | `hooks` |
| Specialized worker persona | `agents` plus agent instructions |
| External tools or MCP server | `tools` |
| Scripted shell operation | `recipes` and `runtimeModules` when needed |
| Permissions or safety posture | `policies` |

## References

Read [references/plugin-patterns.md](references/plugin-patterns.md) when you need
copyable OIAP examples for command plugins, hook plugins, agent plugins, or
policies.

## Output Style

When you create files, summarize:

- The plugin behavior.
- The primitives used.
- The build command to generate bundles.
- Any target-specific limitations or policies the user should review.

Keep explanations focused on the user's plugin, not on OIAP internals.