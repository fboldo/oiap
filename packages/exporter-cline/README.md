# @oiap/exporter-cline

Cline target exporter for Open Interoperable Agent Plugins.

This package renders OIAP plugin definitions into project-local Cline assets:

- Rules in `.clinerules/` with Cline conditional `paths` frontmatter.
- Skills in `.cline/skills/<name>/SKILL.md`.
- Commands as user-invocable Cline skills.
- Agents in `.cline/agents/<name>.yaml` frontmatter files.
- Hook files in `.cline/hooks/*.cjs` backed by the generated OIAP runtime.
- MCP servers in `.cline/mcp.json`.
- OIAP capability reports, source maps, and policy evidence under `.oiap/`.

Use it directly from TypeScript:

```ts
import { exportCline } from "@oiap/exporter-cline";

const bundle = exportCline(pluginDefinition);
```

Or through the CLI:

```sh
bun run oiap build ./oiap.plugin.ts --target cline --out ./build/cline
```

Cline command and policy surfaces do not map one-to-one with OIAP. Commands are
lowered as skills so users can invoke them with slash skill commands, and policy
rules are emitted as reviewable evidence instead of enforced host settings.
Generated hook files also preserve unsupported hook result decisions as advisory
context where Cline file hooks do not expose an equivalent control.