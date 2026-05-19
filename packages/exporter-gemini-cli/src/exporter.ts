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
import { GEMINI_CLI_TARGET, geminiCliProfile } from "./profile";

export type GeminiCliPluginInput = PluginDefinition | PluginIr;

export interface GeminiCliSourceMap {
	target: typeof GEMINI_CLI_TARGET;
	entries: GeminiCliSourceMapEntry[];
}

export interface GeminiCliSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

interface GeminiExtensionSetting {
	name: string;
	description: string;
	envVar: string;
	sensitive?: boolean;
}

interface GeminiSettingOptions {
	settings: Map<string, GeminiExtensionSetting>;
	secretRef: string;
	name: string;
	description: string;
	sensitive: boolean;
}

export const geminiCliExporter = defineExporter({
	target: GEMINI_CLI_TARGET,
	profile: geminiCliProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderGeminiCliFiles(ir);
		const report = createExportReport(ir);

		return {
			target: GEMINI_CLI_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: GEMINI_CLI_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "gemini-cli-extension",
				target: GEMINI_CLI_TARGET,
				manifestPath: "gemini-extension.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateGeminiCliBundle(bundle);
	},
});

export function exportGeminiCli(plugin: GeminiCliPluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = geminiCliExporter.lower(ir);
	const bundle = geminiCliExporter.render(graph);
	const validationIssues = geminiCliExporter.validate(bundle);

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

function normalizePluginInput(plugin: GeminiCliPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: GeminiCliPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderGeminiCliFiles(ir: PluginIr): RenderedFile[] {
	const usedSkillSlugs = new Set<string>();
	const usedCommandPaths = new Set<string>();
	const usedAgentSlugs = new Set<string>();
	const contextFiles = renderContextFiles(ir);
	const pluginFiles = [
		renderExtensionManifest(ir, contextFiles),
		...contextFiles,
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommands(
			ir.commands,
			ir.invocations,
			ir.instructions,
			usedCommandPaths,
		),
		...renderAgents(ir.agents, ir.instructions, usedAgentSlugs),
		...renderHookFiles(ir),
		...renderPolicyFiles(ir.policies),
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

function renderExtensionManifest(
	ir: PluginIr,
	contextFiles: RenderedFile[],
): RenderedFile {
	const manifest = getManifest(ir);
	const contextPaths = contextFiles.map((file) => file.path);
	const mcpServers = renderMcpServers(ir.tools);
	const excludeTools = collectExcludedTools(ir.policies);
	const settings = collectGeminiSettings(ir);
	const content = omitUndefined({
		name: slug(manifest.id, "oiap-plugin"),
		version: manifest.version,
		description: manifest.description,
		mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
		contextFileName: contextFileNameValue(contextPaths),
		excludeTools: excludeTools.length > 0 ? excludeTools : undefined,
		settings: settings.length > 0 ? settings : undefined,
	});

	return jsonFile(
		"gemini-extension.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function contextFileNameValue(paths: string[]): string | string[] | undefined {
	if (paths.length === 0) {
		return undefined;
	}

	return paths.length === 1 ? paths[0] : paths;
}

function renderContextFiles(ir: PluginIr): RenderedFile[] {
	const manifest = getManifest(ir);
	const groupedContext = new Map<
		string,
		{ parts: string[]; source: SourceRef }
	>();
	const standalone = standaloneInstructions(ir);

	if (standalone.length > 0) {
		appendContextFile(
			groupedContext,
			"GEMINI.md",
			[
				`# ${manifest.name}`,
				manifest.description,
				...standalone.map(
					(instruction) =>
						`## ${instruction.id}\n\n${instructionBody(instruction)}`,
				),
			].join("\n\n"),
			sourceRef(manifest.id, "gemini-md"),
		);
	}

	for (const rule of ir.rules.filter(
		(candidate) => candidate.target === GEMINI_CLI_TARGET,
	)) {
		const path = normalizeGeminiContextPath(rule);
		const content =
			path === "GEMINI.md"
				? `## ${rule.description ?? rule.id}\n\n${renderProjectRuleContent(rule)}`
				: renderProjectRuleContent(rule);

		appendContextFile(
			groupedContext,
			path,
			content,
			sourceRef(rule.id, "rule"),
		);
	}

	return [...groupedContext.entries()].map(([path, entry]) =>
		textFile(path, entry.parts.join("\n\n"), entry.source),
	);
}

function appendContextFile(
	groupedContext: Map<string, { parts: string[]; source: SourceRef }>,
	path: string,
	content: string,
	source: SourceRef,
): void {
	const existing = groupedContext.get(path);

	if (existing) {
		existing.parts.push(content);
		return;
	}

	groupedContext.set(path, { parts: [content], source });
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
	usedCommandPaths: Set<string>,
): RenderedFile[] {
	return commands.map((command) => {
		const invocation = findInvocation(command.invocation.id, invocations);
		const prompt = command.prompt
			? findInstruction(command.prompt.id, instructions)
			: undefined;
		const commandName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const commandPath = reserveCommandPath(commandName, usedCommandPaths);
		const body = [
			`# ${commandName}`,
			invocation?.helpText ??
				`Command invocation reference not found: ${command.invocation.id}`,
			prompt ? instructionBody(prompt) : undefined,
			...(invocation?.examples ?? []).map((example) => `- ${example}`),
		]
			.filter(Boolean)
			.join("\n\n");
		const content = tomlDocument({
			description: invocation?.helpText ?? command.id,
			prompt: body,
		});

		return textFile(commandPath, content, sourceRef(command.id, "command"));
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
				model: agent.model,
				tools: agent.tools?.map((tool) => tool.id),
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
		? ["## OIAP Metadata", ...lines].join("\n")
		: undefined;
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const geminiHooks = supportedGeminiHooks(ir.hooks);

	if (geminiHooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(geminiHooks),
		...geminiHooks.map(renderHookMetadata),
		...renderHookRuntime(ir, geminiHooks),
	];
}

function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};
	const extensionPath = "$" + "{extensionPath}";
	const pathSeparator = "$" + "{/}";
	const runnerPath = `${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}runner.mjs`;
	const manifestPath = `${extensionPath}${pathSeparator}.oiap${pathSeparator}runtime${pathSeparator}manifest.json`;

	for (const hook of hooks) {
		const event = toGeminiHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const eventHooks = groupedHooks[event] ?? [];
		eventHooks.push(
			omitUndefined({
				matcher: renderHookMatcher(hook.match),
				hooks: [
					omitUndefined({
						name: slug(hook.id, "oiap-hook"),
						type: "command",
						command: renderHookRuntimeCommand({
							runnerPath,
							manifestPath,
							target: GEMINI_CLI_TARGET,
							event: hook.event,
							hookId: hook.id,
						}),
						timeout: hook.timeoutMs,
						description: `Run OIAP hook ${hook.id}.`,
					}),
				],
			}),
		);
		groupedHooks[event] = eventHooks;
	}

	return jsonFile(
		"hooks/hooks.json",
		{ hooks: groupedHooks },
		sourceRef("gemini-cli-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			geminiEvent: toGeminiHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Gemini CLI hook config calls the generated OIAP raw-JS hook runner.",
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
		target: GEMINI_CLI_TARGET,
		hooks,
		targetEvent: (hook) => toGeminiHookEvent(hook.event),
	}).files;
}

function renderMcpServers(tools: ToolSurface[]): Record<string, unknown> {
	return Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [tool.id, toGeminiMcpServer(tool)]),
	);
}

function toGeminiMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	const env = { ...(server.env ?? {}) };

	if (server.auth?.mode === "env" && server.auth.secretRef) {
		const envVar = envVarName(server.auth.secretRef);
		env[envVar] ??= envVariableReference(envVar);
	}

	return omitUndefined({
		command: server.command,
		args: server.args,
		env: Object.keys(env).length > 0 ? env : undefined,
		cwd: server.cwd,
		url: server.url ?? server.httpUrl,
		httpUrl: server.httpUrl && !server.url ? server.httpUrl : undefined,
		headers: server.headers,
		includeTools: server.includeTools,
		excludeTools: server.excludeTools,
		description: tool.tools.length > 0 ? tool.tools[0]?.description : undefined,
	});
}

function renderPolicyFiles(policies: PermissionPolicy[]): RenderedFile[] {
	const rules = policies
		.flatMap((policy) => policy.permissions)
		.flatMap(permissionToPolicyRules);

	if (rules.length === 0) {
		return [];
	}

	return [
		textFile(
			"policies/oiap-policy.toml",
			`${rules.join("\n\n")}\n`,
			sourceRef("oiap-policy", "policy-rules"),
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
				(module) => module.target === GEMINI_CLI_TARGET,
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
		"This Gemini CLI extension bundle was generated by the OIAP Gemini CLI exporter.",
		"## Contents",
		"- `gemini-extension.json`: Gemini CLI extension manifest with MCP servers, context files, settings, and excluded tools.",
		"- `GEMINI.md`: generated extension context, when present.",
		"- `commands/`: generated Gemini custom command TOML files, when present.",
		"- `skills/`: generated Gemini Agent Skills, when present.",
		"- `agents/`: generated Gemini sub-agent definitions, when present.",
		"- `hooks/hooks.json`: generated Gemini CLI hook configuration, when present.",
		"- `policies/`: generated Gemini Policy Engine rules for supported policies, when present.",
		"- `.oiap/`: source map, capability report, policy evidence, and degraded runtime metadata.",
		"## Current Limitations",
		"Supported TypeScript hook functions are emitted as a generated raw-JS OIAP runtime. Gemini CLI sub-agents are treated as a preview surface, and extension policy allow decisions are recorded as evidence rather than emitted as auto-approval rules.",
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
		target: GEMINI_CLI_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: GEMINI_CLI_TARGET },
	];

	if (hasContextOutput(ir)) {
		capabilities.push({ kind: "rules", target: GEMINI_CLI_TARGET });
	}

	if (ir.skills.length > 0) {
		capabilities.push({ kind: "skills", target: GEMINI_CLI_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: GEMINI_CLI_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: GEMINI_CLI_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: GEMINI_CLI_TARGET });
	}

	if (renderablePolicyRuleCount(ir.policies) > 0) {
		capabilities.push({ kind: "policy", target: GEMINI_CLI_TARGET });
	}

	if (supportedGeminiHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: GEMINI_CLI_TARGET });
		capabilities.push({ kind: "runtime", target: GEMINI_CLI_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];

	if (ir.agents.length > 0) {
		degradations.push({
			capability: { kind: "agents", target: GEMINI_CLI_TARGET },
			from: "stable-custom-agent-surface",
			to: "preview-sub-agent-files",
			reason:
				"Gemini CLI sub-agents are a preview feature, so generated agent definitions should be reviewed against the installed CLI version.",
		});
	}

	const nonPortableHookIds = runtimeUnsupportedHookIds(
		supportedGeminiHooks(ir.hooks),
	);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GEMINI_CLI_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported Gemini CLI hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount =
		ir.hooks.length - supportedGeminiHooks(ir.hooks).length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GEMINI_CLI_TARGET },
			from: "all-oiap-hook-events",
			to: "gemini-cli-supported-hook-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a Gemini CLI lifecycle equivalent today.`,
		});
	}

	const allowPolicyCount = ir.policies
		.flatMap((policy) => policy.permissions)
		.filter((permission) => permission.access === "allow").length;

	if (allowPolicyCount > 0) {
		degradations.push({
			capability: { kind: "policy", target: GEMINI_CLI_TARGET },
			from: "permission-allow-policy",
			to: "policy-evidence",
			reason:
				"Gemini CLI ignores allow decisions from extension policy tiers, so allow policies are recorded as evidence only.",
		});
	}

	const unsupportedPolicyCount = ir.policies
		.flatMap((policy) => policy.permissions)
		.filter((permission) => !canRenderPolicyPermission(permission)).length;

	if (unsupportedPolicyCount > 0) {
		degradations.push({
			capability: { kind: "policy", target: GEMINI_CLI_TARGET },
			from: "full-oiap-policy-model",
			to: "gemini-policy-rules-plus-evidence",
			reason: `${unsupportedPolicyCount} policy permission(s) do not map to Gemini CLI extension policy TOML and were recorded as evidence only.`,
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === GEMINI_CLI_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: GEMINI_CLI_TARGET },
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
				capability.target && capability.target !== GEMINI_CLI_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not Gemini CLI.`,
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
				"Plugin manifest is missing; fallback Gemini CLI extension metadata was generated.",
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

function validateGeminiCliBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `Gemini CLI bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	const manifestFile = bundle.files.find(
		(file) => file.path === "gemini-extension.json",
	);

	if (!manifestFile) {
		issues.push({
			severity: "error",
			code: "missing-gemini-extension-json",
			message: "Gemini CLI bundle is missing gemini-extension.json.",
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

	if (manifestFile && typeof manifestFile.content === "string") {
		validateManifestContextFiles(manifestFile, filePaths, issues);
	}

	for (const file of bundle.files.filter(
		(candidate) =>
			candidate.path.startsWith("commands/") &&
			candidate.path.endsWith(".toml"),
	)) {
		if (
			typeof file.content === "string" &&
			!/^prompt\s*=\s*/m.test(file.content)
		) {
			issues.push({
				severity: "error",
				code: "missing-command-prompt",
				message: `Gemini CLI command file is missing a prompt field: ${file.path}`,
				path: file.path,
			});
		}
	}

	return issues;
}

function validateManifestContextFiles(
	manifestFile: RenderedFile,
	filePaths: Set<string>,
	issues: ValidationIssue[],
): void {
	let manifest: { contextFileName?: unknown };

	try {
		manifest = JSON.parse(manifestFile.content as string) as {
			contextFileName?: unknown;
		};
	} catch {
		return;
	}

	const contextFileNames = Array.isArray(manifest.contextFileName)
		? manifest.contextFileName
		: manifest.contextFileName
			? [manifest.contextFileName]
			: [];

	for (const contextFileName of contextFileNames) {
		if (typeof contextFileName !== "string") {
			issues.push({
				severity: "error",
				code: "invalid-context-file-name",
				message:
					"Gemini CLI manifest contextFileName must be a string or string array.",
				path: "gemini-extension.json",
			});
			continue;
		}

		if (!filePaths.has(contextFileName)) {
			issues.push({
				severity: "error",
				code: "missing-context-file",
				message: `Gemini CLI manifest references a missing context file: ${contextFileName}`,
				path: "gemini-extension.json",
			});
		}
	}
}

function createSourceMap(files: RenderedFile[]): GeminiCliSourceMap {
	return {
		target: GEMINI_CLI_TARGET,
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
		target: GEMINI_CLI_TARGET,
		exporter: "@oiap/exporter-gemini-cli",
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
			supportedTargets: [GEMINI_CLI_TARGET],
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
	return instruction.hostOverrides?.[GEMINI_CLI_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[GEMINI_CLI_TARGET] ?? invocation.canonical;
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

function hasContextOutput(ir: PluginIr): boolean {
	return (
		standaloneInstructions(ir).length > 0 ||
		ir.rules.some((rule) => rule.target === GEMINI_CLI_TARGET)
	);
}

function normalizeGeminiContextPath(rule: ProjectRule): string {
	const cleanPath = rule.path.trim().replace(/\\/g, "/").replace(/^\/+/, "");

	if (!cleanPath || cleanPath.includes("..") || cleanPath.endsWith("/")) {
		return `context/${slug(rule.id, "rule")}.md`;
	}

	return cleanPath;
}

function renderProjectRuleContent(rule: ProjectRule): string {
	if (rule.frontmatter) {
		return withFrontmatter(rule.frontmatter, rule.content);
	}

	return rule.content;
}

function supportedGeminiHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toGeminiHookEvent(hook.event)));
}

function toGeminiHookEvent(event: HookDefinition["event"]): string | undefined {
	switch (event) {
		case "session_start":
			return "SessionStart";
		case "user_prompt_submit":
		case "before_agent":
			return "BeforeAgent";
		case "after_agent":
			return "AfterAgent";
		case "before_tool":
			return "BeforeTool";
		case "after_tool":
			return "AfterTool";
		case "stop":
			return "SessionEnd";
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

		if (typeof matcher.permission === "string") {
			return matcher.permission;
		}
	}

	return JSON.stringify(match);
}

function collectGeminiSettings(ir: PluginIr): GeminiExtensionSetting[] {
	const settings = new Map<string, GeminiExtensionSetting>();

	for (const tool of ir.tools) {
		const secretRef = tool.server?.auth?.secretRef;

		if (tool.server?.auth?.mode === "env" && secretRef) {
			addSetting({
				settings,
				secretRef,
				name: `${tool.id} MCP credential`,
				description: `Credential used by the ${tool.id} MCP server.`,
				sensitive: true,
			});
		}
	}

	for (const policy of ir.policies) {
		for (const secretRef of policy.secrets?.allowedRefs ?? []) {
			addSetting({
				settings,
				secretRef,
				name: `${secretRef} secret`,
				description: `Secret requested by OIAP policy ${secretRef}.`,
				sensitive: policy.secrets?.redactLogs ?? true,
			});
		}

		for (const permission of policy.permissions) {
			if (permission.kind !== "secrets") {
				continue;
			}

			for (const resource of permission.resources ?? []) {
				addSetting({
					settings,
					secretRef: resource,
					name: `${resource} secret`,
					description:
						permission.reason ?? `Secret requested by OIAP policy ${resource}.`,
					sensitive: true,
				});
			}
		}
	}

	return [...settings.values()];
}

function addSetting(options: GeminiSettingOptions): void {
	const { settings, secretRef, name, description, sensitive } = options;
	const envVar = envVarName(secretRef);

	if (settings.has(envVar)) {
		return;
	}

	settings.set(envVar, { name, description, envVar, sensitive });
}

function collectExcludedTools(policies: PermissionPolicy[]): string[] {
	return policies
		.flatMap((policy) => policy.permissions)
		.filter(
			(permission) =>
				permission.kind === "process" && permission.access === "deny",
		)
		.flatMap((permission) => {
			if (!permission.resources || permission.resources.length === 0) {
				return ["run_shell_command"];
			}

			return permission.resources.map(
				(resource) => `run_shell_command(${resource})`,
			);
		});
}

function permissionToPolicyRules(permission: Permission): string[] {
	if (!canRenderPolicyPermission(permission)) {
		return [];
	}

	if (permission.kind === "process") {
		return processPermissionToPolicyRules(permission);
	}

	if (permission.kind === "mcp") {
		return mcpPermissionToPolicyRules(permission);
	}

	return [];
}

function processPermissionToPolicyRules(permission: Permission): string[] {
	const resources = permission.resources?.length
		? permission.resources
		: [undefined];

	return resources.map((resource) =>
		tomlTable(
			"rule",
			omitUndefined({
				toolName: "run_shell_command",
				commandPrefix: resource,
				decision: toGeminiPolicyDecision(permission.access),
				priority: policyPriority(permission.access),
				denyMessage:
					permission.access === "deny" ? permission.reason : undefined,
			}),
		),
	);
}

function mcpPermissionToPolicyRules(permission: Permission): string[] {
	const resources = permission.resources?.length ? permission.resources : ["*"];

	return resources.map((resource) => {
		const parsedResource = parseMcpPolicyResource(resource);

		return tomlTable(
			"rule",
			omitUndefined({
				mcpName: parsedResource.server,
				toolName: parsedResource.tool,
				decision: toGeminiPolicyDecision(permission.access),
				priority: policyPriority(permission.access),
				denyMessage:
					permission.access === "deny" ? permission.reason : undefined,
			}),
		);
	});
}

function parseMcpPolicyResource(resource: string): {
	server?: string;
	tool?: string;
} {
	const separator = resource.includes(":") ? ":" : "/";
	const [server, tool] = resource.split(separator, 2);

	if (!server) {
		return { server: "*", tool: "*" };
	}

	if (!tool && server !== "*") {
		return { server, tool: "*" };
	}

	return { server, tool: tool ?? "*" };
}

function canRenderPolicyPermission(permission: Permission): boolean {
	return (
		permission.access !== "allow" &&
		(permission.kind === "process" || permission.kind === "mcp")
	);
}

function renderablePolicyRuleCount(policies: PermissionPolicy[]): number {
	return policies
		.flatMap((policy) => policy.permissions)
		.flatMap(permissionToPolicyRules).length;
}

function toGeminiPolicyDecision(
	access: Permission["access"],
): "allow" | "deny" | "ask_user" {
	switch (access) {
		case "allow":
			return "allow";
		case "deny":
			return "deny";
		case "ask":
			return "ask_user";
	}
}

function policyPriority(access: Permission["access"]): number {
	switch (access) {
		case "deny":
			return 500;
		case "ask":
			return 100;
		case "allow":
			return 10;
	}
}

function reserveCommandPath(
	commandName: string,
	usedCommandPaths: Set<string>,
): string {
	const commandSegments = commandName
		.trim()
		.replace(/^\/+/, "")
		.split(":")
		.flatMap((segment) => segment.split(/[\\/]+/))
		.filter(Boolean)
		.map((segment) => slug(segment, "command"));
	const segments = commandSegments.length > 0 ? commandSegments : ["command"];
	const fileName = `${segments.at(-1) ?? "command"}.toml`;
	const directorySegments = segments.slice(0, -1);
	const path = ["commands", ...directorySegments, fileName].join("/");

	return reservePath(path, usedCommandPaths);
}

function reserveSlug(
	value: string,
	usedSlugs: Set<string>,
	fallback: string,
): string {
	const baseSlug = slug(value, fallback);
	let candidate = baseSlug;
	let suffix = 2;

	while (usedSlugs.has(candidate)) {
		candidate = `${baseSlug}-${suffix}`;
		suffix += 1;
	}

	usedSlugs.add(candidate);
	return candidate;
}

function reservePath(value: string, usedPaths: Set<string>): string {
	const normalized = value.replace(/\\/g, "/");
	const slashIndex = normalized.lastIndexOf("/");
	const dotIndex = normalized.lastIndexOf(".");
	const hasExtension = dotIndex > slashIndex;
	const basePath = hasExtension ? normalized.slice(0, dotIndex) : normalized;
	const extension = hasExtension ? normalized.slice(dotIndex) : "";
	let candidate = normalized;
	let suffix = 2;

	while (usedPaths.has(candidate)) {
		candidate = `${basePath}-${suffix}${extension}`;
		suffix += 1;
	}

	usedPaths.add(candidate);
	return candidate;
}

function slug(value: string, fallback = "asset"): string {
	const normalized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || fallback;
}

function envVarName(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^A-Za-z0-9_]+/g, "_")
		.replace(/^([^A-Za-z_])/, "_$1")
		.toUpperCase();

	return normalized || "OIAP_SECRET";
}

function envVariableReference(envVar: string): string {
	return `\${${envVar}}`;
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
	return metadata?.[GEMINI_CLI_TARGET] ?? {};
}

function tomlDocument(values: Record<string, unknown>): string {
	return `${Object.entries(omitUndefined(values))
		.map(([key, value]) => `${key} = ${tomlValue(value)}`)
		.join("\n")}\n`;
}

function tomlTable(name: string, values: Record<string, unknown>): string {
	return [`[[${name}]]`, tomlDocument(values).trim()].join("\n");
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
