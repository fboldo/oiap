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
	McpServer,
	PackageAssetRef,
	Permission,
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
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import type {
	OpenCodeHookBridgeManifest,
	OpenCodeHookDescriptor,
} from "./hook-plugin-runtime";
import { renderHookPluginSource } from "./hook-plugin-source";
import { OPENCODE_TARGET, openCodeProfile } from "./profile";

export type OpenCodePluginInput = PluginDefinition | PluginIr;

export interface OpenCodeSourceMap {
	target: typeof OPENCODE_TARGET;
	entries: OpenCodeSourceMapEntry[];
}

export interface OpenCodeSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

type OpenCodePermissionAction = "allow" | "ask" | "deny";
type OpenCodePermissionRules = Record<string, OpenCodePermissionAction>;
type OpenCodePermissionConfig = Record<
	string,
	OpenCodePermissionAction | OpenCodePermissionRules
>;

export const openCodeExporter = defineExporter({
	target: OPENCODE_TARGET,
	profile: openCodeProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderOpenCodeFiles(ir);
		const report = createExportReport(ir);

		return {
			target: OPENCODE_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: OPENCODE_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "opencode-config",
				target: OPENCODE_TARGET,
				manifestPath: "opencode.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateOpenCodeBundle(bundle);
	},
});

export function exportOpenCode(plugin: OpenCodePluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = openCodeExporter.lower(ir);
	const bundle = openCodeExporter.render(graph);
	const validationIssues = openCodeExporter.validate(bundle);

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

function normalizePluginInput(plugin: OpenCodePluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: OpenCodePluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderOpenCodeFiles(ir: PluginIr): RenderedFile[] {
	const usedInstructionPaths = new Set<string>();
	const usedSkillSlugs = new Set<string>();
	const usedCommandSlugs = new Set<string>();
	const usedAgentSlugs = new Set<string>();
	const projectInstructions = renderProjectInstructions(ir);
	const ruleFiles = renderProjectRuleFiles(ir.rules, usedInstructionPaths);
	const pluginFiles = [
		renderOpenCodeConfig(ir, ruleFiles),
		...projectInstructions,
		...ruleFiles,
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommands(
			ir.commands,
			ir.invocations,
			ir.instructions,
			usedCommandSlugs,
		),
		...renderAgents(ir.agents, ir.instructions, usedAgentSlugs),
		...renderHookFiles(ir),
		renderMcpEvidence(ir.tools),
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

function renderOpenCodeConfig(
	ir: PluginIr,
	instructionFiles: RenderedFile[],
): RenderedFile {
	const config = omitUndefined({
		$schema: "https://opencode.ai/config.json",
		instructions:
			instructionFiles.length > 0
				? instructionFiles.map((file) => file.path)
				: undefined,
		mcp: renderMcpConfig(ir.tools),
		permission: renderPermissionConfig(ir.policies),
	});

	return jsonFile(
		"opencode.json",
		config,
		sourceRef(getManifest(ir).id, "config"),
	);
}

function renderProjectInstructions(ir: PluginIr): RenderedFile[] {
	const manifest = getManifest(ir);
	const agentsMdRules = ir.rules.filter(
		(rule) =>
			rule.target === OPENCODE_TARGET &&
			normalizeOpenCodeRulePath(rule) === "AGENTS.md",
	);
	const sections = [
		`# ${manifest.name}`,
		manifest.description,
		...standaloneInstructions(ir).map(
			(instruction) =>
				`## ${instruction.id}\n\n${instructionBody(instruction)}`,
		),
		...agentsMdRules.map(
			(rule) => `## ${rule.description ?? rule.id}\n\n${rule.content}`,
		),
	];

	if (sections.length <= 2) {
		return [];
	}

	return [
		textFile(
			"AGENTS.md",
			sections.join("\n\n"),
			sourceRef(manifest.id, "agents-md"),
		),
	];
}

function renderProjectRuleFiles(
	rules: ProjectRule[],
	usedInstructionPaths: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === OPENCODE_TARGET)
		.flatMap((rule) => {
			const normalizedPath = normalizeOpenCodeRulePath(rule);

			if (normalizedPath === "AGENTS.md") {
				return [];
			}

			const path = reservePath(normalizedPath, usedInstructionPaths);
			const content = rule.frontmatter
				? withFrontmatter(rule.frontmatter, rule.content)
				: rule.content;

			return [textFile(path, content, sourceRef(rule.id, "rule"))];
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
				compatibility: "opencode",
				...targetMetadata(skill.targetMetadata),
			},
			skill.name === skillSlug ? body : `# ${skill.name}\n\n${body}`,
		);

		return textFile(
			`.opencode/skills/${skillSlug}/SKILL.md`,
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
			prompt
				? instructionBody(prompt)
				: (invocation?.helpText ??
					`Command invocation reference not found: ${command.invocation.id}`),
			...(invocation?.examples ?? []).map((example) => `Example: ${example}`),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				description: invocation?.helpText ?? command.id,
				...targetMetadata(command.targetMetadata),
			},
			body,
		);

		return textFile(
			`.opencode/commands/${commandSlug}.md`,
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
			instruction
				? instructionBody(instruction)
				: `Agent instruction reference not found: ${agent.instructions.id}`,
			renderAgentMetadata(agent),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				description: agent.description,
				mode: "subagent",
				model: agent.model,
			},
			body,
		);

		return textFile(
			`.opencode/agents/${agentSlug}.md`,
			content,
			sourceRef(agent.id, "agent"),
		);
	});
}

function renderAgentMetadata(agent: AgentDefinition): string | undefined {
	const lines = [
		agent.name ? `- Display name: ${agent.name}` : undefined,
		agent.tools && agent.tools.length > 0
			? `- OIAP tool refs: ${agent.tools.map((tool) => tool.id).join(", ")}`
			: undefined,
	].filter(Boolean);

	return lines.length > 0
		? `## OIAP Metadata\n\n${lines.join("\n")}`
		: undefined;
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const openCodeHooks = supportedOpenCodeHooks(ir.hooks);

	if (openCodeHooks.length === 0) {
		return [];
	}

	const hookDescriptors = openCodeHooks
		.map(toOpenCodeHookDescriptor)
		.filter((descriptor): descriptor is OpenCodeHookDescriptor =>
			Boolean(descriptor),
		);

	return [
		renderHookPlugin(),
		renderHookBridgeManifest(hookDescriptors),
		...openCodeHooks.map(renderHookMetadata),
		...renderHookRuntime(ir, openCodeHooks),
	];
}

function renderHookPlugin(): RenderedFile {
	return textFile(
		".opencode/plugins/oiap-hooks.js",
		renderHookPluginSource(),
		sourceRef("opencode-hooks", "hook-plugin"),
	);
}

function renderHookBridgeManifest(
	hooks: OpenCodeHookDescriptor[],
): RenderedFile {
	const manifest: OpenCodeHookBridgeManifest = {
		version: 1,
		target: OPENCODE_TARGET,
		hooks,
	};

	return jsonFile(
		".oiap/opencode-hooks.json",
		manifest,
		sourceRef("opencode-hooks", "hook-descriptors"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			openCodeEvent: toOpenCodeHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"OpenCode plugin hooks call the generated OIAP raw-JS hook runner.",
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
		target: OPENCODE_TARGET,
		hooks,
		targetEvent: (hook) => toOpenCodeHookEvent(hook.event),
	}).files;
}

function renderMcpConfig(
	tools: ToolSurface[],
): Record<string, unknown> | undefined {
	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [slug(tool.id, "mcp"), toOpenCodeMcpServer(tool)]),
	);

	return Object.keys(mcpServers).length > 0 ? mcpServers : undefined;
}

function renderMcpEvidence(tools: ToolSurface[]): RenderedFile {
	return jsonFile(".oiap/mcp.json", { tools }, sourceRef("oiap-mcp", "mcp"));
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
				(module) => module.target === OPENCODE_TARGET,
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
		"This OpenCode bundle was generated by the OIAP OpenCode exporter.",
		"## Contents",
		"- `opencode.json`: OpenCode config for instruction references, MCP servers, and permissions.",
		"- `AGENTS.md`: generated project rules, when present.",
		"- `.opencode/skills/`: generated Agent Skills, when present.",
		"- `.opencode/commands/`: generated command prompt templates, when present.",
		"- `.opencode/agents/`: generated custom agents, when present.",
		"- `.opencode/plugins/oiap-hooks.js`: generated OpenCode plugin hook bridge, when present.",
		"- `.oiap/`: source map, capability report, and runtime metadata.",
		"## Current Limitations",
		"OpenCode hook support is implemented as a bundled JavaScript plugin bridge compiled from TypeScript and backed by the generated OIAP runtime. Unsupported OIAP hook lifecycles, non-portable hook handlers, and host-specific hook result mappings are reported as degraded metadata.",
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
		target: OPENCODE_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: OPENCODE_TARGET },
	];

	if (hasRuleOutput(ir)) {
		capabilities.push({ kind: "rules", target: OPENCODE_TARGET });
	}

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: OPENCODE_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: OPENCODE_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: OPENCODE_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: OPENCODE_TARGET });
	}

	if (ir.policies.length > 0) {
		capabilities.push({ kind: "policy", target: OPENCODE_TARGET });
	}

	if (supportedOpenCodeHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: OPENCODE_TARGET });
		capabilities.push({ kind: "runtime", target: OPENCODE_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];
	const supportedHooks = supportedOpenCodeHooks(ir.hooks);
	const nonPortableHookIds = runtimeUnsupportedHookIds(supportedHooks);

	if (supportedHooks.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: OPENCODE_TARGET },
			from: "full-oiap-hook-result",
			to: "opencode-plugin-event-bridge",
			reason:
				"OpenCode hooks are emitted through a bundled JavaScript plugin bridge compiled from TypeScript; block and replace-result are mapped where possible, while richer OIAP hook results remain advisory metadata.",
		});
	}

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: OPENCODE_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported OpenCode hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount = ir.hooks.length - supportedHooks.length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: OPENCODE_TARGET },
			from: "all-oiap-hook-events",
			to: "opencode-supported-plugin-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a stable OpenCode plugin event equivalent today.`,
		});
	}

	if (hasOpenCodeMcpGaps(ir.tools)) {
		degradations.push({
			capability: { kind: "mcp", target: OPENCODE_TARGET },
			from: "oiap-mcp-server-policy",
			to: "opencode-mcp-config",
			reason:
				"OpenCode MCP config is generated, but OIAP tool allowlists, denylists, required flags, cwd, and some auth policies are recorded only in OIAP metadata.",
		});
	}

	if (hasPolicyGaps(ir.policies)) {
		degradations.push({
			capability: { kind: "policy", target: OPENCODE_TARGET },
			from: "full-oiap-policy",
			to: "opencode-permission-rules",
			reason:
				"Common process, filesystem, network, path, and destructive-action policies are lowered to OpenCode permissions; remaining policy dimensions are preserved as evidence.",
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === OPENCODE_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: OPENCODE_TARGET },
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
				capability.target && capability.target !== OPENCODE_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not OpenCode.`,
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
				"Plugin manifest is missing; fallback OpenCode metadata was generated.",
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

function validateOpenCodeBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `OpenCode bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	if (!filePaths.has("opencode.json")) {
		issues.push({
			severity: "error",
			code: "missing-opencode-json",
			message: "OpenCode bundle is missing opencode.json.",
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

	for (const path of filePaths) {
		const skillMatch = path.match(/^\.opencode\/skills\/([^/]+)\/SKILL\.md$/);

		if (skillMatch?.[1] && !isValidOpenCodeSkillName(skillMatch[1])) {
			issues.push({
				severity: "error",
				code: "invalid-skill-name",
				message: `OpenCode skill directory is not a valid skill name: ${skillMatch[1]}`,
				path,
			});
		}
	}

	return issues;
}

function createSourceMap(files: RenderedFile[]): OpenCodeSourceMap {
	return {
		target: OPENCODE_TARGET,
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
		target: OPENCODE_TARGET,
		exporter: "@oiap/exporter-opencode",
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
			supportedTargets: [OPENCODE_TARGET],
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
	return instruction.hostOverrides?.[OPENCODE_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[OPENCODE_TARGET] ?? invocation.canonical;
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
		ir.rules.some((rule) => rule.target === OPENCODE_TARGET)
	);
}

function supportedOpenCodeHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toOpenCodeHookEvent(hook.event)));
}

function toOpenCodeHookDescriptor(
	hook: HookDefinition,
): OpenCodeHookDescriptor | undefined {
	const targetEvent = toOpenCodeHookEvent(hook.event);

	if (!targetEvent) {
		return undefined;
	}

	return omitUndefined({
		id: hook.id,
		event: hook.event,
		targetEvent,
		match: hook.match,
		timeoutMs: hook.timeoutMs,
		failureMode: hook.failureMode,
	}) as unknown as OpenCodeHookDescriptor;
}

function toOpenCodeHookEvent(
	event: HookDefinition["event"],
): string | undefined {
	switch (event) {
		case "session_start":
			return "session.created";
		case "user_prompt_submit":
			return "tui.prompt.append";
		case "before_tool":
			return "tool.execute.before";
		case "permission_request":
			return "permission.asked";
		case "after_tool":
			return "tool.execute.after";
		case "stop":
			return "session.idle";
		case "before_agent":
		case "after_agent":
			return undefined;
	}
}

function toOpenCodeMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	if (tool.transport === "mcp-http" || tool.transport === "mcp-sse") {
		return omitUndefined({
			type: "remote",
			url: server.url ?? server.httpUrl,
			enabled: server.required !== false,
			headers: renderRemoteMcpHeaders(server.headers, server.auth),
			oauth: server.auth?.mode === "oauth" ? {} : undefined,
		});
	}

	return omitUndefined({
		type: "local",
		command: [server.command, ...(server.args ?? [])].filter(Boolean),
		environment: server.env,
		enabled: server.required !== false,
	});
}

function renderRemoteMcpHeaders(
	headers: Record<string, string> | undefined,
	auth: McpServer["auth"] | undefined,
): Record<string, string> | undefined {
	const renderedHeaders = { ...(headers ?? {}) };

	if (auth?.mode === "env" && auth.secretRef) {
		renderedHeaders.Authorization = `Bearer {env:${auth.secretRef}}`;
	}

	return Object.keys(renderedHeaders).length > 0 ? renderedHeaders : undefined;
}

function renderPermissionConfig(
	policies: PermissionPolicy[],
): OpenCodePermissionConfig | undefined {
	const permissionConfig: OpenCodePermissionConfig = {};

	for (const policy of policies) {
		for (const permission of policy.permissions) {
			applyPermission(permissionConfig, permission);
		}

		if (policy.sandbox?.mode === "read_only") {
			addPermissionRule(permissionConfig, "edit", "*", "deny");
			addPermissionRule(permissionConfig, "bash", "*", "ask");
		}

		if (policy.network?.access === "deny") {
			addPermissionRule(permissionConfig, "webfetch", "*", "deny");
		}

		if (policy.network?.access === "allowlist") {
			addPermissionRule(permissionConfig, "webfetch", "*", "deny");

			for (const host of policy.network.hosts ?? []) {
				addPermissionRule(permissionConfig, "webfetch", host, "allow");
			}
		}

		for (const path of policy.pathAccess?.deny ?? []) {
			addPermissionRule(permissionConfig, "read", path, "deny");
			addPermissionRule(permissionConfig, "edit", path, "deny");
		}

		for (const path of policy.pathAccess?.write ?? []) {
			addPermissionRule(permissionConfig, "edit", path, "allow");
		}

		const destructiveActionMode = policy.destructiveActions?.mode;

		for (const pattern of policy.destructiveActions?.patterns ?? []) {
			addPermissionRule(
				permissionConfig,
				"bash",
				pattern,
				destructiveActionMode ?? "ask",
			);
		}
	}

	return Object.keys(permissionConfig).length > 0
		? permissionConfig
		: undefined;
}

function applyPermission(
	permissionConfig: OpenCodePermissionConfig,
	permission: Permission,
): void {
	const action = permissionToAction(permission.access);
	const resources = permission.resources?.length ? permission.resources : ["*"];

	switch (permission.kind) {
		case "process":
			for (const resource of resources) {
				addPermissionRule(permissionConfig, "bash", resource, action);
			}
			return;
		case "filesystem":
			for (const resource of resources) {
				addPermissionRule(permissionConfig, "read", resource, action);
				addPermissionRule(permissionConfig, "edit", resource, action);
			}
			return;
		case "network":
			for (const resource of resources) {
				addPermissionRule(permissionConfig, "webfetch", resource, action);
			}
			return;
		case "mcp":
			for (const resource of resources) {
				addPermissionRule(permissionConfig, `${resource}_*`, "*", action);
			}
			return;
		case "secrets":
			addPermissionRule(permissionConfig, "read", "*.env", action);
			addPermissionRule(permissionConfig, "read", "*.env.*", action);
			return;
		case "package":
		case "rules":
		case "skills":
		case "commands":
		case "hooks":
		case "agents":
		case "runtime":
		case "policy":
		case "database":
			return;
	}
}

function addPermissionRule(
	permissionConfig: OpenCodePermissionConfig,
	key: string,
	pattern: string,
	action: OpenCodePermissionAction,
): void {
	const existing = permissionConfig[key];

	if (!existing) {
		permissionConfig[key] = { [pattern]: action };
		return;
	}

	if (typeof existing === "string") {
		permissionConfig[key] = { "*": existing, [pattern]: action };
		return;
	}

	existing[pattern] = action;
}

function permissionToAction(
	access: Permission["access"],
): OpenCodePermissionAction {
	switch (access) {
		case "allow":
			return "allow";
		case "ask":
			return "ask";
		case "deny":
			return "deny";
	}
}

function hasOpenCodeMcpGaps(tools: ToolSurface[]): boolean {
	return tools.some((tool) => {
		const server = tool.server;

		return Boolean(
			server &&
				(server.includeTools ||
					server.excludeTools ||
					server.cwd ||
					server.required !== undefined ||
					(server.auth &&
						server.auth.mode !== "env" &&
						server.auth.mode !== "oauth")),
		);
	});
}

function hasPolicyGaps(policies: PermissionPolicy[]): boolean {
	return policies.some((policy) =>
		Boolean(
			policy.approvals ||
				policy.secrets ||
				policy.promptInjection ||
				policy.pathAccess?.read ||
				policy.sandbox?.mode === "host",
		),
	);
}

function normalizeOpenCodeRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);

	if (
		!cleanPath ||
		cleanPath === "AGENTS.md" ||
		cleanPath.endsWith("/AGENTS.md")
	) {
		return "AGENTS.md";
	}

	let rulePath = cleanPath.replace(
		/^\.opencode\/rules\//,
		".opencode/instructions/",
	);

	if (!rulePath.startsWith(".opencode/instructions/")) {
		rulePath = `.opencode/instructions/${fileBaseName(rulePath)}`;
	}

	if (rulePath === ".opencode/instructions/" || rulePath.endsWith("/")) {
		rulePath = `${rulePath}${slug(rule.id, "rule")}.md`;
	}

	return ensureMarkdownPath(rulePath);
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
	return path.split("/").filter(Boolean).at(-1) ?? "rule.md";
}

function ensureMarkdownPath(path: string): string {
	if (/\.(md|markdown)$/i.test(path)) {
		return path;
	}

	return `${path.replace(/\.[^/.]+$/, "")}.md`;
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
	return metadata?.[OPENCODE_TARGET] ?? {};
}

function formatFrontmatterValue(value: unknown): string {
	return JSON.stringify(value);
}

function omitUndefined<TValue extends Record<string, unknown>>(
	value: TValue,
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

function isValidOpenCodeSkillName(value: string): boolean {
	return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(value) && value.length <= 64;
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
