# OIAP Examples

This folder contains demonstrative OIAP plugin projects and integration
patterns. Some examples rewrite existing Claude Code plugin ideas with OIAP
primitives, while others show how plugin authors can build tooling around OIAP
source declarations.

For the adapted Claude Code examples, the upstream repository license permits
the demonstration. These files are not vendored copies of the Claude Code plugin
source; they keep the same plugin intent while rewriting the behavior as OIAP
`definePlugin` definitions.

| Example | Source plugin |
| --- | --- |
| `security-guidance` | <https://github.com/anthropics/claude-code/tree/main/plugins/security-guidance> |
| `explanatory-output-style` | <https://github.com/anthropics/claude-code/tree/main/plugins/explanatory-output-style> |
| `feature-dev` | <https://github.com/anthropics/claude-code/tree/main/plugins/feature-dev> |
| `discovery-installer-cli` | Plugin-owned installer CLI built with `installPlugin()` |

Build one example for every registered target:

```sh
bun run oiap build examples/security-guidance/oiap.plugin.ts --out dist/examples/security-guidance
```

Build one example for a specific target:

```sh
bun run oiap build examples/feature-dev/oiap.plugin.ts --target vscode-copilot-chat --out dist/examples/feature-dev-vscode
```

Run the discovery installer example:

```sh
bun examples/discovery-installer-cli/install.ts --overwrite
bun examples/discovery-installer-cli/install.ts --global --overwrite
bun examples/discovery-installer-cli/install.ts vscode --overwrite
```