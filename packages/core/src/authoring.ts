import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import type { HookDefinition, TargetModuleRef } from "./hooks.ts";
import type {
	AgentDefinition,
	Artifact,
	CommandAsset,
	CommandRecipe,
	DelegationStrategy,
	HostProfile,
	InstructionModule,
	Invocation,
	PermissionPolicy,
	PlatformExporter,
	PluginFile,
	PluginIr,
	PluginManifest,
	ProjectRule,
	RuntimeModule,
	SkillAsset,
	InstructionModule as SkillInstruction,
	TargetId,
	ToolSurface,
	Workflow,
} from "./primitives.ts";

export const CURRENT_OIAP_CORE_VERSION = "0.0.0";

export interface MarkdownFileOptions {
	baseDir?: string;
	baseUrl?: string | URL;
}

export interface PluginDefinition {
	manifest?: PluginManifest;
	invocations?: Invocation[];
	instructions?: InstructionModule[];
	commands?: CommandAsset[];
	workflows?: Workflow[];
	rules?: ProjectRule[];
	skills?: SkillAsset[];
	hooks?: HookDefinition[];
	agents?: AgentDefinition[];
	tools?: ToolSurface[];
	artifacts?: Artifact[];
	recipes?: CommandRecipe[];
	delegationStrategies?: DelegationStrategy[];
	policies?: PermissionPolicy[];
	runtimeModules?: RuntimeModule[];
	resources?: PluginFile[];
	/**
	 * Files written as-is into one target's bundle, relative to its root: host
	 * files OIAP does not model, such as hand-written hook scripts or Gemini
	 * `commands/*.toml`.
	 */
	targetFiles?: Partial<Record<TargetId, PluginFile[]>>;
	targetModules?: Partial<
		Record<TargetId, TargetModuleRef | TargetModuleRef[]>
	>;
}

export type DefinedPlugin<
	TDefinition extends PluginDefinition = PluginDefinition,
> = TDefinition & {
	readonly kind: "oiap.plugin";
	readonly oiapVersion: string;
};

export function definePlugin<const TDefinition extends PluginDefinition>(
	definition: TDefinition,
): DefinedPlugin<TDefinition> {
	return {
		...definition,
		kind: "oiap.plugin",
		oiapVersion: CURRENT_OIAP_CORE_VERSION,
	} as DefinedPlugin<TDefinition>;
}

export function markdownFile(
	filePath: string | URL,
	options: MarkdownFileOptions = {},
): string {
	const resolvedPath = resolveMarkdownFilePath(filePath, options);

	if (!existsSync(resolvedPath)) {
		throw new Error(`Markdown file not found: ${resolvedPath}`);
	}

	return readFileSync(resolvedPath, "utf8");
}

export interface PluginFilesOptions extends MarkdownFileOptions {
	/** Path prefix for the returned files, such as `references`. */
	prefix?: string;
	/** Return false to leave a file out; receives the path relative to the directory. */
	include?: (path: string) => boolean;
}

/**
 * Read every file under a directory as `PluginFile`s, for `SkillAsset.files`
 * and plugin `resources`. UTF-8 files become strings; others stay bytes.
 */
export function pluginFiles(
	directory: string | URL,
	options: PluginFilesOptions = {},
): PluginFile[] {
	const root = resolveMarkdownFilePath(directory, options);

	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`Plugin file directory not found: ${root}`);
	}

	// ignoreBOM keeps a leading byte-order mark, so text files stay byte-identical.
	const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

	return listFiles(root)
		.map((filePath) => relative(root, filePath).split(sep).join("/"))
		.filter((path) => options.include?.(path) ?? true)
		.sort()
		.map((path) => {
			const filePath = join(root, path);
			const bytes = readFileSync(filePath);
			const mode = statSync(filePath).mode & 0o777;
			let content: string | Uint8Array;
			try {
				content = decoder.decode(bytes);
			} catch {
				content = new Uint8Array(bytes);
			}
			return {
				path: options.prefix ? `${options.prefix}/${path}` : path,
				content,
				// Keep executable bits, such as on a skill's scripts.
				mode: mode & 0o111 ? mode : undefined,
			};
		});
}

function listFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const entryPath = join(directory, entry.name);
		if (entry.isDirectory()) {
			return listFiles(entryPath);
		}
		return entry.isFile() ? [entryPath] : [];
	});
}

export interface SkillsFromOptions extends MarkdownFileOptions {
	/** Return false to leave a skill directory out; receives its name. */
	include?: (name: string) => boolean;
}

/**
 * Use the skills a repository already has: every `<directory>/<name>/SKILL.md`
 * becomes a skill that exporters emit unchanged, with its sibling files.
 * Frontmatter is read for `name`, `description`,
 * `disable-model-invocation` and `user-invocable`; other keys stay in the file.
 */
export function skillsFrom(
	directory: string | URL,
	options: SkillsFromOptions = {},
): SkillAsset[] {
	const root = resolveMarkdownFilePath(directory, options);

	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`Skills directory not found: ${root}`);
	}

	return readdirSync(root, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(join(root, entry.name, "SKILL.md")) &&
				(options.include?.(entry.name) ?? true),
		)
		.map((entry) => entry.name)
		.sort()
		.map((name) => skillFrom(join(root, name)));
}

/** Use one skill directory that already exists in the repository; see `skillsFrom`. */
export function skillFrom(
	directory: string | URL,
	options: MarkdownFileOptions = {},
): SkillAsset {
	const skillDirectory = resolveMarkdownFilePath(directory, options);
	const skillFile = readFileSync(join(skillDirectory, "SKILL.md"), "utf8");
	const { frontmatter } = splitFrontmatter(skillFile);
	const id = basename(skillDirectory);
	const description = frontmatter.description;

	if (typeof description !== "string" || description.trim() === "") {
		throw new Error(
			`${join(skillDirectory, "SKILL.md")} needs a description in its frontmatter.`,
		);
	}

	return {
		id,
		name: typeof frontmatter.name === "string" ? frontmatter.name : id,
		description: description.trim(),
		instructions: { id: skillSourceInstructionId(id), kind: "instruction" },
		files: pluginFiles(skillDirectory, {
			include: (path) => path !== "SKILL.md",
		}),
		modelInvocable:
			frontmatter["disable-model-invocation"] === true ? false : undefined,
		userInvocable: frontmatter["user-invocable"] === false ? false : undefined,
		source: { directory: skillDirectory, skillFile },
	};
}

export interface AgentsFromOptions extends MarkdownFileOptions {
	/** Return false to leave an agent file out; receives its file name. */
	include?: (fileName: string) => boolean;
}

/**
 * Use the agents a repository already has: every `<directory>/*.md` becomes an
 * agent that hosts reading Markdown agent files get unchanged. Frontmatter is
 * read for `name`, `description` and `model`; the body becomes the agent's
 * instructions for hosts with other agent formats.
 */
export function agentsFrom(
	directory: string | URL,
	options: AgentsFromOptions = {},
): AgentDefinition[] {
	const root = resolveMarkdownFilePath(directory, options);

	if (!existsSync(root) || !statSync(root).isDirectory()) {
		throw new Error(`Agents directory not found: ${root}`);
	}

	return readdirSync(root, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isFile() &&
				entry.name.endsWith(".md") &&
				(options.include?.(entry.name) ?? true),
		)
		.map((entry) => entry.name)
		.sort()
		.map((name) => agentFrom(join(root, name)));
}

/** Use one agent file that already exists in the repository; see `agentsFrom`. */
export function agentFrom(
	file: string | URL,
	options: MarkdownFileOptions = {},
): AgentDefinition {
	const agentFile = resolveMarkdownFilePath(file, options);
	const content = readFileSync(agentFile, "utf8");
	const { frontmatter } = splitFrontmatter(content);
	const id = basename(agentFile).replace(/\.md$/, "");
	const description = frontmatter.description;

	if (typeof description !== "string" || description.trim() === "") {
		throw new Error(`${agentFile} needs a description in its frontmatter.`);
	}

	return {
		id,
		name: typeof frontmatter.name === "string" ? frontmatter.name : id,
		description: description.trim(),
		instructions: { id: agentSourceInstructionId(id), kind: "instruction" },
		model:
			typeof frontmatter.model === "string" ? frontmatter.model : undefined,
		source: { file: agentFile, content },
	};
}

function agentSourceInstructionId(id: string): string {
	return `${id}-agent-source`;
}

function skillSourceInstructionId(id: string): string {
	return `${id}-skill-source`;
}

function splitFrontmatter(text: string): {
	frontmatter: Record<string, unknown>;
	body: string;
} {
	const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);

	if (!match) {
		return { frontmatter: {}, body: text };
	}

	const parsed: unknown = parseYaml(match[1] ?? "");

	return {
		frontmatter:
			parsed && typeof parsed === "object" && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: {},
		body: text.slice(match[0].length),
	};
}

/** Instruction modules for in-place skills and agents whose body the definition does not declare. */
function skillSourceInstructions(
	definition: PluginDefinition,
): SkillInstruction[] {
	const declared = new Set(
		(definition.instructions ?? []).map((instruction) => instruction.id),
	);

	const agentInstructions = (definition.agents ?? []).flatMap((agent) =>
		agent.source && !declared.has(agent.instructions.id)
			? [
					{
						id: agent.instructions.id,
						purpose: "agent" as const,
						triggers: [agent.name],
						body: splitFrontmatter(agent.source.content).body.trimStart(),
					},
				]
			: [],
	);

	return [
		...agentInstructions,
		...(definition.skills ?? []).flatMap((skill) =>
			skill.source && !declared.has(skill.instructions.id)
				? [
						{
							id: skill.instructions.id,
							purpose: "workflow" as const,
							triggers: [skill.name],
							body: splitFrontmatter(skill.source.skillFile).body.trimStart(),
						},
					]
				: [],
		),
	];
}

export function toPluginIr(definition: PluginDefinition): PluginIr {
	return {
		manifest: definition.manifest,
		invocations: definition.invocations ?? [],
		instructions: [
			...(definition.instructions ?? []),
			...skillSourceInstructions(definition),
		],
		commands: definition.commands ?? [],
		workflows: definition.workflows ?? [],
		rules: definition.rules ?? [],
		skills: definition.skills ?? [],
		hooks: definition.hooks ?? [],
		agents: definition.agents ?? [],
		tools: definition.tools ?? [],
		artifacts: definition.artifacts ?? [],
		recipes: definition.recipes ?? [],
		delegationStrategies: definition.delegationStrategies ?? [],
		policies: definition.policies ?? [],
		runtimeModules: definition.runtimeModules ?? [],
		resources: definition.resources ?? [],
		targetFiles: definition.targetFiles ?? {},
	};
}

export function defineManifest<const TManifest extends PluginManifest>(
	manifest: TManifest,
): TManifest {
	return manifest;
}

export function defineHostProfile<const TProfile extends HostProfile>(
	profile: TProfile,
): TProfile {
	return profile;
}

export function defineExporter<const TExporter extends PlatformExporter>(
	exporter: TExporter,
): TExporter {
	return exporter;
}

function resolveMarkdownFilePath(
	filePath: string | URL,
	options: MarkdownFileOptions,
): string {
	if (filePath instanceof URL) {
		return fileURLToPath(filePath);
	}

	if (isAbsolute(filePath)) {
		return filePath;
	}

	const baseDir =
		options.baseDir ??
		(options.baseUrl ? dirname(fileURLToPath(options.baseUrl)) : undefined) ??
		inferCallerDirectory() ??
		process.cwd();

	return resolve(baseDir, filePath);
}

function inferCallerDirectory(): string | undefined {
	const stack = new Error().stack;

	if (!stack) {
		return undefined;
	}

	const authoringFile = fileURLToPath(import.meta.url);

	for (const line of stack.split("\n").slice(1)) {
		const filePath = stackFrameFilePath(line);

		if (!filePath || filePath === authoringFile) {
			continue;
		}

		return dirname(filePath);
	}

	return undefined;
}

function stackFrameFilePath(line: string): string | undefined {
	const match = line.match(/\(?((?:file:\/\/)?\/.*?):\d+:\d+\)?$/);
	const rawPath = match?.[1];

	if (!rawPath) {
		return undefined;
	}

	try {
		return rawPath.startsWith("file://") ? fileURLToPath(rawPath) : rawPath;
	} catch {
		return undefined;
	}
}
