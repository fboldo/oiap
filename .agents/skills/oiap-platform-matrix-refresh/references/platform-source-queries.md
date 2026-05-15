# Platform Source Queries

Use this reference when refreshing `docs/platform-matrix.md`. Prefer official
docs, canonical repositories, release notes, and host-owned examples.

## Source Priority

1. Official product documentation.
2. Canonical vendor GitHub repositories.
3. Official release notes or changelogs.
4. CLI help from the platform tool when already available in the environment.
5. Community posts only as discovery leads, not as authoritative evidence.

## Evidence To Extract

For each platform, look for evidence about:

- Package or extension format.
- Rules, custom instructions, memory, or steering files.
- Skills or reusable instruction bundles.
- Commands, slash commands, prompts, workflows, or specs.
- Hooks or lifecycle events.
- Custom agents, subagents, Droids, task groups, or delegation.
- MCP servers, tools, resources, and prompts.
- Runtime/plugin SDK language requirements.
- Permissions, approvals, sandboxing, policies, or autonomy controls.
- Current filenames, manifest names, schemas, and version requirements.

## Query Table

| Target | Official or canonical starting point | Aliases | Suggested searches |
| --- | --- | --- | --- |
| Claude Code | <https://docs.anthropic.com/en/docs/claude-code/overview> | Anthropic Claude Code | `Claude Code plugins skills hooks MCP settings docs`, `site:docs.anthropic.com Claude Code plugin hooks MCP` |
| Codex | <https://github.com/openai/codex> | OpenAI Codex CLI | `OpenAI Codex CLI plugins skills hooks MCP AGENTS.md`, `github.com/openai/codex plugins hooks MCP config` |
| OpenCode | <https://opencode.ai/docs> | opencode | `OpenCode agent plugin JavaScript hooks MCP docs`, `opencode extension API hooks MCP` |
| GitHub Copilot CLI | <https://docs.github.com/en/copilot> | Copilot CLI | `GitHub Copilot CLI extension custom instructions docs`, `GitHub Copilot CLI commands plugin docs` |
| VS Code Copilot Chat | <https://code.visualstudio.com/docs/copilot/overview> | VS Code Copilot | `VS Code Copilot custom instructions skills prompts agents hooks MCP docs`, `code.visualstudio.com Copilot agent skills hooks MCP` |
| Aider | <https://aider.chat/docs/> | aider.chat | `Aider config read command watch files docs`, `Aider MCP support docs`, `Aider slash commands docs` |
| OpenClaw | Needs verified official source | OpenClaw agent | `OpenClaw agent plugins skills hooks MCP docs`, `OpenClaw coding agent extension docs` |
| Factory Droid | Needs verified official source | Factory AI Droid | `Factory Droid plugins skills hooks MCP custom Droids docs`, `Factory AI Droid slash commands MCP hooks` |
| Trae | Needs verified official source | Trae IDE | `Trae project rules custom agents MCP docs`, `Trae AI IDE rules context custom agents tools` |
| Trae CN | Needs verified official source | Trae China | `Trae CN project rules custom agents MCP docs`, `Trae CN AI IDE rules context tools` |
| Gemini CLI | <https://github.com/google-gemini/gemini-cli> | Google Gemini CLI | `Gemini CLI extensions commands hooks MCP GEMINI.md skills docs`, `github.com/google-gemini/gemini-cli extension hooks MCP` |
| Hermes | Needs verified official source | Hermes agent | `Hermes agent Python plugin hooks tools docs`, `Hermes coding agent plugin API Python hooks` |
| Kimi Code | Needs verified official source | Kimi coding agent | `Kimi Code skills MCP docs`, `Kimi coding agent plugin docs MCP` |
| Kiro IDE/CLI | Needs verified official source | Kiro agent | `Kiro Agent Skills steering hooks MCP specs docs`, `Kiro IDE hooks MCP steering skills` |
| Pi coding agent | Needs verified official source | Pi agent | `Pi coding agent plugins skills hooks MCP docs`, `Pi agent coding extension docs` |
| Cursor | <https://docs.cursor.com/> | Cursor IDE | `Cursor rules AGENTS.md MCP custom agents docs`, `Cursor project rules team rules MCP docs` |
| Google Antigravity | Needs verified official source | Antigravity | `Google Antigravity rules workflows skills MCP permissions docs`, `Antigravity browser subagent task groups workflows MCP` |

## Source Notes Format

Use this scratch format while researching:

```markdown
### <Platform>

- Source: <url or repo path>
- Date checked: <yyyy-mm-dd>
- Evidence:
  - Package: <yes/no/partial/unknown and why>
  - Rules: <yes/no/partial/unknown and why>
  - Skills: <yes/no/partial/unknown and why>
  - Commands: <yes/no/partial/unknown and why>
  - Hooks: <yes/no/partial/unknown and why>
  - Agents: <yes/no/partial/unknown and why>
  - MCP: <yes/no/partial/unknown and why>
  - Runtime: <language or bridge needs>
  - Policy: <permissions/sandbox/approvals>
- Matrix change: <none or proposed mark changes>
- Adapter mismatch: <none or category>
```