# Agent Plugin Authoring and Export Model

OIAP exists to give plugin authors one stable authoring model and many target
bundle exporters. The developer defines a plugin once using host-neutral
primitives. OIAP then exports platform-specific bundles for agent harnesses such
as Claude Code, Codex, Gemini CLI, Kiro, Cursor, Trae, Factory Droid,
Antigravity, Hermes, and other hosts.

The scope is export, not placement. OIAP should produce validated bundle
directories, manifests, generated code, rules, skills, workflows, MCP
configuration fragments, policy fragments, and compatibility reports. It should
not be responsible for mutating a user's home directory, editing live host
configuration, auto-detecting every local agent tool, or applying the generated
bundle into a running harness. A separate consumer, package manager, host CLI, or
human can decide how the exported bundle is adopted.

The core promise is simple:

1. Define the plugin once in OIAP.
2. Normalize it into a portable intermediate representation.
3. Export host-native bundles from that representation.
4. Report which capabilities are native, degraded, or unsupported per target.

For shared terminology used throughout this document, see the [Glossary](glossary.md).

## Target Platform Set

The initial target set should cover the harness families already common in the
agent ecosystem:

| Platform | Primary bundle surface |
| --- | --- |
| Claude Code | Plugin package, skills, commands, agents, hooks, MCP, settings |
| Codex | Plugin/config package, skills, `AGENTS.md`, hooks, MCP, rules, custom agents |
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
| Google Antigravity | Rules, workflows, skills, MCP configuration, permissions, task groups |

This table is not an adoption workflow. It is an export matrix: each row answers
"what kind of bundle can OIAP generate for this host?"

For the living capability matrix and adapter package status, see the
[Platform Support Matrix](platform-matrix.md).

## Scope Boundaries

OIAP should own:

- A plugin authoring SDK.
- A target-neutral plugin intermediate representation.
- Exporters for host-native bundle formats.
- Generated target files, manifests, source maps, and verification reports.
- Capability negotiation and graceful degradation.
- Runtime bridge templates for hosts that require platform-native code.

OIAP should not own:

- Writing directly into a user's global agent configuration.
- Editing a repository's live instruction files by default.
- Auto-enabling hooks, MCP servers, permissions, or sandbox exceptions.
- Host account auth, marketplace publishing, or organization policy decisions.
- Replacing a host's official package manager or extension manager.

This boundary keeps OIAP usable in CI, package registries, enterprise review
flows, and local development without assuming authority over the user's agent
environment.

## What Varies Across Hosts

The same plugin behavior must lower into several incompatible host surfaces:

| Surface | Host examples | OIAP primitive needed |
| --- | --- | --- |
| Distribution package | Claude plugins, Codex plugins, Gemini extensions, Factory plugins | `TargetBundle` and `DistributionPackage` |
| Skills | Agent Skills folders, Claude skills, Gemini extension skills, Kiro skills, Factory skills | `SkillAsset` |
| Commands | Claude commands, Gemini TOML commands, Factory slash commands, workflow invocations | `CommandAsset` and `Invocation` |
| Project rules | `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Cursor rules, Kiro steering, Trae rules, Antigravity rules | `ProjectRule` |
| Hooks | Claude lifecycle hooks, Codex hooks, Gemini hooks, Factory hooks, Kiro hooks, OpenCode events | `Hook` |
| Delegation | Claude subagents, Codex custom agents, Factory Droids, Trae custom agents, browser subagents | `DelegationStrategy` and `AgentDefinition` |
| Runtime code | JavaScript extensions, Python plugins, shell hooks, generated wrappers | `RuntimeModule` |
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

For the strategy to prove exported bundles work in real target environments, see
the [Platform Conformance Test Harness](test-harness.md).

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
states what mapped natively, what degraded, and what was omitted. `source-map.json`
maps generated host files back to OIAP primitives so reviewers can audit why a
file exists.

## Primitive Set

### 1. Plugin Manifest

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

### 2. Target Bundle

The target bundle is the exported artifact, not a mutation plan.

```ts
export interface TargetBundle {
  target: TargetId;
  format: "directory" | "archive" | "manifest-only";
  files: RenderedFile[];
  package?: DistributionPackage;
  report: ExportReport;
}

export interface DistributionPackage {
  id: string;
  target: TargetId;
  manifestPath: string;
  assets: PackageAssetRef[];
  marketplace?: MarketplaceMetadata;
  trustModel: "local" | "reviewed" | "managed" | "signed";
  settings?: PackageSetting[];
}
```

Some hosts have a first-class package format. Others only support loose files or
instructions. OIAP should represent both as target bundles, with package metadata
present only when the host supports it.

### 3. Invocation

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

### 4. Instruction Module

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

### 5. Command Asset

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

### 6. Workflow

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

export type WorkflowStep =
  | RunCommandStep
  | ReadFileStep
  | WriteFileStep
  | PatchFileStep
  | SpawnWorkersStep
  | CallToolStep
  | StartMcpServerStep
  | AskUserStep
  | ConditionalStep;
```

Targets with native workflows receive structured workflow assets. Thin targets
receive clear instruction modules that describe the same workflow.

### 7. Command Recipe

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

### 8. Artifact Model

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

### 9. Project Rule

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

### 10. Hook

Hooks express desired host lifecycle events without hardcoding host schemas into
plugin logic.

```ts
export interface Hook {
  id: string;
  event:
    | "session_start"
    | "user_prompt_submit"
    | "before_tool"
    | "permission_request"
    | "after_tool"
    | "before_agent"
    | "after_agent"
    | "stop";
  matcher?: string | string[];
  handlerKind: "command" | "prompt" | "agent" | "http" | "mcp_tool";
  action: HookAction;
  optional: boolean;
  requiresUserTrust?: boolean;
  fallbackRule?: ProjectRuleRef;
}
```

If a target lacks hooks, OIAP should render the fallback rule or omit the hook
with a capability warning.

### 11. Delegation Strategy

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

### 12. Tool Surface

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

export interface McpServer {
  command?: string;
  args?: string[];
  url?: string;
  httpUrl?: string;
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  includeTools?: string[];
  excludeTools?: string[];
  auth?: McpAuthPolicy;
  required?: boolean;
}
```

MCP should be the preferred portable tool boundary when a host supports it.
Targets that lack MCP receive command or instruction fallbacks.

### 13. Runtime Module

Runtime modules represent target-native code generated or supplied for a bundle.

```ts
export interface RuntimeModule {
  id: string;
  target: TargetId;
  language: "typescript" | "javascript" | "python" | "shell" | "wasm";
  purpose: "host_adapter" | "tool_server" | "hook_handler" | "command_runner";
  entrypoint: string;
  generated: boolean;
  source?: string;
  bridgesTo?: ToolSurfaceRef | WorkflowRef | HookRef;
}
```

This primitive is what lets OIAP handle hosts whose plugin surface is an SDK in a
specific language.

### 14. Export Plan

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

### 15. Policy and Safety

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
export workspace custom instructions and shell-neutral command recipes, and
avoid assuming lifecycle hooks or background agents.

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

### Trae

Trae has project rules, context imports, custom agents, built-in tools, and MCP
tools. OIAP should export `.trae/rules` assets, custom-agent metadata, tool
requirements, and optional localized variants.

### Trae CN

Trae CN should be a regional target profile. The plugin IR should stay the same;
the exporter changes host names, localization, and target-specific metadata.

### Gemini CLI

Gemini CLI is a rich extension target. OIAP should export `gemini-extension.json`,
custom commands, `GEMINI.md`, skills, hooks, MCP server definitions, settings
prompts, sandbox and approval hints, and headless-mode documentation.

### Hermes

Hermes is the architectural stress test when the platform plugin surface is
Python-native. OIAP should not force every author to rewrite their plugin in
Python. Instead, the Hermes exporter should generate a Python adapter module that
binds Hermes lifecycle events, tools, and metadata to the OIAP intermediate
representation. The adapter can forward calls to a portable core through JSON-RPC,
stdio, HTTP, MCP, or a generated Python runtime library.

The important design move is to separate host glue from plugin logic:

- Host glue: generated Python files that satisfy Hermes' plugin API.
- Portable core: OIAP workflows, tool schemas, command recipes, and policy.
- Bridge boundary: a stable protocol for calling the portable core from Python.
- Escape hatch: optional author-supplied Python modules for features that cannot
  be represented in the portable IR.

### Kimi Code

Kimi Code should be treated as skill plus MCP until official surfaces are
verified. OIAP can still export MCP declarations and instruction assets, but the
bundle report should mark assumptions clearly.

### Kiro IDE/CLI

Kiro supports Agent Skills, steering files, hooks, MCP, and specs. OIAP should
export `.kiro/skills`, `.kiro/steering`, hook definitions, MCP fragments, and
spec artifacts from the same workflow primitives.

### Pi Coding Agent

Pi should remain a thin skill target until official extension docs are verified.
The exporter should render clear instructions and a capability report.

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

## Handling Platform-Native Runtime Plugins

Some hosts do not just read markdown or config. They require code written in a
specific runtime, such as Python or JavaScript. Hermes is the clearest example if
its plugin contract is Python-defined. OIAP can support this without abandoning
write-once authoring by using a runtime bridge architecture.

### Runtime Bridge Architecture

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

For a Python-native target, the generated bundle might look like this:

```text
dist/hermes/package/
  hermes_plugin.py
  oiap_bundle.json
  oiap_runtime/
    bridge.py
    schemas.py
  assets/
    instructions.md
    tool-schemas.json
```

The generated Python would be a target adapter, not the source of truth:

```python
# Generated adapter sketch. Exact imports/classes come from the target profile.
from oiap_runtime.bridge import invoke_tool, load_bundle

bundle = load_bundle("oiap_bundle.json")

class ExportedPlugin:
    name = bundle["name"]
    description = bundle["description"]

    def tools(self):
        return bundle["tools"]

    def call_tool(self, name, arguments):
        return invoke_tool(bundle=bundle, name=name, arguments=arguments)
```

The real exporter would replace `ExportedPlugin` with the exact class, decorator,
or registration API required by the host. The point is that OIAP emits that glue
from templates and schemas.

### Portable Core Options

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

For the TypeScript-first hook API, side-effect policy, async behavior, and
runtime-specific adapter contract, see the [Runtime Bridge Pattern](runtime-bridge-pattern.md).

### Runtime Module Contract

Runtime backends should implement a narrow contract:

```ts
export interface RuntimeBackend {
  target: TargetId;
  language: RuntimeLanguage;
  generate(module: RuntimeModule, ir: PluginIr): RenderedFile[];
  validate(files: RenderedFile[]): ValidationIssue[];
  testHarness?: RuntimeTestHarness;
}
```

Each backend owns its templates, dependency metadata, generated tests, and target
schema validation. For a Python-native platform, that likely means a target
exporter package plus a tiny Python runtime package.

### Author Escape Hatches

Some platform SDK features will not map cleanly to the portable model. OIAP
should support explicit target modules for those cases:

```ts
export default definePlugin({
  manifest,
  tools,
  workflows,
  targetModules: {
    hermes: pythonModule({
      entrypoint: "src/hermes/native_plugin.py",
      exposes: ["custom_panel", "native_hook"]
    })
  }
});
```

Escape hatches should be isolated. They should not fork the whole plugin; they
only fill gaps that the generic primitives cannot express yet. The capability
report should make those target-specific modules visible.

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
  configFormats: ("json" | "toml" | "markdown" | "yaml-frontmatter" | "python" | "javascript")[];
}
```

Profiles should be data-driven where possible. A profile tells the exporter what
the host supports; the exporter tells the author how much of the plugin mapped
cleanly.

## Minimal Author Experience

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

## Generated Documentation

Each bundle should include a generated `README.md` covering:

- What the bundle contains.
- Which host version/profile it targets.
- Which capabilities mapped natively.
- Which capabilities degraded or were omitted.
- What commands, hooks, tools, and policies the bundle declares.
- What runtime code was generated.
- What target-specific modules were supplied by the author.
- What files are expected to be reviewed before adoption.

## Recommended OIAP Package Layout

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
9. `Hook` with fallback
10. `ToolSurface`
11. `McpServer`
12. `RuntimeModule`
13. `PermissionPolicy`
14. `ExportPlan`
15. `Artifact`

That MVP covers prompt/config hosts, MCP-capable hosts, and Python/JavaScript
runtime hosts without requiring plugin authors to manually rewrite the same
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

OIAP should be developer tooling for authoring once and exporting many bundles.
The center of the architecture is a portable plugin IR. Around it are target
exporters, host profiles, validators, and runtime bridge generators. Declarative
hosts receive markdown, rules, skills, commands, and config. Rich hosts receive
native package bundles. Runtime SDK hosts, including Python-native platforms,
receive generated adapter shims that call back into the portable core through a
stable bridge.

The design principle is export fidelity: generate the richest native bundle a
host supports, preserve a clear source map back to the OIAP primitives, and make
every degraded or target-specific choice visible in the bundle report.