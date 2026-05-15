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
} from "@oiap/core";
import { defineExporter, toPluginIr } from "@oiap/core";
import {
	renderHookRuntimeCommand,
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import { CODEX_TARGET, codexProfile } from "./profile";

export type CodexPluginInput = PluginDefinition | PluginIr;

export interface CodexSourceMap {
	target: typeof CODEX_TARGET;
	entries: CodexSourceMapEntry[];
}

export interface CodexSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export const codexExporter = defineExporter({
	target: CODEX_TARGET,
	profile: codexProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderCodexFiles(ir);
		const report = createExportReport(ir);

		return {
			target: CODEX_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: CODEX_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "codex-plugin",
				target: CODEX_TARGET,
				manifestPath: ".codex-plugin/plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateCodexBundle(bundle);
	},
});

export function exportCodex(plugin: CodexPluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = codexExporter.lower(ir);
	const bundle = codexExporter.render(graph);
	const validationIssues = codexExporter.validate(bundle);

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

function normalizePluginInput(plugin: CodexPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: CodexPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderCodexFiles(ir: PluginIr): RenderedFile[] {
	const usedSkillSlugs = new Set<string>();
	const pluginFiles = [
		renderPluginManifest(ir),
		...renderProjectInstructions(ir),
		...renderProjectRuleFiles(ir.rules),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandsAsSkills(
			ir.commands,
			ir.invocations,
			ir.instructions,
			usedSkillSlugs,
		),
		...ir.agents.map((agent) => renderAgent(agent, ir.instructions)),
		...renderHookFiles(ir),
		...renderMcpFiles(ir.tools),
		...renderPolicyRules(ir.policies),
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
	const hasSkills = ir.skills.length > 0 || ir.commands.length > 0;
	const hasHooks = supportedCodexHooks(ir.hooks).length > 0;
	const hasMcp = ir.tools.some((tool) => tool.server);
	const content = omitUndefined({
		name: slug(manifest.id),
		version: manifest.version,
		description: manifest.description,
		homepage: manifest.homepage,
		license: manifest.license,
		keywords: manifest.categories.length > 0 ? manifest.categories : undefined,
		skills: hasSkills ? "./skills/" : undefined,
		mcpServers: hasMcp ? "./.mcp.json" : undefined,
		hooks: hasHooks ? "./hooks/hooks.json" : undefined,
		interface: omitUndefined({
			displayName: manifest.name,
			shortDescription: manifest.description,
			category: manifest.categories[0],
		}),
	});

	return jsonFile(
		".codex-plugin/plugin.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function renderProjectInstructions(ir: PluginIr): RenderedFile[] {
	const manifest = getManifest(ir);
	const agentsMdRules = ir.rules.filter(
		(rule) =>
			rule.target === CODEX_TARGET &&
			normalizeCodexRulePath(rule) === "AGENTS.md",
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

function renderProjectRuleFiles(rules: ProjectRule[]): RenderedFile[] {
	const groupedRules = new Map<string, ProjectRule[]>();

	for (const rule of rules.filter(
		(candidate) => candidate.target === CODEX_TARGET,
	)) {
		const rulePath = normalizeCodexRulePath(rule);

		if (rulePath === "AGENTS.md") {
			continue;
		}

		groupedRules.set(rulePath, [...(groupedRules.get(rulePath) ?? []), rule]);
	}

	return [...groupedRules.entries()].map(([path, pathRules]) => {
		const content = pathRules.map(renderProjectRuleContent).join("\n\n");
		const firstRule = pathRules[0];
		const source = firstRule
			? sourceRef(firstRule.id, "rule")
			: sourceRef("codex-project-rules", "rules", path);

		return textFile(path, content, source);
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

function renderCommandsAsSkills(
	commands: CommandAsset[],
	invocations: Invocation[],
	instructions: InstructionModule[],
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return commands.map((command) => {
		const invocation = findInvocation(command.invocation.id, invocations);
		const prompt = command.prompt
			? findInstruction(command.prompt.id, instructions)
			: undefined;
		const commandName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const skillSlug = reserveSlug(commandName, usedSkillSlugs);
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
				name: skillSlug,
				description: invocation?.helpText ?? command.id,
				...targetMetadata(command.targetMetadata),
			},
			body,
		);

		return textFile(
			`skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(command.id, "command-as-skill"),
		);
	});
}

function renderAgent(
	agent: AgentDefinition,
	instructions: InstructionModule[],
): RenderedFile {
	const instruction = findInstruction(agent.instructions.id, instructions);
	const content = tomlDocument({
		name: codexIdentifier(agent.id),
		description: agent.description,
		model: agent.model,
		developer_instructions: instruction
			? instructionBody(instruction)
			: `Agent instruction reference not found: ${agent.instructions.id}`,
	});

	return textFile(
		`.codex/agents/${slug(agent.id)}.toml`,
		content,
		sourceRef(agent.id, "agent"),
	);
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const codexHooks = supportedCodexHooks(ir.hooks);

	if (codexHooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(codexHooks),
		...codexHooks.map(renderHookMetadata),
		...renderHookRuntime(ir, codexHooks),
	];
}

function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};
	const pluginRoot = "$" + "{PLUGIN_ROOT}";

	for (const hook of hooks) {
		const event = toCodexHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const eventHooks = groupedHooks[event] ?? [];
		eventHooks.push(
			omitUndefined({
				matcher: renderHookMatcher(hook.match),
				hooks: [
					omitUndefined({
						type: "command",
						command: renderHookRuntimeCommand({
							runnerPath: `${pluginRoot}/.oiap/runtime/runner.mjs`,
							manifestPath: `${pluginRoot}/.oiap/runtime/manifest.json`,
							target: CODEX_TARGET,
							event: hook.event,
							hookId: hook.id,
						}),
						timeout: hook.timeoutMs
							? Math.ceil(hook.timeoutMs / 1000)
							: undefined,
						statusMessage: `Running OIAP hook ${hook.id}`,
					}),
				],
			}),
		);
		groupedHooks[event] = eventHooks;
	}

	return jsonFile(
		"hooks/hooks.json",
		{ hooks: groupedHooks },
		sourceRef("codex-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id)}.json`,
		{
			id: hook.id,
			event: hook.event,
			codexEvent: toCodexHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Codex hook config calls the generated OIAP raw-JS hook runner.",
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
		target: CODEX_TARGET,
		hooks,
		targetEvent: (hook) => toCodexHookEvent(hook.event),
	}).files;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [tool.id, toCodexMcpServer(tool)]),
	);

	return [jsonFile(".mcp.json", mcpServers, sourceRef("codex-mcp", "mcp"))];
}

function renderPolicyRules(policies: PermissionPolicy[]): RenderedFile[] {
	const rules = policies
		.flatMap((policy) => policy.permissions)
		.flatMap(permissionToRule);

	if (rules.length === 0) {
		return [];
	}

	return [
		textFile(
			".codex/rules/oiap.rules",
			rules.join("\n\n"),
			sourceRef("oiap-policy", "rules"),
		),
	];
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
				(module) => module.target === CODEX_TARGET,
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
		"This Codex bundle was generated by the OIAP Codex exporter.",
		"## Contents",
		"- `.codex-plugin/plugin.json`: Codex plugin manifest.",
		"- `skills/`: generated skill assets and command fallbacks, when present.",
		"- `hooks/hooks.json`: generated Codex hook configuration, when present.",
		"- `.mcp.json`: generated bundled MCP server configuration, when present.",
		"- `AGENTS.md`: generated project instructions, when present.",
		"- `.codex/agents/`: generated project-scoped custom agents, when present.",
		"- `.codex/rules/`: generated project-scoped command rules, when present.",
		"- `.oiap/`: source map, capability report, and degraded runtime metadata.",
		"## Current Limitations",
		"OIAP commands are exported as Codex skills. Supported TypeScript hook functions are emitted as a generated raw-JS OIAP runtime; unsupported lifecycle events remain degraded.",
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
		target: CODEX_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: CODEX_TARGET },
	];

	if (ir.rules.length > 0 || standaloneInstructions(ir).length > 0) {
		capabilities.push({ kind: "rules", target: CODEX_TARGET });
	}

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: CODEX_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: CODEX_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: CODEX_TARGET });
	}

	if (ir.policies.length > 0) {
		capabilities.push({ kind: "policy", target: CODEX_TARGET });
	}

	if (supportedCodexHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: CODEX_TARGET });
		capabilities.push({ kind: "runtime", target: CODEX_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];

	if (ir.commands.length > 0) {
		degradations.push({
			capability: { kind: "commands", target: CODEX_TARGET },
			from: "native-command",
			to: "skill",
			reason:
				"Codex plugins expose reusable workflows as skills, so OIAP commands are exported as explicit Codex skills.",
		});
	}

	const nonPortableHookIds = runtimeUnsupportedHookIds(
		supportedCodexHooks(ir.hooks),
	);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: CODEX_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported Codex hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount =
		ir.hooks.length - supportedCodexHooks(ir.hooks).length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: CODEX_TARGET },
			from: "all-oiap-hook-events",
			to: "codex-supported-hook-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a Codex lifecycle equivalent today.`,
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === CODEX_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: CODEX_TARGET },
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
			(capability) => capability.target && capability.target !== CODEX_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not Codex.`,
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
				"Plugin manifest is missing; fallback Codex metadata was generated.",
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

function validateCodexBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `Codex bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	if (!filePaths.has(".codex-plugin/plugin.json")) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "Codex bundle is missing .codex-plugin/plugin.json.",
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

function createSourceMap(files: RenderedFile[]): CodexSourceMap {
	return {
		target: CODEX_TARGET,
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
		target: CODEX_TARGET,
		exporter: "@oiap/exporter-codex",
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
			supportedTargets: [CODEX_TARGET],
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
	return instruction.hostOverrides?.[CODEX_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[CODEX_TARGET] ?? invocation.canonical;
}

function normalizeCodexRulePath(rule: ProjectRule): string {
	const cleanPath = rule.path.trim().replace(/\\/g, "/").replace(/^\/+/, "");

	if (!cleanPath || cleanPath.includes("..")) {
		return `.codex/rules/${slug(rule.id)}.rules`;
	}

	return cleanPath;
}

function renderProjectRuleContent(rule: ProjectRule): string {
	if (rule.frontmatter) {
		return withFrontmatter(rule.frontmatter, rule.content);
	}

	return rule.content;
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

function supportedCodexHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toCodexHookEvent(hook.event)));
}

function toCodexHookEvent(event: HookDefinition["event"]): string | undefined {
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
		case "stop":
			return "Stop";
		case "before_agent":
		case "after_agent":
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

		if (typeof matcher.permission === "string") {
			return matcher.permission;
		}
	}

	return JSON.stringify(match);
}

function toCodexMcpServer(tool: ToolSurface): Record<string, unknown> {
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
		http_headers: server.headers,
		enabled_tools: server.includeTools,
		disabled_tools: server.excludeTools,
		bearer_token_env_var:
			server.auth?.mode === "env" ? server.auth.secretRef : undefined,
		required: server.required,
	});
}

function permissionToRule(permission: Permission): string[] {
	if (
		permission.kind !== "process" ||
		!permission.resources ||
		permission.resources.length === 0
	) {
		return [];
	}

	return permission.resources.map((resource) => {
		const decision = toCodexRuleDecision(permission.access);
		const pattern = splitCommandPrefix(resource);
		const justification =
			permission.reason ?? `OIAP ${permission.access} policy for ${resource}`;

		return [
			"prefix_rule(",
			`    pattern = [${pattern.map((part) => JSON.stringify(part)).join(", ")}],`,
			`    decision = ${JSON.stringify(decision)},`,
			`    justification = ${JSON.stringify(justification)},`,
			")",
		].join("\n");
	});
}

function toCodexRuleDecision(
	access: Permission["access"],
): "allow" | "forbidden" | "prompt" {
	switch (access) {
		case "allow":
			return "allow";
		case "deny":
			return "forbidden";
		case "ask":
			return "prompt";
	}
}

function splitCommandPrefix(value: string): string[] {
	return value.trim().split(/\s+/).filter(Boolean);
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

function targetMetadata(
	metadata: CommandAsset["targetMetadata"] | SkillAsset["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[CODEX_TARGET] ?? {};
}

function tomlDocument(values: Record<string, unknown>): string {
	return `${Object.entries(omitUndefined(values))
		.map(([key, value]) => `${key} = ${tomlValue(value)}`)
		.join("\n")}\n`;
}

function tomlValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(tomlValue).join(", ")}]`;
	}

	if (typeof value === "string") {
		return JSON.stringify(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return JSON.stringify(value);
}

function reserveSlug(value: string, usedSlugs: Set<string>): string {
	const baseSlug = slug(value);
	let candidate = baseSlug;
	let suffix = 2;

	while (usedSlugs.has(candidate)) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}

	usedSlugs.add(candidate);
	return candidate;
}

function slug(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || "asset";
}

function codexIdentifier(value: string): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");

	return normalized || "agent";
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
	mode?: number,
): RenderedFile {
	return mode === undefined
		? { path, content, source }
		: { path, content, mode, source };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}
