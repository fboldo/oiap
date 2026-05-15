# Platform Support Matrix

This matrix is the living index of OIAP target support. It tracks which agent
harness surfaces each exporter should produce, where adapter packages are
expected to live, and which capabilities need recurring verification against
current platform documentation.

The matrix is about export support. It does not describe installing bundles into
a user's live agent environment. OIAP generates target bundles, profiles,
reports, and adapter code; adoption remains a host or user workflow.

Last reviewed: 2026-05-15.

Use the [OIAP Platform Matrix Refresh](../.agents/skills/oiap-platform-matrix-refresh/SKILL.md)
skill when refreshing this document from current platform docs.

For shared terminology used in the matrix, see the [Glossary](glossary.md).
For the testing strategy behind support claims, see the
[Platform Conformance Test Harness](test-harness.md).

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
| Codex | <https://github.com/openai/codex> | canonical repository | Prefer repo docs and release notes unless OpenAI publishes a dedicated Codex CLI docs site. |
| OpenCode | <https://opencode.ai/docs> | official docs | Verify the JavaScript extension API and hook/event surfaces. |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot> | official docs | Verify whether CLI-specific extension surfaces still exist and are current. |
| VS Code Copilot Chat | <https://code.visualstudio.com/docs/copilot/overview> | official docs | Also verify customization docs for skills, prompts, instructions, agents, hooks, and MCP. |
| Aider | <https://aider.chat/docs/> | official docs | Verify configuration, slash commands, watch mode, and MCP status. |
| OpenClaw | Needs verified official source | needs verification | Keep as thin target until an official source is identified. |
| Factory Droid | Needs verified official source | needs verification | Confirm Factory-owned docs for plugins, Droids, hooks, MCP, and enterprise registry behavior. |
| Trae | Needs verified official source | needs verification | Confirm vendor-owned docs for rules, context, custom agents, and MCP tools. |
| Trae CN | Needs verified official source | needs verification | Confirm regional docs and feature parity before copying Trae assumptions. |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> | canonical repository | Verify extension, command, hook, MCP, sandbox, and settings docs in repo or linked official docs. |
| Hermes | Needs verified official source | needs verification | Confirm Python plugin API, hooks, tool registration, and async support. |
| Kimi Code | Needs verified official source | needs verification | Keep as skill/MCP target until official docs are found. |
| Kiro IDE/CLI | Needs verified official source | needs verification | Confirm Agent Skills, steering, hooks, MCP, specs, and policy controls from official docs. |
| Pi coding agent | Needs verified official source | needs verification | Keep as thin target until official extension surfaces are verified. |
| Cursor | <https://docs.cursor.com/> | official docs | Verify rules, nested agent guidance, MCP, and agent/tool behavior. |
| Google Antigravity | Needs verified official source | needs verification | Confirm rules, workflows, skills, MCP, permissions, task groups, and browser subagent behavior. |

## Capability Matrix

| Target | Profile | Package | Rules | Skills | Commands | Hooks | Agents | MCP | Runtime | Policy | Adapter package |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | core | Y | Y | Y | Y | Y | Y | Y | P | P | `packages/exporter-claude-code` |
| Codex | core | Y | Y | Y | P | Y | Y | Y | F | Y | `packages/exporter-codex` |
| OpenCode | bridge | P | P | P | P | P | ? | P | R | P | `packages/exporter-opencode` |
| GitHub Copilot CLI | thin | ? | P | ? | P | N | N | ? | F | N | `packages/exporter-github-copilot-cli` |
| VS Code Copilot Chat | editor | P | Y | Y | P | P | P | Y | F | P | `packages/exporter-vscode-copilot-chat` |
| Aider | workflow | N | P | N | P | P | N | ? | F | P | `packages/exporter-aider` |
| OpenClaw | thin | ? | F | F | F | ? | ? | ? | F | ? | `packages/exporter-openclaw` |
| Factory Droid | core | Y | P | Y | Y | Y | Y | Y | F | Y | `packages/exporter-factory-droid` |
| Trae | editor | P | Y | ? | P | ? | Y | Y | F | P | `packages/exporter-trae` |
| Trae CN | regional | P | Y | ? | P | ? | Y | Y | F | P | `packages/exporter-trae-cn` |
| Gemini CLI | core | Y | Y | Y | Y | Y | P | Y | F | Y | `packages/exporter-gemini-cli` |
| Hermes | bridge | P | P | P | P | R | ? | P | R | P | `packages/exporter-hermes` |
| Kimi Code | thin | ? | F | P | F | ? | ? | P | F | ? | `packages/exporter-kimi-code` |
| Kiro IDE/CLI | core | P | Y | Y | P | Y | P | Y | F | P | `packages/exporter-kiro` |
| Pi coding agent | thin | ? | F | F | F | ? | ? | ? | F | ? | `packages/exporter-pi` |
| Cursor | editor | P | Y | P | P | ? | P | Y | F | P | `packages/exporter-cursor` |
| Google Antigravity | core | P | Y | Y | Y | P | Y | Y | F | Y | `packages/exporter-antigravity` |

## Adapter Status

The current repository does not yet contain adapter packages. Until packages are
implemented, every adapter path in the matrix is a proposed package location.

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

Bridge target. Verify the current JavaScript extension API and whether hooks,
events, MCP, and command surfaces are stable enough for a rich adapter.

### GitHub Copilot CLI

Thin target until current extension surfaces are verified. Avoid assuming hooks,
MCP, or subagents without current official evidence.

### VS Code Copilot Chat

Editor target. Verify project skills, prompts, instructions, custom agents,
hooks, MCP, and any differences between project-level and user-level
customizations.

### Aider

Workflow/config target. Verify configuration files, read-context patterns,
slash-command behavior, watch-comment workflows, and whether MCP support is
available in the current release.

### OpenClaw

Thin target until official extension surfaces are verified. Export conservative
instructions and explicit unsupported-capability reports.

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

Editor target. Verify project/user/team rules, nested `AGENTS.md` behavior, MCP,
agent behavior, and any command or hook-like surfaces.

### Google Antigravity

High-fidelity workflow target. Verify rules, workflows, skills, MCP config,
permissions, planning modes, task groups, browser subagent behavior, and hook-like
events.

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

No adapters exist yet. Once exporters are implemented, use this section to record
mismatches found by recurring refreshes.

| Date | Target | Matrix capability | Adapter state | Action |
| --- | --- | --- | --- | --- |
| 2026-05-15 | all | Initial planned matrix | No adapter packages yet | Create exporters from highest-fidelity targets first |