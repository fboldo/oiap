import type {
	AgentDefinition,
	CapabilityDegradation,
	CommandAsset,
	ExportReport,
	HookDefinition,
	HostCapability,
	InstructionModule,
	Invocation,
	LoweredTargetGraph,
	PackageAssetRef,
	PermissionPolicy,
	PluginDefinition,
	PluginIr,
	PluginManifest,
	RenderedFile,
	RuntimeModule,
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
	renderPluginFiles,
	resolveBundlePaths,
	toPluginIr,
	unresolvedTokenIssues,
} from "@oiap/core";
import {
	renderHookRuntimeCommand,
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import { CLAUDE_CODE_TARGET, claudeCodeProfile } from "./profile.ts";

export type ClaudeCodePluginInput = PluginDefinition | PluginIr;

export interface ClaudeCodeSourceMap {
	target: typeof CLAUDE_CODE_TARGET;
	entries: ClaudeCodeSourceMapEntry[];
}

export interface ClaudeCodeSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export const claudeCodeExporter = defineExporter({
	target: CLAUDE_CODE_TARGET,
	profile: claudeCodeProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderClaudeCodeFiles(ir);
		const report = createExportReport(ir);

		return {
			target: CLAUDE_CODE_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: CLAUDE_CODE_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "claude-code-plugin",
				target: CLAUDE_CODE_TARGET,
				manifestPath: ".claude-plugin/plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateClaudeCodeBundle(bundle);
	},
});

export function exportClaudeCode(plugin: ClaudeCodePluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = claudeCodeExporter.lower(ir);
	const bundle = claudeCodeExporter.render(graph);
	const validationIssues = claudeCodeExporter.validate(bundle);

	if (validationIssues.length === 0) {
		return bundle;
	}

	return {
		...bundle,
		report: {
			...bundle.report,
			status: validationIssues.some((issue) => issue.severity === "error")
				? "unsupported"
				: "degraded",
			issues: [...bundle.report.issues, ...validationIssues],
		},
	};
}

function normalizePluginInput(plugin: ClaudeCodePluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: ClaudeCodePluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderClaudeCodeFiles(ir: PluginIr): RenderedFile[] {
	const generatedFiles = [
		renderPluginManifest(ir),
		...ir.skills.flatMap((skill) => [
			renderSkill(skill, ir.instructions),
			...renderPluginFiles(
				skill.files,
				`skills/${slug(skill.id)}`,
				sourceRef(skill.id, "skill-file"),
			),
		]),
		...ir.commands.map((command) =>
			renderCommand(command, ir.invocations, ir.instructions),
		),
		...ir.agents.map((agent) => renderAgent(agent, ir.instructions)),
		...renderHookFiles(ir.hooks),
		...renderHookRuntime(ir),
		...renderMcpFiles(ir.tools),
		renderPolicyEvidence(ir.policies),
		renderRuntimeModules(ir.runtimeModules),
		renderPackageReadme(ir),
		...renderPluginFiles(
			ir.resources,
			"",
			sourceRef(getManifest(ir).id, "resource"),
		),
	];
	const pluginFiles = resolveBundlePaths(generatedFiles, {
		resourceRoot: "",
		rootVariable: "$" + "{CLAUDE_PLUGIN_ROOT}",
		agentFiles: Object.fromEntries(
			ir.agents.map((agent) => [agent.id, agentPath(agent)]),
		),
	});
	const report = createExportReport(ir);
	const sourceMap = createSourceMap(pluginFiles);
	const bundleManifest = createBundleManifest(ir, pluginFiles);

	return [
		...pluginFiles,
		jsonFile(
			".oiap/bundle.json",
			bundleManifest,
			sourceRef("oiap-bundle", "bundle"),
		),
		jsonFile(
			".oiap/capability-report.json",
			report,
			sourceRef("oiap-report", "report"),
		),
		jsonFile(
			".oiap/source-map.json",
			sourceMap,
			sourceRef("oiap-source-map", "source-map"),
		),
	];
}

// plugin.json documents displayName, keywords, author ({name, email?, url?}),
// repository (string), homepage and license. There is no `logo` key; `icon`
// is the path of an image inside the plugin, used by Anthropic's directory
// listing (Claude Code itself does not read it).
// https://code.claude.com/docs/en/plugins-reference
function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const content = omitUndefined({
		$schema: "https://json.schemastore.org/claude-code-plugin-manifest.json",
		name: slug(manifest.id),
		displayName: manifest.displayName,
		version: manifest.version,
		description: manifest.description,
		author: manifest.author ? omitUndefined({ ...manifest.author }) : undefined,
		homepage: manifest.homepage,
		repository: manifest.repository,
		license: manifest.license,
		keywords: manifestKeywords(manifest),
		icon: manifest.logo ? `./${resourcePath(manifest.logo)}` : undefined,
	});

	return jsonFile(
		".claude-plugin/plugin.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function manifestKeywords(
	manifest: Pick<PluginManifest, "keywords" | "categories">,
): string[] | undefined {
	if (manifest.keywords && manifest.keywords.length > 0) {
		return manifest.keywords;
	}

	return manifest.categories.length > 0 ? manifest.categories : undefined;
}

// Resources are written at the bundle root.
function resourcePath(path: string): string {
	return path.replace(/^(\.\/)+/, "");
}

function renderSkill(
	skill: SkillAsset,
	instructions: InstructionModule[],
): RenderedFile {
	const instruction = findInstruction(skill.instructions.id, instructions);
	const body =
		instruction?.body ??
		`Skill instruction reference not found: ${skill.instructions.id}`;
	// A skill from skillsFrom() keeps its SKILL.md exactly as written.
	const content =
		skill.source?.skillFile ??
		withFrontmatter(
			{
				name: skill.name,
				description: skill.description,
				...skillInvocationFrontmatter(skill),
				...targetMetadata(skill.targetMetadata),
			},
			body,
		);

	return textFile(
		`skills/${slug(skill.id)}/SKILL.md`,
		content,
		sourceRef(skill.id, "skill"),
	);
}

// SKILL.md `disable-model-invocation` (default false) and `user-invocable`
// (default true); only non-default values are written.
// https://code.claude.com/docs/en/skills
function skillInvocationFrontmatter(
	skill: SkillAsset,
): Record<string, unknown> {
	return omitUndefined({
		"disable-model-invocation":
			skill.modelInvocable === false ? true : undefined,
		"user-invocable": skill.userInvocable === false ? false : undefined,
	});
}

function renderCommand(
	command: CommandAsset,
	invocations: Invocation[],
	instructions: InstructionModule[],
): RenderedFile {
	const invocation = findInvocation(command.invocation.id, invocations);
	const prompt = command.prompt
		? findInstruction(command.prompt.id, instructions)
		: undefined;
	const commandName = invocation
		? targetInvocationName(invocation)
		: command.id;
	const body = [
		`# ${commandName}`,
		invocation?.helpText ??
			`Command invocation reference not found: ${command.invocation.id}`,
		prompt?.body,
		...(invocation?.examples ?? []).map((example) => `- ${example}`),
	]
		.filter(Boolean)
		.join("\n\n");

	return textFile(
		`commands/${slug(commandName)}.md`,
		withFrontmatter(
			{
				description: invocation?.helpText ?? command.id,
				...targetMetadata(command.targetMetadata),
			},
			body,
		),
		sourceRef(command.id, "command"),
	);
}

// `omitClaudeMd: true` starts the subagent without the user, project and local
// CLAUDE.md files (managed policy files still load); plugin agents support it.
// It is ignored when the agent runs as the main session agent via --agent.
// https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields
// https://code.claude.com/docs/en/plugins/components
function renderAgent(
	agent: AgentDefinition,
	instructions: InstructionModule[],
): RenderedFile {
	const instruction = findInstruction(agent.instructions.id, instructions);
	const body =
		instruction?.body ??
		`Agent instruction reference not found: ${agent.instructions.id}`;
	const content = withFrontmatter(
		{
			name: agent.name,
			description: agent.description,
			model: agent.model,
			tools: agentTools(agent),
			omitClaudeMd: agent.hostInstructions === "exclude" ? true : undefined,
			...targetMetadata(agent.targetMetadata),
		},
		body,
	);

	return textFile(agentPath(agent), content, sourceRef(agent.id, "agent"));
}

function agentPath(agent: AgentDefinition): string {
	return `agents/${slug(agent.id)}.md`;
}

const READ_ONLY_TOOLS = ["Read", "Grep", "Glob"];

function agentTools(agent: AgentDefinition): string | undefined {
	if (agent.tools) {
		return agent.tools.map((tool) => tool.id).join(",");
	}

	return agent.access === "read-only" ? READ_ONLY_TOOLS.join(",") : undefined;
}

function renderHookFiles(hooks: HookDefinition[]): RenderedFile[] {
	if (hooks.length === 0) {
		return [];
	}

	return [renderHooksConfig(hooks), ...hooks.map(renderHookMetadata)];
}

function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};
	const pluginRoot = "$" + "{CLAUDE_PLUGIN_ROOT}";

	for (const hook of hooks) {
		const event = toClaudeHookEvent(hook.event);
		const eventHooks = groupedHooks[event] ?? [];
		eventHooks.push(
			omitUndefined({
				matcher: renderHookMatcher(hook.match),
				hooks: [
					{
						type: "command",
						command: renderHookRuntimeCommand({
							runnerPath: `${pluginRoot}/.oiap/runtime/runner.mjs`,
							manifestPath: `${pluginRoot}/.oiap/runtime/manifest.json`,
							target: CLAUDE_CODE_TARGET,
							event: hook.event,
							hookId: hook.id,
						}),
					},
				],
			}),
		);
		groupedHooks[event] = eventHooks;
	}

	return jsonFile(
		"hooks/hooks.json",
		{ hooks: groupedHooks },
		sourceRef("claude-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id)}.json`,
		{
			id: hook.id,
			event: hook.event,
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Claude hook config calls the generated OIAP raw-JS hook runner.",
			},
		},
		sourceRef(hook.id, "hook"),
	);
}

function renderHookRuntime(ir: PluginIr): RenderedFile[] {
	return renderHookRuntimeFiles({
		pluginId: getManifest(ir).id,
		target: CLAUDE_CODE_TARGET,
		hooks: ir.hooks,
		targetEvent: (hook) => toClaudeHookEvent(hook.event),
	}).files;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	return [renderMcpConfig(tools)];
}

// Claude Code .mcp.json servers: stdio (command, args, env) or remote
// (type http|sse, url, headers). https://code.claude.com/docs/en/mcp
function renderMcpConfig(tools: ToolSurface[]): RenderedFile {
	const mcpServers = Object.fromEntries(
		tools.flatMap((tool) =>
			tool.server ? [[tool.id, claudeMcpServer(tool)]] : [],
		),
	);

	return jsonFile(
		".mcp.json",
		{ mcpServers },
		sourceRef("claude-settings", "settings"),
	);
}

function claudeMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server ?? {};

	if (tool.transport === "mcp-http" || tool.transport === "mcp-sse") {
		return omitUndefined({
			type: tool.transport === "mcp-sse" ? "sse" : "http",
			url: server.url ?? server.httpUrl,
			headers: server.headers,
		});
	}

	return omitUndefined({
		command: server.command,
		args: server.args,
		env: server.env,
	});
}

/** McpServer fields Claude Code's .mcp.json has no place for. */
function unmappedMcpFields(tools: ToolSurface[]): string[] {
	const fields = new Set<string>();

	for (const tool of tools) {
		for (const field of [
			"cwd",
			"includeTools",
			"excludeTools",
			"auth",
			"required",
		] as const) {
			if (tool.server?.[field] !== undefined) {
				fields.add(field);
			}
		}
	}

	return [...fields].sort();
}

function renderPolicyEvidence(policies: PermissionPolicy[]): RenderedFile {
	return jsonFile(
		".oiap/policy.json",
		{ policies },
		sourceRef("oiap-policy", "policy"),
	);
}

function renderRuntimeModules(runtimeModules: RuntimeModule[]): RenderedFile {
	return jsonFile(
		".oiap/runtime-modules.json",
		{
			runtimeModules: runtimeModules.filter(
				(module) => module.target === CLAUDE_CODE_TARGET,
			),
		},
		sourceRef("oiap-runtime-modules", "runtime"),
	);
}

function renderPackageReadme(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const sections = [
		`# ${manifest.name}`,
		manifest.description,
		"This Claude Code plugin bundle was generated by the OIAP Claude Code exporter.",
		"## Contents",
		"- `.claude-plugin/plugin.json`: Claude Code plugin manifest.",
		"- `skills/`: generated skill assets, when present.",
		"- `commands/`: generated command assets, when present.",
		"- `agents/`: generated agent assets, when present.",
		"- `hooks/hooks.json`: generated hook configuration, when present.",
		"- `.mcp.json`: generated MCP server configuration, when present.",
		"- `.oiap/`: source map, capability report, and degraded runtime metadata.",
		"## Current Limitations",
		"TypeScript hook functions are emitted as a generated raw-JS OIAP runtime. Hook handlers must be portable function expressions or target modules are reported as degraded metadata.",
	];

	return textFile(
		"README.md",
		sections.join("\n\n"),
		sourceRef(manifest.id, "readme"),
	);
}

const BUNDLE_FILE_SUPPORT = {
	target: CLAUDE_CODE_TARGET,
	files: true,
	rootVariable: true,
};

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
		target: CLAUDE_CODE_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: CLAUDE_CODE_TARGET },
	];

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: CLAUDE_CODE_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: CLAUDE_CODE_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: CLAUDE_CODE_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: CLAUDE_CODE_TARGET });
	}

	if (ir.hooks.length > 0) {
		capabilities.push({ kind: "hooks", target: CLAUDE_CODE_TARGET });
		capabilities.push({ kind: "runtime", target: CLAUDE_CODE_TARGET });
	}

	if (ir.policies.length > 0) {
		capabilities.push({ kind: "policy", target: CLAUDE_CODE_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).degradations,
	];

	if (ir.rules.length > 0 || hasStandaloneInstructions(ir)) {
		degradations.push({
			capability: { kind: "rules", target: CLAUDE_CODE_TARGET },
			from: "project-context-rules",
			to: "not-emitted",
			reason:
				"Claude Code plugins do not load root CLAUDE.md context; rules must be represented as skills, agents, hooks, or target-specific plugin files.",
		});
	}

	const droppedMcpFields = unmappedMcpFields(ir.tools);

	if (droppedMcpFields.length > 0) {
		degradations.push({
			capability: { kind: "mcp", target: CLAUDE_CODE_TARGET },
			from: "oiap-mcp-server",
			to: "claude-mcp-server",
			reason: `Claude Code .mcp.json has no field for ${droppedMcpFields.join(", ")}; those settings were left out.`,
		});
	}

	const nonPortableHookIds = runtimeUnsupportedHookIds(ir.hooks);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: CLAUDE_CODE_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === CLAUDE_CODE_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: CLAUDE_CODE_TARGET },
			from: "generated-runtime-module",
			to: "runtime-module-manifest",
			reason:
				"Runtime modules are recorded but not generated by this exporter yet.",
		});
	}

	return degradations;
}

function collectUnsupportedCapabilities(ir: PluginIr): UnsupportedCapability[] {
	return (ir.manifest?.requiredCapabilities ?? [])
		.filter(
			(capability) =>
				capability.target && capability.target !== CLAUDE_CODE_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not Claude Code.`,
			required: capability.required ?? true,
		}));
}

function collectIssues(
	ir: PluginIr,
	degradedCapabilities: CapabilityDegradation[],
	unsupportedCapabilities: UnsupportedCapability[],
): ValidationIssue[] {
	const issues: ValidationIssue[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).issues,
	];

	if (!ir.manifest) {
		issues.push({
			severity: "warning",
			code: "missing-manifest",
			message:
				"Plugin manifest is missing; fallback Claude metadata was generated.",
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

function createSourceMap(files: RenderedFile[]): ClaudeCodeSourceMap {
	return {
		target: CLAUDE_CODE_TARGET,
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
		target: CLAUDE_CODE_TARGET,
		exporter: "@oiap/exporter-claude-code",
		files: files.map((file) => ({ path: file.path, source: file.source })),
	};
}

function validateClaudeCodeBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [
		...duplicateFileIssues(bundle.files),
		...unresolvedTokenIssues(bundle.files),
	];
	const filePaths = new Set(bundle.files.map((file) => file.path));

	if (!filePaths.has(".claude-plugin/plugin.json")) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "Claude bundle is missing .claude-plugin/plugin.json.",
		});
	}

	if (filePaths.has("package/plugin.json")) {
		issues.push({
			severity: "error",
			code: "legacy-package-wrapper",
			message:
				"Claude plugin files must live at the plugin root; package/plugin.json is not a valid Claude plugin manifest path.",
			path: "package/plugin.json",
		});
	}

	if (filePaths.has("CLAUDE.md")) {
		issues.push({
			severity: "warning",
			code: "ignored-root-claude-md",
			message:
				"Claude Code plugins do not load root CLAUDE.md files as project context.",
			path: "CLAUDE.md",
		});
	}

	for (const file of bundle.files.filter((candidate) =>
		candidate.path.endsWith(".json"),
	)) {
		if (typeof file.content !== "string") {
			continue;
		}

		try {
			JSON.parse(file.content);
		} catch (error) {
			issues.push({
				severity: "error",
				code: "invalid-json",
				message: error instanceof Error ? error.message : "Invalid JSON file.",
				path: file.path,
			});
		}
	}

	return issues;
}

function getManifest(ir: PluginIr): PluginManifest {
	return (
		ir.manifest ?? {
			id: "oiap-plugin",
			name: "OIAP Plugin",
			version: "0.0.0",
			description: "Generated OIAP plugin bundle.",
			categories: [],
			supportedTargets: [CLAUDE_CODE_TARGET],
		}
	);
}

function findInstruction(
	id: string,
	instructions: InstructionModule[],
): InstructionModule | undefined {
	return instructions.find((instruction) => instruction.id === id);
}

function findInvocation(
	id: string,
	invocations: Invocation[],
): Invocation | undefined {
	return invocations.find((invocation) => invocation.id === id);
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[CLAUDE_CODE_TARGET] ?? invocation.canonical;
}

function withFrontmatter(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	const lines = Object.entries(omitUndefined(frontmatter)).map(
		([key, value]) => `${key}: ${formatFrontmatterValue(value)}`,
	);

	return [`---`, ...lines, `---`, ``, body].join("\n");
}

function targetMetadata(
	metadata:
		| CommandAsset["targetMetadata"]
		| SkillAsset["targetMetadata"]
		| AgentDefinition["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[CLAUDE_CODE_TARGET] ?? {};
}

function toClaudeHookEvent(event: HookDefinition["event"]): string {
	switch (event) {
		case "session_start":
			return "SessionStart";
		case "user_prompt_submit":
			return "UserPromptSubmit";
		case "before_tool":
			return "PreToolUse";
		case "permission_request":
			return "PermissionRequest";
		case "after_tool":
			return "PostToolUse";
		case "before_agent":
			return "SubagentStart";
		case "after_agent":
			return "SubagentStop";
		case "stop":
			return "Stop";
	}
}

function renderHookMatcher(match: HookDefinition["match"]): string | undefined {
	if (!match) {
		return undefined;
	}

	if (isRecord(match)) {
		const matcher = match as Record<string, unknown>;

		if (
			matcher.kind === "expression" &&
			typeof matcher.expression === "string"
		) {
			return matcher.expression;
		}

		const tool = isRecord(matcher.tool) ? matcher.tool : undefined;

		if (typeof tool?.name === "string") {
			return tool.name;
		}

		if (typeof matcher.permission === "string") {
			return matcher.permission;
		}

		if (typeof matcher.agentName === "string") {
			return matcher.agentName;
		}
	}

	return JSON.stringify(match);
}

function hasStandaloneInstructions(ir: PluginIr): boolean {
	const referencedInstructions = new Set([
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
	]);

	return ir.instructions.some(
		(instruction) =>
			!referencedInstructions.has(instruction.id) &&
			(instruction.purpose === "always_on" ||
				instruction.purpose === "safety" ||
				instruction.purpose === "workflow"),
	);
}

function omitUndefined(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter((entry) => entry[1] !== undefined),
	);
}

function formatFrontmatterValue(value: unknown): string {
	return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function slug(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || "asset";
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
	mode?: number,
): RenderedFile {
	return mode === undefined
		? { path, content, source }
		: { path, content, mode, source };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}
