# Platform Support Matrix

This matrix is the living index of OIAP target support. It tracks which agent
harness surfaces each exporter should produce, where adapter packages are
expected to live, and which capabilities need recurring verification against
current platform documentation.

The matrix is about export support. It does not describe installing bundles into
a user's live agent environment. OIAP generates target bundles, profiles,
reports, and adapter code; adoption remains a host or user workflow.

Last reviewed: 2026-05-19.

Use the [OIAP Platform Matrix Refresh](.agents/skills/oiap-platform-matrix-refresh/SKILL.md)
skill when refreshing this document from current platform docs.

For shared terminology used in the matrix, see the
[Architecture Glossary](ARCHITECTURE.md#glossary).

## Legend

| Mark | Meaning |
| --- | --- |
| `Y` | Native or first-class target surface expected |
| `P` | Partial support, profile-dependent support, or likely support needing verification |
| `F` | OIAP can generate a fallback, but the host does not expose a rich native surface |
| `R` | Runtime bridge required, such as Python, JavaScript, shell, or hook runner glue |
| `N` | Not expected to be supported by the host profile |
| `?` | Needs verification against current official docs |

## Documentation Sources

Use these official or canonical sources as the starting point for matrix
refreshes. When a row is marked `needs verification`, do not promote assumptions
from search results into the matrix until an official documentation page,
canonical repository, or vendor-owned release note is found.

| Target | Official or canonical source | Status | Notes |
| --- | --- | --- | --- |
| Claude Code | <https://docs.anthropic.com/en/docs/claude-code/overview> | official docs | Verify feature-specific pages for plugins, skills, commands, hooks, MCP, and settings. |
| Codex | <https://developers.openai.com/codex> | official docs | Verify plugins, skills, AGENTS.md, hooks, MCP, subagents, rules, approvals, and sandbox settings. |
| OpenCode | <https://opencode.ai/docs> | official docs | Verify the JavaScript extension API and hook/event surfaces. |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot> | official docs | Verify whether CLI-specific extension surfaces still exist and are current. |
| VS Code Copilot Chat | <https://code.visualstudio.com/docs/copilot/overview> | official docs | Also verify customization docs for skills, prompts, instructions, agents, hooks, and MCP. |
| Aider | <https://aider.chat/docs/> | official docs | Verify configuration, slash commands, watch mode, and MCP status. |
| OpenClaw | <https://docs.openclaw.ai/plugins/building-plugins> | official docs | Verify native plugin manifests, package metadata, skills, tools, commands, hooks, and bundle compatibility. |
| Factory Droid | Needs verified official source | needs verification | Confirm Factory-owned docs for plugins, Droids, hooks, MCP, and enterprise registry behavior. |
| Trae | Needs verified official source | needs verification | Confirm vendor-owned docs for rules, context, custom agents, and MCP tools. |
| Trae CN | Needs verified official source | needs verification | Confirm regional docs and feature parity before copying Trae assumptions. |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> | canonical repository | Verify extension, command, hook, MCP, sandbox, and settings docs in repo or linked official docs. |
| Hermes | Needs verified official source | needs verification | Confirm Python plugin API, hooks, tool registration, and async support. |
| Kimi Code | Needs verified official source | needs verification | Keep as skill/MCP target until official docs are found. |
| Kiro IDE/CLI | Needs verified official source | needs verification | Confirm Agent Skills, steering, hooks, MCP, specs, and policy controls from official docs. |
| Pi coding agent | Needs verified official source | needs verification | Keep as thin target until official extension surfaces are verified. |
| Cursor | <https://cursor.com/docs> | official docs | Verify plugins, rules, skills, commands, agents, hooks, MCP, and nested agent guidance. |
| Google Antigravity | <https://antigravity.google/docs> | official docs | Verify feature pages for workspace rules, workflows, Agent Skills, MCP, permissions, strict mode, task groups, and browser subagent behavior. |

## Capability Matrix

| Target | Profile | Package | Rules | Skills | Commands | Hooks | Agents | MCP | Runtime | Policy | Adapter package |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | core | Y | Y | Y | Y | Y | Y | Y | P | P | `packages/exporter-claude-code` |
| Codex | core | Y | Y | Y | P | Y | Y | Y | F | Y | `packages/exporter-codex` |
| OpenCode | bridge | P | Y | Y | Y | P | Y | Y | R | P | `packages/exporter-opencode` |
| GitHub Copilot CLI | thin | ? | P | ? | P | N | N | ? | F | N | `packages/exporter-github-copilot-cli` |
| VS Code Copilot Chat | editor | Y | F | Y | Y | P | Y | Y | P | P | `packages/exporter-vscode-copilot` |
| Aider | workflow | N | P | N | P | P | N | ? | F | P | `packages/exporter-aider` |
| OpenClaw | core | Y | F | Y | P | Y | P | P | F | P | `packages/exporter-openclaw` |
| Factory Droid | core | Y | P | Y | Y | Y | Y | Y | F | Y | `packages/exporter-factory-droid` |
| Trae | editor | P | Y | ? | P | ? | Y | Y | F | P | `packages/exporter-trae` |
| Trae CN | regional | P | Y | ? | P | ? | Y | Y | F | P | `packages/exporter-trae-cn` |
| Gemini CLI | core | Y | Y | Y | Y | Y | P | Y | F | Y | `packages/exporter-gemini-cli` |
| Hermes | bridge | P | P | P | P | R | ? | P | R | P | `packages/exporter-hermes` |
| Kimi Code | thin | ? | F | P | F | ? | ? | P | F | ? | `packages/exporter-kimi-code` |
| Kiro IDE/CLI | core | P | Y | Y | P | Y | P | Y | F | P | `packages/exporter-kiro` |
| Pi coding agent | thin | ? | F | F | F | ? | ? | ? | F | ? | `packages/exporter-pi` |
| Cursor | editor | Y | Y | Y | Y | Y | Y | Y | P | P | `packages/exporter-cursor` |
| Google Antigravity | core | F | Y | Y | P | N | P | Y | F | P | `packages/exporter-antigravity` |

## Adapter Status

The repository now contains initial Antigravity, Claude Code, Codex, Cursor,
OpenClaw, OpenCode, and VS Code Copilot exporter packages at
`packages/exporter-antigravity`, `packages/exporter-claude-code`,
`packages/exporter-codex`, `packages/exporter-cursor`,
`packages/exporter-openclaw`, `packages/exporter-opencode`, and
`packages/exporter-vscode-copilot`. Other adapter paths in the matrix remain
proposed package locations until implemented.

When adapter packages are added, each target should expose:

- A `HostProfile` describing package, rule, skill, command, hook, MCP, runtime,
  and policy support.
- A `PlatformExporter` implementation.
- Renderer fixtures for generated bundle files.
- Capability-report snapshots.
- Tests that compare expected target capabilities with rendered output.

Recommended shape:

```text
packages/exporter-<target>/
  src/profile.ts
  src/exporter.ts
  src/renderers/
  fixtures/
  tests/
```

If shared profiles become useful, they can move to:

```text
packages/target-profiles/src/<target>.ts
```

## Target Notes

### Claude Code

High-fidelity native package target. Verify plugin package metadata, skills,
commands, subagents, hooks, MCP, settings, binaries, and policy-related settings
against current docs.

### Codex

High-fidelity config/package target. Verify skills, plugins, hooks, MCP,
`AGENTS.md`, approval rules, sandbox settings, and custom agents.

### OpenCode

Bridge target. OpenCode documents project `opencode.json`, `AGENTS.md`,
`.opencode/skills`, `.opencode/commands`, `.opencode/agents`, local or npm
plugins, local and remote MCP servers, and permission rules. OIAP exports those
project-local assets and uses a bundled JavaScript OpenCode plugin bridge for
supported hook events.

### GitHub Copilot CLI

Thin target until current extension surfaces are verified. Avoid assuming hooks,
MCP, or subagents without current official evidence.

### VS Code Copilot Chat

Editor plugin target. VS Code Copilot agent plugins use root `plugin.json`,
Agent Skills folders, prompt-file slash commands, `.agent.md` custom agents,
root `hooks.json`, and root `.mcp.json`. Copilot-format plugins do not define a
plugin-root token, so generated hook runtime commands are plugin-relative and
reported as degraded until conformance probes confirm host path behavior.

### Aider

Workflow/config target. Verify configuration files, read-context patterns,
slash-command behavior, watch-comment workflows, and whether MCP support is
available in the current release.

### OpenClaw

Native plugin target. OpenClaw plugins ship `package.json` metadata,
`openclaw.plugin.json` manifests, `definePluginEntry` runtime entrypoints,
AgentSkills-compatible skill folders, tool contracts, command metadata, and
typed `api.on(...)` hook registrations. OIAP currently exports command and rule
fallbacks as skills and records MCP/policy/runtime gaps in capability reports.

### Factory Droid

High-fidelity native package target. Verify plugin packaging, skills, custom
slash commands, custom Droids, hooks, MCP, autonomy controls, settings, and
enterprise registry expectations.

### Trae

Editor target. Verify project rules, context imports, custom agents, built-in
tools, MCP tools, and whether hooks or command registries are available.

### Trae CN

Regional Trae profile. Verify feature parity, naming, localization, and any
regional documentation differences before copying assumptions from Trae.

### Gemini CLI

High-fidelity extension target. Verify extension manifest shape, commands,
`GEMINI.md`, skills, hooks, MCP, settings, sandbox behavior, approvals, and
headless execution notes.

### Hermes

Runtime bridge target. Verify Python plugin APIs, hook lifecycle events, tool
registration, async support, external process behavior, and how an exported
Python adapter should call the TypeScript hook runner.

### Kimi Code

Thin skill/MCP target until official surfaces are verified. Keep unsupported
surfaces visible in the capability report.

### Kiro IDE/CLI

High-fidelity skill/steering target. Verify Agent Skills, steering files, hooks,
MCP, specs, command-like workflows, and policy controls.

### Pi Coding Agent

Thin target until official extension surfaces are verified. Export instructions
and capability reports conservatively.

### Cursor

Editor plugin target. Cursor plugins use `.cursor-plugin/plugin.json`, `.mdc`
rule files in `rules/`, Agent Skills in `skills/`, custom agent markdown files
in `agents/`, command markdown files in `commands/`, `hooks/hooks.json`, and
root `mcp.json`. OIAP emits plugin bundles for those native surfaces and records
policy-specific lowering gaps in the capability report.

### Google Antigravity

Workflow/config target. Antigravity documents workspace Markdown rules under
`.agents/rules`, Agent Skills under `.agents/skills`, workflow markdown invoked
as slash commands, `mcp_config.json` with `mcpServers`, allow/deny/ask
permission resource strings, strict mode, task groups, and a browser subagent.
OIAP exports bundle artifacts for the documented file formats and records
degradations for the missing native plugin manifest, hook configuration, custom
agent files, workflow directory schema, and project-local permission file path.

## Refresh Checklist

When refreshing the matrix:

1. Prefer official platform docs, canonical vendor repositories, and release
   notes.
2. Record uncertainty with `?` instead of guessing.
3. Update the capability matrix only when the evidence changes the export model.
4. Check adapter packages and target profiles against the matrix.
5. Add adapter mismatches to the review queue instead of silently changing code.
6. Run documentation validation before finishing.

## Adapter Review Queue

Use this section to record mismatches found by recurring refreshes and exporter
validation.

| Date | Target | Matrix capability | Adapter state | Action |
| --- | --- | --- | --- | --- |
| 2026-05-15 | Claude Code | Initial exporter package | Static renderer and generated raw-JS hook runtime exist | Add conformance probes before claiming full support |
| 2026-05-15 | Codex | Initial exporter package | Plugin/config renderer and generated raw-JS hook runtime exist; command-to-skill fallback remains | Add Codex conformance probes and compare against plugin validation when available |
| 2026-05-15 | Cursor | Initial exporter package | Cursor plugin renderer and generated raw-JS hook runtime exist for documented plugin component folders | Add Cursor plugin diagnostics/conformance probes for `.cursor-plugin/plugin.json`, rules, skills, agents, commands, hooks, and MCP |
| 2026-05-15 | OpenClaw | Initial exporter package | Native package renderer and generated raw-JS hook runtime exist; command lowering, MCP bridge, policy enforcement, and tool runtime remain pending | Add OpenClaw manifest/plugin validation probes when CLI is available |
| 2026-05-19 | OpenCode | Initial exporter package | Project config renderer, skills, commands, agents, MCP config, permission config, and generated TypeScript hook bridge exist | Add OpenCode conformance probes for `opencode.json`, `.opencode/*` discovery, plugin hook events, MCP config, and permission behavior |
| 2026-05-15 | VS Code Copilot Chat | Initial exporter package | Copilot-format plugin renderer and generated raw-JS hook runtime exist; hook runner paths are plugin-relative because Copilot format has no root token | Add VS Code plugin diagnostics/conformance probes for root `plugin.json`, prompt commands, skills, agents, hooks, and MCP |
| 2026-05-15 | all remaining targets | Initial planned matrix | No adapter packages yet | Create exporters from highest-fidelity targets first |