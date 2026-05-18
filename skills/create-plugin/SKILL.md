---
name: create-plugin
description: Create Open Interoperable Agent Plugin (OIAP) projects and plugin definitions. Use this skill whenever the user wants to create, scaffold, design, or improve an OIAP plugin, write an oiap.plugin.ts file, define commands, instructions, skills, hooks, agents, policies, or build target bundles with the npm-published OIAP CLI.
---

# Create OIAP Plugin

Use this skill to help users create OIAP plugins that can be authored once and
exported into host-native bundles for multiple agent platforms.

This skill is intended for agents installed with `npx skills`. It is not a
repository-local customization. Treat OIAP as an external SDK and CLI unless the
user is explicitly working inside the OIAP source repository.

## First Response

Start by identifying the plugin shape the user wants:

- What should the plugin help an agent do?
- Which targets matter first, such as `claude-code`, `codex`, `cursor`,
  `openclaw`, `vscode-copilot-chat`, or `antigravity`?
- Does the plugin need commands, always-on instructions, skills, hooks, agents,
  MCP tools, executable recipes, or policies?
- Should generated bundles be committed, published, or only built locally for
  review?

If the request is already clear, do not over-interview. Scaffold the smallest
useful plugin and explain where to extend it.

## Install OIAP

For normal plugin projects, use the npm-published Node CLI and SDK:

```sh
npm install --save-dev @oiap/cli @oiap/core
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
- Build target bundles into `dist/` and tell the user that OIAP generates
  artifacts; installing those artifacts into a host is handled by the host or the
  user's own workflow.

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