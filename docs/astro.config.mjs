// @ts-check
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightLlmsTxt from "starlight-llms-txt";

const repository = "https://github.com/fboldo/oiap";

export default defineConfig({
	site: "https://fboldo.github.io",
	base: "/oiap",
	trailingSlash: "ignore",
	integrations: [
		starlight({
			title: "OIAP",
			description:
				"Write your agent plugin once in TypeScript and export host-native bundles for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot, Antigravity, OpenClaw, OpenCode, Cline and Windsurf.",
			social: [{ icon: "github", label: "GitHub", href: repository }],
			editLink: { baseUrl: `${repository}/edit/main/docs/` },
			lastUpdated: false,
			plugins: [
				starlightLlmsTxt({
					projectName: "OIAP (Open Interoperable Agent Plugins)",
					details: [
						"OIAP is a TypeScript SDK (`@oiap/core`) and CLI (`@oiap/cli`, binary `oiap`). A plugin is an `oiap.plugin.ts` module that exports `definePlugin({...})`; exporters turn it into host-native files.",
						"",
						"- Target ids: `antigravity`, `claude-code`, `cline`, `codex`, `cursor`, `gemini-cli`, `github-copilot-cli`, `openclaw`, `opencode`, `vscode-copilot-chat`, `windsurf`.",
						"- Ship a plugin by committing host files with `oiap sync` (checked in CI by the `fboldo/oiap` GitHub Action), or by building at install time with `npx install-agent-plugin <owner>/<repo> --plugin <id> --agent <target>`.",
						"- Every build writes a capability report with status `ok`, `degraded` or `unsupported`.",
					].join("\n"),
					customSets: [
						{
							label: "Guides",
							description: "how to write, build and ship an OIAP plugin",
							paths: ["start/**", "guides/**"],
						},
						{
							label: "Targets",
							description:
								"the support matrix and one page per exporter target",
							paths: ["targets/**"],
						},
						{
							label: "Reference",
							description: "CLI reference, architecture and packages",
							paths: ["reference/**"],
						},
					],
					optionalLinks: [
						{
							label: "Source repository",
							url: repository,
							description: "code, issues and examples",
						},
					],
					promote: ["index*", "start/**"],
					demote: ["reference/architecture", "examples/**"],
					// Drop Starlight's "Section titled ..." heading links from every output.
					customSelectors: { all: [".sl-anchor-link"] },
					// Keep llms-small.txt to the how-to content.
					exclude: ["reference/architecture", "targets/matrix", "examples/**"],
				}),
			],
			sidebar: [
				{
					label: "Start here",
					items: [
						"start/what-is-oiap",
						"start/quick-start",
						"start/two-ways-to-ship",
					],
				},
				{
					label: "Guides",
					items: [
						"guides/write-a-plugin",
						"guides/bundled-files",
						"guides/agents",
						"guides/hooks",
						"guides/oiap-sync",
						"guides/github-action",
						"guides/install-agent-plugin",
						"guides/own-installer",
						"guides/capability-reports",
					],
				},
				{
					label: "Targets",
					items: [{ autogenerate: { directory: "targets" } }],
				},
				{
					label: "Reference",
					items: [
						"reference/cli",
						"reference/architecture",
						{
							label: "Packages",
							items: [{ autogenerate: { directory: "reference/packages" } }],
						},
					],
				},
				{
					label: "Examples",
					items: [{ autogenerate: { directory: "examples" } }],
				},
			],
		}),
	],
});
