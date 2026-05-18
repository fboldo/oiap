# OIAP - Open Interoperable Agent Plugins

OIAP is a TypeScript SDK and build toolchain for writing AI agent plugins once
and exporting them into host-native bundles for multiple agent platforms.

Agent harnesses increasingly expose the same ideas through different file
formats: commands, skills, rules, hooks, custom agents, MCP configuration,
runtime shims, and permission policies. OIAP gives plugin authors one stable
authoring model and a set of exporters that generate reviewable bundles for each
target platform.

## Project Status

OIAP is early and actively evolving. The current repository focuses on developer
tooling: define plugins, normalize them into an intermediate representation, and
generate bundle artifacts. Installing those artifacts into a user's local agent
environment is intentionally outside the project scope.

## Features

- **Host-neutral TypeScript authoring** for plugin manifests, commands,
	instructions, skills, hooks, agents, tools, artifacts, recipes, and policies.
- A published Node **CLI that builds plugin definition files** into deterministic
	target bundle directories.
- Exporters that **render OIAP plugins into host-native files** for the currently
	implemented agent platforms.
- A **stable runtime for hooks** and executable scripts, giving generated adapters a
	consistent way to invoke plugin behavior across host environments.
- **Compatibility reports** that describe which capabilities mapped cleanly,
	degraded, or were unsupported for a target.

OIAP is complementary to specification efforts such as the
[Open Plugin Spec](https://github.com/vercel-labs/open-plugin-spec). It is not a
competing standards body; it is practical authoring and bundling infrastructure
for developers who need to ship across several agent harnesses.

## Quick Start

The `@oiap/cli` package is published to npm as a Node CLI and installs the
`oiap` binary. In a plugin project, install the CLI with the authoring SDK:

```sh
npm install --save-dev @oiap/cli @oiap/core
```

List the registered exporter targets:

```sh
npx oiap targets
```

Create an `oiap.plugin.ts` file using the shape shown below, then build it for a
target platform:

```sh
npx oiap build oiap.plugin.ts --target claude-code --out dist/claude-code
```

Build the same plugin for every registered exporter:

```sh
npx oiap build oiap.plugin.ts --out dist/oiap
```

## Plugin Example

An OIAP plugin is a normal TypeScript module that exports a `definePlugin`
definition. The CLI loads that definition and asks the selected exporters to
render platform-specific files.

```text
my-review-plugin/
  oiap.plugin.ts
  prompts/
    review.md
```

```md
<!-- prompts/review.md -->
Review the current change for correctness, security risks, missing tests, and
maintainability issues. Lead with concrete findings and include file references
when possible.
```

```ts
import type { PluginDefinition } from "@oiap/core";
import { definePlugin, markdownFile } from "@oiap/core";

const reviewPrompt = markdownFile("prompts/review.md", {
	baseUrl: import.meta.url,
});

export default definePlugin({
	manifest: {
		id: "review-guard",
		name: "Review Guard",
		version: "1.0.0",
		description:
			"Adds a portable review command for agent-assisted code review.",
		license: "MIT",
		categories: ["review", "quality", "commands"],
		supportedTargets: ["claude-code", "codex", "vscode-copilot-chat"],
	},
	invocations: [
		{
			id: "review-guard-invocation",
			canonical: "review-guard",
			targetAliases: {
				"claude-code": "review-guard",
				codex: "review-guard",
				"vscode-copilot-chat": "review-guard",
			},
			helpText: "Review the current change before it is merged.",
			examples: ["/review-guard", "/review-guard Focus on security"],
		},
	],
	instructions: [
		{
			id: "review-guard-prompt",
			purpose: "command",
			triggers: ["review", "code review", "pre-merge review"],
			body: reviewPrompt,
		},
	],
	commands: [
		{
			id: "review-guard-command",
			invocation: { id: "review-guard-invocation", kind: "invocation" },
			prompt: { id: "review-guard-prompt", kind: "instruction" },
		},
	],
} satisfies PluginDefinition);
```

Build it for Claude Code:

```sh
npx oiap build my-review-plugin/oiap.plugin.ts --target claude-code --out dist/review-guard-claude
```

Build it for every registered exporter:

```sh
npx oiap build my-review-plugin/oiap.plugin.ts --out dist/review-guard
```

Each output directory contains host-native files plus OIAP metadata such as the
bundle manifest, source map, and capability report.

## Supported Targets

The CLI currently registers these exporters:

| Target ID | Package | Output focus |
| --- | --- | --- |
| `antigravity` | [@oiap/exporter-antigravity](packages/exporter-antigravity) | Google Antigravity workspace bundle artifacts |
| `claude-code` | [@oiap/exporter-claude-code](packages/exporter-claude-code) | Claude Code-oriented plugin bundle artifacts |
| `codex` | [@oiap/exporter-codex](packages/exporter-codex) | Codex plugin and project-configuration artifacts |
| `cursor` | [@oiap/exporter-cursor](packages/exporter-cursor) | Cursor plugin artifacts |
| `openclaw` | [@oiap/exporter-openclaw](packages/exporter-openclaw) | OpenClaw plugin package artifacts |
| `vscode-copilot-chat` | [@oiap/exporter-vscode-copilot](packages/exporter-vscode-copilot) | VS Code Copilot Chat customization artifacts |

For researched and planned platform coverage, see the
[Platform Matrix](MATRIX.md).

## Packages

| Package | Purpose |
| --- | --- |
| [@oiap/core](packages/core) | Primitive TypeScript contracts and author-facing plugin API |
| [@oiap/runtime](packages/runtime) | Portable hook runtime bundle generation used by target exporters |
| [@oiap/cli](packages/cli) | CLI for building target bundles from plugin definition files |
| [@oiap/exporter-antigravity](packages/exporter-antigravity) | Google Antigravity exporter |
| [@oiap/exporter-claude-code](packages/exporter-claude-code) | Claude Code exporter |
| [@oiap/exporter-codex](packages/exporter-codex) | Codex exporter |
| [@oiap/exporter-cursor](packages/exporter-cursor) | Cursor exporter |
| [@oiap/exporter-openclaw](packages/exporter-openclaw) | OpenClaw exporter |
| [@oiap/exporter-vscode-copilot](packages/exporter-vscode-copilot) | VS Code Copilot Chat exporter |

## Examples

The [examples](examples) directory contains OIAP rewrites of representative
agent plugin patterns:

- [security-guidance](examples/security-guidance) demonstrates a before-tool
  hook that warns about risky edits.
- [explanatory-output-style](examples/explanatory-output-style) demonstrates a
  portable instruction/style plugin.
- [feature-dev](examples/feature-dev) demonstrates commands, prompt modules,
  and custom agent definitions.

## Design Documentation

- [Architecture](ARCHITECTURE.md) explains the authoring model, shared
	terminology, core primitives, export pipeline, and runtime bridge pattern.
- [Platform Matrix](MATRIX.md) tracks target capabilities,
  adapter status, and verification notes.

## Development

This repository uses Bun, TypeScript, Biome, Turbo, and Lerna.

```sh
bun install
bun run format
bun run check
bun run typecheck
bun run test
```

Useful development commands:

```sh
bun run oiap targets
bun run oiap build examples/security-guidance/oiap.plugin.ts --target claude-code --out dist/dev/security-guidance
bun run test:coverage
```

Turbo orchestrates build, typecheck, and test tasks across packages. Lerna is
reserved for fixed-version release management. The Husky pre-commit hook runs
`bun run precommit` automatically before commits.

## Release Management

OIAP uses Lerna fixed versioning so all `@oiap/*` packages ship with the same
version. The root workspace remains private; published packages are public scoped
npm packages with `publishConfig.access` set to `public`.

```sh
bun run release:changed
bun run release:version
bun run release:publish
```

The release workflow lives at `.github/workflows/release.yml` and is manually
dispatched from GitHub Actions. Manual dispatch defaults to a dry run.

## Contributing

Contributions are welcome. The most useful contributions are focused changes
that improve the authoring model, exporter fidelity, examples, documentation,
or validation coverage.

Before opening a pull request:

1. Fork the repository or create a feature branch.
2. Run `bun install` from the repository root.
3. Keep changes scoped to the package, exporter, example, or document being
   improved.
4. Add or update tests when behavior changes.
5. Commit normally; the pre-commit hook runs the repository checks automatically.
6. In the pull request description, mention affected targets and any known
   capability degradations.

For exporter work, include a small example or fixture when possible. Generated
bundles should remain deterministic and easy to review.

## License

OIAP is released under the [MIT License](LICENSE).