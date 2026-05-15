# OIAP - Open Interoperable Agent Plugins

OIAP is an open-source SDK for building interoperable plugins for AI agents. It provides a standardized interface for creating plugins that can be easily integrated with various AI agent platforms.

## Problem Statement

As AI agents become more prevalent, the number of agent harness platforms is increasing. However, there is currently no standardized way to create plugins that can work across different platforms. This leads to fragmentation and makes it difficult for developers to create and share plugins.

## Solution

OIAP aims to solve this problem by providing an unified SDK for building interoperable plugins. With OIAP, developers can create plugins that can be easily integrated with multiple AI agent platforms without needing to rewrite code for each platform. OIAP abstracts away the differences between platforms and provides a consistent interface for plugin development through a set of core primitives and generators.

## Existing Solutions

Currently, the most notable effort in this space is the [Open Plugin Spec](https://github.com/vercel-labs/open-plugin-spec). However, OIAP can be positioned more as a framework for building plugins that can be used across various platforms, rather than an attempt to create a specification. OIAP can also be seen as a complementary tool to the Open Plugin Spec, providing a practical implementation for developers to create interoperable plugins.

## Packages

- [@oiap/core](packages/core) defines the primitive TypeScript contracts and author-facing API for OIAP plugins.
- [@oiap/runtime](packages/runtime) generates portable raw-JS hook runtime bundles used by target exporters.
- [@oiap/cli](packages/cli) builds target bundles from plugin definition files.
- [@oiap/exporter-claude-code](packages/exporter-claude-code) exports OIAP plugins into Claude Code-oriented bundle artifacts.
- [@oiap/exporter-codex](packages/exporter-codex) exports OIAP plugins into Codex plugin and project-configuration artifacts.
- [@oiap/exporter-openclaw](packages/exporter-openclaw) exports OIAP plugins into native OpenClaw plugin package artifacts.
- [@oiap/exporter-vscode-copilot](packages/exporter-vscode-copilot) exports OIAP plugins into VS Code Copilot agent plugin artifacts.

## Design Notes

- [Agent Plugin Authoring and Export Model](docs/platform-primitives.md) proposes the core OIAP primitives for defining a plugin once and exporting host-specific agent harness bundles.
- [Glossary](docs/glossary.md) defines the shared concepts used across the OIAP design documents.
- [Platform Support Matrix](docs/platform-matrix.md) tracks target platform capabilities, planned adapter packages, verification status, and adapter review notes.
- [Platform Conformance Test Harness](docs/test-harness.md) plans the harness for proving exported plugins actually work on target platforms.
- [Runtime Bridge Pattern](docs/runtime-bridge-pattern.md) defines the TypeScript-first hook API and explains how generated adapters run those hooks from Python, JavaScript, shell, MCP, or other host runtimes.