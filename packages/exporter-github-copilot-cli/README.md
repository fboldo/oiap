# @oiap/exporter-github-copilot-cli

GitHub Copilot CLI plugin exporter for Open Interoperable Agent Plugins.

This package lowers OIAP plugin primitives into the Copilot CLI plugin layout:

```text
plugin.json
commands/<command>.md
skills/<skill>/SKILL.md
agents/<agent>.agent.md
hooks.json
.mcp.json
.oiap/runtime/
```

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target github-copilot-cli --out ./build/copilot-cli
copilot plugin install ./build/copilot-cli
```

`copilot --plugin-dir ./build/copilot-cli` loads the bundle for one session.

## Surfaces

| OIAP surface | Copilot CLI output | Fidelity |
| --- | --- | --- |
| Manifest | root `plugin.json` with `skills`, `commands`, `agents`, `hooks`, `mcpServers` paths | native |
| Skills | `skills/<name>/SKILL.md` plus skill files beside it | native |
| Commands | `commands/<name>.md` with `name` and `description` frontmatter | native |
| Agents | `agents/<id>.agent.md`; `access: "read-only"` becomes `tools: ["read", "search"]` | native |
| Rules, always-on instructions | model-invoked skills | fallback |
| Hooks | `hooks.json` (`version: 1`, camelCase events) calling the OIAP runner through `$PLUGIN_ROOT` | partial |
| MCP | `.mcp.json` with `mcpServers` (`type: local`, `http` or `sse`) | native |
| Policies | `.oiap/policy.json` evidence | partial |

## Limitations

- Copilot CLI plugins have no rules or custom-instruction component, so rules
  are exported as skills.
- Plugin hooks get `PLUGIN_ROOT` in their environment, and the generated
  commands use it. The OIAP runner does not yet write Copilot CLI hook output
  (`permissionDecision`, `additionalContext`, ...), so hook decisions are not
  enforced. The report marks hooks as degraded.
- The plugin root is not expanded in skill or agent Markdown, so references to
  bundled files are relative to the file that contains them.
- MCP `excludeTools` has no Copilot CLI equivalent and is dropped.
- The `oiap install` command has no default path for this target: Copilot CLI
  manages its own install directory. Use `--out` and `copilot plugin install`.

## Sources

- Plugin reference: <https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference>
- Hooks reference: <https://docs.github.com/en/copilot/reference/hooks-reference>
- Custom agents: <https://docs.github.com/en/copilot/reference/custom-agents-configuration>
- Skills: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills>
- MCP servers: <https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers>
- Changelog: <https://github.com/github/copilot-cli/blob/main/changelog.md>
  (1.0.26 plugin hook root env vars, 1.0.88 hook cwd, 0.0.399 / 0.0.412 /
  0.0.417 command files)
