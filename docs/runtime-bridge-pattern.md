# Runtime Bridge Pattern

OIAP should be opinionated about hooks: plugin authors write hooks as TypeScript
functions with one standardized argument and one required return type. Target
exporters then make those hooks work inside Python, JavaScript, shell-oriented,
or other host environments by generating adapters and a small bridge runtime.

The author-facing model stays small:

```ts
export type HookFunction<E extends HookEvent = HookEvent> = (
  context: HookContext<E>,
) => HookResult | Promise<HookResult>;
```

Everything else, including Python glue for Hermes, JSON-RPC transport, process
supervision, capability reports, and host-specific decision mapping, is exporter
implementation detail.

For shared terminology used throughout this document, see the [Glossary](glossary.md).

## Design Position

The first-class hook language should be TypeScript.

That gives OIAP one authoring runtime, one type system, one async model, one test
story, and one way to validate hook inputs and outputs. It also avoids a worse
contract where every plugin author has to understand Python adapters, shell
wrappers, host SDK classes, MCP proxies, and per-platform hook envelopes.

The target adapter can be Python, JavaScript, shell, or another runtime. The hook
logic remains the compiled TypeScript hook unless the author explicitly opts into
a target-specific escape hatch.

```text
Author-written TypeScript hook
  -> compiled hook bundle
    -> generated hook runner
      -> generated host adapter
        -> host-native hook API
```

For Hermes, this means Hermes receives Python code, but the Python code delegates
to the OIAP hook runner. Python is the adapter language, not the default plugin
authoring language.

## Author API

A hook should be declared as a TypeScript function plus a small amount of static
metadata.

```ts
import { allow, block, definePlugin, hook } from "@oiap/core";

export default definePlugin({
  hooks: [
    hook.beforeTool(
      "validate-write",
      async (context) => {
        if (context.input.tool.name !== "write_file") {
          return allow();
        }

        const policy = await context.services.db.query("policy", {
          path: context.input.arguments.path,
        });

        if (!policy.allowed) {
          return block({
            reason: "workspace_policy_denied",
            message: "This file is protected by workspace policy.",
          });
        }

        return allow();
      },
      {
        match: { tool: "write_file" },
        timeoutMs: 5_000,
        failureMode: "fail_closed",
        capabilities: {
          database: [{ ref: "policy", operations: ["read"] }],
        },
      },
    ),
  ],
});
```

The author writes normal TypeScript. The hook can be sync or async. The only
hard rule is that it must return a valid `HookResult`.

## Standard Context

Every hook receives a single `HookContext` object. Event-specific data lives in
`context.input`; shared runtime services live in `context.services`.

```ts
export interface HookContext<E extends HookEvent = HookEvent> {
  event: E;
  hookId: string;
  pluginId: string;
  target: TargetInfo;
  input: HookInput<E>;
  workspace: WorkspaceContext;
  agent: AgentContext;
  user?: UserContext;
  deadline: Deadline;
  signal: AbortSignal;
  services: HookServices;
  log: HookLogger;
}
```

`HookInput<E>` is typed by event. A `before_tool` hook sees tool name,
arguments, and call metadata. A `user_prompt_submit` hook sees the prompt and
conversation metadata. An `after_agent` hook sees completion status and output
references.

The context should be stable across targets. A Hermes hook, a Gemini hook, and a
Claude hook should all call the same TypeScript function with the same logical
shape.

## Standard Services

Complex hooks still need to do real work: call APIs, read databases, spawn
processes, call MCP tools, cache data, and schedule background jobs. OIAP should
allow that through standard services on the context.

```ts
export interface HookServices {
  fetch: HookFetch;
  db: HookDatabaseClient;
  exec: HookProcessRunner;
  mcp: HookMcpClient;
  secrets: HookSecretStore;
  cache: HookCache;
  schedule: HookScheduler;
}
```

These services are wrappers, not random globals. They let OIAP enforce declared
capabilities, inherit deadlines, propagate cancellation, redact secrets, and
record traces consistently across host environments.

Authors can still import ordinary TypeScript packages, but portable hooks should
use `context.services` for side effects. Raw runtime APIs are harder to enforce
and should trigger an advanced or unsafe capability warning when detected.

## Required Return Type

The return type should be deliberately small.

```ts
export type HookResult =
  | { decision: "allow"; annotations?: DecisionAnnotation[] }
  | { decision: "block"; reason: string; message?: string; retryable?: boolean }
  | { decision: "ask"; message: string; choices?: DecisionChoice[] }
  | { decision: "modify"; patch: JsonPatchOperation[]; reason?: string }
  | { decision: "inject_context"; content: string; priority?: "low" | "normal" | "high" }
  | { decision: "replace_result"; result: unknown }
  | { decision: "schedule"; job: ScheduledJob }
  | { decision: "noop" };
```

Targets may support only a subset of these decisions for a given event. The
exporter validates that at build time. If a required hook returns a decision the
target cannot honor, the export should fail or report an explicit degradation,
depending on the hook's `optional` setting.

## Complex Hook Example

This model still supports complex hooks. Complexity lives in normal async
TypeScript, not in per-target adapter code.

```ts
hook.beforeTool(
  "guard-shell-command",
  async (context) => {
    const command = context.input.arguments.command;

    const policy = await context.services.fetch.json(
      "https://policy.example.com/commands/check",
      {
        method: "POST",
        body: { command, workspace: context.workspace.id },
        signal: context.signal,
      },
    );

    const recentChanges = await context.services.exec.run("git", ["diff", "--stat"], {
      cwd: context.workspace.root,
      timeoutMs: 1_500,
    });

    await context.services.db.transaction("audit", async (tx) => {
      await tx.insert("hook_audit", {
        hook: context.hookId,
        command,
        diff: recentChanges.stdout,
      });
    });

    if (!policy.allowed) {
      return block({
        reason: "command_policy_denied",
        message: policy.message,
      });
    }

    return allow();
  },
  {
    match: { tool: "shell" },
    timeoutMs: 8_000,
    failureMode: "fail_closed",
    capabilities: {
      network: [{ host: "policy.example.com", methods: ["POST"] }],
      process: [{ command: "git", args: ["diff", "--stat"] }],
      database: [{ ref: "audit", operations: ["write", "transaction"] }],
    },
  },
);
```

This hook calls an external API, spawns a process, writes to a database, observes
cancellation, and returns a required decision. The exported Python or shell
adapter does not reimplement any of that logic.

## Export Pipeline

At build time, OIAP should compile hooks into a target-neutral hook bundle.

```text
src/plugin.ts
  -> dist/oiap/hooks.mjs
  -> dist/oiap/hook-manifest.json
  -> dist/<target>/package/generated adapter files
```

The hook manifest records hook IDs, events, matchers, timeout policy,
capability declarations, failure modes, and the compiled hook entrypoint.

```json
{
  "hooks": [
    {
      "id": "validate-write",
      "event": "before_tool",
      "entrypoint": "dist/oiap/hooks.mjs#validateWrite",
      "timeoutMs": 5000,
      "failureMode": "fail_closed",
      "capabilities": ["database:policy:read"]
    }
  ]
}
```

Target exporters consume this manifest and generate host-native adapters.

## Runtime Flow

At runtime, the flow is simple:

1. The host emits a native hook event.
2. The generated adapter normalizes the event into the standard context input.
3. The adapter invokes the OIAP hook runner.
4. The hook runner imports the compiled TypeScript hook.
5. The hook receives `HookContext` and returns `HookResult`.
6. The adapter maps `HookResult` back into the host-native response.

```text
Hermes Python hook
  -> OIAP Python adapter
    -> OIAP hook runner
      -> compiled TypeScript hook
        -> HookResult
          -> Hermes-native decision
```

The same compiled TypeScript hook can be used by many target adapters.

## Hermes Python Adapter

For a Python-native host such as Hermes, OIAP should generate Python code that
does only three things:

1. Register with Hermes' plugin API.
2. Convert Hermes event arguments into OIAP hook input.
3. Call the hook runner and map the result back to Hermes.

Example generated adapter sketch:

```python
from oiap_runtime import HookBridge, load_manifest

manifest = load_manifest("hook-manifest.json")
bridge = HookBridge(manifest=manifest)


class ExportedPlugin:
    def before_tool(self, tool_name, arguments, context):
        result = bridge.invoke_hook(
            hook_id="validate-write",
            event="before_tool",
            input={"tool": {"name": tool_name}, "arguments": arguments},
            host_context=context,
        )

        return bridge.to_hermes_decision(result)
```

If Hermes supports async hooks, the generated adapter can await the bridge:

```python
class ExportedPlugin:
    async def before_tool(self, tool_name, arguments, context):
        result = await bridge.invoke_hook_async(
            hook_id="validate-write",
            event="before_tool",
            input={"tool": {"name": tool_name}, "arguments": arguments},
            host_context=context,
        )

        return bridge.to_hermes_decision(result)
```

The Python bridge usually calls a local JS hook runner over JSON-RPC stdio. If a
target can embed or directly call the JS runtime, the exporter can skip stdio and
use the faster path. Either way, the hook function is still the same compiled
TypeScript hook.

## Hook Runner

The hook runner is the small executable boundary that loads bundled hooks and
executes them with a standard context. OIAP's first implementation emits a raw
JavaScript runtime into each bundle so hook execution does not depend on `npx` or
registry access at host runtime.

```text
node .oiap/runtime/runner.mjs run-hook
  --manifest .oiap/runtime/manifest.json
  --target codex
  --event before_tool
  --hook protect-prod
```

Responsibilities:

- Load generated hook modules from `.oiap/runtime/hooks.mjs`.
- Validate hook input and output schemas.
- Build `HookContext`.
- Provide standard services.
- Apply timeouts and cancellation.
- Enforce declared capabilities where possible.
- Return a serialized `HookResult`.

The runner is generated from `@oiap/runtime` at bundle time. Portable author
functions are serialized into raw JavaScript; target-module hooks or functions
that cannot be serialized are surfaced as degraded metadata rather than silently
claimed as executable.

## Async, Deadlines, And Cancellation

TypeScript hooks can return `Promise<HookResult>`, so async is part of the base
contract. Every hook receives `context.signal` and `context.deadline`.

The bridge should enforce these rules:

- `context.signal` is passed into OIAP service calls.
- Service timeouts must fit inside the hook deadline.
- A cancelled hook returns a normalized timeout or cancellation error.
- Required blocking hooks use the configured `failureMode` when cancellation or
  timeout occurs.
- Background work must be scheduled through `context.services.schedule` instead
  of being left as an unmanaged promise.

Before-event hooks normally block the host until they return. After-event hooks
can often schedule background work and return quickly.

## Side Effects And Capabilities

Hooks can do real work, but they must declare the capabilities they need.

```ts
export interface HookCapabilities {
  network?: NetworkCapability[];
  database?: DatabaseCapability[];
  process?: ProcessCapability[];
  filesystem?: FilesystemCapability[];
  secrets?: SecretCapability[];
  mcp?: McpCapability[];
}
```

The capabilities live beside the hook function, not inside target-specific
adapter code. The exporter includes them in the capability report, and the hook
runner uses them to configure `context.services`.

If the target cannot enforce a capability, the bundle report should say so. OIAP
should fail closed for required security hooks when enforcement is impossible.

## Failure Modes

Every hook should have an explicit failure mode.

```ts
export type HookFailureMode =
  | "fail_closed"
  | "fail_open"
  | "ask_user"
  | "use_fallback_rule"
  | "log_only";
```

Recommended defaults:

| Hook type | Default |
| --- | --- |
| Permission and destructive `before_*` hooks | `fail_closed` |
| Advisory context hooks | `log_only` |
| Formatting or telemetry hooks | `fail_open` |
| Hooks with a safe prose fallback | `use_fallback_rule` |

The generated adapter must apply the failure mode if the hook runner is
unavailable, times out, returns invalid data, or cannot map a result to the host.

## Target Mapping

Different targets still expose different hook surfaces. The exporter handles
that difference behind the TypeScript contract.

| Target shape | Exporter strategy |
| --- | --- |
| JavaScript-native hooks | Import or call the compiled hook bundle directly |
| Python-native hooks | Generate Python adapter that calls the hook runner |
| Shell hooks | Generate shell wrapper that calls the hook runner |
| Config-only hooks | Render fallback rules or fail export for required hooks |
| MCP-capable hooks | Optionally expose the hook runner through MCP tools |
| No matching hook event | Omit optional hook or fail required hook export |

This keeps platform complexity out of the plugin authoring API.

## Escape Hatches

Some platforms will have features that cannot be expressed through the portable
hook function. OIAP should support target modules, but they should be rare and
explicit.

```ts
hook.beforeTool("hermes-native-guard", targetModule("hermes", {
  entrypoint: "src/hermes/hooks.py",
  symbol: "guard",
  returns: "HookResult",
}));
```

Even escape hatches should receive standard hook input and return standard
`HookResult` data. The capability report should list them clearly because they
are no longer purely portable TypeScript hooks.

## Capability Report

Each exported bundle should report how hooks execute.

```json
{
  "hooks": [
    {
      "id": "validate-write",
      "event": "before_tool",
      "authorRuntime": "typescript",
      "compiledRuntime": "javascript",
      "targetAdapter": "python",
      "bridge": "json-rpc-stdio",
      "decisions": ["allow", "block", "ask"],
      "failureMode": "fail_closed",
      "degradations": []
    }
  ]
}
```

The important distinction is visible: authors write TypeScript, while targets may
receive Python, JavaScript, shell, or config adapters.

## Generated Tests

The exporter should generate contract tests around the TypeScript hook bundle and
target adapter mapping.

Recommended tests:

- Hook input schema validation.
- Required `HookResult` validation.
- Timeout and cancellation behavior.
- Capability enforcement for network, database, process, filesystem, secrets,
  and MCP.
- Host adapter mapping from native event to `HookContext.input`.
- Host adapter mapping from `HookResult` to native decision.
- Hook runner unavailable.
- Invalid result from hook runner.

For Hermes, most tests can run without Hermes itself by testing the generated
Python adapter against fake host events and a fake hook runner.

## Minimal MVP

The first version should implement:

1. TypeScript hook function API.
2. Standard `HookContext` and `HookResult` types.
3. Hook metadata for matchers, timeout, failure mode, and capabilities.
4. Compiled JS hook bundle.
5. JSON-RPC stdio hook runner.
6. Python adapter generation for a Hermes-like target.
7. JavaScript direct-call adapter for a JS-native target.
8. Capability report entries for every hook.
9. Generated contract tests.

This is enough to prove the architecture without asking authors to care about
per-target runtime internals.

## Summary

OIAP should make hooks boring to author: write a TypeScript function, receive a
standard context, return a standard result. The bridge pattern exists so that
boring hook can run from interesting host environments. Python, shell, MCP, HTTP,
and other mechanisms are adapter details generated by exporters.

That opinionated boundary keeps OIAP approachable while still allowing complex
hooks that call async functions, external APIs, databases, child processes, MCP
tools, and background jobs under one portable contract.