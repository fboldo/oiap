# @oiap/core

Core primitives and author-facing helpers for Open Interoperable Agent Plugins.

This package defines the stable TypeScript contract that plugin authors use to
describe plugins once before target exporters render host-specific bundles.

```ts
import { allow, definePlugin, hook } from "@oiap/core";

export default definePlugin({
	manifest: {
		id: "example",
		name: "Example Plugin",
		version: "0.0.0",
		description: "Example OIAP plugin.",
		categories: ["example"],
		supportedTargets: ["gemini-cli", "hermes"],
	},
	hooks: [
		hook.beforeTool("allow-all", () => {
			return allow();
		}),
	],
});
```

The package intentionally contains contracts and small authoring helpers.
Target-specific rendering still belongs in exporter packages.

Long Markdown instruction bodies can live beside the plugin file instead of in
template strings:

```ts
import { definePlugin, markdownFile } from "@oiap/core";

export default definePlugin({
	instructions: [
		{
			id: "review-workflow",
			purpose: "workflow",
			triggers: ["review"],
			body: markdownFile("instructions/review-workflow.md"),
		},
	],
});
```

Relative paths resolve from the calling module. Pass `baseUrl: import.meta.url`
when you want to make that relationship explicit.

Installer tools can discover plugin declarations directly from source files
without a separate manifest:

```ts
import { discoverPluginDeclarations } from "@oiap/core";

const declarations = await discoverPluginDeclarations(".");
```

Discovery scans TypeScript and JavaScript source files for `definePlugin(...)`
calls imported from `@oiap/core`, extracts static manifest fields when possible,
and reports dynamic manifest metadata as partial instead of executing plugin code.

Installers can also materialize a plugin for a built-in target id. Core resolves
that id by dynamically loading the matching exporter package, then uses the
target profile's install paths for local or global installs:

```ts
import { installPlugin } from "@oiap/core";
import plugin from "./oiap.plugin";

await installPlugin({
	plugin,
	target: "codex",
	scope: "local",
	overwrite: true,
});
```

Applications that call `installPlugin()` with target ids should include the
exporter packages for the targets they support. Custom targets can still pass a
target object with `id`, `profile`, and `exportBundle`.