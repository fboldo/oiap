---
title: Agents and read-only access
description: Define custom agents once and let each exporter map read-only access to the host's own control.
---

Agents are `AgentDefinition`s: a named worker persona with its own
instructions. Exporters render them as the host's custom agents or subagents
(Claude Code `agents/`, Codex custom agents, Cursor agents, and so on).

```ts
import { definePlugin, markdownFile } from "@oiap/core";

export default definePlugin({
	// ...
	instructions: [
		{
			id: "reviewer-instructions",
			purpose: "agent",
			triggers: ["review code"],
			body: markdownFile("agents/reviewer.md", { baseUrl: import.meta.url }),
		},
	],
	agents: [
		{
			id: "reviewer",
			name: "reviewer",
			description: "Reviews changes for bugs, security risks, test gaps, and maintainability issues.",
			instructions: { id: "reviewer-instructions", kind: "instruction" },
			access: "read-only",
			model: "inherit",
		},
	],
});
```

| Field | Meaning |
| --- | --- |
| `id` | Stable id; `${OIAP_AGENT_FILE:<id>}` resolves to this agent's exported file. |
| `name`, `description` | Shown by the host when it lists or picks agents. |
| `instructions` | Reference to an instruction module with the agent's prompt. |
| `access` | `"read-only"` or `"read-write"`. |
| `tools` | Host tool names, passed through as-is. |
| `model` | Passed to hosts that accept a model field. |
| `targetMetadata` | Extra fields for one target, merged last. |

## Read-only access

`access: "read-only"` asks for an agent that cannot modify the workspace.
Exporters map it to the host's own control and report a `read-only-agent`
degradation where the host has none. The mapping used by the
[Elephant-Goldfish Model example](/oiap/examples/elephant-goldfish-model/):

| Target | Read-only agents become |
| --- | --- |
| Claude Code | `tools: Read,Grep,Glob` |
| Cursor | `readonly: true` |
| VS Code Copilot | `tools: [read, search]` |
| OpenCode | `permission: {edit: deny, bash: deny}` |
| Gemini CLI | read tool allowlist |
| Cline | `tools: [read_files, search_codebase]` |
| GitHub Copilot CLI | `tools: [read, search]` |
| Windsurf (Devin) | `allowed-tools: [read, grep, glob]` |
| Codex | not enforceable; reported |
| Antigravity, OpenClaw | agents are metadata only; reported |

For example, a Codex build reports:

```text
warning: degraded-agents - 8 read-only agent(s) are not restricted: Codex custom agent files cannot set a sandbox; ...
```

## Precedence

- `tools` is a pass-through list of host tool names and takes precedence over
  `access` on hosts that accept it. Prefer `access` for portability.
- `targetMetadata` for the target is merged last, so it can override any
  generated field, including the read-only mapping. Use it only for fields OIAP
  does not model.

```ts
targetMetadata: {
	"claude-code": { color: "blue" },
},
```

## Host instruction files

Reviewer-style agents often need to start without the project's instruction
files (`CLAUDE.md`, `AGENTS.md`, Copilot custom instructions), so they judge the
work without inheriting its assumptions. Set `hostInstructions: "exclude"`:

```ts
agents: [
	{
		id: "critic",
		name: "critic",
		description: "Reviews a design with fresh eyes.",
		instructions: { id: "critic-body", kind: "instruction" },
		access: "read-only",
		hostInstructions: "exclude",
	},
],
```

| Host | Mapping |
| --- | --- |
| Claude Code | `omitClaudeMd: true` |
| GitHub Copilot CLI | `include-custom-instructions: false` |
| Cline | configured agents already start without `.clinerules` |
| Others | no control; reported as a degradation |

Both Claude Code and Copilot CLI apply this when the agent runs as a subagent,
which is how plugin agents are used; a user who selects the agent as the main
session agent still gets the project's instructions.

## Agent names

Agent names are kept as written on every host, so a skill can dispatch a
subagent by name. Refer to agent files with `${OIAP_AGENT_FILE:<id>}` rather
than by path; see [Bundled files and path tokens](/oiap/guides/bundled-files/).
