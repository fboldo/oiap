---
title: Capability reports
description: How to read the ok, degraded and unsupported status, degradations and issues that every OIAP build reports.
---

Hosts don't all support the same surfaces. Instead of silently dropping what a
host can't express, every OIAP export carries a capability report that says
what mapped natively, what degraded and what is unsupported.

## Where to find it

Each bundle has an `.oiap/` directory:

| File | Contents |
| --- | --- |
| `.oiap/capability-report.json` | Status, mapped, degraded and unsupported capabilities, and issues. |
| `.oiap/bundle.json` | Plugin id, name, version, target, exporter package and the list of generated files. |
| `.oiap/source-map.json` | Which OIAP primitive produced each generated file. |
| `.oiap/policy.json` | The plugin's permission policies, as review evidence. |

The CLI also prints the status and issues of every target:

```text
Built claude-code -> dist/oiap/claude-code (12 files, ok)
Built cursor -> dist/oiap/cursor (12 files, degraded)
  warning: degraded-policy - Permission policies are emitted as evidence until policy-specific Cursor hook lowering is implemented.
```

`oiap build --json` and `oiap sync --json` print the same data as JSON, and the
[GitHub Action](/oiap/guides/github-action/) turns issues into pull request
annotations.

## Status

| Status | Meaning |
| --- | --- |
| `ok` | Everything the plugin declares mapped to the host. |
| `degraded` | The bundle was generated, but some capabilities were reduced, emitted as fallbacks or recorded as evidence only. Read the issues. |
| `unsupported` | A required capability cannot be expressed, or validation found an error. `oiap build` and `oiap sync` exit with status 1. |

## Report shape

```json
{
	"target": "codex",
	"status": "degraded",
	"mappedCapabilities": [
		{ "kind": "package", "target": "codex" },
		{ "kind": "skills", "target": "codex" },
		{ "kind": "agents", "target": "codex" }
	],
	"degradedCapabilities": [
		{
			"capability": { "kind": "package", "target": "codex" },
			"from": "plugin-root-variable",
			"to": "file-relative-path",
			"reason": "The host has no plugin root variable; bundled file references are relative to the file that contains them, and the agent must resolve them from that file's location."
		}
	],
	"unsupportedCapabilities": [],
	"issues": [
		{
			"severity": "warning",
			"code": "degraded-package",
			"message": "The host has no plugin root variable; ..."
		}
	]
}
```

- **`mappedCapabilities`**: capability kinds (`package`, `rules`, `skills`,
  `commands`, `hooks`, `agents`, `mcp`, `runtime`, `policy`, ...) the target
  rendered.
- **`degradedCapabilities`**: each entry says what the plugin asked for
  (`from`), what the bundle does instead (`to`) and why.
- **`unsupportedCapabilities`**: capabilities the target cannot express, with a
  `required` flag. A required one makes the status `unsupported`.
- **`issues`**: `info`, `warning` or `error` entries with a stable `code` and a
  message. Degradations appear here as `degraded-<kind>` warnings.

## Common degradations

| `from` | Meaning |
| --- | --- |
| `plugin-root-variable` | The host has no plugin root variable, so [path tokens](/oiap/guides/bundled-files/) resolve to file-relative paths. |
| `read-only-agent` | The host cannot restrict an agent marked `access: "read-only"`; see [Agents](/oiap/guides/agents/). |
| `bundled-plugin-files` | The exporter does not write skill files or resources. |
| `project-context-rules` | The host does not load rule files from a plugin, so rules and always-on instructions are not emitted. |

Hook and policy degradations name the decisions or policy fields the host can't
enforce.

## Common errors

| Code | Meaning |
| --- | --- |
| `duplicate-bundle-file` | Two files are written to the same bundle path. |
| `unresolved-path-token` | A path token is left in a bundle file, such as one naming an undefined agent. |

## What to do with a degradation

- Accept it, and say so in your plugin's README for that host.
- Use a different primitive that the host supports (for example a skill instead
  of a rule).
- Drop the target from `supportedTargets`.
- As a last resort, add `targetMetadata` or a target module for that host.

The [support matrix](/oiap/targets/matrix/) and each [target page](/oiap/targets/)
describe the limits you can expect before you build.
