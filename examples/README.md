# OIAP Examples

This folder contains OIAP rewrites of existing Claude Code plugin examples. They
are included for demonstrative purposes only: the examples show how plugin ideas
from a single host can be expressed with OIAP primitives and exported to multiple
agent platforms.

The upstream repository license permits this adapted demonstration. These files
are not vendored copies of the Claude Code plugin source; they keep the same
plugin intent while rewriting the behavior as OIAP `definePlugin` definitions.

| Example | Source plugin |
| --- | --- |
| `security-guidance` | <https://github.com/anthropics/claude-code/tree/main/plugins/security-guidance> |
| `explanatory-output-style` | <https://github.com/anthropics/claude-code/tree/main/plugins/explanatory-output-style> |
| `feature-dev` | <https://github.com/anthropics/claude-code/tree/main/plugins/feature-dev> |

Build one example for every registered target:

```sh
bun run oiap build examples/security-guidance/oiap.plugin.ts --out dist/examples/security-guidance
```

Build one example for a specific target:

```sh
bun run oiap build examples/feature-dev/oiap.plugin.ts --target vscode-copilot-chat --out dist/examples/feature-dev-vscode
```