---
title: Bundled files and path tokens
description: Ship templates, references and scripts with skills and agents using SkillAsset.files, resources, and the OIAP_PLUGIN_ROOT and OIAP_AGENT_FILE tokens.
---

Skills and agents often read files at run time: templates, schemas, review
standards, scripts. OIAP ships them in every bundle, but each exporter decides
where they go. Instructions therefore never hardcode bundle paths; they use path
tokens that each exporter resolves.

## Skill files: `SkillAsset.files`

`files` ships files beside a skill's `SKILL.md`. Paths are relative to the skill
directory.

```ts
import { definePlugin, pluginFiles } from "@oiap/core";

export default definePlugin({
	// ...
	skills: [
		{
			id: "design-review",
			name: "design-review",
			description: "Review a design document.",
			instructions: { id: "design-review-instructions", kind: "instruction" },
			files: pluginFiles("skills/design-review", {
				baseUrl: import.meta.url,
				include: (path) => path !== "SKILL.md",
			}),
		},
	],
});
```

Inside the skill's instructions, refer to these files by their path relative to
`SKILL.md`, such as `references/checklist.md`.

## Shared files: `resources`

Plugin-level `resources` ship files shared by several skills or agents. Paths
are relative to the plugin root.

```ts
resources: pluginFiles("resources", {
	baseUrl: import.meta.url,
	prefix: "resources",
}),
```

## `pluginFiles(directory, options)`

Reads every file under a directory into `PluginFile`s
(`{ path, content, mode? }`):

- UTF-8 files become strings; other files stay bytes.
- Executable bits are kept, so a skill's scripts stay runnable.
- Symbolic links are skipped.
- `prefix` prepends a directory to every returned path.
- `include(path)` returns `false` to leave a file out.
- Relative directories resolve from the calling module; pass
  `baseUrl: import.meta.url` to make that explicit.

You can also build `PluginFile` objects by hand.

## Path tokens

Text in instructions, skill files and resources may use two tokens:

| Token | Resolves to |
| --- | --- |
| `${OIAP_PLUGIN_ROOT}` | The directory holding `resources`. |
| `${OIAP_AGENT_FILE:<agent id>}` | The exported file of that agent. |

```md
Read the standards in ${OIAP_PLUGIN_ROOT}/resources/review-standards.md.
Dispatch the reviewer defined in ${OIAP_AGENT_FILE:style-reviewer}.
```

`@oiap/core` exports `PLUGIN_ROOT_TOKEN` (the literal `${OIAP_PLUGIN_ROOT}`
string) so you can build paths in code without a template-literal clash.

### How tokens resolve

- When the host expands a plugin root variable at run time, tokens resolve
  through it. On Claude Code, `${OIAP_PLUGIN_ROOT}` becomes
  `${CLAUDE_PLUGIN_ROOT}`.
- Otherwise they resolve to a path relative to the file that contains them, and
  the capability report records a `plugin-root-variable` degradation: the agent
  must resolve the path from that file's location.
- OIAP's own evidence files in `.oiap/` keep tokens as written.

## Errors and warnings

- Two files written to the same bundle path, such as a resource that shadows a
  generated agent file, are an error (`duplicate-bundle-file`).
- A token left unresolved in a bundle file, such as one naming an agent the
  plugin does not define, is an error (`unresolved-path-token`).
- `SkillAsset.assets` (references without content) are not bundled and produce
  a `skill-assets-not-bundled` warning; use `files` instead.
- An exporter that does not write skill files or resources reports a
  `bundled-plugin-files` degradation, because instructions that read them would
  fail.

## Example

The [Elephant-Goldfish Model example](/oiap/examples/elephant-goldfish-model/)
ships skill references and shared resources, and rewrites repository paths
into tokens, for nine targets from one definition.
