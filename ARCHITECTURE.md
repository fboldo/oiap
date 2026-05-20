# OIAP Architecture

OIAP exists to give plugin authors one stable authoring model and many target
bundle exporters. Authors define a plugin once using host-neutral primitives.
OIAP validates that definition, normalizes it into a portable intermediate
representation, and exports host-native bundles for agent harnesses such as
Claude Code, Codex, Cline, Cursor, VS Code Copilot Chat, OpenClaw,
Google Antigravity, and future targets.

The scope is export, not placement. OIAP produces validated bundle directories,
manifests, generated code, rules, skills, workflows, MCP configuration fragments,
policy fragments, source maps, and compatibility reports. It does not mutate a
user's home directory, edit live host configuration, auto-enable permissions, or
install bundles into a running agent harness. A host package manager, host CLI,
consumer workflow, or human decides how exported artifacts are adopted.

The core promise is simple:

1. Define the plugin once in OIAP.
2. Normalize it into a portable intermediate representation.
3. Export host-native bundles from that representation.
4. Report which capabilities are native, degraded, or unsupported per target.

## Glossary

This glossary defines OIAP terms by their intended meaning, independent of any
one platform's vocabulary.

### Core Concepts

| Term | Meaning |
| --- | --- |
| OIAP | Open Interoperable Agent Plugins. The SDK and tooling for defining an agent plugin once and exporting host-specific bundles. |
| Agent harness | A product or runtime that hosts an AI coding agent, such as Claude Code, Codex, Cline, Gemini CLI, Cursor, Kiro, or another target platform. |
| Host | The specific agent harness receiving an exported OIAP bundle. |
| Target | A named export destination, usually one host plus a profile, operating-system dialect, region, or runtime variant. |
| Platform profile | The structured description of what a target supports: packages, rules, skills, commands, hooks, MCP, runtime code, permissions, and policy. |
| Plugin | The author-defined OIAP package containing manifest data, instructions, workflows, hooks, tools, policies, and optional target overrides. |
| Primitive | A host-neutral OIAP building block, such as `HookDefinition`, `ProjectRule`, `ToolSurface`, `CommandAsset`, or `PermissionPolicy`. |
| Intermediate representation | The normalized internal model produced from plugin source before target exporters render host-specific files. Often shortened to IR. |
| Write once, export many | The OIAP design goal: authors define plugin behavior once, then OIAP generates bundles for many agent harnesses. |

### Authoring Concepts

| Term | Meaning |
| --- | --- |
| Plugin manifest | Stable identity and compatibility metadata for a plugin: ID, name, version, description, categories, required capabilities, optional capabilities, and supported targets. |
| Invocation | A host-neutral description of how a user or agent activates behavior. It may become a slash command, command file, workflow name, skill trigger, or instruction fallback. |
| Instruction module | Reusable prose with metadata. It can render into skills, project rules, steering files, command help, or workflow instructions. |
| Workflow | A structured sequence of agent actions, tool calls, file operations, checks, prompts, and output contracts. |
| Command asset | A reusable command-oriented asset that combines invocation metadata, prompt guidance, argument schema, and optional executable recipe. |
| Command recipe | A shell, Python, or runtime-specific executable recipe described by intent, required tools, timeout, arguments, and produced artifacts. |
| Artifact | A file or output the plugin reads, owns, generates, caches, reports, or asks the user to review. |
| Project rule | Host-visible instruction content scoped to a repository, workspace, user, team, nested folder, or managed organization context. |
| Skill asset | A reusable instruction bundle exposed through a host's skill mechanism when available. |

### Export Concepts

| Term | Meaning |
| --- | --- |
| Exporter | Target-specific renderer that lowers OIAP primitives into host-native bundle files. |
| Adapter | Generated or hand-authored target glue that connects OIAP's model to a host-specific API, file format, runtime, or lifecycle. |
| Target bundle | The exported artifact for one target. It may be a directory, archive, or manifest-only output. |
| Distribution package | Host-native package metadata and assets when the target has a first-class package or extension format. |
| Rendered file | A concrete file emitted by an exporter. Examples include manifests, rules, skills, hooks, command files, runtime shims, and README files. |
| Export plan | The deterministic plan for one target export: output directory, rendered files, runtime modules, config fragments, package metadata, and report. |
| Capability report | Machine-readable export evidence explaining which capabilities mapped natively, degraded, were omitted, or need user review. |
| Source map | Mapping from generated host files back to OIAP primitives so reviewers can audit why each file exists. |
| Degradation | A target-specific reduction in fidelity, such as rendering a native hook as a rule fallback because the host lacks the hook event. |
| Fallback | A safe alternative generated when a target cannot support a richer primitive directly. |

### Platform Surface Concepts

| Term | Meaning |
| --- | --- |
| Package surface | Host support for a first-class plugin, extension, or package format. |
| Rule surface | Host support for persistent instruction files such as `AGENTS.md`, `GEMINI.md`, Cursor rules, Kiro steering, Trae rules, or similar assets. |
| Skill surface | Host support for reusable instruction bundles that can be invoked or discovered by the agent. |
| Command surface | Host support for slash commands, command files, custom commands, workflows invoked by name, or prompt commands. |
| Hook surface | Host support for lifecycle events such as session start, prompt submit, before tool use, permission request, after tool use, agent stop, or related events. |
| Agent surface | Host support for custom agents, subagents, Droids, task groups, browser subagents, or other delegation mechanisms. |
| MCP surface | Host support for Model Context Protocol servers, tools, resources, prompts, transports, and related tool filtering. |
| Runtime surface | Host support that requires code in a specific runtime, such as Python plugins, JavaScript extensions, shell hooks, executable scripts, or generated binaries. |
| Policy surface | Host support for permissions, approvals, sandboxing, autonomy controls, network rules, path access, or destructive-action controls. |

### Hook And Runtime Concepts

| Term | Meaning |
| --- | --- |
| Hook | An OIAP lifecycle function that receives a standard `HookContext` and returns a standard `HookResult`. |
| Hook context | The standardized argument passed to a TypeScript hook. It contains event data, workspace data, deadline, cancellation signal, services, and logging. |
| Hook result | The required return value from a hook, such as allow, block, ask, modify, inject context, replace result, schedule, or noop. |
| Hook runner | The executable boundary that loads compiled TypeScript hooks, builds `HookContext`, enforces policy, and returns serialized `HookResult` data. |
| Runtime bridge | Generated adapter architecture that lets a host-native runtime call OIAP's TypeScript hook runner or portable core. |
| Runtime module | Target-native code generated or supplied for a bundle, such as a Python adapter, JavaScript extension, hook handler, tool server, executable script, or command runner. |
| Host adapter | Generated host-native code that registers with a platform API and forwards behavior into OIAP's hook runner or runtime bridge. |
| Target module | Explicit author-supplied target-specific code used as an escape hatch when a host feature cannot be represented portably. |
| Escape hatch | A narrow target-specific override. It should fill gaps in the portable model without forking the entire plugin. |
| Runtime binding | Exporter metadata describing how a hook or runtime module executes for one target, including adapter language, bridge transport, timeout, and failure mode. |

### Tooling And Policy Concepts

| Term | Meaning |
| --- | --- |
| Tool surface | Host-neutral description of callable tools, native tools, CLI tools, MCP servers, resources, and prompts. |
| MCP server | A Model Context Protocol server exposed through stdio, SSE, HTTP, or another supported transport. |
| Permission policy | OIAP's declaration of allowed actions, approvals, sandbox behavior, network access, secrets, path access, and destructive actions. |
| Side effect | Work a plugin performs outside pure computation, such as network calls, database access, file writes, process spawning, secret access, or cache writes. |
| Failure mode | The configured behavior when a hook or adapter fails, such as fail closed, fail open, ask user, use fallback rule, or log only. |
| Deadline | Time budget for a hook, tool call, workflow step, or runtime adapter operation. |
| Cancellation | Propagated signal that asks async work, external calls, or child processes to stop. |
| Capability | A semantic ability requested by a plugin or offered by a host, such as hooks, MCP, file writes, command execution, network access, or custom agents. |
| Capability negotiation | The export-time comparison between plugin requirements and the target platform profile. |

## Scope Boundaries

OIAP should own:

- A plugin authoring SDK.
- A target-neutral plugin intermediate representation.
- Exporters for host-native bundle formats.
- Generated target files, manifests, source maps, and verification reports.
- Capability negotiation and graceful degradation.
- A stable runtime for hooks and executable scripts used by generated adapters.

OIAP should not own:

- Writing directly into a user's global agent configuration.
- Editing a repository's live instruction files by default.
- Auto-enabling hooks, MCP servers, permissions, or sandbox exceptions.
- Host account auth, marketplace publishing, or organization policy decisions.
- Replacing a host's official package manager or extension manager.

This boundary keeps OIAP usable in CI, package registries, enterprise review
flows, and local development without assuming authority over the user's agent
environment.

## Target Platform Set

The initial target set should cover the harness families already common in the
agent ecosystem:

| Platform | Primary bundle surface |
| --- | --- |
| Claude Code | Plugin package, skills, commands, agents, hooks, MCP, settings |
| Codex | Plugin/config package, skills, `AGENTS.md`, hooks, MCP, rules, custom agents |
| Cline | Project rules, Agent Skills, file hooks, MCP config, project agents |
| OpenCode | Skill/rule assets plus JavaScript extension assets where supported |
| GitHub Copilot CLI | Thin skill or instruction bundle until richer surfaces are confirmed |
| VS Code Copilot Chat | Workspace custom instructions and editor-focused guidance |
| Aider | Config, read-context files, slash-command guidance, watch-comment workflows |
| OpenClaw | Conservative skill and instruction bundle until official surfaces are confirmed |
| Factory Droid | Plugin package, skills, custom slash commands, hooks, MCP, custom Droids |
| Trae | Project rules, context imports, custom agents, MCP-backed tools |
| Trae CN | Trae bundle with regional naming and localization profile |
| Gemini CLI | Extension package, commands, `GEMINI.md`, skills, hooks, MCP, settings |
| Hermes | Python-native plugin bundle or Python adapter shim |
| Kimi Code | Skill and MCP bundle until official surfaces are confirmed |
| Kiro IDE/CLI | Agent Skills, steering files, hooks, MCP, specs |
| Pi coding agent | Thin skill bundle until official surfaces are confirmed |
| Cursor | Plugin package, rules, skills, commands, custom agents, hooks, MCP |
| Google Antigravity | Workspace rules, Agent Skills, workflow markdown, MCP configuration, permission fragments, task group guidance |

This table is not an adoption workflow. It is an export matrix: each row answers
what kind of bundle OIAP can generate for a host. For the living capability
matrix and adapter package status, see the [Platform Matrix](MATRIX.md).

## What Varies Across Hosts

The same plugin behavior must lower into several incompatible host surfaces:

| Surface | Host examples | OIAP primitive needed |
| --- | --- | --- |
| Distribution package | Claude plugins, Codex plugins, Gemini extensions, Factory plugins | `TargetBundle` and `DistributionPackage` |
| Skills | Agent Skills folders, Claude skills, Gemini extension skills, Kiro skills, Factory skills | `SkillAsset` |
| Commands | Claude commands, Gemini TOML commands, Factory slash commands, workflow invocations | `CommandAsset` and `Invocation` |
| Project rules | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, Kiro steering, Trae rules, Antigravity rules | `ProjectRule` |
| Hooks | Claude lifecycle hooks, Codex hooks, Gemini hooks, Factory hooks, Kiro hooks, OpenCode events | `HookDefinition` |
| Delegation | Claude subagents, Codex custom agents, Factory Droids, Trae custom agents, browser subagents | `DelegationStrategy` and `AgentDefinition` |
| Runtime code | JavaScript extensions, Python plugins, shell hooks, executable scripts, generated wrappers | `RuntimeModule` |
| Tools | MCP servers, native tools, CLI tools, resources, prompts | `ToolSurface` and `McpServer` |
| Permissions | Codex rules, Antigravity allow/deny/ask lists, Gemini sandbox/tool policy, Factory autonomy controls | `PermissionPolicy` |
| Packaging evidence | Generated manifest, capability report, source map, exported file tree | `ExportReport` |

The primitive model treats these surfaces as generated target adapters, not as
plugin business logic.

## Export Pipeline

The exporter should be deterministic and reviewable.

1. Author writes an OIAP plugin definition using TypeScript, JSON/YAML, or a
   higher-level SDK.
2. OIAP validates the source package and normalizes it into an intermediate
   representation.
3. Capability negotiation compares the plugin requirements with the target host
   profile.
4. The target backend lowers primitives into host-specific assets.
5. Runtime modules are generated for targets that require native host code.
6. The exporter emits a bundle directory and machine-readable report.
7. Validators check schemas, frontmatter, TOML/JSON/YAML, command safety, and
   target capability declarations.

An exported bundle should be a normal build artifact. It can be reviewed,
committed, published, signed, or handed to a host package manager.

## Bundle Layout

Every target export should have a predictable shape:

```text
dist/
  <target>/
    oiap-bundle.json
    capability-report.json
    source-map.json
    package/
      ...host-native files...
    generated/
      ...runtime shims or compiled assets...
    README.md
```

`oiap-bundle.json` identifies the plugin, target, exporter version, source
digest, declared capabilities, and generated files. `capability-report.json`
states what mapped natively, what degraded, and what was omitted.
`source-map.json` maps generated host files back to OIAP primitives so reviewers
can audit why a file exists.

Each bundle should include a generated `README.md` covering:

- What the bundle contains.
- Which host version or profile it targets.
- Which capabilities mapped natively.
- Which capabilities degraded or were omitted.
- What commands, hooks, tools, and policies the bundle declares.
- What runtime code was generated.
- What target-specific modules were supplied by the author.
- What files are expected to be reviewed before adoption.

## Primitive Model

The primitive set is the portable vocabulary exporters lower into target files.

### Plugin Manifest

The manifest is the stable identity and compatibility layer.

```ts
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  homepage?: string;
  license?: string;
  categories: string[];
  requiredCapabilities?: HostCapability[];
  optionalCapabilities?: HostCapability[];
  supportedTargets: TargetId[];
}
```

The manifest should describe what the plugin needs in semantic terms, such as
workspace read access, command execution, file writes, MCP tools, hooks, rules,
subagents, browser control, or network access.

### Target Bundle

The target bundle is the exported artifact, not a mutation plan.

```ts
export interface TargetBundle {
  target: TargetId;
  format: "directory" | "archive" | "manifest-only";
  files: RenderedFile[];
  package?: DistributionPackage;
  report: ExportReport;
}
```

Some hosts have a first-class package format. Others only support loose files or
instructions. OIAP represents both as target bundles, with package metadata
present only when the host supports it.

### Invocation

Invocation describes how users or agents activate plugin behavior.

```ts
export interface Invocation {
  id: string;
  canonical: string;
  aliases?: string[];
  targetAliases?: Partial<Record<TargetId, string>>;
  argsSchema?: JsonSchema;
  helpText: string;
  examples: string[];
}
```

The same logical invocation might become a slash command, a skill mention, a
workflow name, a natural language trigger, a custom command file, or a CLI
command reference depending on the target.

### Instruction Module

Instruction modules are reusable prose with structured metadata. They can render
into skills, project rules, steering files, workflow descriptions, or generated
command help.

```ts
export interface InstructionModule {
  id: string;
  purpose: "command" | "always_on" | "workflow" | "safety" | "agent";
  triggers: string[];
  body: string;
  frontmatter?: Record<string, unknown>;
  hostOverrides?: Partial<Record<TargetId, string>>;
}
```

OIAP should keep host-specific prose small. Most behavioral guidance should live
once and be adapted by renderers.

### Command Asset

Command assets describe reusable command prompts or executable snippets.

```ts
export interface CommandAsset {
  id: string;
  invocation: InvocationRef;
  prompt?: InstructionModuleRef;
  recipe?: CommandRecipeRef;
  arguments?: JsonSchema;
  targetMetadata?: Partial<Record<TargetId, Record<string, unknown>>>;
}
```

Examples include Gemini TOML commands, Claude command files, Factory custom slash
commands, Antigravity workflows invoked by slash command, or plain instruction
fallbacks for targets without command registries.

### Workflow

Workflow captures the behavior an agent should perform. It should be structured
enough to lower into host workflows, command prompts, subagent plans, or
step-by-step fallback instructions.

```ts
export interface Workflow {
  id: string;
  title: string;
  activation: Activation;
  inputs: WorkflowInput[];
  steps: WorkflowStep[];
  outputs: ArtifactRef[];
  failurePolicy: FailurePolicy;
}
```

Targets with native workflows receive structured workflow assets. Thin targets
receive clear instruction modules that describe the same workflow.

### Command Recipe

Command recipes model executable snippets by intent and dialect.

```ts
export interface CommandRecipe {
  id: string;
  intent: string;
  requiredTools: string[];
  dialects: Partial<Record<ShellDialect, string>>;
  timeoutMs?: number;
  produces?: ArtifactRef[];
  sensitiveArgs?: string[];
}
```

A recipe should express the same operation for POSIX shells, PowerShell, Python,
or another execution environment without duplicating plugin behavior.

### Artifact

Artifacts declare files the plugin owns, reads, or produces.

```ts
export interface Artifact {
  id: string;
  path: string;
  kind: "state" | "cache" | "report" | "config" | "output" | "temp";
  lifecycle: "persistent" | "ephemeral" | "generated";
  reviewRecommended?: boolean;
  cleanupRecommended?: boolean;
}
```

The exporter should include artifact ownership in the capability report so host
reviewers can reason about file writes and generated outputs.

### Project Rule

Project rules are host-visible instructions intended for repository, workspace,
team, or global scope.

```ts
export interface ProjectRule {
  id: string;
  target: TargetId;
  path: string;
  marker?: string;
  scope: "user" | "workspace" | "nested" | "team" | "managed";
  mergeStrategy: "append-section" | "replace-file" | "frontmatter-file";
  activation: "always" | "pattern" | "manual" | "model" | "glob";
  globs?: string[];
  description?: string;
  frontmatter?: Record<string, unknown>;
  content: string;
}
```

This primitive covers files such as `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
`.github/copilot-instructions.md`, Cursor rules, Kiro steering, Trae rules, and
Antigravity rules. The important part is not the filename; it is the activation
semantics and host scope.

### Skill Asset

Skills are reusable instruction bundles exposed through a host's skill surface
when available.

```ts
export interface SkillAsset {
  id: string;
  name: string;
  description: string;
  instructions: InstructionModuleRef;
  assets?: PackageAssetRef[];
  targetMetadata?: Partial<Record<TargetId, Record<string, unknown>>>;
}
```

Targets without native skills can still receive the skill content as rules,
instructions, or generated documentation with a degradation entry.

### Hook

Hooks express desired host lifecycle events without hardcoding host schemas into
plugin logic.

```ts
export interface HookDefinition<E extends HookEvent = HookEvent> {
  kind: "oiap.hook";
  id: string;
  event: E;
  handler: HookFunction<E> | TargetModuleRef;
  match?: HookMatcher<E>;
  timeoutMs?: number;
  failureMode?: HookFailureMode;
  capabilities?: HookCapabilities;
  optional?: boolean;
  fallback?: HookFallback;
}
```

If a target lacks hooks, OIAP should render a fallback rule, omit optional hooks
with a capability warning, or fail export for required hooks.

### Delegation Strategy

Many plugins need parallel or specialized agent work. Hosts expose that
differently.

```ts
export interface DelegationStrategy {
  id: string;
  mode:
    | "none"
    | "native_subagents"
    | "custom_agents"
    | "browser_subagent"
    | "mcp_tools";
  maxWorkers?: number;
  chunking?: ChunkingStrategy;
  resultContract: JsonSchema;
  fallback?: WorkflowStep[];
}
```

The plugin author declares the desired delegation shape once. Target exporters
map it to Claude subagents, Codex custom agents, Factory Droids, Trae custom
agents, Antigravity task groups, Kiro hooks/spec tasks, MCP calls, or sequential
fallback instructions.

### Tool Surface

Tool surfaces describe callable tools independent of instruction text.

```ts
export interface ToolSurface {
  id: string;
  transport: "mcp-stdio" | "mcp-sse" | "mcp-http" | "native" | "cli";
  tools: ToolDefinition[];
  resources?: ResourceDefinition[];
  prompts?: PromptDefinition[];
  server?: McpServer;
}
```

MCP should be the preferred portable tool boundary when a host supports it.
Targets that lack MCP receive command or instruction fallbacks.

### Runtime Module

Runtime modules represent target-native code generated or supplied for a bundle.

```ts
export interface RuntimeModule {
  id: string;
  target: TargetId;
  language: "typescript" | "javascript" | "python" | "shell" | "wasm" | "native";
  purpose: "host_adapter" | "tool_server" | "hook_handler" | "command_runner";
  entrypoint: string;
  generated: boolean;
  source?: string;
  bridgesTo?: ToolSurfaceRef | WorkflowRef | HookRef;
}
```

This primitive lets OIAP handle hosts whose plugin surface is an SDK in a
specific language, a shell hook, or another executable script environment.

### Export Plan

Export plans make target output reproducible.

```ts
export interface ExportPlan {
  target: TargetId;
  outDir: string;
  files: RenderedFile[];
  package?: DistributionPackage;
  runtimeModules: RuntimeModule[];
  configFragments: RenderedConfigFragment[];
  report: ExportReport;
}
```

The exporter should never need to write outside `outDir`. That is the line
between building a bundle and adopting it in a user's host environment.

### Policy And Safety

Plugins that ask agents to run commands, edit files, use tools, or access the
network need explicit policy.

```ts
export interface PermissionPolicy {
  permissions: Permission[];
  approvals?: ApprovalPolicy;
  sandbox?: SandboxPolicy;
  network?: NetworkPolicy;
  secrets?: SecretPolicy;
  pathAccess?: PathPolicy;
  destructiveActions?: DestructiveActionPolicy;
  promptInjection?: PromptInjectionPolicy;
}
```

The exporter should render policy into host-native forms when available and add
clear warnings when a host cannot enforce the declared policy.

## Runtime And Hook Bridge

OIAP is opinionated about hooks: plugin authors write hooks as TypeScript
functions with one standardized argument and one required return type. Target
exporters make those hooks work inside Python, JavaScript, shell-oriented, or
other host environments by generating adapters and a stable runtime.

The author-facing model stays small:

```ts
export type HookFunction<E extends HookEvent = HookEvent> = (
  context: HookContext<E>,
) => HookResult | Promise<HookResult>;
```

Everything else, including Python glue for Hermes, JSON-RPC transport, process
supervision, capability reports, host-specific decision mapping, and executable
script wrappers, is exporter implementation detail.

### Design Position

The first-class hook language should be TypeScript. That gives OIAP one
authoring runtime, one type system, one async model, one test story, and one way
to validate hook inputs and outputs.

The target adapter can be Python, JavaScript, shell, or another runtime. The
hook logic remains the compiled TypeScript hook unless the author explicitly
opts into a target-specific escape hatch.

```text
Author-written TypeScript hook
  -> compiled hook bundle
    -> generated hook runner
      -> generated host adapter
        -> host-native hook API
```

For Python-native hosts, the host receives Python code, but the Python code
delegates to the OIAP hook runner. Python is the adapter language, not the
default plugin authoring language.

### Standard Context

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
  signal: HookAbortSignal;
  services: HookServices;
  log: HookLogger;
}
```

`HookInput<E>` is typed by event. A `before_tool` hook sees tool name,
arguments, and call metadata. A `user_prompt_submit` hook sees the prompt and
conversation metadata. An `after_agent` hook sees completion status and output
references.

### Standard Services

Complex hooks still need to do real work: call APIs, read databases, spawn
processes, call MCP tools, cache data, and schedule background jobs. OIAP allows
that through standard services on the context.

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

### Required Return Type

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

### Runtime Flow

At runtime, the flow is simple:

1. The host emits a native hook event or executable script entrypoint.
2. The generated adapter normalizes the event into standard context input.
3. The adapter invokes the OIAP hook runner or script runner.
4. The runner imports the compiled TypeScript behavior.
5. The behavior receives `HookContext` or script input and returns structured
   result data.
6. The adapter maps that result back into the host-native response.

```text
Python or shell host adapter
  -> OIAP runtime bridge
    -> compiled TypeScript behavior
      -> standard result
        -> host-native decision or output
```

The same compiled TypeScript hook can be used by many target adapters.

### Hook Runner

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

### Async, Deadlines, And Cancellation

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

### Side Effects And Capabilities

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

### Failure Modes

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

### Target Mapping

Different targets expose different hook surfaces. The exporter handles that
difference behind the TypeScript contract.

| Target shape | Exporter strategy |
| --- | --- |
| JavaScript-native hooks | Import or call the compiled hook bundle directly |
| Python-native hooks | Generate Python adapter that calls the hook runner |
| Shell hooks | Generate shell wrapper that calls the hook runner |
| Executable script hooks | Generate script entrypoints that call the stable OIAP runtime |
| Config-only hooks | Render fallback rules or fail export for required hooks |
| MCP-capable hooks | Optionally expose the hook runner through MCP tools |
| No matching hook event | Omit optional hook or fail required hook export |

This keeps platform complexity out of the plugin authoring API.

### Escape Hatches

Some platforms have features that cannot be expressed through the portable hook
function. OIAP supports target modules, but they should be rare and explicit.

```ts
hook.beforeTool(
  "hermes-native-guard",
  targetModule("hermes", {
    entrypoint: "src/hermes/hooks.py",
    symbol: "guard",
    returns: "HookResult",
  }),
);
```

Even escape hatches should receive standard hook input and return standard
`HookResult` data. The capability report should list them clearly because they
are no longer purely portable TypeScript hooks.

### Capability Report

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
receive Python, JavaScript, shell, config adapters, or executable script wrappers.

### Generated Tests

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

## Runtime Bridge Architecture

Some hosts do not just read markdown or config. They require code written in a
specific runtime, such as Python, JavaScript, shell, or another executable
environment. OIAP supports this without abandoning write-once authoring by using
a runtime bridge architecture.

```text
Author package
  -> OIAP IR
    -> Target lowering
      -> Host-native shim code
      -> Portable core invocation boundary
      -> Target bundle
```

The host-native shim is generated code. It should be boring, small, and
reviewable. Its job is to satisfy the host SDK, translate host events into OIAP
events, call the portable core, and translate results back into the host shape.

The bridge can call plugin behavior through several backends:

| Backend | When to use |
| --- | --- |
| MCP server | Best default for tools and resources when the host can call MCP or the shim can proxy MCP calls |
| JSON-RPC over stdio | Good for local deterministic tools and simple language boundaries |
| HTTP loopback | Useful when the plugin already exposes a local service |
| Generated native library | Useful for simple declarative tools that can be emitted directly in Python or JavaScript |
| WASM module | Useful for portable compute with stronger runtime isolation |
| Author-supplied target module | Escape hatch for host-only features that cannot be modeled portably |

OIAP should prefer protocol bridges over transpiling arbitrary TypeScript into
Python or arbitrary Python into JavaScript. Transpilation is fragile; a small
host shim plus stable data protocol is auditable and predictable.

## Platform Families

| Family | Platforms | High-fidelity output |
| --- | --- | --- |
| Native package targets | Claude Code, Codex, Gemini CLI, Factory Droid | Manifest, skills, commands, hooks, tools, settings, metadata |
| Rule and steering targets | Cursor, Kiro, Trae, Antigravity, VS Code Copilot Chat | Host-native rules, steering, custom instructions, activation metadata |
| Workflow and command targets | Antigravity, Gemini CLI, Factory Droid, Kiro, Aider | Slash commands, workflows, specs, watch comments, structured task artifacts |
| Subagent/custom-agent targets | Claude Code, Codex, Factory Droid, Trae, Antigravity, Kiro | Agent definitions, delegation policy, model/tool scoping, result contracts |
| MCP-capable targets | Codex, Gemini CLI, Antigravity, Factory Droid, Kiro, Kimi Code, any MCP-compatible host | Transport config, auth, tool filters, resources, prompts |
| Platform-native runtime targets | Hermes, OpenCode, host SDKs with language-specific plugins | Generated runtime shim plus portable core bridge |
| Thin compatibility targets | OpenClaw, Pi, unverified regional variants | Conservative instruction bundle and unsupported-capability report |

## Platform Analysis

### Claude Code

Claude Code is a high-fidelity package target. A bundle can include plugin
metadata, skills, commands, subagents, hooks, MCP configuration, LSP
configuration, monitors, themes, binaries, and settings. OIAP should export a
Claude plugin package when possible and render direct skill/rule files only as a
compatibility mode.

### Claude Code On Windows

Windows should not be a separate plugin implementation. It is a target dialect.
The exporter should render the same primitives with Windows path handling,
PowerShell-safe command recipes, and host wording that avoids POSIX-only
assumptions.

### Codex

Codex is a config/package target with skills, plugins, hooks, MCP, `AGENTS.md`,
approval rules, sandbox settings, and custom agents. OIAP should export TOML,
hook JSON, skills, agent definitions, MCP fragments, policy fragments, and a
clear capability report.

### OpenCode

OpenCode is a programmable extension target when its JavaScript plugin API is
available. OIAP should keep this behind an exporter profile that declares the API
version it targets, because code assets are more brittle than markdown or config
assets.

### GitHub Copilot CLI

Until a richer current extension surface is confirmed, this should remain a thin
bundle target: command guidance, skill-like instructions where supported, and a
capability report that marks hooks, subagents, and MCP as unavailable unless the
target profile says otherwise.

### VS Code Copilot Chat

VS Code Copilot Chat is primarily an editor-instruction target. OIAP should
export workspace custom instructions and shell-neutral command recipes, and avoid
assuming lifecycle hooks or background agents.

### Aider

Aider is configuration and command oriented. OIAP should export `.aider.conf.yml`
fragments, context files to be referenced by `read`, explicit slash-command
guidance, lint/test/run recipes, and optional watch-comment workflow guidance.

### OpenClaw

OpenClaw should be treated conservatively until official extension surfaces are
verified. OIAP can export a focused instruction bundle and mark unsupported
surfaces explicitly.

### Factory Droid

Factory Droid is a native plugin target with skills, custom slash commands,
custom Droids, hooks, MCP, settings, headless execution, autonomy controls, and
enterprise registry concerns. OIAP should export a plugin package and policy
fragments rather than reducing Droid to a generic instruction host.

### Trae And Trae CN

Trae has project rules, context imports, custom agents, built-in tools, and MCP
tools. OIAP should export `.trae/rules` assets, custom-agent metadata, tool
requirements, and optional localized variants. Trae CN should be a regional
target profile: the plugin IR stays the same, while the exporter changes host
names, localization, and target-specific metadata.

### Gemini CLI

Gemini CLI is a rich extension target. OIAP should export
`gemini-extension.json`, custom commands, `GEMINI.md`, skills, hooks, MCP server
definitions, settings prompts, sandbox and approval hints, and headless-mode
documentation.

### Hermes

Hermes is the architectural stress test when the platform plugin surface is
Python-native. OIAP should not force every author to rewrite their plugin in
Python. Instead, the Hermes exporter should generate a Python adapter module that
binds Hermes lifecycle events, tools, and metadata to the OIAP intermediate
representation. The adapter can forward calls to a portable core through
JSON-RPC, stdio, HTTP, MCP, or a generated Python runtime library.

### Kimi Code, Kiro, And Pi

Kimi Code should be treated as skill plus MCP until official surfaces are
verified. Kiro should export `.kiro/skills`, `.kiro/steering`, hook definitions,
MCP fragments, and spec artifacts from the same workflow primitives. Pi should
remain a thin skill target until official extension docs are verified.

### Cursor

Cursor is an editor plugin target. OIAP should export Cursor plugin directories
with `.cursor-plugin/plugin.json`, `rules/`, `skills/`, `agents/`, `commands/`,
`hooks/hooks.json`, and `mcp.json` components, then report any policy-specific
or runtime-specific gaps in the capability report.

### Google Antigravity

Antigravity is a multi-asset target with rules, workflows, skills, MCP config,
permissions, planning modes, task groups, and a browser subagent. OIAP should
export rules, workflows, skills, MCP fragments, and permission recommendations as
one coherent bundle.

## Exporter Interface

An OIAP exporter can be small if the IR is strong.

```ts
export interface PlatformExporter {
  target: TargetId;
  profile: HostProfile;
  lower(ir: PluginIr): LoweredTargetGraph;
  render(graph: LoweredTargetGraph): TargetBundle;
  validate(bundle: TargetBundle): ValidationIssue[];
}

export interface HostProfile {
  id: TargetId;
  verification: "official" | "profile-derived" | "thin";
  packageSupport?: PackageSupport;
  skillSupport?: SkillSupport;
  commandSupport?: CommandSupport;
  ruleSupport?: RuleSupport;
  hookSupport?: HookSupport;
  mcpSupport?: McpSupport;
  permissionSupport?: PermissionSupport;
  runtimeSupport?: RuntimeSupport;
  shellDialects: ShellDialect[];
  configFormats: ConfigFormat[];
}
```

Profiles should be data-driven where possible. A profile tells the exporter what
the host supports; the exporter tells the author how much of the plugin mapped
cleanly.

## Author Experience

The authoring flow should look like building software, not configuring local
agent tools:

```bash
oiap init my-plugin
oiap add command analyze --schema schemas/analyze.schema.json
oiap add workflow analyze-workspace workflows/analyze-workspace.ts
oiap add mcp my-plugin -- node dist/mcp.js
oiap export --target claude-code --target codex --target gemini-cli --target hermes
oiap verify dist/hermes
```

The result is a set of target bundles under `dist/`. Adoption into a host is a
separate step owned by that host's tooling or the user's distribution process.

## Recommended Package Layout

```text
plugin/
  oiap.plugin.ts
  manifest.json
  instructions/
    command.md
    always-on.md
    safety.md
  workflows/
    analyze-workspace.ts
    answer-question.ts
  schemas/
    command.schema.json
    tool-result.schema.json
  recipes/
    detect-files.recipe.ts
    run-analysis.recipe.ts
  tools/
    mcp.ts
  runtime/
    portable-server.ts
  target-modules/
    hermes/
      native_plugin.py
  policies/
    permissions.ts
    sandbox.ts
  exporters/
    overrides.ts
```

Most plugins should not need custom target modules. They exist for host-only
features and for platforms whose extension SDK cannot be represented purely with
declarative primitives.

## Practical MVP

The smallest useful OIAP implementation should support these primitives first:

1. `PluginManifest`
2. `TargetBundle`
3. `Invocation`
4. `InstructionModule`
5. `CommandAsset`
6. `ProjectRule`
7. `SkillAsset`
8. `CommandRecipe`
9. `HookDefinition` with fallback
10. `ToolSurface`
11. `McpServer`
12. `RuntimeModule`
13. `PermissionPolicy`
14. `ExportPlan`
15. `Artifact`

That MVP covers prompt/config hosts, MCP-capable hosts, and Python/JavaScript or
shell runtime hosts without requiring plugin authors to manually rewrite the same
plugin for every harness.

## Open Questions

- What should be the canonical source language for OIAP plugins: TypeScript,
  JSON/YAML, or both?
- How much behavior should be represented as structured workflow DAGs versus
  instruction modules?
- Should MCP be the default portable tool boundary for all imperative behavior?
- How should target profiles be versioned when host docs and SDKs change?
- How should OIAP test generated Python, JavaScript, and shell runtime shims?
- What signing or provenance model should target bundles use?
- How should marketplace metadata differ from local bundle metadata?
- How should target-specific escape hatches be audited so they do not silently
  fork the plugin logic?

## Summary

OIAP is developer tooling for authoring once and exporting many bundles. The
center of the architecture is a portable plugin IR. Around it are target
exporters, host profiles, validators, and runtime bridge generators.
Declarative hosts receive markdown, rules, skills, commands, and config. Rich
hosts receive native package bundles. Runtime SDK hosts, including Python-native
platforms, receive generated adapter shims that call back into the portable core
through a stable bridge.

The design principle is export fidelity: generate the richest native bundle a
host supports, preserve a clear source map back to the OIAP primitives, and make
every degraded or target-specific choice visible in the bundle report.

## Related Documents

- [Platform Matrix](MATRIX.md)