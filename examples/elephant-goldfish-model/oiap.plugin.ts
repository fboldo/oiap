import { readdirSync } from "node:fs";
import type {
	AgentDefinition,
	InstructionModule,
	PluginDefinition,
	SkillAsset,
} from "@oiap/core";
import {
	definePlugin,
	markdownFile,
	PLUGIN_ROOT_TOKEN,
	pluginFiles,
} from "@oiap/core";

// Shared EGM content, vendored unchanged from
// https://github.com/google/elephant-goldfish-model at 70406c4.
const SOURCE = new URL("./source/", import.meta.url);

const SKILLS = readdirSync(new URL("skills/", SOURCE)).sort();

const PERSONAS = [
	"bootstrap_orchestrator",
	"codebase_details",
	"comprehension",
	"design_critic",
	"implementation_readiness",
	"inventive_catalyst",
	"structural",
	"style",
	"synthesizer",
	"zoom_out",
] as const;

// Personas that coordinate other agents. Every other persona is a read-only
// reviewer that must start without the parent conversation.
const ORCHESTRATORS = new Set(["bootstrap_orchestrator", "synthesizer"]);

// EGM text names bundled files by repository path. Rewrite those references
// into OIAP path tokens so every exporter can point them at its own layout.
const personaNames = Object.fromEntries(
	PERSONAS.map((persona) => [
		persona,
		stringField(readMarkdown(`agents/${persona}.md`), "name"),
	]),
);

function agentFileToken(name: string): string {
	return ["$", "{OIAP_AGENT_FILE:", name, "}"].join("");
}

function portPaths(text: string): string {
	return text
		.replace(/\bagents\/([a-z_]+)\.md\b/g, (reference, persona: string) => {
			const name = personaNames[persona];
			return name ? agentFileToken(name) : reference;
		})
		.replace(/(?<![\w/.])resources\//g, `${PLUGIN_ROOT_TOKEN}/resources/`);
}

interface MarkdownDocument {
	frontmatter: Record<string, unknown>;
	body: string;
}

function readMarkdown(path: string): MarkdownDocument {
	const text = markdownFile(new URL(path, SOURCE));
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	if (!match) {
		return { frontmatter: {}, body: text };
	}
	return {
		frontmatter: Bun.YAML.parse(match[1] ?? "") as Record<string, unknown>,
		body: text.slice(match[0].length).trimStart(),
	};
}

function stringField(document: MarkdownDocument, key: string): string {
	const value = document.frontmatter[key];
	if (typeof value !== "string") {
		throw new Error(`Missing frontmatter field: ${key}`);
	}
	return value.trim();
}

const instructions: InstructionModule[] = [];
const skills: SkillAsset[] = [];
const agents: AgentDefinition[] = [];

for (const directory of SKILLS) {
	const document = readMarkdown(`skills/${directory}/SKILL.md`);
	const name = stringField(document, "name");
	instructions.push({
		id: `${name}-instructions`,
		purpose: "workflow",
		triggers: [name],
		body: portPaths(document.body),
	});
	skills.push({
		id: name,
		name,
		description: stringField(document, "description"),
		instructions: { id: `${name}-instructions`, kind: "instruction" },
		// References, icons and Codex metadata read beside SKILL.md.
		files: pluginFiles(new URL(`skills/${directory}/`, SOURCE), {
			include: (path) => path !== "SKILL.md",
		}),
		targetMetadata: {
			"claude-code": { "disable-model-invocation": true },
			codex: { "disable-model-invocation": true },
		},
	});
}

for (const persona of PERSONAS) {
	const document = readMarkdown(`agents/${persona}.md`);
	const name = stringField(document, "name");
	instructions.push({
		id: `${name}-persona`,
		purpose: "agent",
		triggers: [name],
		body: portPaths(document.body),
	});
	agents.push({
		id: name,
		name,
		description: stringField(document, "description"),
		instructions: { id: `${name}-persona`, kind: "instruction" },
		model: "inherit",
		access: ORCHESTRATORS.has(persona) ? "read-write" : "read-only",
	});
}

export default definePlugin({
	manifest: {
		id: "egm",
		name: "Elephant-Goldfish Model",
		version: "0.1.1",
		description:
			"Develop ideas with context and review documents with fresh eyes.",
		homepage: "https://egm.dev",
		license: "Apache-2.0",
		categories: ["productivity", "design-documents", "design-review"],
		supportedTargets: [
			"antigravity",
			"claude-code",
			"cline",
			"codex",
			"cursor",
			"gemini-cli",
			"openclaw",
			"opencode",
			"vscode-copilot-chat",
		],
	},
	instructions,
	skills,
	agents,
	// Document standards shared by several skills and personas.
	resources: pluginFiles(new URL("resources/", SOURCE), {
		prefix: "resources",
	}).map((file) =>
		typeof file.content === "string"
			? { ...file, content: portPaths(file.content) }
			: file,
	),
} satisfies PluginDefinition);
