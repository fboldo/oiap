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
import { VSCODE_COPILOT_TARGET, vsCodeCopilotProfile } from "./profile";

export type VsCodeCopilotPluginInput = PluginDefinition | PluginIr;

export interface VsCodeCopilotSourceMap {
	target: typeof VSCODE_COPILOT_TARGET;
	entries: VsCodeCopilotSourceMapEntry[];
}

export interface VsCodeCopilotSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export const vsCodeCopilotExporter = defineExporter({
	target: VSCODE_COPILOT_TARGET,
	profile: vsCodeCopilotProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderVsCodeCopilotFiles(ir);
		const report = createExportReport(ir);

		return {
			target: VSCODE_COPILOT_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: VSCODE_COPILOT_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "vscode-copilot-plugin",
				target: VSCODE_COPILOT_TARGET,
				manifestPath: "plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateVsCodeCopilotBundle(bundle);
	},
});

export function exportVsCodeCopilot(
	plugin: VsCodeCopilotPluginInput,
): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = vsCodeCopilotExporter.lower(ir);
	const bundle = vsCodeCopilotExporter.render(graph);
	const validationIssues = vsCodeCopilotExporter.validate(bundle);

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

function normalizePluginInput(plugin: VsCodeCopilotPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: VsCodeCopilotPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderVsCodeCopilotFiles(ir: PluginIr): RenderedFile[] {
	const usedSkillSlugs = new Set<string>();
	const pluginFiles = [
		renderPluginManifest(ir),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderInstructionSkills(ir, usedSkillSlugs),
		...renderRuleSkills(ir.rules, usedSkillSlugs),
		...renderCommands(ir.commands, ir.invocations, ir.instructions),
		...ir.agents.map((agent) => renderAgent(agent, ir.instructions)),
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
	const hasSkills = hasSkillOutput(ir);
	const hasCommands = ir.commands.length > 0;
	const hasAgents = ir.agents.length > 0;
	const hooks = supportedVsCodeHooks(ir.hooks);
	const hasMcp = ir.tools.some((tool) => tool.server);
	const content = omitUndefined({
		name: slug(manifest.id, "oiap-plugin"),
		description: manifest.description,
		version: manifest.version,
		homepage: manifest.homepage,
		license: manifest.license,
		keywords: manifest.categories.length > 0 ? manifest.categories : undefined,
		category: manifest.categories[0],
		skills: hasSkills ? "skills/" : undefined,
		commands: hasCommands ? "commands/" : undefined,
		agents: hasAgents ? "agents/" : undefined,
		hooks: hooks.length > 0 ? "hooks.json" : undefined,
		mcpServers: hasMcp ? ".mcp.json" : undefined,
	});

	return jsonFile("plugin.json", content, sourceRef(manifest.id, "manifest"));
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
		const skillSlug = reserveSlug(skill.id, usedSkillSlugs);
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

function renderInstructionSkills(
	ir: PluginIr,
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return standaloneInstructions(ir).map((instruction) => {
		const skillSlug = reserveSlug(instruction.id, usedSkillSlugs);
		const content = withFrontmatter(
			{
				name: skillSlug,
				description: instruction.triggers[0] ?? instruction.id,
				"user-invocable": false,
			},
			instructionBody(instruction),
		);

		return textFile(
			`skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(instruction.id, "instruction-as-skill"),
		);
	});
}

function renderRuleSkills(
	rules: ProjectRule[],
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === VSCODE_COPILOT_TARGET)
		.map((rule) => {
			const skillSlug = reserveSlug(rule.id, usedSkillSlugs);
			const content = withFrontmatter(
				{
					name: skillSlug,
					description: rule.description ?? rule.id,
					"user-invocable": false,
				},
				rule.content,
			);

			return textFile(
				`skills/${skillSlug}/SKILL.md`,
				content,
				sourceRef(rule.id, "rule-as-skill"),
			);
		});
}

function renderCommands(
	commands: CommandAsset[],
	invocations: Invocation[],
	instructions: InstructionModule[],
): RenderedFile[] {
	return commands.map((command) => {
		const invocation = findInvocation(command.invocation.id, invocations);
		const prompt = command.prompt
			? findInstruction(command.prompt.id, instructions)
			: undefined;
		const commandName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const commandSlug = slug(commandName, command.id);
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
				agent: "agent",
				...targetMetadata(command.targetMetadata),
			},
			body,
		);

		return textFile(
			`commands/${commandSlug}.prompt.md`,
			content,
			sourceRef(command.id, "command"),
		);
	});
}

function renderAgent(
	agent: AgentDefinition,
	instructions: InstructionModule[],
): RenderedFile {
	const instruction = findInstruction(agent.instructions.id, instructions);
	const body = instruction
		? instructionBody(instruction)
		: `Agent instruction reference not found: ${agent.instructions.id}`;
	const content = withFrontmatter(
		{
			name: agent.name,
			description: agent.description,
			model: agent.model,
			tools: agent.tools?.map((tool) => tool.id),
		},
		body,
	);

	return textFile(
		`agents/${slug(agent.id, "agent")}.agent.md`,
		content,
		sourceRef(agent.id, "agent"),
	);
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const hooks = supportedVsCodeHooks(ir.hooks);

	if (hooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(hooks),
		...hooks.map(renderHookMetadata),
		...renderHookRuntime(ir, hooks),
	];
}

function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};

	for (const hook of hooks) {
		const event = toVsCodeHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const commandHook = omitUndefined({
			type: "command",
			command: renderHookRuntimeCommand({
				runnerPath: ".oiap/runtime/runner.mjs",
				manifestPath: ".oiap/runtime/manifest.json",
				target: VSCODE_COPILOT_TARGET,
				event: hook.event,
				hookId: hook.id,
			}),
			timeout: hook.timeoutMs ? Math.ceil(hook.timeoutMs / 1000) : undefined,
		});
		const eventHooks = groupedHooks[event] ?? [];
		const matcher = renderHookMatcher(hook.match);

		if (matcher) {
			eventHooks.push({ matcher, hooks: [commandHook] });
		} else {
			eventHooks.push(commandHook);
		}

		groupedHooks[event] = eventHooks;
	}

	return jsonFile(
		"hooks.json",
		{ hooks: groupedHooks },
		sourceRef("vscode-copilot-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			vsCodeEvent: toVsCodeHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"VS Code Copilot hook config calls the generated OIAP raw-JS hook runner with plugin-relative paths.",
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
		target: VSCODE_COPILOT_TARGET,
		hooks,
		targetEvent: (hook) => toVsCodeHookEvent(hook.event),
	}).files;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [slug(tool.id, "server"), toVsCodeMcpServer(tool)]),
	);

	return [
		jsonFile(
			".mcp.json",
			{ mcpServers },
			sourceRef("vscode-copilot-mcp", "mcp"),
		),
	];
}

function toVsCodeMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	return omitUndefined({
		command: server.command,
		args: server.args,
		url: server.url ?? server.httpUrl,
		env: server.env,
		cwd: server.cwd,
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
				(module) => module.target === VSCODE_COPILOT_TARGET,
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
		"This VS Code Copilot agent plugin bundle was generated by the OIAP VS Code Copilot exporter.",
		"## Contents",
		"- `plugin.json`: VS Code Copilot-format plugin manifest.",
		"- `commands/`: generated prompt files for slash commands, when present.",
		"- `skills/`: generated Agent Skills folders, when present.",
		"- `agents/`: generated `.agent.md` custom agents, when present.",
		"- `hooks.json`: generated hook configuration, when present.",
		"- `.mcp.json`: generated MCP server configuration, when present.",
		"- `.oiap/`: source map, capability report, and degraded runtime metadata.",
		"## Current Limitations",
		"Copilot-format plugins do not define an official plugin-root token, so generated hook commands use plugin-relative `.oiap/runtime` paths and are reported as degraded. OIAP rules and always-on instructions are represented as model-invoked skills because plugin-scoped custom instruction files are not documented for this format.",
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
		target: VSCODE_COPILOT_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: VSCODE_COPILOT_TARGET },
	];

	if (hasSkillOutput(ir)) {
		capabilities.push({ kind: "skills", target: VSCODE_COPILOT_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: VSCODE_COPILOT_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: VSCODE_COPILOT_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: VSCODE_COPILOT_TARGET });
	}

	if (supportedVsCodeHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: VSCODE_COPILOT_TARGET });
		capabilities.push({ kind: "runtime", target: VSCODE_COPILOT_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];
	const ruleCount = ir.rules.filter(
		(rule) => rule.target === VSCODE_COPILOT_TARGET,
	).length;

	if (ruleCount > 0 || standaloneInstructions(ir).length > 0) {
		degradations.push({
			capability: { kind: "rules", target: VSCODE_COPILOT_TARGET },
			from: "always-on-instruction-rule",
			to: "model-invoked-skill",
			reason:
				"VS Code Copilot plugin manifests do not document plugin-scoped custom instruction files, so rules and standalone instructions are exported as non-user-invocable skills.",
		});
	}

	const supportedHooks = supportedVsCodeHooks(ir.hooks);
	const nonPortableHookIds = runtimeUnsupportedHookIds(supportedHooks);

	if (supportedHooks.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: VSCODE_COPILOT_TARGET },
			from: "plugin-root-token-command",
			to: "plugin-relative-command",
			reason:
				"Copilot-format plugins do not define an official plugin-root token, so generated hook commands reference the bundled runner with plugin-relative paths.",
		});
	}

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: VSCODE_COPILOT_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported VS Code Copilot hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount = ir.hooks.length - supportedHooks.length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: VSCODE_COPILOT_TARGET },
			from: "all-oiap-hook-events",
			to: "vscode-supported-hook-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a documented VS Code Copilot hook lifecycle equivalent today.`,
		});
	}

	if (ir.policies.length > 0) {
		degradations.push({
			capability: { kind: "policy", target: VSCODE_COPILOT_TARGET },
			from: "policy-enforcement",
			to: "policy-evidence",
			reason:
				"Permission policies are emitted as evidence until policy-specific VS Code Copilot hook lowering is implemented.",
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === VSCODE_COPILOT_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: VSCODE_COPILOT_TARGET },
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
				capability.target && capability.target !== VSCODE_COPILOT_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not VS Code Copilot.`,
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
				"Plugin manifest is missing; fallback VS Code Copilot metadata was generated.",
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

function validateVsCodeCopilotBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `VS Code Copilot bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	if (!filePaths.has("plugin.json")) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "VS Code Copilot bundle is missing root plugin.json.",
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

function createSourceMap(files: RenderedFile[]): VsCodeCopilotSourceMap {
	return {
		target: VSCODE_COPILOT_TARGET,
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
		target: VSCODE_COPILOT_TARGET,
		exporter: "@oiap/exporter-vscode-copilot",
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
			supportedTargets: [VSCODE_COPILOT_TARGET],
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
	return instruction.hostOverrides?.[VSCODE_COPILOT_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return (
		invocation.targetAliases?.[VSCODE_COPILOT_TARGET] ?? invocation.canonical
	);
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

function hasSkillOutput(ir: PluginIr): boolean {
	return (
		ir.skills.length > 0 ||
		standaloneInstructions(ir).length > 0 ||
		ir.rules.some((rule) => rule.target === VSCODE_COPILOT_TARGET)
	);
}

function supportedVsCodeHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toVsCodeHookEvent(hook.event)));
}

function toVsCodeHookEvent(event: HookDefinition["event"]): string | undefined {
	switch (event) {
		case "session_start":
			return "SessionStart";
		case "user_prompt_submit":
			return "UserPromptSubmit";
		case "before_tool":
			return "PreToolUse";
		case "after_tool":
			return "PostToolUse";
		case "before_agent":
			return "SubagentStart";
		case "after_agent":
			return "SubagentStop";
		case "stop":
			return "Stop";
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
	return metadata?.[VSCODE_COPILOT_TARGET] ?? {};
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

function reserveSlug(value: string, usedSlugs: Set<string>): string {
	const base = slug(value, "asset");
	let candidate = base;
	let index = 2;

	while (usedSlugs.has(candidate)) {
		candidate = slug(`${base}-${index}`, "asset");
		index += 1;
	}

	usedSlugs.add(candidate);
	return candidate;
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
