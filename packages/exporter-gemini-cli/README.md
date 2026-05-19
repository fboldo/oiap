# @oiap/exporter-gemini-cli

Gemini CLI target exporter for Open Interoperable Agent Plugins.

This package lowers OIAP plugin primitives into Gemini CLI extension files. The
generated bundle uses the documented Gemini extension layout:

```text
gemini-extension.json
GEMINI.md
commands/<command>.toml
skills/<skill>/SKILL.md
agents/<agent>.md
hooks/hooks.json
policies/oiap-policy.toml
```

MCP servers are embedded in `gemini-extension.json`, because Gemini CLI loads
extension MCP configuration from the manifest. Hook configuration calls the
generated `.oiap/runtime/runner.mjs` raw-JS hook runtime through
`${extensionPath}` variables.

Most authors should use the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target gemini-cli --out ./build/gemini-cli
```

The exporter records policy evidence in `.oiap/policy.json` and emits Gemini
Policy Engine TOML rules for supported deny and ask policies. Allow policies and
non-tool policy surfaces remain visible as degradations because extension policy
tiers cannot silently auto-approve tool calls.