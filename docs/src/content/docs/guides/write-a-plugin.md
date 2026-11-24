---
title: Write a plugin
description: The oiap.plugin.ts file, the manifest, and the primitives for skills, commands, rules, agents, hooks, MCP tools and policies.
---

An OIAP plugin is a normal TypeScript module that exports a `definePlugin(...)`
definition from [`@oiap/core`](/oiap/reference/packages/core/). The CLI loads
it and asks each exporter to render host-specific files.

```ts
import type { PluginDefinition } from "@oiap/core";
import { definePlugin } from "@oiap/core";

export default definePlugin({
	manifest: { /* identity and targets */ },
	// invocations, instructions, commands, skills, rules, agents,
	// hooks, tools, policies, resources, ...
} satisfies PluginDefinition);
```

The CLI reads the `default` export, then a named `plugin` export. Pass
`--export <name>` to pick another.

## Project layout

```text
my-plugin/
  package.json
  tsconfig.json
  oiap.plugin.ts
  prompts/      command, skill, workflow and safety prompts
  agents/       custom agent instructions
```

Add only the folders the plugin needs.

## Primitives at a glance

| You want | Use |
| --- | --- |
| A slash command or named action | `invocations`, `instructions`, `commands` |
| A reusable prompt bundle | `instructions`, `skills` |
| Always-on repository guidance | `instructions` with `purpose: "always_on"`, or target-specific `rules` |
| Pre/post lifecycle behavior | `hooks` |
| A specialized worker persona | `agents` plus agent instructions |
| External tools or an MCP server | `tools` |
| A permissions or safety posture | `policies` |
| Files that skills and agents read | `SkillAsset.files`, `resources` |

The full type definitions are in the [Architecture](/oiap/reference/architecture/#primitive-model)
page and in `@oiap/core`.

## Manifest

```ts
manifest: {
	id: "review-guard",
	name: "Review Guard",
	version: "1.0.0",
	description: "Adds a portable review command for agent-assisted code review.",
	license: "MIT",
	author: { name: "Your Name", url: "https://example.com" },
	repository: "https://github.com/your-org/review-guard",
	categories: ["review", "quality", "commands"],
	supportedTargets: ["claude-code", "codex", "vscode-copilot-chat"],
},
```

- `id` names the plugin in every host and is what users pass to
  `install-agent-plugin --plugin`.
- `version` is written into every host manifest. Bump it when you release:
  Codex, Antigravity, and Claude Code (when the manifest has a version) only
  update installed plugins when it changes.
- `supportedTargets` is the set `oiap sync` writes by default. List only the
  targets you build and check.
- `author` and `repository` are used for marketplace owners and manifest
  authors.

## Instructions

An instruction module is reusable prose with metadata. Commands, skills and
agents reference instructions by id; they don't hold prose themselves.

```ts
import { markdownFile } from "@oiap/core";

instructions: [
	{
		id: "review-guard-prompt",
		purpose: "command", // "command" | "always_on" | "workflow" | "safety" | "agent"
		triggers: ["review", "code review"],
		body: markdownFile("prompts/review.md", { baseUrl: import.meta.url }),
	},
],
```

`markdownFile()` reads a Markdown file relative to the calling module, so long
prompts stay out of template strings. Instructions that no command, skill or
agent references and whose purpose is `always_on`, `safety` or `workflow` are
standalone guidance; each exporter renders them in the host's rule or
instruction surface, or reports a degradation where it has none.

## Commands

A command joins an invocation (how the user calls it) with a prompt:

```ts
invocations: [
	{
		id: "review-guard-invocation",
		canonical: "review-guard",
		targetAliases: { codex: "review-guard" },
		helpText: "Review the current change before it is merged.",
		examples: ["/review-guard", "/review-guard Focus on security"],
	},
],
commands: [
	{
		id: "review-guard-command",
		invocation: { id: "review-guard-invocation", kind: "invocation" },
		prompt: { id: "review-guard-prompt", kind: "instruction" },
	},
],
```

References are `{ id, kind }` objects. `targetAliases` renames the command on
specific targets. Hosts without a command surface receive the command as a
skill or instruction fallback; see each [target page](/oiap/targets/).

## Skills

A skill exports as a `SKILL.md` folder on hosts with Agent Skills:

```ts
skills: [
	{
		id: "review-checklist",
		name: "review-checklist",
		description: "Checklist for reviewing a pull request.",
		instructions: { id: "review-checklist-instructions", kind: "instruction" },
		files: pluginFiles("skills/review-checklist/references", {
			baseUrl: import.meta.url,
			prefix: "references",
		}),
		targetMetadata: {
			"claude-code": { "disable-model-invocation": true },
		},
	},
],
```

`files` ships files beside `SKILL.md`; see
[Bundled files and path tokens](/oiap/guides/bundled-files/). `targetMetadata`
passes extra frontmatter to one target only.

## Rules

Portable always-on guidance belongs in an instruction with
`purpose: "always_on"`. A `ProjectRule` is a target-specific file: it names its
`target`, `path`, `scope`, `activation` and `content`, and only that target's
exporter renders it.

```ts
rules: [
	{
		id: "cursor-style",
		target: "cursor",
		path: "rules/style.mdc",
		scope: "workspace",
		mergeStrategy: "frontmatter-file",
		activation: "glob",
		globs: ["**/*.ts"],
		description: "TypeScript style",
		content: "Prefer named exports.",
	},
],
```

## Agents

```ts
agents: [
	{
		id: "reviewer",
		name: "reviewer",
		description: "Reviews changes for bugs, security risks and test gaps.",
		instructions: { id: "reviewer-instructions", kind: "instruction" },
		access: "read-only",
		model: "inherit",
	},
],
```

See [Agents and read-only access](/oiap/guides/agents/).

## Hooks

```ts
import { hook } from "@oiap/core";

hooks: [
	hook.beforeTool(
		"protect-env-files",
		(context) => {
			const args = context.input.arguments as Record<string, unknown>;
			const filePath = String(args.file_path ?? "");
			return filePath.endsWith(".env")
				? {
						decision: "block",
						reason: "protected_env_file",
						message: "Do not edit .env files through this agent workflow.",
					}
				: { decision: "allow" };
		},
		{
			match: { kind: "expression", expression: "Edit|Write|MultiEdit" },
			timeoutMs: 3000,
			failureMode: "fail_open",
		},
	),
],
```

See [Hooks and the runtime](/oiap/guides/hooks/) for events, results and how
handlers run on each host.

## MCP tools

A tool surface with a `server` becomes the host's MCP configuration (for
example `.mcp.json` on Claude Code). The surface `id` is the server name.

```ts
tools: [
	{
		id: "issue-tracker",
		transport: "mcp-stdio",
		tools: [{ name: "search_issues", description: "Search issues." }],
		server: {
			command: "npx",
			args: ["-y", "@your-org/issue-tracker-mcp"],
			env: { TRACKER_URL: "https://tracker.example.com" },
		},
	},
],
```

`server` also accepts `url`, `httpUrl`, `headers`, `cwd`, `includeTools`,
`excludeTools`, `auth` and `required`. Fields a host cannot express are dropped
and noted on its target page.

## Policies

Declare what the plugin needs when hooks, tools, scripts, network access, file
writes, secrets or destructive actions are involved:

```ts
policies: [
	{
		permissions: [
			{
				kind: "filesystem",
				access: "ask",
				resources: ["workspace files"],
				reason: "The hook inspects requested file edit paths before writes.",
			},
		],
		network: { access: "allowlist", hosts: ["api.example.com"] },
		destructiveActions: { mode: "ask", patterns: ["file edits"] },
		promptInjection: { mode: "warn" },
	},
],
```

Every exporter writes policies to `.oiap/policy.json` as review evidence.
Exporters render them into host-native settings only where the host has a
matching control; OIAP never enables permissions on its own.

## Build and review

```sh
npx oiap build oiap.plugin.ts --out dist/oiap
```

Read the [capability report](/oiap/guides/capability-reports/) for each target
before you ship.
