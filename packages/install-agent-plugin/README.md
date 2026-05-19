# install-agent-plugin

Consumer-facing CLI for discovering OIAP plugin declarations in a repository.

```sh
npx install-agent-plugin owner/repo --list
npx install-agent-plugin owner/repo --plugin review-guard --agent claude-code
```

The CLI discovers `definePlugin(...)` calls directly from TypeScript and
JavaScript source files through `@oiap/core`; it does not require a separate JSON
declaration file.

Direct host installation paths are intentionally not guessed yet. Until target
profiles carry installation destinations, bundles are materialized under
`dist/install-agent-plugin/<agent>/<plugin>` by default. Pass `--out <dir>` to
choose a different destination.