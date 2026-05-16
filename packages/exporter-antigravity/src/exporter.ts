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
	Workflow,
	WorkflowStep,
} from "@oiap/core";
import { defineExporter, toPluginIr } from "@oiap/core";
import { ANTIGRAVITY_TARGET, antigravityProfile } from "./profile";

export type AntigravityPluginInput = PluginDefinition | PluginIr;

export interface AntigravitySourceMap {
	target: typeof ANTIGRAVITY_TARGET;
	entries: AntigravitySourceMapEntry[];
}

export interface AntigravitySourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

interface AntigravityPermissionConfig {
	version: 1;
	permissions: {
		allow: string[];
		deny: string[];
		ask: string[];
	};
	notes: string[];
}

interface CommandWorkflowRenderContext {
	invocations: Invocation[];
	instructions: InstructionModule[];
	recipes: PluginIr["recipes"];
	usedWorkflowSlugs: Set<string>;
}

export const antigravityExporter = defineExporter({
	target: ANTIGRAVITY_TARGET,
	profile: antigravityProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderAntigravityFiles(ir);
		const report = createExportReport(ir);

		return {
			target: ANTIGRAVITY_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: ANTIGRAVITY_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "antigravity-workspace-bundle",
				target: ANTIGRAVITY_TARGET,
				manifestPath: ".oiap/antigravity-target.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateAntigravityBundle(bundle);
	},
});

export function exportAntigravity(
	plugin: AntigravityPluginInput,
): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = antigravityExporter.lower(ir);
	const bundle = antigravityExporter.render(graph);
	const validationIssues = antigravityExporter.validate(bundle);

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

function normalizePluginInput(plugin: AntigravityPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: AntigravityPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderAntigravityFiles(ir: PluginIr): RenderedFile[] {
	const usedRulePaths = new Set<string>();
	const usedSkillSlugs = new Set<string>();
	const usedWorkflowSlugs = new Set<string>();
	const pluginFiles = [
		renderTargetManifest(ir),
		...renderProjectRuleFiles(ir.rules, usedRulePaths),
		...renderInstructionRules(ir, usedRulePaths),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandWorkflows(ir.commands, {
			invocations: ir.invocations,
			instructions: ir.instructions,
			recipes: ir.recipes,
			usedWorkflowSlugs,
		}),
		...renderStructuredWorkflows(
			ir.workflows,
			ir.invocations,
			usedWorkflowSlugs,
		),
		...renderAgentMetadata(ir.agents, ir.instructions),
		...renderHookMetadata(ir.hooks),
		...renderMcpFiles(ir.tools),
		renderPermissionConfig(ir.policies),
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

function renderTargetManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const content = omitUndefined({
		name: slug(manifest.id, "oiap-plugin"),
		displayName: manifest.name,
		description: manifest.description,
		version: manifest.version,
		homepage: manifest.homepage,
		license: manifest.license,
		keywords: manifest.categories.length > 0 ? manifest.categories : undefined,
		target: ANTIGRAVITY_TARGET,
		rules: hasRuleOutput(ir) ? ".agents/rules/" : undefined,
		skills: ir.skills.length > 0 ? ".agents/skills/" : undefined,
		workflows: hasWorkflowOutput(ir) ? ".agents/workflows/" : undefined,
		mcpConfig: ir.tools.some((tool) => tool.server)
			? "mcp_config.json"
			: undefined,
		permissions:
			ir.policies.length > 0 ? ".oiap/antigravity-permissions.json" : undefined,
	});

	return jsonFile(
		".oiap/antigravity-target.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function renderProjectRuleFiles(
	rules: ProjectRule[],
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === ANTIGRAVITY_TARGET)
		.map((rule) => {
			const path = reservePath(
				normalizeAntigravityRulePath(rule),
				usedRulePaths,
			);
			const content = withFrontmatter(
				{
					description: rule.description ?? rule.id,
					activation: antigravityRuleActivation(rule.activation),
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
			`.agents/rules/${slug(instruction.id, "instruction")}.md`,
			usedRulePaths,
		);
		const content = withFrontmatter(
			{
				description: instruction.triggers[0] ?? instruction.id,
				activation:
					instruction.purpose === "always_on" ||
					instruction.purpose === "safety"
						? "always"
						: "model",
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
			`.agents/skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(skill.id, "skill"),
		);
	});
}

function renderCommandWorkflows(
	commands: CommandAsset[],
	context: CommandWorkflowRenderContext,
): RenderedFile[] {
	return commands.map((command) => {
		const invocation = findInvocation(
			command.invocation.id,
			context.invocations,
		);
		const prompt = command.prompt
			? findInstruction(command.prompt.id, context.instructions)
			: undefined;
		const recipe = command.recipe
			? context.recipes.find((candidate) => candidate.id === command.recipe?.id)
			: undefined;
		const workflowName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const workflowSlug = reserveSlug(
			workflowName,
			context.usedWorkflowSlugs,
			"workflow",
		);
		const body = [
			`# ${workflowName}`,
			invocation?.helpText ??
				`Command invocation reference not found: ${command.invocation.id}`,
			prompt ? instructionBody(prompt) : undefined,
			recipe ? renderCommandRecipe(recipe) : undefined,
			...(invocation?.examples ?? []).map((example) => `- ${example}`),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				name: workflowSlug,
				title: workflowName,
				description: invocation?.helpText ?? command.id,
				...targetMetadata(command.targetMetadata),
			},
			body,
		);

		return textFile(
			`.agents/workflows/${workflowSlug}.md`,
			content,
			sourceRef(command.id, "command-as-workflow"),
		);
	});
}

function renderStructuredWorkflows(
	workflows: Workflow[],
	invocations: Invocation[],
	usedWorkflowSlugs: Set<string>,
): RenderedFile[] {
	return workflows.map((workflow) => {
		const invocation = workflow.activation.invocation
			? findInvocation(workflow.activation.invocation.id, invocations)
			: undefined;
		const workflowName = invocation
			? targetInvocationName(invocation)
			: workflow.id;
		const workflowSlug = reserveSlug(
			workflowName,
			usedWorkflowSlugs,
			"workflow",
		);
		const body = [
			`# ${workflow.title}`,
			`Activation: ${workflow.activation.mode}`,
			workflow.activation.triggers && workflow.activation.triggers.length > 0
				? `Triggers: ${workflow.activation.triggers.join(", ")}`
				: undefined,
			"## Steps",
			...workflow.steps.flatMap((step, index) =>
				renderWorkflowStep(step, index + 1),
			),
			"## Failure Policy",
			`Mode: ${workflow.failurePolicy.mode}`,
		]
			.filter(Boolean)
			.join("\n\n");
		const content = withFrontmatter(
			{
				name: workflowSlug,
				title: workflow.title,
				description:
					workflow.activation.triggers?.[0] ??
					invocation?.helpText ??
					workflow.title,
			},
			body,
		);

		return textFile(
			`.agents/workflows/${workflowSlug}.md`,
			content,
			sourceRef(workflow.id, "workflow"),
		);
	});
}

function renderAgentMetadata(
	agents: AgentDefinition[],
	instructions: InstructionModule[],
): RenderedFile[] {
	return agents.map((agent) => {
		const instruction = findInstruction(agent.instructions.id, instructions);

		return jsonFile(
			`.oiap/agents/${slug(agent.id, "agent")}.json`,
			{
				id: agent.id,
				name: agent.name,
				description: agent.description,
				model: agent.model,
				tools: agent.tools,
				instructions: instruction
					? instructionBody(instruction)
					: `Agent instruction reference not found: ${agent.instructions.id}`,
				degradation:
					"Antigravity documents a browser subagent and task groups, but not user-defined custom agent configuration files.",
			},
			sourceRef(agent.id, "agent"),
		);
	});
}

function renderHookMetadata(hooks: HookDefinition[]): RenderedFile[] {
	return hooks.map((hook) =>
		jsonFile(
			`.oiap/hooks/${slug(hook.id, "hook")}.json`,
			{
				id: hook.id,
				event: hook.event,
				match: hook.match,
				timeoutMs: hook.timeoutMs,
				failureMode: hook.failureMode,
				optional: hook.optional ?? false,
				capabilities: hook.capabilities ?? {},
				runtime: {
					status: "metadata-only",
					message:
						"Antigravity docs do not document hook lifecycle configuration; OIAP hook source is recorded for review only.",
				},
			},
			sourceRef(hook.id, "hook"),
		),
	);
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [slug(tool.id, "server"), toAntigravityMcpServer(tool)]),
	);

	return [
		jsonFile(
			"mcp_config.json",
			{ mcpServers },
			sourceRef("antigravity-mcp", "mcp"),
		),
	];
}

function toAntigravityMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	return omitUndefined({
		command: tool.transport === "mcp-stdio" ? server.command : undefined,
		args: tool.transport === "mcp-stdio" ? server.args : undefined,
		serverUrl:
			tool.transport === "mcp-http" || tool.transport === "mcp-sse"
				? (server.url ?? server.httpUrl)
				: undefined,
		env: server.env,
		cwd: server.cwd,
		headers: server.headers,
		disabledTools: server.excludeTools,
	});
}

function renderPermissionConfig(policies: PermissionPolicy[]): RenderedFile {
	return jsonFile(
		".oiap/antigravity-permissions.json",
		toAntigravityPermissionConfig(policies),
		sourceRef("antigravity-permissions", "policy"),
	);
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
				(module) => module.target === ANTIGRAVITY_TARGET,
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
		"This Google Antigravity workspace bundle was generated by the OIAP Antigravity exporter.",
		"## Contents",
		"- `.agents/rules/`: generated workspace rules, when present.",
		"- `.agents/skills/`: generated Agent Skills folders, when present.",
		"- `.agents/workflows/`: generated workflow markdown for slash-invoked commands and workflows, when present.",
		"- `mcp_config.json`: generated MCP server configuration fragment, when present.",
		"- `.oiap/antigravity-permissions.json`: documented permission resource strings for review, when policies are present.",
		"- `.oiap/`: source map, capability report, and degraded metadata.",
		"## Current Limitations",
		"Antigravity does not currently document a native plugin manifest, hook configuration, custom agent files, or a filesystem path for workflow markdown. Generated workflow and permission files are reviewable bundle artifacts and may need placement by a host or user workflow.",
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
		target: ANTIGRAVITY_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: ANTIGRAVITY_TARGET },
	];

	if (hasRuleOutput(ir)) {
		capabilities.push({ kind: "rules", target: ANTIGRAVITY_TARGET });
	}

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: ANTIGRAVITY_TARGET });
	}

	if (hasWorkflowOutput(ir)) {
		capabilities.push({ kind: "commands", target: ANTIGRAVITY_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: ANTIGRAVITY_TARGET });
	}

	if (ir.policies.length > 0) {
		capabilities.push({ kind: "policy", target: ANTIGRAVITY_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];

	if (hasWorkflowOutput(ir)) {
		degradations.push({
			capability: { kind: "commands", target: ANTIGRAVITY_TARGET },
			from: "documented-slash-workflow",
			to: "workspace-workflow-markdown",
			reason:
				"Antigravity documents slash-invoked workflow markdown, but does not document the workflow filesystem directory; OIAP emits .agents/workflows as a reviewable workspace artifact.",
		});
	}

	if (ir.hooks.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: ANTIGRAVITY_TARGET },
			from: "oiap-hook-lifecycle",
			to: "metadata-only-hook",
			reason:
				"Antigravity docs do not document hook lifecycle configuration, so hooks are recorded as metadata only.",
		});
	}

	if (ir.agents.length > 0) {
		degradations.push({
			capability: { kind: "agents", target: ANTIGRAVITY_TARGET },
			from: "custom-agent",
			to: "metadata-only-agent",
			reason:
				"Antigravity documents task groups and a browser subagent, but not user-defined custom agent files.",
		});
	}

	if (hasAntigravityMcpPolicyGaps(ir.tools)) {
		degradations.push({
			capability: { kind: "mcp", target: ANTIGRAVITY_TARGET },
			from: "oiap-mcp-server-policy",
			to: "antigravity-mcp-config",
			reason:
				"Antigravity mcp_config.json supports disabledTools, but OIAP includeTools, required flags, and non-header auth policies are recorded only in source metadata.",
		});
	}

	if (ir.policies.length > 0) {
		degradations.push({
			capability: { kind: "policy", target: ANTIGRAVITY_TARGET },
			from: "policy-enforcement",
			to: "permission-resource-fragment",
			reason:
				"Antigravity documents allow, deny, and ask resource strings but not a project-local policy file; generated permissions are reviewable fragments.",
		});
	}

	const targetRuntimeModules = ir.runtimeModules.filter(
		(module) => module.target === ANTIGRAVITY_TARGET,
	);

	if (targetRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: ANTIGRAVITY_TARGET },
			from: "generated-runtime-module",
			to: "runtime-module-manifest",
			reason:
				"Antigravity does not document runtime plugin adapters, so runtime modules are recorded but not generated.",
		});
	}

	return degradations;
}

function collectUnsupportedCapabilities(ir: PluginIr): UnsupportedCapability[] {
	return (ir.manifest?.requiredCapabilities ?? [])
		.filter(
			(capability) =>
				capability.target && capability.target !== ANTIGRAVITY_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not Antigravity.`,
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
				"Plugin manifest is missing; fallback Antigravity metadata was generated.",
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

function validateAntigravityBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `Antigravity bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	if (!filePaths.has(".oiap/antigravity-target.json")) {
		issues.push({
			severity: "error",
			code: "missing-antigravity-target-manifest",
			message: "Antigravity bundle is missing .oiap/antigravity-target.json.",
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

function createSourceMap(files: RenderedFile[]): AntigravitySourceMap {
	return {
		target: ANTIGRAVITY_TARGET,
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
		target: ANTIGRAVITY_TARGET,
		exporter: "@oiap/exporter-antigravity",
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
			supportedTargets: [ANTIGRAVITY_TARGET],
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
	return instruction.hostOverrides?.[ANTIGRAVITY_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[ANTIGRAVITY_TARGET] ?? invocation.canonical;
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
		ir.rules.some((rule) => rule.target === ANTIGRAVITY_TARGET)
	);
}

function hasWorkflowOutput(ir: PluginIr): boolean {
	return ir.commands.length > 0 || ir.workflows.length > 0;
}

function antigravityRuleActivation(
	activation: ProjectRule["activation"],
): string {
	switch (activation) {
		case "always":
			return "always";
		case "glob":
		case "pattern":
			return "glob";
		case "manual":
			return "manual";
		case "model":
			return "model";
	}
}

function renderCommandRecipe(recipe: PluginIr["recipes"][number]): string {
	const dialects = Object.entries(recipe.dialects)
		.map(([dialect, command]) => `- ${dialect}: \`${command}\``)
		.join("\n");
	const sections = [
		"## Command Recipe",
		recipe.intent,
		dialects ? `### Dialects\n\n${dialects}` : undefined,
		recipe.requiredTools.length > 0
			? `Required tools: ${recipe.requiredTools.join(", ")}`
			: undefined,
	]
		.filter(Boolean)
		.join("\n\n");

	return sections;
}

function renderWorkflowStep(step: WorkflowStep, index: number): string[] {
	const prefix = `${index}.`;

	switch (step.kind) {
		case "run_command":
			return [`${prefix} Run command recipe \`${step.recipe.id}\`.`];
		case "read_file":
			return [`${prefix} Read \`${step.path}\`.`];
		case "write_file":
			return [`${prefix} Write \`${step.path}\`.`];
		case "patch_file":
			return [`${prefix} Patch \`${step.path}\`.`];
		case "spawn_workers":
			return [
				`${prefix} Spawn workers using strategy \`${step.strategy.id}\`.`,
			];
		case "call_tool":
			return [`${prefix} Call tool \`${step.tool.id}\`.`];
		case "start_mcp_server":
			return [`${prefix} Start MCP server \`${step.server.id}\`.`];
		case "ask_user":
			return [`${prefix} Ask the user: ${step.prompt}`];
		case "conditional":
			return [
				`${prefix} If \`${step.condition}\`, run:`,
				...step.then.flatMap((child, childIndex) =>
					renderNestedWorkflowStep(child, childIndex + 1),
				),
				...(step.otherwise && step.otherwise.length > 0
					? [
							"Otherwise:",
							...step.otherwise.flatMap((child, childIndex) =>
								renderNestedWorkflowStep(child, childIndex + 1),
							),
						]
					: []),
			];
	}
}

function renderNestedWorkflowStep(step: WorkflowStep, index: number): string {
	return `   ${renderWorkflowStep(step, index)[0] ?? "- Continue."}`;
}

function toAntigravityPermissionConfig(
	policies: PermissionPolicy[],
): AntigravityPermissionConfig {
	const permissions: AntigravityPermissionConfig["permissions"] = {
		allow: [],
		deny: [],
		ask: [],
	};
	const notes: string[] = [];

	for (const policy of policies) {
		for (const permission of policy.permissions) {
			const resources = permissionToResources(permission);
			permissions[permission.access].push(...resources);
		}

		for (const path of policy.pathAccess?.read ?? []) {
			permissions.allow.push(`read_file(${path})`);
		}

		for (const path of policy.pathAccess?.write ?? []) {
			permissions.allow.push(`write_file(${path})`);
		}

		for (const path of policy.pathAccess?.deny ?? []) {
			permissions.deny.push(`write_file(${path})`);
		}

		if (policy.network?.access === "deny") {
			permissions.deny.push("read_url(*)");
		}

		if (policy.network?.access === "allow") {
			permissions.allow.push("read_url(*)");
		}

		for (const host of policy.network?.hosts ?? []) {
			permissions.allow.push(`read_url(${host})`);
		}

		for (const pattern of policy.destructiveActions?.patterns ?? []) {
			if (policy.destructiveActions?.mode === "deny") {
				permissions.deny.push(`command(${pattern})`);
			} else if (policy.destructiveActions?.mode === "ask") {
				permissions.ask.push(`command(${pattern})`);
			}
		}

		if (policy.approvals) {
			notes.push(`approval mode: ${policy.approvals.mode}`);
		}

		if (policy.sandbox) {
			notes.push(`sandbox mode: ${policy.sandbox.mode}`);
		}
	}

	return {
		version: 1,
		permissions: {
			allow: uniqueSorted(permissions.allow),
			deny: uniqueSorted(permissions.deny),
			ask: uniqueSorted(permissions.ask),
		},
		notes: uniqueSorted([
			"Antigravity documents allow, deny, and ask resource strings, but not a project-local policy file path.",
			...notes,
		]),
	};
}

function permissionToResources(permission: Permission): string[] {
	return (permission.resources ?? []).flatMap((resource) => {
		switch (permission.kind) {
			case "process":
				return [`command(${resource})`];
			case "network":
				return [`read_url(${resource})`];
			case "mcp":
				return [`mcp(${resource})`];
			case "filesystem":
				return [`read_file(${resource})`];
			default:
				return [];
		}
	});
}

function hasAntigravityMcpPolicyGaps(tools: ToolSurface[]): boolean {
	return tools.some((tool) => {
		const server = tool.server;

		return Boolean(
			server &&
				(server.includeTools ||
					server.required !== undefined ||
					(server.auth && server.auth.mode !== "none")),
		);
	});
}

function targetMetadata(
	metadata: CommandAsset["targetMetadata"] | SkillAsset["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[ANTIGRAVITY_TARGET] ?? {};
}

function normalizeAntigravityRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);

	if (!cleanPath) {
		return `.agents/rules/${slug(rule.id, "rule")}.md`;
	}

	let rulePath = cleanPath.replace(/^\.agent\/rules\//, ".agents/rules/");
	rulePath = rulePath.replace(/^\.agents\//, ".agents/");

	if (!rulePath.startsWith(".agents/rules/")) {
		rulePath = `.agents/rules/${fileBaseName(rulePath)}`;
	}

	if (rulePath === ".agents/rules/" || rulePath.endsWith("/")) {
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

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort();
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
