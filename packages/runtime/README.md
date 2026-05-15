# @oiap/runtime

Generated runtime bridge utilities for OIAP exporters.

Exporters use this package at bundle time to emit a portable raw-JS hook runtime:

```text
.oiap/runtime/runner.mjs
.oiap/runtime/hooks.mjs
.oiap/runtime/manifest.json
```

Target hook configuration then calls the generated runner with Node:

```sh
node .oiap/runtime/runner.mjs run-hook --manifest .oiap/runtime/manifest.json --target codex --event before_tool --hook protect-prod
```

The package is a build-time dependency for exporters. Generated plugin bundles do
not need to install `@oiap/runtime` before a hook can execute.