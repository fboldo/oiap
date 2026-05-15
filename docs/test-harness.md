# Platform Conformance Test Harness

OIAP needs a test harness that can make a strong, evidence-backed claim: a plugin
defined with OIAP exports correctly and works on a given target platform. This
cannot stop at snapshot tests. The harness should validate generated files,
exercise target adapters, run exported bundles inside controlled host
environments, and produce auditable evidence for each platform capability.

The harness should be designed as a conformance system. It proves that an OIAP
exporter and target profile satisfy a shared contract for one host. When full
automation is impossible, it records the highest trustworthy assurance level and
the exact gap.

## Goals

- Prove that exported bundles are structurally valid for a target.
- Prove that the target can load or recognize the generated bundle in a clean
  test environment.
- Prove that declared surfaces are discoverable: commands, skills, rules, hooks,
  MCP tools, agents, runtime modules, and policies.
- Prove that representative behavior executes end to end.
- Prove that hooks and runtime bridges actually fire in the host runtime.
- Prove that permissions, failure modes, and degraded capabilities are reported
  truthfully.
- Produce machine-readable evidence that can update release gates, support
  matrices, and adapter review queues.

## Non-Goals

- OIAP should not mutate a user's real agent configuration as part of normal
  testing.
- The harness should not claim to prove model quality or agent reasoning quality.
- The harness should not require every contributor to have every proprietary host
  installed locally.
- The harness should not hide manual or credential-gated gaps behind a green
  check.

Some hosts will only support partial automation. That is acceptable if the
evidence report says exactly what was tested and what still needs manual or
vendor-assisted verification.

## What "Works" Means

For OIAP, a plugin works on a target when each declared capability reaches an
appropriate assurance level for that platform.

| Surface | Evidence that it works |
| --- | --- |
| Package | Host accepts or recognizes the generated package, manifest, or bundle layout. |
| Rules | Host sees the generated rule or instruction content in the expected scope and activation mode. |
| Skills | Host discovers the generated skill and can invoke or reference it through the expected mechanism. |
| Commands | Host exposes the generated command and passes typed arguments into the intended handler or prompt. |
| Hooks | Host emits the lifecycle event and the generated hook path returns the expected decision. |
| Agents | Host discovers the custom agent, subagent, Droid, task group, or delegation asset and can route a task to it. |
| MCP | Host starts or connects to the MCP server and can call expected tools/resources/prompts. |
| Runtime | Host-native adapter code invokes the OIAP hook runner or runtime bridge and handles success, failure, timeout, and cancellation. |
| Policy | Host enforces, exposes, or truthfully reports permissions, approvals, sandboxing, and denied operations. |
| Degradation | Capability report matches the actual observed host behavior. |

The harness should test both positive paths and negative controls. A hook test is
not serious if it only proves that a command completed. It should also prove that
the hook can block, modify, ask, or fail according to the configured policy when
the target claims those decisions are supported.

## Assurance Levels

Each target and surface should report the highest level reached.

| Level | Name | Claim |
| --- | --- | --- |
| L0 | Static | Generated files pass schemas, snapshots, lint rules, and capability-report checks. |
| L1 | Adapter contract | Exporter output satisfies target profile contracts and generated adapter tests pass with fake host events. |
| L2 | Simulated host | A local simulator or fake host loads the bundle and exercises target semantics without the real platform. |
| L3 | Real host smoke | The real CLI, IDE, or SDK recognizes the bundle in a disposable environment and exposes expected surfaces. |
| L4 | Real host behavior | The real host executes representative commands, hooks, MCP calls, runtime bridge calls, and policy checks. |
| L5 | Release conformance | A repeatable, version-pinned, evidence-producing run covers the target's required capability set across supported OS/runtime profiles. |

The matrix should avoid a binary pass/fail story. A target might have L5 command
coverage, L4 MCP coverage, L1 hook coverage, and no agent coverage yet.

## Architecture

```text
Probe plugin corpus
  -> OIAP exporter
    -> target bundle
      -> static validators
      -> target driver
        -> isolated host environment
          -> scenario runner
            -> oracle checks
              -> evidence bundle
                -> support matrix and release gate
```

The harness has six core parts:

| Component | Responsibility |
| --- | --- |
| Probe plugin corpus | Small OIAP plugins designed to exercise one or more platform surfaces. |
| Static validators | Schema checks, generated file checks, source-map checks, and capability-report checks. |
| Target driver | Platform-specific automation for adopting the exported bundle into a disposable test environment and exercising host behavior. |
| Environment provider | Local process, container, VM, IDE automation, or remote environment used by the target driver. |
| Scenario runner | Executes test scenarios and captures host outputs, filesystem changes, process events, MCP traffic, and traces. |
| Oracle | Determines whether observed behavior satisfies the expected contract. |

## Target Driver Contract

Every serious platform adapter should eventually have a target driver. The driver
is test-only code. It may place a bundle into a temporary home directory,
workspace, container, or VM because conformance tests need controlled adoption.
That does not change OIAP's product boundary: normal OIAP export still produces
bundles without mutating a user's real environment.

```ts
export interface TargetConformanceDriver {
  target: TargetId;
  profile: HostProfile;

  prepareEnvironment(request: EnvironmentRequest): Promise<TestEnvironment>;
  exportBundle(plugin: ProbePluginRef, target: TargetId): Promise<TargetBundle>;
  adoptBundle(bundle: TargetBundle, environment: TestEnvironment): Promise<AdoptionResult>;
  discoverSurfaces(environment: TestEnvironment): Promise<DiscoveredSurface[]>;
  runScenario(scenario: ConformanceScenario, environment: TestEnvironment): Promise<ScenarioResult>;
  collectEvidence(environment: TestEnvironment): Promise<EvidenceBundle>;
  teardown(environment: TestEnvironment): Promise<void>;
}
```

The driver should be explicit about what it can and cannot automate:

```ts
export interface DriverCapabilityReport {
  target: TargetId;
  maxAssuranceBySurface: Partial<Record<PlatformSurface, AssuranceLevel>>;
  requiresCredentials: boolean;
  requiresProprietaryHost: boolean;
  supportedOperatingSystems: OperatingSystem[];
  unsupportedReasons: DriverUnsupportedReason[];
}
```

## Probe Plugin Corpus

The harness needs intentionally small plugins that test one concept at a time.
These are not examples for users; they are conformance probes.

| Probe | Purpose |
| --- | --- |
| `rule-basic` | Verifies project rule rendering and host recognition. |
| `skill-basic` | Verifies skill metadata, discovery, and invocation. |
| `command-args` | Verifies command registration and typed argument passing. |
| `hook-allow-block` | Verifies before-event hooks fire and decisions map correctly. |
| `hook-modify` | Verifies supported argument/result mutation semantics. |
| `mcp-tool-call` | Verifies MCP server declaration, startup, tool discovery, and tool call. |
| `runtime-bridge-ts` | Verifies a target-native adapter calls the compiled TypeScript hook runner. |
| `policy-deny` | Verifies permission denial, approval, sandbox, or unsupported-policy reporting. |
| `agent-delegation` | Verifies custom agent/subagent/Droid/task-group discovery and routing when supported. |
| `full-stack` | Combines rule, command, hook, MCP, runtime bridge, and capability report checks. |

Each probe should include deterministic sentinels in outputs so tests can prove
the expected path executed. For example, an MCP tool might return
`oiap-probe:mcp-tool-call:<scenario-id>`, and a hook might write a trace record
with the hook ID and decision.

## Scenario Format

Scenarios should be data-driven so one probe can run against many targets.

```ts
export interface ConformanceScenario {
  id: string;
  probe: string;
  target: TargetId;
  requiredLevel: AssuranceLevel;
  surfaces: PlatformSurface[];
  steps: ScenarioStep[];
  expectations: ScenarioExpectation[];
  cleanup?: CleanupStep[];
}

export type ScenarioStep =
  | { kind: "invoke-command"; name: string; args?: Record<string, unknown> }
  | { kind: "submit-prompt"; text: string }
  | { kind: "call-mcp-tool"; tool: string; args?: Record<string, unknown> }
  | { kind: "trigger-hook"; event: HookEventName; payload: unknown }
  | { kind: "run-host-command"; command: string; args?: string[] }
  | { kind: "inspect-file"; path: string }
  | { kind: "wait-for-trace"; traceId: string; timeoutMs: number };
```

Scenarios should avoid relying on model creativity. They should ask for direct,
deterministic actions and then verify concrete evidence: files, logs, traces,
structured JSON, MCP responses, process exit codes, or host-discovered surfaces.

## Oracles

An oracle decides whether observed behavior satisfies the contract.

| Oracle | Checks |
| --- | --- |
| Schema oracle | Generated manifests, configs, TOML, JSON, YAML, frontmatter, and capability reports. |
| Snapshot oracle | Stable rendered files and source maps. |
| Discovery oracle | Host lists expected commands, skills, rules, tools, agents, or package metadata. |
| Execution oracle | Host command, hook, or tool call produces expected sentinel output. |
| Trace oracle | Hook runner, runtime bridge, or adapter emits expected trace records. |
| Policy oracle | Denied operations fail closed, allowed operations pass, and unsupported enforcement is reported. |
| Regression oracle | Repeated runs produce stable results under the same host version and target profile. |

The harness should prefer machine-checkable oracles. If a platform only exposes a
visual UI, the driver can use UI automation screenshots or accessibility trees,
but the evidence should still reduce to concrete assertions.

## Evidence Bundle

Every conformance run should emit an evidence bundle. This makes test results
auditable and lets the platform matrix cite real observed behavior.

```text
conformance-results/
  <run-id>/
    run.json
    environment.json
    target-profile.json
    exported-bundle/
    capability-report.json
    source-map.json
    scenarios/
      <scenario-id>/
        scenario.json
        result.json
        stdout.log
        stderr.log
        traces.jsonl
        files/
        screenshots/
    summary.md
```

`run.json` should include host version, adapter version, exporter version,
operating system, runtime versions, environment provider, timestamps, and whether
credentials or proprietary tools were required.

## Environment Providers

Different hosts require different levels of isolation.

| Provider | Use case |
| --- | --- |
| Local temporary workspace | Fast CLI tests that can use an isolated workspace and temporary home directory. |
| Container | Linux CLI tests with reproducible dependencies and no host UI. |
| VM | Hosts requiring full OS isolation, GUI, or stricter filesystem isolation. |
| VS Code automation | Editor targets that need workspace customizations, UI surfaces, or extension APIs. |
| Browser automation | Web or browser-subagent targets where surface discovery happens through a browser UI. |
| Remote runner | Hosted platforms that require vendor credentials or cloud execution. |
| Manual evidence mode | Last resort for targets that cannot be automated yet. Must produce structured notes and artifacts. |

Environment providers should never reuse a contributor's real home directory or
real project settings. They should use temporary homes, temporary workspaces,
mock secrets, and pinned runtime versions whenever possible.

## Host Automation Strategies

### CLI Targets

For CLI-first platforms, the driver should run the real CLI with a temporary
home, temporary workspace, and target bundle adopted into that environment. It
should capture stdout, stderr, exit code, generated files, and structured host
logs where available.

### IDE Targets

For editor-first platforms, the driver should open a fixture workspace in an
isolated editor profile. It should verify generated rules, skills, commands,
custom agents, MCP configs, and any UI-visible surfaces through editor APIs,
command execution, accessibility trees, or screenshots.

### Runtime Bridge Targets

For targets such as Python-native or JavaScript-native hosts, the driver should
test both sides of the bridge:

1. A fake host invokes the generated adapter with controlled events.
2. The real host, when available, invokes the generated adapter through its
   native plugin mechanism.
3. The adapter calls the OIAP hook runner.
4. The compiled TypeScript hook returns a standard `HookResult`.
5. The adapter maps the result back to a host-native decision.

### MCP Targets

For MCP-capable targets, the driver should test server startup, tool discovery,
tool invocation, resource reads, prompt exposure, tool filtering, auth headers,
and timeout behavior where the host supports them.

## Handling Nondeterminism

Agent platforms are partly nondeterministic because model behavior can vary. The
harness should reduce nondeterminism by testing surfaces rather than taste.

Recommended practices:

- Use deterministic probes and sentinel outputs.
- Prefer host commands and tool calls over open-ended chat when possible.
- Use tiny fixture workspaces with obvious expected changes.
- Assert file changes, structured JSON, traces, and exit codes.
- Run retries only for explicitly flaky host startup, not for failed behavior.
- Record every retry in the evidence bundle.
- Separate "host loaded the plugin" from "the model chose to use the plugin".

If a platform only exposes behavior through natural language, the scenario should
ask for a narrow action and the oracle should verify a concrete artifact.

## Security And Safety

The harness will intentionally run generated hooks, commands, MCP servers, and
runtime adapters. It needs strong safety defaults.

- Use disposable workspaces and disposable homes.
- Use mock credentials unless the scenario explicitly needs real credentials.
- Redact secrets from logs and evidence bundles.
- Deny network by default except for declared scenarios.
- Deny process spawning by default except for declared probes.
- Bound all timeouts, output sizes, and child process lifetimes.
- Never run destructive probes against a real user workspace.
- Keep credential-gated runs out of default PR checks.
- Mark proprietary-host runs separately from open local runs.

## CI Strategy

The harness should support multiple lanes.

| Lane | Runs on | Purpose |
| --- | --- | --- |
| PR static | Every pull request | L0 schemas, snapshots, capability reports, source maps, and unit tests. |
| PR simulated | Every pull request when cheap | L1-L2 adapter contracts and fake-host scenarios. |
| Nightly local | Scheduled | Real CLI tests for hosts available in CI without secrets. |
| Nightly credentialed | Scheduled, protected | Hosted or proprietary targets requiring credentials. |
| Release conformance | Before release | Full supported target matrix with evidence bundles and summarized assurance levels. |
| Manual certification | As needed | Human-assisted evidence for targets without stable automation. |

PR checks should be fast and deterministic. Release conformance can be slower and
more expensive because it produces the evidence OIAP relies on for support
claims.

## Matrix Integration

The harness should feed the [Platform Support Matrix](platform-matrix.md). Each
target should eventually have a conformance summary with:

- Highest assurance level per surface.
- Last passing host version.
- Last passing adapter/exporter version.
- Evidence bundle path or CI run link.
- Known gaps and manual-only surfaces.

The matrix should not upgrade a `?`, `P`, or `Y` mark solely because a document
says a feature exists. It should upgrade support confidence when both docs and
conformance evidence agree.

## Planned Package Layout

```text
packages/
  conformance-core/
    src/assurance.ts
    src/evidence.ts
    src/oracles.ts
    src/scenario.ts
  conformance-runner/
    src/cli.ts
    src/run.ts
    src/report.ts
  conformance-testkit/
    src/fake-host.ts
    src/fixtures.ts
    src/probes.ts
  conformance-drivers/
    claude-code/
    codex/
    gemini-cli/
    hermes/
    cursor/
  probes/
    rule-basic/
    skill-basic/
    command-args/
    hook-allow-block/
    mcp-tool-call/
    runtime-bridge-ts/
```

Target drivers can start inside `packages/conformance-drivers/<target>` and move
near each exporter later if that becomes easier to maintain.

## Release Gate

An adapter should not be marked production-ready until it has:

1. L0 static validation for every generated file type.
2. L1 adapter contract tests for every declared surface.
3. L2 simulated host tests for hooks, commands, MCP, runtime bridge, and policy
   when those surfaces exist.
4. L3 real-host discovery for the target's primary package, rule, skill,
   command, or MCP surfaces.
5. L4 behavior tests for at least one representative end-to-end plugin.
6. Evidence bundle output with host version, exporter version, target profile,
   logs, traces, and capability report.
7. Clear documentation of surfaces that cannot yet be automated.

L5 should be required for targets OIAP claims as fully supported. Lower levels
are acceptable for experimental, thin, or unverified targets if the support
matrix says so plainly.

## MVP Plan

The smallest useful harness should target one CLI platform, one editor/platform
with rules, and one runtime bridge platform.

1. Build `conformance-core` types for assurance levels, scenarios, evidence, and
   oracles.
2. Build a fake-host simulator for L1-L2 adapter tests.
3. Create probe plugins for rules, commands, hooks, MCP, runtime bridge, and
   policy denial.
4. Add static validators for `TargetBundle`, `capability-report.json`, and
   `source-map.json`.
5. Build one real CLI driver, likely Gemini CLI or Codex depending on available
   automation.
6. Build one runtime bridge driver, likely Hermes-style Python fake host first.
7. Generate evidence bundles and a Markdown summary.
8. Add a matrix update report that says which surfaces reached which assurance
   level.

That MVP will be serious enough to shape adapter implementation before OIAP has
many exporters.

## Open Questions

- Which target should be the first real-host driver?
- Should conformance drivers live beside exporters or under a central package?
- Should evidence bundles be committed for releases, uploaded as CI artifacts,
  or both?
- How should credentialed proprietary hosts be tested without making local
  development painful?
- What minimum assurance level is required before a target can move from
  experimental to supported?
- How should manual evidence be represented so it is useful but not confused
  with automated conformance?

## Summary

The serious version of OIAP testing is a conformance harness. It exports probe
plugins, adopts them into isolated target environments, exercises host-native
surfaces, validates behavior with machine-checkable oracles, and emits evidence
bundles. Static tests say the exporter rendered plausible files. Conformance
tests say the target actually recognized and executed them.