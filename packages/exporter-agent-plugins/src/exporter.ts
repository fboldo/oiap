import type {
	CapabilityDegradation,
	CapabilityKind,
	ExportReport,
	HostCapability,
	InstructionModule,
	LoweredTargetGraph,
	PackageAssetRef,
	PluginDefinition,
	PluginIr,
	PluginManifest,
	RenderedFile,
	SkillAsset,
	SourceRef,
	TargetBundle,
	ToolSurface,
	UnsupportedCapability,
	ValidationIssue,
} from "@oiap/core";
import {
	bundleFileFindings,
	defineExporter,
	duplicateFileIssues,
	mergeTargetMetadata,
	renderPluginFiles,
	resolveBundlePaths,
	scopeToTarget,
	toPluginIr,
	unresolvedTokenIssues,
} from "@oiap/core";
import {
	AGENT_PLUGINS_MCP_SCHEMA,
	AGENT_PLUGINS_PLUGIN_SCHEMA,
	AGENT_PLUGINS_TARGET,
	agentPluginsProfile,
} from "./profile.ts";

export type AgentPluginsPluginInput = PluginDefinition | PluginIr;

export interface AgentPluginsSourceMap {
	target: typeof AGENT_PLUGINS_TARGET;
	entries: AgentPluginsSourceMapEntry[];
}

export interface AgentPluginsSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

const MANIFEST_PATH = "plugin.json";
const MCP_PATH = "mcp.json";

/** Expanded by clients in stdio `args`, `env` and `cwd` (spec §9.2). */
const PLUGIN_ROOT_VARIABLE = "$" + "{PLUGIN_ROOT}";
const PLUGIN_DATA_VARIABLE = "$" + "{PLUGIN_DATA}";
const OIAP_PLUGIN_ROOT = "$" + "{OIAP_PLUGIN_ROOT}";

/** Closed top-level field set of plugin.json (spec §5.2). */
const MANIFEST_FIELDS = new Set([
	"$schema",
	"name",
	"version",
	"description",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);

/** Plugin name rules (spec §5.5), as in the official schema. */
const PLUGIN_NAME_PATTERN =
	/^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

/** Agent Skills `name`: https://agentskills.io/specification */
const SKILL_NAME_PATTERN = /^(?!.*--)[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/** Reverse-domain extension namespace, such as `com.github.copilot` (spec §8). */
const EXTENSION_NAMESPACE_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i;

/** Targets that carry what Agent Plugins 1.0 leaves out. */
const HOST_TARGETS =
	"claude-code, codex, cursor, github-copilot-cli or vscode-copilot-chat";

const EXTENSION_HINT = `or ship the host's own files through targetFiles["${AGENT_PLUGINS_TARGET}"] in a client extension directory such as com.github.copilot/ and point to them from manifest.targetMetadata["${AGENT_PLUGINS_TARGET}"].extensions`;

export const agentPluginsExporter = defineExporter({
	target: AGENT_PLUGINS_TARGET,
	profile: agentPluginsProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		return {
			target: AGENT_PLUGINS_TARGET,
			files: renderAgentPluginsFiles(ir),
			runtimeModules: [],
			configFragments: [],
			report: createExportReport(ir),
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: AGENT_PLUGINS_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "agent-plugins-package",
				target: AGENT_PLUGINS_TARGET,
				manifestPath: MANIFEST_PATH,
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateAgentPluginsBundle(bundle);
	},
});

export function exportAgentPlugins(
	plugin: AgentPluginsPluginInput,
): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = agentPluginsExporter.lower(ir);
	const bundle = agentPluginsExporter.render(graph);
	const validationIssues = agentPluginsExporter.validate(bundle);

	if (validationIssues.length === 0) {
		return bundle;
	}

	const hasError = validationIssues.some((issue) => issue.severity === "error");
	const hasWarning = validationIssues.some(
		(issue) => issue.severity === "warning",
	);

	return {
		...bundle,
		report: {
			...bundle.report,
			status: hasError
				? "unsupported"
				: hasWarning && bundle.report.status === "ok"
					? "degraded"
					: bundle.report.status,
			issues: [...bundle.report.issues, ...validationIssues],
		},
	};
}

// Primitives limited to other hosts with `targets` never reach this exporter.
function normalizePluginInput(plugin: AgentPluginsPluginInput): PluginIr {
	return scopeToTarget(
		isPluginIr(plugin) ? plugin : toPluginIr(plugin),
		AGENT_PLUGINS_TARGET,
	);
}

function isPluginIr(plugin: AgentPluginsPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderAgentPluginsFiles(ir: PluginIr): RenderedFile[] {
	const manifest = getManifest(ir);
	const generatedFiles = [
		renderPluginManifest(ir),
		...ir.skills.flatMap((skill) => [
			renderSkill(skill, ir.instructions),
			...renderPluginFiles(
				skill.files,
				`skills/${skillDirectory(skill)}`,
				sourceRef(skill.id, "skill-file"),
			),
		]),
		...renderPluginFiles(ir.resources, "", sourceRef(manifest.id, "resource")),
		// Hand-written files at the plugin root, such as a client extension
		// directory (com.github.copilot/agents/...), before path resolution and
		// duplicate checks.
		...renderPluginFiles(
			ir.targetFiles?.[AGENT_PLUGINS_TARGET],
			"",
			sourceRef(manifest.id, "target-file"),
		),
	];
	// Agents are not part of the format, so agent file references stay
	// unresolved and are reported by validation.
	const pathContext = { resourceRoot: "", agentFiles: {} };
	// Only MCP stdio args, env and cwd expand ${PLUGIN_ROOT}; skill text uses
	// paths relative to the file, as Agent Skills recommends.
	const pluginFiles = [
		...resolveBundlePaths(generatedFiles, pathContext),
		...resolveBundlePaths(renderMcpFiles(ir.tools), {
			...pathContext,
			rootVariable: PLUGIN_ROOT_VARIABLE,
		}),
	];

	return [
		...pluginFiles,
		jsonFile(
			".oiap/bundle.json",
			createBundleManifest(ir, pluginFiles),
			sourceRef("oiap-bundle", "bundle"),
		),
		jsonFile(
			".oiap/capability-report.json",
			createExportReport(ir),
			sourceRef("oiap-report", "report"),
		),
		jsonFile(
			".oiap/source-map.json",
			createSourceMap(pluginFiles),
			sourceRef("oiap-source-map", "source-map"),
		),
	];
}

// plugin.json is closed (spec §5.2): $schema, name, version, description,
// author {name, email, url}, homepage, repository, license, keywords and
// extensions. There is no displayName or logo in 1.0.0. Client-specific data
// goes under `extensions` keyed by reverse-domain namespace (§8.1); authors add
// it, or override any generated field, through
// manifest.targetMetadata["agent-plugins"].
// https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md#5-manifest
function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const generated = omitUndefined({
		$schema: AGENT_PLUGINS_PLUGIN_SCHEMA,
		name: agentPluginName(manifest.id),
		version: manifest.version,
		description: manifest.description,
		author: manifest.author ? omitUndefined({ ...manifest.author }) : undefined,
		homepage: manifest.homepage,
		repository: manifest.repository,
		license: manifest.license,
		keywords: manifestKeywords(manifest),
	});
	const content = mergeTargetMetadata(
		generated,
		manifest.targetMetadata?.[AGENT_PLUGINS_TARGET],
	);

	return jsonFile(MANIFEST_PATH, content, sourceRef(manifest.id, "manifest"));
}

function manifestKeywords(
	manifest: Pick<PluginManifest, "keywords" | "categories">,
): string[] | undefined {
	if (manifest.keywords && manifest.keywords.length > 0) {
		return manifest.keywords;
	}

	return manifest.categories.length > 0 ? manifest.categories : undefined;
}

/** 1-64 of a-z, 0-9, `-` and `.`, alphanumeric at both ends, no `--` or `..`. */
function agentPluginName(id: string): string {
	const trim = (value: string) =>
		value.replace(/^[^a-z0-9]+/, "").replace(/[^a-z0-9]+$/, "");
	const normalized = trim(
		id
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9.-]+/g, "-")
			.replace(/-{2,}/g, "-")
			.replace(/\.{2,}/g, "."),
	);

	return trim(normalized.slice(0, 64)) || "plugin";
}

/** Agent Skills names: 1-64 of a-z, 0-9 and single hyphens, matching the folder. */
function skillDirectory(skill: SkillAsset): string {
	const normalized = skill.name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized.slice(0, 64).replace(/-+$/, "") || "skill";
}

// Agent Skills frontmatter: name (matches the folder), description, and
// optionally license, compatibility, metadata and allowed-tools, which authors
// set through skill.targetMetadata["agent-plugins"].
// https://agentskills.io/specification
function renderSkill(
	skill: SkillAsset,
	instructions: InstructionModule[],
): RenderedFile {
	const directory = skillDirectory(skill);
	const instruction = instructions.find(
		(candidate) => candidate.id === skill.instructions.id,
	);
	const body =
		(instruction ? instructionBody(instruction) : undefined) ??
		`Skill instruction reference not found: ${skill.instructions.id}`;
	// A skill from skillsFrom() keeps its SKILL.md exactly as written.
	const content =
		skill.source?.skillFile ??
		withFrontmatter(
			{
				name: directory,
				description: skill.description,
				...(skill.targetMetadata?.[AGENT_PLUGINS_TARGET] ?? {}),
			},
			body,
		);

	return textFile(
		`skills/${directory}/SKILL.md`,
		content,
		sourceRef(skill.id, "skill"),
	);
}

interface McpEntry {
	name: string;
	config?: Record<string, unknown>;
	/** What was left out or changed meaning, for the report. */
	lost: string[];
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	const entries = mcpEntries(tools).filter((entry) => entry.config);

	if (entries.length === 0) {
		return [];
	}

	return [
		jsonFile(
			MCP_PATH,
			{
				$schema: AGENT_PLUGINS_MCP_SCHEMA,
				mcpServers: Object.fromEntries(
					entries.map((entry) => [entry.name, entry.config]),
				),
			},
			sourceRef("agent-plugins-mcp", "mcp"),
		),
	];
}

// mcp.json is a closed union per server (spec §7.2.1): stdio {command, args,
// env, cwd}, streamable-http or sse {url, headers}. `command` is one token,
// bare or `./`-relative, never expanded; only args, env and cwd expand
// ${PLUGIN_ROOT}/${PLUGIN_DATA}; url and headers are never expanded.
// https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md#72-mcp-servers
function mcpEntries(tools: ToolSurface[]): McpEntry[] {
	return tools.flatMap((tool) =>
		tool.server ? [mcpEntry(tool, tool.server)] : [],
	);
}

function mcpEntry(
	tool: ToolSurface,
	server: NonNullable<ToolSurface["server"]>,
): McpEntry {
	const lost: string[] = [];

	for (const field of [
		"includeTools",
		"excludeTools",
		"auth",
		"required",
	] as const) {
		if (server[field] !== undefined) {
			lost.push(`${field} (no Agent Plugins field)`);
		}
	}

	const remoteType =
		tool.transport === "mcp-sse"
			? "sse"
			: tool.transport === "mcp-http" || !server.command
				? "streamable-http"
				: undefined;

	if (remoteType) {
		const url =
			remoteType === "sse"
				? (server.url ?? server.httpUrl)
				: (server.httpUrl ?? server.url);

		if (!url) {
			return {
				name: tool.id,
				lost: [...lost, "the server (it has neither a command nor a URL)"],
			};
		}

		return {
			name: tool.id,
			config: omitUndefined({
				type: remoteType,
				url,
				headers: literalHeaders(server.headers, lost),
			}),
			lost,
		};
	}

	return {
		name: tool.id,
		config: omitUndefined({
			type: "stdio",
			command: portableCommand(server.command ?? ""),
			args: server.args,
			env: portableEnv(server.env, lost),
			cwd: portableCwd(server.cwd, lost),
		}),
		lost: [...lost, ...foreignArgs(server.args)],
	};
}

/** A bundled executable is `./`-relative; the command is never expanded. */
function portableCommand(command: string): string {
	for (const root of [OIAP_PLUGIN_ROOT, PLUGIN_ROOT_VARIABLE]) {
		if (command.startsWith(`${root}/`)) {
			return `./${command.slice(root.length + 1)}`;
		}
	}

	return command;
}

/** `${NAME}` other than the plugin variables, which clients leave literal. */
function foreignPlaceholders(value: string): string[] {
	return [
		...value.matchAll(
			/\$\{(?!(?:PLUGIN_ROOT|PLUGIN_DATA|OIAP_PLUGIN_ROOT)\}|OIAP_AGENT_FILE:)([^}]*)\}/g,
		),
	].map((match) => match[0]);
}

function foreignArgs(args: string[] | undefined): string[] {
	const placeholders = [...new Set((args ?? []).flatMap(foreignPlaceholders))];

	return placeholders.length > 0
		? [`args keep ${placeholders.join(", ")} literally (no expansion)`]
		: [];
}

function portableEnv(
	env: Record<string, string> | undefined,
	lost: string[],
): Record<string, string> | undefined {
	if (!env) {
		return undefined;
	}

	const kept: Record<string, string> = {};

	for (const [key, value] of Object.entries(env)) {
		if (key === "PLUGIN_ROOT" || key === "PLUGIN_DATA") {
			lost.push(`env ${key} (reserved; the client sets it)`);
		} else if (foreignPlaceholders(value).length > 0) {
			lost.push(
				`env ${key} (references ${foreignPlaceholders(value).join(", ")}, which clients do not expand)`,
			);
		} else {
			kept[key] = value;
		}
	}

	return Object.keys(kept).length > 0 ? kept : undefined;
}

function literalHeaders(
	headers: Record<string, string> | undefined,
	lost: string[],
): Record<string, string> | undefined {
	if (!headers) {
		return undefined;
	}

	const kept: Record<string, string> = {};

	for (const [key, value] of Object.entries(headers)) {
		if (value.includes("$" + "{")) {
			lost.push(
				`header ${key} (clients never expand placeholders in headers, and headers must not carry secrets)`,
			);
		} else {
			kept[key] = value;
		}
	}

	return Object.keys(kept).length > 0 ? kept : undefined;
}

/** `./…`, `${PLUGIN_ROOT}…` or `${PLUGIN_DATA}…`; the plugin root is the default. */
function portableCwd(
	cwd: string | undefined,
	lost: string[],
): string | undefined {
	if (cwd === undefined || cwd === "." || cwd === "./") {
		return undefined;
	}

	const value = cwd.startsWith(OIAP_PLUGIN_ROOT)
		? PLUGIN_ROOT_VARIABLE + cwd.slice(OIAP_PLUGIN_ROOT.length)
		: cwd;
	const segments = value.split(/[\\/]/);

	if (!segments.includes("..")) {
		if (
			value.startsWith("./") ||
			value === PLUGIN_ROOT_VARIABLE ||
			value.startsWith(`${PLUGIN_ROOT_VARIABLE}/`) ||
			value === PLUGIN_DATA_VARIABLE ||
			value.startsWith(`${PLUGIN_DATA_VARIABLE}/`)
		) {
			return value;
		}

		if (!/^(?:[/\\~]|[A-Za-z]:|\$)/.test(value)) {
			return `./${value}`;
		}
	}

	lost.push(
		`cwd ${cwd} (must stay inside the plugin root or PLUGIN_DATA; the plugin root is used)`,
	);
	return undefined;
}

function createExportReport(ir: PluginIr): ExportReport {
	const mappedCapabilities = collectMappedCapabilities(ir);
	const degradedCapabilities = collectDegradedCapabilities(ir);
	const unsupportedCapabilities = collectUnsupportedCapabilities(ir);
	const issues = collectIssues(
		ir,
		degradedCapabilities,
		unsupportedCapabilities,
	);
	const status = unsupportedCapabilities.some(
		(capability) => capability.required,
	)
		? "unsupported"
		: degradedCapabilities.length > 0
			? "degraded"
			: "ok";

	return {
		target: AGENT_PLUGINS_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: AGENT_PLUGINS_TARGET },
	];

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: AGENT_PLUGINS_TARGET });
	}

	if (mcpEntries(ir.tools).some((entry) => entry.config)) {
		capabilities.push({ kind: "mcp", target: AGENT_PLUGINS_TARGET });
	}

	return capabilities;
}

// Bundle file findings, minus MCP config: mcp.json resolves bundled paths with
// ${PLUGIN_ROOT}, which clients expand.
function bundleFindings(ir: PluginIr) {
	return bundleFileFindings(
		{ ...ir, tools: [] },
		{ target: AGENT_PLUGINS_TARGET, files: true, rootVariable: false },
	);
}

function notEmitted(
	kind: CapabilityKind,
	from: string,
	count: number,
	what: string,
): CapabilityDegradation {
	return {
		capability: { kind, target: AGENT_PLUGINS_TARGET },
		from,
		to: "not-emitted",
		reason: `Agent Plugins 1.0 defines only skills and MCP servers, so ${count} ${what} were left out. Export the ${HOST_TARGETS} target for them, ${EXTENSION_HINT}.`,
	};
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [
		...bundleFindings(ir).degradations,
	];

	const restrictedSkills = ir.skills.filter(
		(skill) => skill.modelInvocable === false || skill.userInvocable === false,
	);

	if (restrictedSkills.length > 0) {
		degradations.push({
			capability: { kind: "skills", target: AGENT_PLUGINS_TARGET },
			from: "skill-invocation-control",
			to: "default-invocation",
			reason: `Agent Skills has no field to limit who can run a skill, so ${restrictedSkills.map((skill) => skill.id).join(", ")} can be run by both the user and the model. SKILL.md files used in place keep their own host keys, which some hosts may honor.`,
		});
	}

	if (ir.commands.length > 0) {
		degradations.push(
			notEmitted("commands", "commands", ir.commands.length, "command(s)"),
		);
	}

	if (ir.workflows.length > 0) {
		degradations.push(
			notEmitted("commands", "workflows", ir.workflows.length, "workflow(s)"),
		);
	}

	if (ir.agents.length > 0) {
		degradations.push(
			notEmitted("agents", "agents", ir.agents.length, "agent(s)"),
		);
	}

	const ruleCount = ir.rules.length + standaloneInstructions(ir).length;

	if (ruleCount > 0) {
		degradations.push(
			notEmitted(
				"rules",
				"project-context-rules",
				ruleCount,
				"rule(s) or always-on instruction(s)",
			),
		);
	}

	if (ir.hooks.length > 0) {
		degradations.push(
			notEmitted(
				"hooks",
				"hooks",
				ir.hooks.length,
				"hook(s) (hooks are only in the 1.1.0 working draft)",
			),
		);
	}

	const runtimeModules = ir.runtimeModules.filter(
		(module) => module.target === AGENT_PLUGINS_TARGET,
	);

	if (runtimeModules.length > 0) {
		degradations.push(
			notEmitted(
				"runtime",
				"runtime-modules",
				runtimeModules.length,
				"runtime module(s)",
			),
		);
	}

	if (ir.policies.length > 0) {
		degradations.push(
			notEmitted(
				"policy",
				"permission-policies",
				ir.policies.length,
				"permission polic(ies)",
			),
		);
	}

	const lost = mcpEntries(ir.tools).flatMap((entry) =>
		entry.lost.map((item) => `${entry.name}: ${item}`),
	);

	if (lost.length > 0) {
		degradations.push({
			capability: { kind: "mcp", target: AGENT_PLUGINS_TARGET },
			from: "oiap-mcp-server",
			to: "agent-plugins-mcp-server",
			reason: `Agent Plugins mcp.json could not keep: ${lost.join("; ")}.`,
		});
	}

	const serverless = ir.tools.filter((tool) => !tool.server);

	if (serverless.length > 0) {
		degradations.push({
			capability: { kind: "mcp", target: AGENT_PLUGINS_TARGET },
			from: "tool-surface-without-server",
			to: "not-emitted",
			reason: `${serverless.map((tool) => tool.id).join(", ")} declare no MCP server, and Agent Plugins can only ship tools as MCP servers.`,
		});
	}

	return degradations;
}

const UNSUPPORTED_KINDS = new Set<CapabilityKind>([
	"commands",
	"hooks",
	"agents",
	"rules",
	"policy",
	"runtime",
]);

function collectUnsupportedCapabilities(ir: PluginIr): UnsupportedCapability[] {
	return (ir.manifest?.requiredCapabilities ?? []).flatMap((capability) => {
		if (capability.target && capability.target !== AGENT_PLUGINS_TARGET) {
			return [
				{
					capability,
					reason: `Capability is scoped to ${capability.target}, not Agent Plugins.`,
					required: capability.required ?? true,
				},
			];
		}

		if (UNSUPPORTED_KINDS.has(capability.kind)) {
			return [
				{
					capability,
					reason: `Agent Plugins 1.0 has no ${capability.kind} component.`,
					required: capability.required ?? true,
				},
			];
		}

		return [];
	});
}

function collectIssues(
	ir: PluginIr,
	degradedCapabilities: CapabilityDegradation[],
	unsupportedCapabilities: UnsupportedCapability[],
): ValidationIssue[] {
	const issues: ValidationIssue[] = [...bundleFindings(ir).issues];
	const manifest = getManifest(ir);

	if (!ir.manifest) {
		issues.push({
			severity: "warning",
			code: "missing-manifest",
			message:
				"Plugin manifest is missing; fallback Agent Plugins metadata was generated.",
		});
	}

	const name = agentPluginName(manifest.id);

	if (name !== manifest.id) {
		issues.push({
			severity: "info",
			code: "agent-plugins-name-normalized",
			message: `Plugin id ${manifest.id} became ${name} to meet the Agent Plugins name rules.`,
			path: MANIFEST_PATH,
		});
	}

	const unmapped = (["displayName", "logo"] as const).filter(
		(field) => manifest[field] !== undefined,
	);

	if (unmapped.length > 0) {
		issues.push({
			severity: "info",
			code: "agent-plugins-manifest-field-not-emitted",
			message: `plugin.json 1.0.0 has no field for ${unmapped.join(" or ")}; they were left out.`,
			path: MANIFEST_PATH,
		});
	}

	for (const degradation of degradedCapabilities) {
		issues.push({
			severity: "warning",
			code: `degraded-${degradation.capability.kind}`,
			message: degradation.reason,
		});
	}

	for (const unsupported of unsupportedCapabilities) {
		issues.push({
			severity: unsupported.required ? "error" : "warning",
			code: `unsupported-${unsupported.capability.kind}`,
			message: unsupported.reason,
		});
	}

	return issues;
}

/** Instructions no skill, agent or command uses: rule content with no home here. */
function standaloneInstructions(ir: PluginIr): InstructionModule[] {
	const referenced = new Set([
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
	]);

	return ir.instructions.filter(
		(instruction) =>
			!referenced.has(instruction.id) &&
			(instruction.purpose === "always_on" ||
				instruction.purpose === "safety" ||
				instruction.purpose === "workflow"),
	);
}

function validateAgentPluginsBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [
		...duplicateFileIssues(bundle.files),
		...unresolvedTokenIssues(bundle.files),
	];
	const parsed = new Map<string, unknown>();

	for (const file of bundle.files) {
		if (!file.path.endsWith(".json") || typeof file.content !== "string") {
			continue;
		}

		try {
			parsed.set(file.path, JSON.parse(file.content));
		} catch (error) {
			issues.push({
				severity: "error",
				code: "invalid-json",
				message: error instanceof Error ? error.message : "Invalid JSON file.",
				path: file.path,
			});
		}
	}

	if (!bundle.files.some((file) => file.path === MANIFEST_PATH)) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "Agent Plugins bundle is missing its root plugin.json.",
		});
	} else if (parsed.has(MANIFEST_PATH)) {
		issues.push(...manifestIssues(parsed.get(MANIFEST_PATH)));
	}

	if (parsed.has(MCP_PATH)) {
		issues.push(...mcpIssues(parsed.get(MCP_PATH)));
	}

	for (const file of bundle.files) {
		const match = /^skills\/([^/]+)\/SKILL\.md$/.exec(file.path);

		if (match?.[1] && typeof file.content === "string") {
			issues.push(...skillIssues(match[1], file.content, file.path));
		}
	}

	return issues;
}

/** The closed plugin.json schema (spec §5); violations make clients reject the plugin. */
function manifestIssues(value: unknown): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const error = (code: string, message: string) =>
		issues.push({ severity: "error", code, message, path: MANIFEST_PATH });

	if (!isRecord(value)) {
		error("agent-plugins-invalid-manifest", "plugin.json must be an object.");
		return issues;
	}

	for (const key of Object.keys(value)) {
		if (!MANIFEST_FIELDS.has(key)) {
			error(
				"agent-plugins-unknown-manifest-field",
				`plugin.json field ${key} is not in the closed Agent Plugins manifest; put client data under extensions.<namespace>.`,
			);
		}
	}

	if (value.$schema !== AGENT_PLUGINS_PLUGIN_SCHEMA) {
		error(
			"agent-plugins-invalid-schema-id",
			`plugin.json $schema must be ${AGENT_PLUGINS_PLUGIN_SCHEMA}.`,
		);
	}

	if (
		typeof value.name !== "string" ||
		value.name.length > 64 ||
		!PLUGIN_NAME_PATTERN.test(value.name)
	) {
		error(
			"agent-plugins-invalid-name",
			"plugin.json name must be 1-64 lowercase letters, digits, hyphens or periods, start and end alphanumeric, without -- or ..",
		);
	}

	for (const key of [
		"version",
		"description",
		"homepage",
		"repository",
		"license",
	]) {
		if (value[key] !== undefined && typeof value[key] !== "string") {
			error(
				"agent-plugins-invalid-manifest-field",
				`plugin.json ${key} must be a string.`,
			);
		}
	}

	if (
		value.author !== undefined &&
		!(
			isRecord(value.author) &&
			Object.entries(value.author).every(
				([key, field]) =>
					["name", "email", "url"].includes(key) && typeof field === "string",
			)
		)
	) {
		error(
			"agent-plugins-invalid-manifest-field",
			"plugin.json author may only have string name, email and url.",
		);
	}

	if (
		value.keywords !== undefined &&
		!(
			Array.isArray(value.keywords) &&
			value.keywords.every((keyword) => typeof keyword === "string")
		)
	) {
		error(
			"agent-plugins-invalid-manifest-field",
			"plugin.json keywords must be an array of strings.",
		);
	}

	if (value.extensions !== undefined) {
		if (
			!isRecord(value.extensions) ||
			!Object.values(value.extensions).every(isRecord)
		) {
			error(
				"agent-plugins-invalid-extensions",
				"plugin.json extensions must be an object of namespace objects.",
			);
		} else {
			for (const namespace of Object.keys(value.extensions)) {
				if (!EXTENSION_NAMESPACE_PATTERN.test(namespace)) {
					issues.push({
						severity: "warning",
						code: "agent-plugins-extension-namespace",
						message: `Extension namespace ${namespace} is not reverse-domain (such as com.github.copilot); no client will read it.`,
						path: MANIFEST_PATH,
					});
				}
			}
		}
	}

	return issues;
}

/** Spec rules the MCP schema cannot express (§7.2.1); a bad entry is skipped by clients. */
function mcpIssues(value: unknown): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const servers =
		isRecord(value) && isRecord(value.mcpServers) ? value.mcpServers : {};
	const warn = (name: string, problem: string) =>
		issues.push({
			severity: "warning",
			code: "agent-plugins-invalid-mcp-server",
			message: `MCP server ${name} ${problem}; clients will skip it.`,
			path: MCP_PATH,
		});

	for (const [name, server] of Object.entries(servers)) {
		if (!isRecord(server)) {
			continue;
		}

		if (server.type === "stdio" && typeof server.command === "string") {
			if (/\s/.test(server.command) || server.command.includes("$" + "{")) {
				warn(
					name,
					"has a command that is not a single executable token (no spaces or placeholders; pass arguments in args)",
				);
			}
		}

		if (typeof server.url === "string" && !portableUrl(server.url)) {
			warn(
				name,
				"needs an absolute HTTPS URL (HTTP only for localhost or loopback IPs) without credentials, fragment or placeholders",
			);
		}
	}

	return issues;
}

function portableUrl(value: string): boolean {
	if (value.includes("$" + "{")) {
		return false;
	}

	try {
		const url = new URL(value);
		const loopback =
			url.hostname === "localhost" ||
			url.hostname === "[::1]" ||
			/^127\./.test(url.hostname);

		return (
			(url.protocol === "https:" || (url.protocol === "http:" && loopback)) &&
			!url.username &&
			!url.password &&
			!value.includes("#")
		);
	} catch {
		return false;
	}
}

/** Agent Skills rules; clients skip a skill that breaks them (spec §7.1). */
function skillIssues(
	directory: string,
	content: string,
	path: string,
): ValidationIssue[] {
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1] ?? "";
	const name = frontmatterScalar(frontmatter, "name");
	const problems: string[] = [];

	if (!SKILL_NAME_PATTERN.test(directory) || directory.length > 64) {
		problems.push(
			"its folder name must be 1-64 lowercase letters, digits and single hyphens",
		);
	}

	if (name !== directory) {
		problems.push(`its frontmatter name must be ${directory}`);
	}

	if (!/^description:/m.test(frontmatter)) {
		problems.push("it needs a description");
	} else {
		const description = frontmatterScalar(frontmatter, "description");

		if (description !== undefined && description.length > 1024) {
			problems.push("its description is longer than 1024 characters");
		}
	}

	return problems.map((problem) => ({
		severity: "warning",
		code: "agent-plugins-invalid-skill",
		message: `Skill ${directory} does not follow Agent Skills: ${problem}; clients will skip it.`,
		path,
	}));
}

function frontmatterScalar(
	frontmatter: string,
	key: string,
): string | undefined {
	const raw = new RegExp(`^${key}:[ \\t]*(.*)$`, "m").exec(frontmatter)?.[1];

	if (raw === undefined) {
		return undefined;
	}

	const value = raw.trim();

	if (value.startsWith('"')) {
		try {
			return String(JSON.parse(value));
		} catch {
			return value;
		}
	}

	return value.startsWith("'") && value.endsWith("'")
		? value.slice(1, -1).replaceAll("''", "'")
		: value;
}

function createSourceMap(files: RenderedFile[]): AgentPluginsSourceMap {
	return {
		target: AGENT_PLUGINS_TARGET,
		entries: files
			.filter((file) => file.source)
			.map((file) => ({
				file: file.path,
				primitiveId: file.source?.primitiveId ?? "unknown",
				primitiveKind: file.source?.primitiveKind ?? "unknown",
				path: file.source?.path,
			})),
	};
}

function createBundleManifest(ir: PluginIr, files: RenderedFile[]) {
	const manifest = getManifest(ir);

	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		target: AGENT_PLUGINS_TARGET,
		exporter: "@oiap/exporter-agent-plugins",
		files: files.map((file) => ({ path: file.path, source: file.source })),
	};
}

function getManifest(ir: PluginIr): PluginManifest {
	return (
		ir.manifest ?? {
			id: "oiap-plugin",
			name: "OIAP Plugin",
			version: "0.0.0",
			description: "Generated OIAP plugin bundle.",
			categories: [],
			supportedTargets: [AGENT_PLUGINS_TARGET],
		}
	);
}

function instructionBody(instruction: InstructionModule): string {
	return instruction.hostOverrides?.[AGENT_PLUGINS_TARGET] ?? instruction.body;
}

function withFrontmatter(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	const lines = Object.entries(omitUndefined(frontmatter)).map(
		([key, value]) => `${key}: ${JSON.stringify(value)}`,
	);

	return [`---`, ...lines, `---`, ``, body].join("\n");
}

function omitUndefined(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter((entry) => entry[1] !== undefined),
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sourceRef(
	primitiveId: string,
	primitiveKind: string,
	path?: string,
): SourceRef {
	return { primitiveId, primitiveKind, path };
}

function jsonFile(
	path: string,
	value: unknown,
	source: SourceRef,
): RenderedFile {
	return textFile(path, `${JSON.stringify(value, null, "\t")}\n`, source);
}

function textFile(
	path: string,
	content: string,
	source: SourceRef,
): RenderedFile {
	return { path, content, source };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}
