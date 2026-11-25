# @oiap/exporter-windsurf

Windsurf exporter for Open Interoperable Agent Plugins.

Windsurf was renamed Devin Desktop in 2026, and `docs.windsurf.com` now
redirects to `docs.devin.ai/desktop`. Devin Desktop no longer starts new
Cascade conversations. New conversations use Devin Local, which still reads the
legacy `.windsurf/` rules and skills. The exporter writes a reviewable
workspace bundle:

- `.windsurf/rules/*.md`: workspace rules with `trigger` (`always_on`,
  `manual`, `model_decision`, `glob`), `description` and `globs` frontmatter
  ([rules](https://docs.devin.ai/cli/extensibility/rules.md),
  [customizations](https://docs.devin.ai/desktop/cascade/memories)).
- `.windsurf/skills/<name>/SKILL.md`: Agent Skills, with skill files beside
  them ([skills](https://docs.devin.ai/cli/extensibility/skills/overview.md)).
  Commands and OIAP workflows become user-only skills (`triggers: [user]`)
  invoked as `/name`. Cascade workflows are not emitted because Devin Local
  does not support them, and the docs say to migrate them to skills
  ([workflows](https://docs.devin.ai/desktop/cascade/workflows)).
- `.devin/agents/<name>.md`: custom subagents with `allowed-tools`. A
  read-only agent gets `read`, `grep` and `glob`
  ([subagents](https://docs.devin.ai/cli/subagents.md)).
- `.devin/hooks.v1.json` and `.devin/hooks/oiap-<plugin>.cjs`: command hooks
  for `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`,
  `PermissionRequest` and `Stop`. Each hook runs
  `node "$DEVIN_PROJECT_DIR/.devin/hooks/oiap-<plugin>.cjs" <Event>`, which
  calls the generated runtime in `.oiap/runtime/`
  ([hooks](https://docs.devin.ai/cli/extensibility/hooks/overview.md)).
- `.devin/mcp_config.json`: project MCP servers under `mcpServers`
  ([MCP](https://docs.devin.ai/cli/extensibility/mcp/configuration.md)).
- `.windsurf/<plugin>/`: plugin resources.
- `.oiap/`: the target manifest, capability report, source map, policy
  evidence and runtime. `targetMetadata.windsurf` on the plugin manifest
  merges into `.oiap/windsurf-target.json` (`null` removes a field).
- `targetFiles.windsurf`: written as-is relative to the workspace root, beside
  `.windsurf/` and `.devin/` (for example `.devin/hooks/<script>`).

Agents from `agentsFrom` are written to `.devin/agents/<name>.md` unchanged,
like skills from `skillsFrom`. Primitives with `targets` that leave out
`windsurf` are dropped.

To activate the bundle, copy `.windsurf/`, `.devin/` and `.oiap/` into the
workspace root. Hook commands depend on `DEVIN_PROJECT_DIR`, so they only work
from the workspace root. The exporter does not write to `~/.codeium` or
`~/.config/devin`.
