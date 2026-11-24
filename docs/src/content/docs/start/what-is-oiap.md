---
title: What is OIAP?
description: OIAP is a TypeScript SDK and build toolchain for writing an AI agent plugin once and exporting it to many agent hosts.
---

OIAP (Open Interoperable Agent Plugins) is a TypeScript SDK and build toolchain
for writing AI agent plugins once and exporting them into host-native bundles
for several agent platforms.

Agent hosts expose the same ideas through different file formats: commands,
skills, rules, hooks, custom agents, MCP configuration, runtime shims and
permission policies. OIAP gives you one authoring model and a set of exporters
that generate reviewable files for each host.

## How it works

1. You write `oiap.plugin.ts`, a TypeScript module that exports
   `definePlugin({...})` from [`@oiap/core`](/oiap/reference/packages/core/).
2. OIAP normalizes the definition into an intermediate representation.
3. One exporter per target renders host-native files: manifests, `SKILL.md`
   folders, command files, agent files, hook configuration, MCP configuration.
4. Each bundle carries a [capability report](/oiap/guides/capability-reports/)
   that says what mapped natively, what degraded and what is unsupported.

```text
oiap.plugin.ts
  -> definePlugin(...)            @oiap/core
    -> exporter per target        @oiap/exporter-*
      -> host-native files + .oiap/ (bundle manifest, capability report, source map)
```

## What you get

- **Host-neutral TypeScript authoring** for manifests, commands, instructions,
  skills, hooks, agents, tools, artifacts, recipes and policies.
- **A CLI** (`oiap`, from `@oiap/cli`) that builds deterministic bundle
  directories and syncs host files into your repository.
- **Exporters** for the [registered targets](/oiap/targets/).
- **A hook runtime** so a hook written once as a TypeScript function runs
  through each host's own hook mechanism.
- **Capability reports** so degradations are visible instead of silent.

## What OIAP does not do

OIAP builds bundles. It does not edit a user's global agent configuration
outside an explicit install, auto-enable hooks, MCP servers or permissions, or
make account, marketplace or organization policy decisions. Hosts install
plugins with their own tooling; OIAP generates the files they read.

OIAP is complementary to specification efforts such as the
[Open Plugin Spec](https://github.com/vercel-labs/open-plugin-spec). It is
authoring and bundling infrastructure, not a competing standard.

:::caution[Project status]
OIAP is early and actively evolving. Target support and generated formats change
as hosts change; the [support matrix](/oiap/targets/matrix/) records what has
been verified and when.
:::

## Next steps

- [Quick start](/oiap/start/quick-start/): install the CLI and build a bundle.
- [Two ways to ship a plugin](/oiap/start/two-ways-to-ship/): commit host files
  or build at install time.
- [Architecture](/oiap/reference/architecture/): the full design, glossary and
  primitive model.
