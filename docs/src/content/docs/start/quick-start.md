---
title: Quick start
description: Install the OIAP CLI, write a minimal oiap.plugin.ts and build bundles for one or every target.
---

## Install

The `@oiap/cli` package installs the `oiap` binary. Install it with the
authoring SDK in your plugin project:

```sh
npm install --save-dev @oiap/cli @oiap/core
```

List the registered exporter targets:

```sh
npx oiap targets
```

## Write a plugin

Create a prompt file and an `oiap.plugin.ts` next to it:

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
// oiap.plugin.ts
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

[Write a plugin](/oiap/guides/write-a-plugin/) explains each field.

## Build

Build for one target:

```sh
npx oiap build oiap.plugin.ts --target claude-code --out dist/claude-code
```

Build for every registered target (one directory per target under
`dist/oiap/`):

```sh
npx oiap build oiap.plugin.ts --out dist/oiap
```

Each output directory holds host-native files plus OIAP metadata in `.oiap/`:
the bundle manifest, source map and [capability report](/oiap/guides/capability-reports/).
The CLI prints one line per target with its status and any issues:

```text
Built claude-code -> dist/claude-code (8 files, ok)
```

The output directory is cleaned before each build, and must be inside the
current directory.

## Ship it

Don't commit `dist/`. Pick one or both ways to get the plugin to users:

- [Commit host files with `oiap sync`](/oiap/guides/oiap-sync/) for hosts that
  install from git.
- [Document `install-agent-plugin`](/oiap/guides/install-agent-plugin/) for hosts
  that read files from the user's project.

See [Two ways to ship a plugin](/oiap/start/two-ways-to-ship/).

:::tip[Let an agent write it]
The `create-plugin` skill helps agents scaffold OIAP plugin projects:

```sh
npx skills add fboldo/oiap --skill create-plugin
```
:::
