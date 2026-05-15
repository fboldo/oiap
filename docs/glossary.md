# Glossary

This glossary defines the shared terms used across the OIAP design documents.
It favors OIAP's intended meaning over any one platform's terminology.

## Core Concepts

| Term | Meaning |
| --- | --- |
| OIAP | Open Interoperable Agent Plugins. The SDK and tooling for defining an agent plugin once and exporting host-specific bundles. |
| Agent harness | A product or runtime that hosts an AI coding agent, such as Claude Code, Codex, Gemini CLI, Cursor, Kiro, or another target platform. |
| Host | The specific agent harness receiving an exported OIAP bundle. |
| Target | A named export destination, usually one host plus a profile, operating-system dialect, region, or runtime variant. |
| Platform profile | The structured description of what a target supports: packages, rules, skills, commands, hooks, MCP, runtime code, permissions, and policy. |
| Plugin | The author-defined OIAP package containing manifest data, instructions, workflows, hooks, tools, policies, and optional target overrides. |
| Primitive | A host-neutral OIAP building block, such as `Hook`, `ProjectRule`, `ToolSurface`, `CommandAsset`, or `PermissionPolicy`. |
| Intermediate representation | The normalized internal model produced from plugin source before target exporters render host-specific files. Often shortened to IR. |
| Write once, export many | The OIAP design goal: authors define plugin behavior once, then OIAP generates bundles for many agent harnesses. |

## Authoring Concepts

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

## Export Concepts

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

## Platform Surface Concepts

| Term | Meaning |
| --- | --- |
| Package surface | Host support for a first-class plugin, extension, or package format. |
| Rule surface | Host support for persistent instruction files such as `AGENTS.md`, `GEMINI.md`, Cursor rules, Kiro steering, Trae rules, or similar assets. |
| Skill surface | Host support for reusable instruction bundles that can be invoked or discovered by the agent. |
| Command surface | Host support for slash commands, command files, custom commands, workflows invoked by name, or prompt commands. |
| Hook surface | Host support for lifecycle events such as session start, prompt submit, before tool use, permission request, after tool use, agent stop, or related events. |
| Agent surface | Host support for custom agents, subagents, Droids, task groups, browser subagents, or other delegation mechanisms. |
| MCP surface | Host support for Model Context Protocol servers, tools, resources, prompts, transports, and related tool filtering. |
| Runtime surface | Host support that requires code in a specific runtime, such as Python plugins, JavaScript extensions, shell hooks, or generated binaries. |
| Policy surface | Host support for permissions, approvals, sandboxing, autonomy controls, network rules, path access, or destructive-action controls. |

## Hook And Runtime Concepts

| Term | Meaning |
| --- | --- |
| Hook | An OIAP lifecycle function that receives a standard `HookContext` and returns a standard `HookResult`. |
| Hook context | The standardized argument passed to a TypeScript hook. It contains event data, workspace data, deadline, cancellation signal, services, and logging. |
| Hook result | The required return value from a hook, such as allow, block, ask, modify, inject context, replace result, schedule, or noop. |
| Hook runner | The executable boundary that loads compiled TypeScript hooks, builds `HookContext`, enforces policy, and returns serialized `HookResult` data. |
| Runtime bridge | Generated adapter architecture that lets a host-native runtime call OIAP's TypeScript hook runner or portable core. |
| Runtime module | Target-native code generated or supplied for a bundle, such as a Python adapter, JavaScript extension, hook handler, tool server, or command runner. |
| Host adapter | Generated host-native code that registers with a platform API and forwards behavior into OIAP's hook runner or runtime bridge. |
| Target module | Explicit author-supplied target-specific code used as an escape hatch when a host feature cannot be represented portably. |
| Escape hatch | A narrow target-specific override. It should fill gaps in the portable model without forking the entire plugin. |
| Runtime binding | Exporter metadata describing how a hook or runtime module executes for one target, including adapter language, bridge transport, timeout, and failure mode. |

## Tooling And Policy Concepts

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

## Matrix Concepts

| Term | Meaning |
| --- | --- |
| Core target | A high-fidelity target expected to support several native surfaces such as packages, skills, commands, hooks, MCP, and policy. |
| Editor target | A target centered on editor rules, workspace instructions, MCP, custom agents, and developer workflow assets. |
| Bridge target | A target that needs generated runtime adapter code because the host plugin API is language-specific or runtime-specific. |
| Thin target | A conservative target where OIAP can export instructions or simple assets, but richer platform surfaces still need verification. |
| Regional target | A target profile that shares most behavior with another platform but differs by region, localization, docs, naming, or policy. |
| Adapter review queue | The tracked list of mismatches between platform documentation, the support matrix, and implemented exporters. |

## Conformance Concepts

| Term | Meaning |
| --- | --- |
| Conformance harness | The OIAP test system that exports probe plugins, runs them against target platforms, and produces evidence that an adapter works. |
| Assurance level | A graded claim about how strongly a surface has been tested, from static validation through real-host release conformance. |
| Probe plugin | A small OIAP plugin designed to exercise one platform surface or behavior deterministically. |
| Target driver | Test-only automation that adopts an exported bundle into an isolated target environment and runs conformance scenarios. |
| Environment provider | The local workspace, container, VM, editor automation, browser automation, remote runner, or manual mode used by a target driver. |
| Scenario | A data-driven conformance test describing the probe, target, steps, required surfaces, and expected evidence. |
| Oracle | A checker that decides whether observed behavior satisfies the expected contract. |
| Evidence bundle | The structured output of a conformance run, including environment metadata, exported bundle, logs, traces, scenario results, and summary. |
| Fixture workspace | Disposable project workspace used by conformance tests to avoid touching a real user repository. |
| Real-host test | A conformance run that uses the actual target CLI, IDE, SDK, or hosted platform instead of only a simulator. |

## See Also

- [Agent Plugin Authoring and Export Model](platform-primitives.md)
- [Platform Support Matrix](platform-matrix.md)
- [Runtime Bridge Pattern](runtime-bridge-pattern.md)
- [Platform Conformance Test Harness](test-harness.md)