---
title: Hooks and the runtime
description: Write lifecycle hooks once as TypeScript functions; OIAP generates a Node runtime and host configuration that calls it.
---

OIAP hooks are TypeScript functions with one argument, a `HookContext`, and one
required return value, a `HookResult`. Exporters generate the host's hook
configuration and a small Node runtime that runs your function.

```ts
import type { HookDefinition } from "@oiap/core";
import { hook } from "@oiap/core";

const protectEnvFiles = hook.beforeTool(
	"protect-env-files",
	(context) => {
		const args = context.input.arguments as Record<string, unknown>;
		const filePath = String(args.file_path ?? "");

		if (!filePath.endsWith(".env")) {
			return { decision: "allow" };
		}

		return {
			decision: "block",
			reason: "protected_env_file",
			message: "Do not edit .env files through this agent workflow.",
			retryable: true,
		};
	},
	{
		match: { kind: "expression", expression: "Edit|Write|MultiEdit" },
		timeoutMs: 3000,
		failureMode: "fail_open",
	},
) as HookDefinition;
```

Add it to the plugin with `hooks: [protectEnvFiles]`.

## Events

| Helper | Event |
| --- | --- |
| `hook.sessionStart` | `session_start` |
| `hook.userPromptSubmit` | `user_prompt_submit` |
| `hook.beforeTool` | `before_tool` |
| `hook.permissionRequest` | `permission_request` |
| `hook.afterTool` | `after_tool` |
| `hook.beforeAgent` | `before_agent` |
| `hook.afterAgent` | `after_agent` |
| `hook.stop` | `stop` |

`context.input` is typed by event: a `before_tool` hook sees the tool and its
arguments, a `user_prompt_submit` hook sees the prompt. Not every host has every
event.

## Results

| Result | Meaning |
| --- | --- |
| `{ decision: "allow" }` | Let the action proceed. |
| `{ decision: "block", reason, message?, retryable? }` | Stop the action. |
| `{ decision: "ask", message, choices? }` | Ask the user. |
| `{ decision: "modify", patch }` | Change the input with JSON Patch operations. |
| `{ decision: "inject_context", content, priority? }` | Add context for the agent. |
| `{ decision: "replace_result", result }` | Replace a tool result. |
| `{ decision: "schedule", job }` | Schedule background work. |
| `{ decision: "noop" }` | Do nothing. |

Hosts honor only a subset of decisions per event, and some hosts run hooks
without enforcing their decisions. Each [target page](/oiap/targets/) describes
its exporter's hook support, and the
[capability report](/oiap/guides/capability-reports/) marks hooks as degraded
where they are not fully mapped.

## Options

| Option | Meaning |
| --- | --- |
| `match` | Narrows when the hook runs. `{ kind: "expression", expression }` is passed to hosts with a matcher field, such as Claude Code. |
| `timeoutMs` | Time budget. Defaults to 5000 ms unless the exporter sets its own default. |
| `failureMode` | What the runtime returns if the hook throws, times out or returns invalid data. Defaults to `fail_closed`. |
| `optional` | When `true`, a failing hook lets the action proceed, like `fail_open`. |
| `fallback`, `capabilities` | Declared fallback rule and side-effect capabilities (network, database, process, filesystem, secrets, MCP). See [Architecture](/oiap/reference/architecture/#side-effects-and-capabilities). |

How the runtime applies `failureMode`:

| `failureMode` | Result on failure |
| --- | --- |
| `fail_closed` (default) | `block` with the error message |
| `fail_open`, `log_only` | `allow`, with the error recorded as an annotation |
| `ask_user` | `ask` with the error message |
| `use_fallback_rule` | `noop` |

Recommended: `fail_closed` for permission and destructive `before_*` hooks,
`log_only` for advisory context hooks, `fail_open` for formatting or telemetry
hooks.

## The runtime

Bundles with hooks contain a generated raw-JavaScript runtime, so hooks do not
depend on `npx` or registry access when they run:

```text
.oiap/runtime/runner.mjs
.oiap/runtime/hooks.mjs
.oiap/runtime/manifest.json
```

The host's hook configuration calls the runner with Node:

```sh
node .oiap/runtime/runner.mjs run-hook --manifest .oiap/runtime/manifest.json --target codex --event before_tool --hook protect-prod
```

The runner loads the hook, builds the `HookContext`, applies the timeout and
failure mode, and returns the result, which the generated adapter maps to the
host's native response. Users need Node on their machine; they do not need to
install `@oiap/runtime`.

### Hook code and dependencies

`oiap build`, `oiap sync` and `install-agent-plugin` all bundle hook handlers
from the original plugin source into `hooks.mjs`, so hook code can use normal
imports, top-level constants, local helpers and result helpers such as
`allow()` and `block()`. Write handlers inline in the plugin's `hooks` array as
arrow functions or function expressions. Declare runtime hook dependencies in
the plugin package's `dependencies` or `optionalDependencies`, so they are
installed before the plugin is built.

## Target modules

For host-only features, a hook can point at an author-supplied module instead of
a function:

```ts
import { hook, targetModule } from "@oiap/core";

hook.beforeTool(
	"native-guard",
	targetModule("claude-code", { entrypoint: "hooks/guard.mjs", symbol: "guard" }),
);
```

Target modules are not portable and are reported as degraded metadata. Use them
rarely.

## Examples

- [Security Guidance](/oiap/examples/security-guidance/): a `before_tool` hook
  that blocks risky edits with a security reminder.
- [Explanatory Output Style](/oiap/examples/explanatory-output-style/): a
  `session_start` hook that injects guidance.
