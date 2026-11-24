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

1. **No context isolation flag.** EGM reviewers must start without host
   instruction files: Claude `omitClaudeMd: true`, Copilot
   `include-custom-instructions: false`. Hosts without a control should report
   the capability as unsupported, and EGM should be able to require it.
2. **Agent names change per target.** Codex writes `egm_style`; the skills
   dispatch `egm-style`.
3. **User-only skills are per-target metadata.** EGM marks every skill
   `disable-model-invocation: true`. This example passes it through
   `targetMetadata` for Claude and Codex only; other targets lose it.
4. **Manifest metadata is too thin.** EGM's manifests carry author,
   repository, display name, logo and icon, support, privacy and terms URLs,
   brand colour, default prompts, and Codex `requires_local_executor`.
5. **No marketplace catalogs.** EGM ships `.claude-plugin/marketplace.json`,
   `.cursor-plugin/marketplace.json` and `.agents/plugins/marketplace.json`.
6. **Host-specific text in the skills.** EGM skills point at
   `${CLAUDE_PLUGIN_ROOT}/docs/claude.md` and `../../docs/codex.md`. The port
   does not ship `docs/`, and those lines would need per-target instruction
   overrides.
