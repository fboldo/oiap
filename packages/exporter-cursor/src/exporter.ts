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
	ProjectRule,
	RenderedFile,
	RuntimeModule,
	SkillAsset,
	SourceRef,
	TargetBundle,
	ToolSurface,
	UnsupportedCapability,
	ValidationIssue,
} from "@oiap/core";
import { defineExporter, toPluginIr } from "@oiap/core";
import {
	renderHookRuntimeCommand,
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import { CURSOR_TARGET, cursorProfile } from "./profile";

export type CursorPluginInput = PluginDefinition | PluginIr;

export interface CursorSourceMap {
	target: typeof CURSOR_TARGET;
	entries: CursorSourceMapEntry[];
}

export interface CursorSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export const cursorExporter = defineExporter({
	target: CURSOR_TARGET,
	profile: cursorProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderCursorFiles(ir);
		const report = createExportReport(ir);

		return {
			target: CURSOR_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: CURSOR_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "cursor-plugin",
				target: CURSOR_TARGET,
				manifestPath: ".cursor-plugin/plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateCursorBundle(bundle);
	},
});

export function exportCursor(plugin: CursorPluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = cursorExporter.lower(ir);
	const bundle = cursorExporter.render(graph);
	const validationIssues = cursorExporter.validate(bundle);

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

function normalizePluginInput(plugin: CursorPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: CursorPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderCursorFiles(ir: PluginIr): RenderedFile[] {
	const usedRulePaths = new Set<string>();
	const usedSkillSlugs = new Set<string>();
	const usedCommandSlugs = new Set<string>();
	const usedAgentSlugs = new Set<string>();
	const pluginFiles = [
		renderPluginManifest(ir),
		...renderProjectRuleFiles(ir.rules, usedRulePaths),
		...renderInstructionRules(ir, usedRulePaths),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommands(
			ir.commands,
			ir.invocations,
			ir.instructions,
			usedCommandSlugs,
		),
		...renderAgents(ir.agents, ir.instructions, usedAgentSlugs),
		...renderHookFiles(ir),
		...renderMcpFiles(ir.tools),
		renderPolicyEvidence(ir.policies),
		renderRuntimeModules(ir.runtimeModules),
		renderPackageReadme(ir),
	];
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

function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const hasRules = hasRuleOutput(ir);
	const hasSkills = ir.skills.length > 0;
	const hasCommands = ir.commands.length > 0;
	const hasAgents = ir.agents.length > 0;
	const hasHooks = supportedCursorHooks(ir.hooks).length > 0;
	const hasMcp = ir.tools.some((tool) => tool.server);
	const content = omitUndefined({
		name: slug(manifest.id, "oiap-plugin"),
		description: manifest.description,
		version: manifest.version,
		homepage: manifest.homepage,
		license: manifest.license,
		keywords: manifest.categories.length > 0 ? manifest.categories : undefined,
		rules: hasRules ? "rules/" : undefined,
		skills: hasSkills ? "skills/" : undefined,
		commands: hasCommands ? "commands/" : undefined,
		agents: hasAgents ? "agents/" : undefined,
		hooks: hasHooks ? "hooks/hooks.json" : undefined,
		mcpServers: hasMcp ? "mcp.json" : undefined,
	});

	return jsonFile(
		".cursor-plugin/plugin.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function renderProjectRuleFiles(
	rules: ProjectRule[],
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === CURSOR_TARGET)
		.map((rule) => {
			const path = reservePath(normalizeCursorRulePath(rule), usedRulePaths);
			const content = withFrontmatter(
				{
					description: rule.description ?? rule.id,
					alwaysApply: rule.activation === "always",
					globs: rule.globs && rule.globs.length > 0 ? rule.globs : undefined,
					...rule.frontmatter,
				},
				rule.content,
			);

			return textFile(path, content, sourceRef(rule.id, "rule"));
		});
}

function renderInstructionRules(
	ir: PluginIr,
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return standaloneInstructions(ir).map((instruction) => {
		const path = reservePath(
			`rules/${slug(instruction.id, "instruction")}.mdc`,
			usedRulePaths,
		);
		const content = withFrontmatter(
			{
				description: instruction.triggers[0] ?? instruction.id,
				alwaysApply:
					instruction.purpose === "always_on" ||
					instruction.purpose === "safety",
				...instruction.frontmatter,
			},
			instructionBody(instruction),
		);

		return textFile(
			path,
			content,
			sourceRef(instruction.id, "instruction-rule"),
		);
	});
}

function renderSkills(
	skills: SkillAsset[],
	instructions: InstructionModule[],
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return skills.map((skill) => {
		const instruction = findInstruction(skill.instructions.id, instructions);
		const body = instruction
			? instructionBody(instruction)
			: `Skill instruction reference not found: ${skill.instructions.id}`;
		const skillSlug = reserveSlug(skill.id, usedSkillSlugs, "skill");
		const content = withFrontmatter(
			{
				name: skillSlug,
				description: skill.description,
				...targetMetadata(skill.targetMetadata),
			},
			skill.name === skillSlug ? body : `# ${skill.name}\n\n${body}`,
		);

		return textFile(
			`skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(skill.id, "skill"),
		);
	});
}

function renderCommands(
	commands: CommandAsset[],
	invocations: Invocation[],
	instructions: InstructionModule[],
	usedCommandSlugs: Set<string>,
): RenderedFile[] {
	return commands.map((command) => {
		const invocation = findInvocation(command.invocation.id, invocations);
		const prompt = command.prompt
			? findInstruction(command.prompt.id, instructions)
			: undefined;
		const commandName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const commandSlug = reserveSlug(commandName, usedCommandSlugs, "command");
		const body = [
			`# ${commandName}`,
			invocation?.helpText ??
				`Command invocation reference not found: ${command.invocation.id}`,
			prompt ? instructionBody(prompt) : undefined,
			...(invocation?.examples ?? []).map((example) => `- ${example}`),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				name: commandSlug,
				description: invocation?.helpText ?? command.id,
				...targetMetadata(command.targetMetadata),
			},
			body,
		);

		return textFile(
			`commands/${commandSlug}.md`,
			content,
			sourceRef(command.id, "command"),
		);
	});
}

function renderAgents(
	agents: AgentDefinition[],
	instructions: InstructionModule[],
	usedAgentSlugs: Set<string>,
): RenderedFile[] {
	return agents.map((agent) => {
		const instruction = findInstruction(agent.instructions.id, instructions);
		const agentSlug = reserveSlug(agent.id, usedAgentSlugs, "agent");
		const body = [
			agent.name === agentSlug ? undefined : `# ${agent.name}`,
			instruction
				? instructionBody(instruction)
				: `Agent instruction reference not found: ${agent.instructions.id}`,
			renderAgentMetadata(agent),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				name: agentSlug,
				description: agent.description,
			},
			body,
		);

		return textFile(
			`agents/${agentSlug}.md`,
			content,
			sourceRef(agent.id, "agent"),
		);
	});
}

function renderAgentMetadata(agent: AgentDefinition): string | undefined {
	const lines = [
		agent.model ? `- Preferred model: ${agent.model}` : undefined,
		agent.tools && agent.tools.length > 0
			? `- OIAP tool refs: ${agent.tools.map((tool) => tool.id).join(", ")}`
			: undefined,
	].filter(Boolean);

	return lines.length > 0
		? `## OIAP Metadata\n\n${lines.join("\n")}`
		: undefined;
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const cursorHooks = supportedCursorHooks(ir.hooks);

	if (cursorHooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(cursorHooks),
		...cursorHooks.map(renderHookMetadata),
		...renderHookRuntime(ir, cursorHooks),
	];
}

function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};

	for (const hook of hooks) {
		const event = toCursorHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const eventHooks = groupedHooks[event] ?? [];
		eventHooks.push(
			omitUndefined({
				type: "command",
				command: renderHookRuntimeCommand({
					runnerPath: ".oiap/runtime/runner.mjs",
					manifestPath: ".oiap/runtime/manifest.json",
					target: CURSOR_TARGET,
					event: hook.event,
					hookId: hook.id,
				}),
				timeout: hook.timeoutMs ? Math.ceil(hook.timeoutMs / 1000) : undefined,
				matcher: renderHookMatcher(hook.match),
				failClosed: shouldFailClosed(hook) ? true : undefined,
			}),
		);
		groupedHooks[event] = eventHooks;
	}

	return jsonFile(
		"hooks/hooks.json",
		{ version: 1, hooks: groupedHooks },
		sourceRef("cursor-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			cursorEvent: toCursorHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Cursor hook config calls the generated OIAP raw-JS hook runner with plugin-relative paths.",
			},
		},
		sourceRef(hook.id, "hook"),
	);
}

function renderHookRuntime(
	ir: PluginIr,
	hooks: HookDefinition[],
): RenderedFile[] {
	return renderHookRuntimeFiles({
		pluginId: getManifest(ir).id,
		target: CURSOR_TARGET,
		hooks,
		targetEvent: (hook) => toCursorHookEvent(hook.event),
	}).files;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [slug(tool.id, "server"), toCursorMcpServer(tool)]),
	);

	return [jsonFile("mcp.json", { mcpServers }, sourceRef("cursor-mcp", "mcp"))];
}

function toCursorMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	return omitUndefined({
		type: cursorMcpType(tool.transport),
		command: server.command,
		args: server.args,
		url: server.url ?? server.httpUrl,
		env: server.env,
		headers: server.headers,
	});
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
				(module) => module.target === CURSOR_TARGET,
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
		"This Cursor plugin bundle was generated by the OIAP Cursor exporter.",
		"## Contents",
		"- `.cursor-plugin/plugin.json`: Cursor plugin manifest.",
		"- `rules/`: generated Cursor `.mdc` rules, when present.",
		"- `skills/`: generated Agent Skills folders, when present.",
		"- `commands/`: generated agent-executable command files, when present.",
		"- `agents/`: generated custom agent prompt files, when present.",
		"- `hooks/hooks.json`: generated Cursor hook configuration, when present.",
		"- `mcp.json`: generated MCP server configuration, when present.",
		"- `.oiap/`: source map, capability report, and degraded runtime metadata.",
		"## Current Limitations",
		"Permission policies are emitted as evidence until policy-specific Cursor hook lowering is implemented. Supported portable hook functions are emitted as a generated raw-JS OIAP runtime; unsupported OIAP hook lifecycles remain degraded.",
	];

	return textFile(
		"README.md",
		sections.join("\n\n"),
		sourceRef(manifest.id, "readme"),
	);
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
		target: CURSOR_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: CURSOR_TARGET },
	];

	if (hasRuleOutput(ir)) {
		capabilities.push({ kind: "rules", target: CURSOR_TARGET });
	}

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: CURSOR_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: CURSOR_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: CURSOR_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: CURSOR_TARGET });
	}

	if (supportedCursorHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: CURSOR_TARGET });
		capabilities.push({ kind: "runtime", target: CURSOR_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];
	const supportedHooks = supportedCursorHooks(ir.hooks);
	const nonPortableHookIds = runtimeUnsupportedHookIds(supportedHooks);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: CURSOR_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported Cursor hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount = ir.hooks.length - supportedHooks.length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: CURSOR_TARGET },
			from: "all-oiap-hook-events",
			to: "cursor-supported-hook-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a documented Cursor lifecycle equivalent today.`,
		});
	}

	if (hasCursorMcpServerPolicyGaps(ir.tools)) {
		degradations.push({
			capability: { kind: "mcp", target: CURSOR_TARGET },
			from: "oiap-mcp-server-policy",
			to: "cursor-mcp-server-config",
			reason:
				"Cursor mcp.json is generated, but OIAP tool allowlists, denylists, required flags, cwd, and auth policies are recorded only in source metadata.",
		});
	}

	if (ir.policies.length > 0) {
		degradations.push({
			capability: { kind: "policy", target: CURSOR_TARGET },
			from: "policy-enforcement",
			to: "policy-evidence",
			reason:
				"Permission policies are emitted as evidence until policy-specific Cursor hook lowering is implemented.",
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === CURSOR_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: CURSOR_TARGET },
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
			(capability) => capability.target && capability.target !== CURSOR_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not Cursor.`,
			required: capability.required ?? true,
		}));
}

function collectIssues(
	ir: PluginIr,
	degradedCapabilities: CapabilityDegradation[],
	unsupportedCapabilities: UnsupportedCapability[],
): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (!ir.manifest) {
		issues.push({
			severity: "warning",
			code: "missing-manifest",
			message:
				"Plugin manifest is missing; fallback Cursor metadata was generated.",
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

function validateCursorBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `Cursor bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	if (!filePaths.has(".cursor-plugin/plugin.json")) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "Cursor bundle is missing .cursor-plugin/plugin.json.",
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

function createSourceMap(files: RenderedFile[]): CursorSourceMap {
	return {
		target: CURSOR_TARGET,
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
		target: CURSOR_TARGET,
		exporter: "@oiap/exporter-cursor",
		files: files.map((file) => ({ path: file.path, source: file.source })),
	};
}

function getManifest(ir: PluginIr) {
	return (
		ir.manifest ?? {
			id: "oiap-plugin",
			name: "OIAP Plugin",
			version: "0.0.0",
			description: "Generated OIAP plugin bundle.",
			categories: [],
			supportedTargets: [CURSOR_TARGET],
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

function instructionBody(instruction: InstructionModule): string {
	return instruction.hostOverrides?.[CURSOR_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[CURSOR_TARGET] ?? invocation.canonical;
}

function standaloneInstructions(ir: PluginIr): InstructionModule[] {
	const referencedInstructions = new Set([
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
	]);

	return ir.instructions.filter(
		(instruction) =>
			!referencedInstructions.has(instruction.id) &&
			(instruction.purpose === "always_on" ||
				instruction.purpose === "safety" ||
				instruction.purpose === "workflow"),
	);
}

function hasRuleOutput(ir: PluginIr): boolean {
	return (
		standaloneInstructions(ir).length > 0 ||
		ir.rules.some((rule) => rule.target === CURSOR_TARGET)
	);
}

function supportedCursorHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toCursorHookEvent(hook.event)));
}

function toCursorHookEvent(event: HookDefinition["event"]): string | undefined {
	switch (event) {
		case "session_start":
			return "sessionStart";
		case "user_prompt_submit":
			return "beforeSubmitPrompt";
		case "before_tool":
			return "preToolUse";
		case "after_tool":
			return "postToolUse";
		case "before_agent":
			return "subagentStart";
		case "after_agent":
			return "subagentStop";
		case "stop":
			return "stop";
		case "permission_request":
			return undefined;
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

		if (typeof matcher.agentName === "string") {
			return matcher.agentName;
		}
	}

	return JSON.stringify(match);
}

function shouldFailClosed(hook: HookDefinition): boolean {
	if (hook.optional) {
		return false;
	}

	return !["fail_open", "log_only", "use_fallback_rule"].includes(
		hook.failureMode ?? "fail_closed",
	);
}

function cursorMcpType(
	transport: ToolSurface["transport"],
): string | undefined {
	switch (transport) {
		case "mcp-stdio":
			return "stdio";
		case "mcp-http":
			return "http";
		case "mcp-sse":
			return "sse";
		case "native":
		case "cli":
			return undefined;
	}
}

function hasCursorMcpServerPolicyGaps(tools: ToolSurface[]): boolean {
	return tools.some((tool) => {
		const server = tool.server;

		return Boolean(
			server &&
				(server.includeTools ||
					server.excludeTools ||
					server.auth ||
					server.required !== undefined ||
					server.cwd),
		);
	});
}

function normalizeCursorRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);

	if (!cleanPath) {
		return `rules/${slug(rule.id, "rule")}.mdc`;
	}

	if (cleanPath === "AGENTS.md" || cleanPath.endsWith("/AGENTS.md")) {
		return `rules/${slug(rule.id, "rule")}.mdc`;
	}

	let rulePath = cleanPath.replace(/^\.cursor\/rules\//, "rules/");
	rulePath = rulePath.replace(/^\.cursor\//, "");

	if (!rulePath.startsWith("rules/")) {
		rulePath = `rules/${fileBaseName(rulePath)}`;
	}

	if (rulePath === "rules/" || rulePath.endsWith("/")) {
		rulePath = `${rulePath}${slug(rule.id, "rule")}.mdc`;
	}

	return ensureCursorMarkdownPath(rulePath);
}

function sanitizeRelativePath(value: string): string | undefined {
	const cleanPath = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	const segments = cleanPath.split("/").filter(Boolean);

	if (!cleanPath || segments.some((segment) => segment === "..")) {
		return undefined;
	}

	return segments.join("/");
}

function fileBaseName(path: string): string {
	return path.split("/").filter(Boolean).at(-1) ?? "rule.mdc";
}

function ensureCursorMarkdownPath(path: string): string {
	if (/\.(md|mdc|markdown)$/i.test(path)) {
		return path;
	}

	return `${path.replace(/\.[^/.]+$/, "")}.mdc`;
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
	metadata: CommandAsset["targetMetadata"] | SkillAsset["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[CURSOR_TARGET] ?? {};
}

function formatFrontmatterValue(value: unknown): string {
	return JSON.stringify(value);
}

function omitUndefined(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter((entry) => entry[1] !== undefined),
	);
}

function reserveSlug(
	value: string,
	usedSlugs: Set<string>,
	fallback: string,
): string {
	const base = slug(value, fallback);
	let candidate = base;
	let index = 2;

	while (usedSlugs.has(candidate)) {
		candidate = slug(`${base}-${index}`, fallback);
		index += 1;
	}

	usedSlugs.add(candidate);
	return candidate;
}

function reservePath(path: string, usedPaths: Set<string>): string {
	let candidate = path;
	let index = 2;

	while (usedPaths.has(candidate)) {
		candidate = appendPathSuffix(path, index);
		index += 1;
	}

	usedPaths.add(candidate);
	return candidate;
}

function appendPathSuffix(path: string, index: number): string {
	const extension = path.match(/(\.[^./]+)$/)?.[1] ?? "";

	if (!extension) {
		return `${path}-${index}`;
	}

	return `${path.slice(0, -extension.length)}-${index}${extension}`;
}

function slug(value: string, fallback: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64)
		.replace(/-+$/g, "");

	return normalized || fallback;
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
	mode?: number,
): RenderedFile {
	return mode === undefined
		? { path, content, source }
		: { path, content, mode, source };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}
