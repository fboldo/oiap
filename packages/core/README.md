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

The package intentionally contains contracts and small authoring helpers only.
Target-specific rendering belongs in exporter packages.