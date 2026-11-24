# Elephant-Goldfish Model

OIAP port of Google's Elephant-Goldfish Model (EGM) plugin.

Source plugin: <https://github.com/google/elephant-goldfish-model> at
`70406c4`. The shared skills, personas and document standards in `source/` are
vendored unchanged under the Apache-2.0 license in `source/LICENSE`. Upstream
test fixtures (`TEST.md`, `test_scenarios.yaml`) are omitted.

EGM ships to about ten harnesses from one set of skills and personas. Everything
else (5 plugin manifests, 3 marketplace catalogs, a thin agent adapter per
persona for Claude, Cursor and Copilot, Windsurf workflows, an OpenCode config
generator) is maintained by hand and kept in line by parity tests. This example
checks how much of that OIAP can generate from one definition.

```sh
bun run oiap build examples/elephant-goldfish-model/oiap.plugin.ts --out dist/examples/egm
```

## How the port maps EGM

- Skill `references/`, icons and Codex `agents/openai.yaml` ship as
  `SkillAsset.files`; `resources/` ships as plugin `resources`.
- `oiap.plugin.ts` rewrites EGM's repository paths into OIAP tokens:
  `agents/zoom_out.md` becomes `${OIAP_AGENT_FILE:egm-zoom-out}` and
  `resources/...` becomes `${OIAP_PLUGIN_ROOT}/resources/...`. Each exporter
  resolves them to its own layout (`${CLAUDE_PLUGIN_ROOT}/...` on Claude Code,
  file-relative paths elsewhere).
- Reviewers set `access: "read-only"`; the synthesizer and bootstrap
  orchestrator are `read-write`.

| Target | Read-only reviewers | Plugin root |
| --- | --- | --- |
| Claude Code | `tools: Read,Grep,Glob` | `${CLAUDE_PLUGIN_ROOT}` |
| Cursor | `readonly: true` | file-relative |
| VS Code Copilot | `tools: [read, search]` | file-relative |
| OpenCode | `permission: {edit: deny, bash: deny}` | file-relative |
| Gemini CLI | read tool allowlist | file-relative |
| Cline | `tools: [read_files, search_codebase]` | file-relative |
| GitHub Copilot CLI | `tools: [read, search]` | file-relative |
| Windsurf (Devin) | `allowed-tools: [read, grep, glob]` | file-relative |
| Codex | not enforceable; reported | file-relative |
| Antigravity, OpenClaw | agents are metadata only; reported | file-relative |

## Remaining gaps

1. **Host-specific text in the skills.** EGM skills point at
   `${CLAUDE_PLUGIN_ROOT}/docs/claude.md` and `../../docs/codex.md`. The port
   does not ship `docs/`, and those lines would need per-target instruction
   overrides.
2. **Hosts without a control** for read-only agents, user-only skills or
   excluding host instruction files report a degradation instead (see each
   target's capability report). EGM keeps those guarantees only on hosts that
   support them.

Gaps closed since the first port: Codex keeps agent names such as `egm-style`;
user-only skills use `modelInvocable: false`; reviewers use
`hostInstructions: "exclude"` (Claude `omitClaudeMd`, Copilot
`include-custom-instructions: false`); manifests carry display name, author,
repository and keywords; `oiap sync` writes the marketplace catalogs.
