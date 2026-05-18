---
name: oiap-platform-matrix-refresh
description: "Use when: refreshing OIAP platform support documentation, updating MATRIX.md, researching agent harness platform docs, auditing exporter assumptions, checking target profiles against adapters, or verifying capabilities such as hooks, MCP, skills, commands, rules, custom agents, runtime bridges, package formats, permissions, and policies across Claude Code, Codex, Gemini CLI, Hermes, Kiro, Cursor, Trae, Factory Droid, Antigravity, and related agent platforms."
argument-hint: "[platform names or all]"
user-invocable: true
---

# OIAP Platform Matrix Refresh

Use this skill to refresh OIAP's platform support matrix from current platform
documentation and compare the results against implemented OIAP adapters.

The workflow updates documentation and produces an adapter review report. It does
not install host tools, mutate user agent configuration, or implement adapter
code unless the user explicitly asks for that follow-up.

## Inputs

The user may name one platform, several platforms, or `all`. If no scope is
given, refresh the targets that are most likely to have changed or that have `?`
marks in `MATRIX.md`.

## Read First

Read these files before researching:

- `ARCHITECTURE.md`
- `MATRIX.md`
- `package.json`

Then inspect adapter code if it exists:

```bash
rg --files packages .agents | rg 'exporter|adapter|profile|target|platform'
```

If no adapter packages exist, treat adapter checks as planned-package checks and
say that no implementation comparison was possible yet.

## Research Procedure

1. Resolve the platform scope.
2. Start from the Documentation Sources table in `MATRIX.md`.
3. Use the queries in [platform-source-queries.md](./references/platform-source-queries.md)
   to find feature-specific docs and replacement official sources for rows
   marked `needs verification`.
4. Prefer official docs, canonical vendor repositories, and release notes.
5. Use community posts only as leads. Do not cite them as source of truth unless
   no official source exists, and mark that evidence as unverified.
6. For each platform, extract evidence for package, rules, skills, commands,
   hooks, agents/delegation, MCP/tools, runtime adapter needs, permissions, and
   policy controls.
7. Record dates and URLs in your working notes so the final summary can explain
   what changed.

When official docs cannot be found or are ambiguous, keep the matrix mark as `?`
and add a short note instead of guessing.

## Matrix Update Rules

Use the existing legend in `MATRIX.md`:

- `Y`: native or first-class target surface expected.
- `P`: partial support, profile-dependent support, or likely support needing
  verification.
- `F`: OIAP fallback support.
- `R`: runtime bridge required.
- `N`: not expected.
- `?`: needs verification.

Update the matrix only when evidence changes OIAP's export model. Keep wording
focused on generated bundles and adapter behavior, not installation steps.

## Adapter Comparison

Compare the refreshed matrix against adapter implementation if present.

Look for:

- `packages/exporter-<target>/src/profile.ts`
- `packages/exporter-<target>/src/exporter.ts`
- `packages/target-profiles/src/<target>.ts`
- Tests or fixtures that snapshot generated capability reports.

Classify mismatches as:

| Category | Meaning |
| --- | --- |
| `docs-ahead` | Matrix documents a capability the adapter does not implement yet |
| `adapter-ahead` | Adapter implements a capability missing from the matrix |
| `stale-docs` | Platform docs changed and the matrix needs a wording/capability update |
| `unsupported-required` | Required OIAP behavior cannot be exported safely for that target |
| `needs-source` | No current official source was found |
| `target-renamed` | Platform naming or package shape changed |

Add important mismatches to the Adapter Review Queue in `MATRIX.md`.
Do not change adapter behavior unless the user explicitly asks for an
implementation pass.

## Reporting Format

End with a concise report:

```markdown
## Platform Matrix Refresh

Updated: <platforms>
Sources checked: <count and strongest sources>
Matrix changes: <summary>
Adapter mismatches: <summary or none>
Open questions: <items needing human or future doc confirmation>
Validation: <commands run>
```

Mention exact platforms that remain `?` and why.

## Validation

After edits, run:

```bash
bunx biome check README.md ARCHITECTURE.md MATRIX.md .agents/skills/oiap-platform-matrix-refresh/SKILL.md .agents/skills/oiap-platform-matrix-refresh/references/platform-source-queries.md
```

Also run editor diagnostics for edited Markdown files when available.