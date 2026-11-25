---
title: Per-host differences
description: Limit primitives to some hosts, add host-only manifest fields, ship host files OIAP does not model, and reuse the skills and agents a repository already has.
---

OIAP writes one definition into many host formats. Real plugins still need a
few host-specific pieces. These are the supported ways to express them, from
most to least portable.

## Limit a primitive to some hosts

Every instruction, command, workflow, rule, skill, hook, agent and tool surface
accepts `targets`. Exporters for other hosts never see it, so it appears in no
other bundle and no other capability report:

```ts
commands: [
	{
		id: "plan",
		targets: ["claude-code", "gemini-cli"],
		invocation: { id: "plan-invocation", kind: "invocation" },
		prompt: { id: "plan-prompt", kind: "instruction" },
	},
],
```

Use it for commands a host turns into skills you'd rather not ship, or for an
always-on rule that a host already gets from its own instruction file.

## Host-only manifest fields

`manifest.targetMetadata` merges extra fields into one host's manifest. Objects
merge deeply, other values replace, and `null` removes a field OIAP generated:

```ts
manifest: {
	id: "my-skills",
	name: "My Skills",
	version: "1.2.0",
	description: "Skills for my team.",
	categories: ["productivity"],
	supportedTargets: ["claude-code", "codex"],
	targetMetadata: {
		// Leave the version out so every commit is an update for Claude Code users.
		"claude-code": { version: null },
		codex: {
			interface: {
				brandColor: "#6C47FF",
				defaultPrompt: ["Add sign-in to this app."],
			},
		},
	},
},
```

The same rule applies to skills, commands and agents through their own
`targetMetadata`.

## Marketplace catalogs

`manifest.marketplace` controls the catalogs `oiap sync` writes, so existing
install commands keep working:

```ts
manifest: {
	// ...
	marketplace: {
		name: "my-skills-marketplace", // users install my-skills@my-skills-marketplace
		owner: { name: "My Team" },
		description: "Skills for my team.",
		entry: { tags: ["auth"] },
		targetMetadata: {
			"claude-code": { entry: { version: null } },
		},
	},
},
```

Catalog entries carry the plugin's version, description, author, homepage,
repository, license, keywords and first category; `entry` adds fields for every
host and `targetMetadata` per host.

## Host files OIAP does not model

`targetFiles` writes files into one host's bundle exactly as given, relative to
that bundle's root. Use it for hand-written hook scripts and their hook
configuration, or a host's own command format:

```ts
import { definePlugin, pluginFiles } from "@oiap/core";

export default definePlugin({
	manifest: {
		/* ... */
	},
	targetFiles: {
		"claude-code": pluginFiles("hosts/claude"), // hooks/hooks.json, hooks/*.sh
		"gemini-cli": pluginFiles("hosts/gemini"), // commands/*.toml
	},
});
```

They go through the same duplicate-file checks as generated files, so a target
file that collides with one OIAP writes is reported as an error.

## Reuse the skills and agents you already have

If the repository already keeps skills or agents in folders, point OIAP at
them instead of rewriting them:

```ts
import { agentsFrom, definePlugin, skillsFrom } from "@oiap/core";

export default definePlugin({
	manifest: {
		/* ... */
	},
	skills: skillsFrom("skills"),
	agents: agentsFrom("agents"),
});
```

Each `SKILL.md`, and each agent file on hosts that read Markdown agent files,
is emitted exactly as written. `oiap sync` shares those files instead of
copying them; see [Ship with oiap sync](/oiap/guides/oiap-sync/).
