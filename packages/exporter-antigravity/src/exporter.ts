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
import {
	agentAccessDegradation,
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
import { ANTIGRAVITY_TARGET, antigravityProfile } from "./profile.ts";

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

interface CommandSkillRenderContext {
	invocations: Invocation[];
	instructions: InstructionModule[];
	recipes: PluginIr["recipes"];
	usedSkillSlugs: Set<string>;
}

/**
 * Antigravity plugin manifest. `.antigravity-plugin/plugin.json` takes
 * precedence over a root `plugin.json`; the schema rejects unlisted keys.
 * https://antigravity.google/docs/build-plugins.md
 */
export const ANTIGRAVITY_MANIFEST_PATH = ".antigravity-plugin/plugin.json";
export const ANTIGRAVITY_MANIFEST_SCHEMA =
	"https://antigravity.google/schemas/v1/plugin.json";
const ANTIGRAVITY_MANIFEST_KEYS = new Set([
	"$schema",
	"name",
	"displayName",
	"description",
	"version",
	"logo",
	"disabled",
	"suggestedPrompts",
	"skills",
	"author",
	"homepage",
	"repository",
	"license",
	"keywords",
	"extensions",
]);
const ANTIGRAVITY_PLUGIN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Hook commands run with cwd set to the plugin root. */
const HOOK_RUNNER_PATH = "./.oiap/runtime/runner.mjs";
const HOOK_MANIFEST_PATH = "./.oiap/runtime/manifest.json";

/** Expanded in mcp_config.json `args`, `cwd` and `env` only. */
const MCP_PLUGIN_ROOT_VARIABLE = "$" + "{PLUGIN_ROOT}";

/** Plugin resources live at the plugin root. */
const RESOURCE_ROOT = "";

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
				id: "antigravity-plugin",
				target: ANTIGRAVITY_TARGET,
				manifestPath: ANTIGRAVITY_MANIFEST_PATH,
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
	const agentFiles = agentFilePaths(ir.agents);
	const generatedFiles = [
		renderPluginManifest(ir),
		...renderProjectRuleFiles(ir.rules, usedRulePaths),
		...renderInstructionRules(ir, usedRulePaths),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandSkills(ir.commands, {
			invocations: ir.invocations,
			instructions: ir.instructions,
			recipes: ir.recipes,
			usedSkillSlugs,
		}),
		...renderWorkflowSkills(ir.workflows, ir.invocations, usedSkillSlugs),
		...renderAgents(ir.agents, ir.instructions, agentFiles),
		...renderHookFiles(ir),
		renderPermissionConfig(ir.policies),
		renderPolicyEvidence(ir.policies),
		renderRuntimeModules(ir.runtimeModules),
		...renderPackageReadme(ir),
		...renderPluginFiles(
			ir.resources,
			RESOURCE_ROOT,
			sourceRef(getManifest(ir).id, "resource"),
		),
	];
	const pathContext = { resourceRoot: RESOURCE_ROOT, agentFiles };
	const pluginFiles = [
		...resolveBundlePaths(generatedFiles, pathContext),
		...resolveBundlePaths(renderMcpFiles(ir.tools), {
			...pathContext,
			rootVariable: MCP_PLUGIN_ROOT_VARIABLE,
		}),
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

/**
 * `displayName`, `logo`, `author` (string or {name, email, url}),
 * `repository` and `keywords` are documented plugin.json keys.
 * https://antigravity.google/docs/build-plugins.md
 * https://antigravity.google/schemas/v1/plugin.json
 */
function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const keywords = manifest.keywords ?? manifest.categories;
	const content = omitUndefined({
		$schema: ANTIGRAVITY_MANIFEST_SCHEMA,
		name: pluginName(ir),
		displayName: manifest.displayName ?? manifest.name,
		description: manifest.description,
		version: manifest.version,
		logo: manifestLogo(ir),
		author: manifest.author ? omitUndefined({ ...manifest.author }) : undefined,
		homepage: manifest.homepage,
		repository: manifest.repository,
		license: manifest.license,
		keywords: keywords.length > 0 ? keywords : undefined,
	});

	return jsonFile(
		ANTIGRAVITY_MANIFEST_PATH,
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

/**
 * The schema accepts a relative path to a .png, .svg, .jpg, .jpeg or .webp
 * file inside the plugin. Resources are written at the plugin root, so the
 * resource path is the manifest path.
 */
const ANTIGRAVITY_LOGO_PATH =
	/^(?![A-Za-z][A-Za-z0-9+.-]*:)(?!\/)\S.*\.(png|svg|jpe?g|webp)$/i;

function manifestLogo(ir: PluginIr): string | undefined {
	const logo = ir.manifest?.logo?.replace(/^\.\//, "");

	if (
		!logo ||
		!ANTIGRAVITY_LOGO_PATH.test(logo) ||
		!(ir.resources ?? []).some((resource) => resource.path === logo)
	) {
		return undefined;
	}

	return logo;
}

function pluginName(ir: PluginIr): string {
	return slug(getManifest(ir).id, "oiap-plugin");
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
			const trigger = antigravityRuleTrigger(rule.activation);
			const content = withFrontmatter(
				{
					trigger,
					globs:
						trigger === "glob" && rule.globs && rule.globs.length > 0
							? rule.globs.join(", ")
							: undefined,
					description: rule.description ?? rule.id,
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
			`rules/${slug(instruction.id, "instruction")}.md`,
			usedRulePaths,
		);
		const content = withFrontmatter(
			{
				trigger:
					instruction.purpose === "always_on" ||
					instruction.purpose === "safety"
						? "always_on"
						: "model_decision",
				description: instruction.triggers[0] ?? instruction.id,
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
	return skills.flatMap((skill) => {
		const instruction = findInstruction(skill.instructions.id, instructions);
		const body = instruction
			? instructionBody(instruction)
			: `Skill instruction reference not found: ${skill.instructions.id}`;
		const skillSlug = reserveSlug(skill.id, usedSkillSlugs, "skill");
		const content = withFrontmatter(
			{
				name: skillSlug,
				description: skill.description,
				// `disable-model-invocation: true` limits the skill to /<name>.
				// No key hides a skill from the user (see collectDegradedCapabilities).
				// https://antigravity.google/docs/build-plugins.md
				"disable-model-invocation":
					skill.modelInvocable === false ? true : undefined,
				...targetMetadata(skill.targetMetadata),
			},
			skill.name === skillSlug ? body : `# ${skill.name}\n\n${body}`,
		);

		return [
			textFile(
				`skills/${skillSlug}/SKILL.md`,
				content,
				sourceRef(skill.id, "skill"),
			),
			...renderPluginFiles(
				skill.files,
				`skills/${skillSlug}`,
				sourceRef(skill.id, "skill-file"),
			),
		];
	});
}

/**
 * Antigravity plugins do not load `commands/`; the build guide names
 * `skills/` as the equivalent, invoked with `/<skill-name>`.
 */
function renderCommandSkills(
	commands: CommandAsset[],
	context: CommandSkillRenderContext,
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
		const commandName = invocation
			? targetInvocationName(invocation)
			: command.id;
		const skillSlug = reserveSlug(commandName, context.usedSkillSlugs, "skill");
		const body = [
			`# ${commandName}`,
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
				name: skillSlug,
				description: invocation?.helpText ?? command.id,
				"disable-model-invocation": true,
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

function renderWorkflowSkills(
	workflows: Workflow[],
	invocations: Invocation[],
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return workflows.map((workflow) => {
		const invocation = workflow.activation.invocation
			? findInvocation(workflow.activation.invocation.id, invocations)
			: undefined;
		const workflowName = invocation
			? targetInvocationName(invocation)
			: workflow.id;
		const skillSlug = reserveSlug(workflowName, usedSkillSlugs, "skill");
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
		const userInvoked =
			workflow.activation.mode === "manual" ||
			workflow.activation.mode === "command";
		const content = withFrontmatter(
			{
				name: skillSlug,
				description:
					workflow.activation.triggers?.[0] ??
					invocation?.helpText ??
					workflow.title,
				"disable-model-invocation": userInvoked ? true : undefined,
			},
			body,
		);

		return textFile(
			`skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(workflow.id, "workflow-as-skill"),
		);
	});
}

function agentFilePaths(agents: AgentDefinition[]): Record<string, string> {
	const usedSlugs = new Set<string>();

	return Object.fromEntries(
		agents.map((agent) => [
			agent.id,
			`agents/${reserveSlug(agent.id, usedSlugs, "agent")}.md`,
		]),
	);
}

/**
 * Custom agents and subagents: `agents/<name>.md` with `name` and
 * `description` frontmatter. Gemini CLI reads the same root `agents/*.md`
 * with a strict schema, so only the keys both hosts share are emitted;
 * `targetMetadata.antigravity` adds Antigravity-only keys (`tools`, `model`,
 * `commandExecutionPolicy`, ...) on request.
 * https://antigravity.google/docs/subagents/
 */
function renderAgents(
	agents: AgentDefinition[],
	instructions: InstructionModule[],
	agentFiles: Record<string, string>,
): RenderedFile[] {
	return agents.map((agent) => {
		const instruction = findInstruction(agent.instructions.id, instructions);
		const path = agentFiles[agent.id] ?? `agents/${slug(agent.id, "agent")}.md`;
		const name = path.slice("agents/".length, -".md".length);
		const content = withFrontmatter(
			{
				name,
				description: agent.description,
				...targetMetadata(agent.targetMetadata),
			},
			instruction
				? instructionBody(instruction)
				: `Agent instruction reference not found: ${agent.instructions.id}`,
		);

		return textFile(path, content, sourceRef(agent.id, "agent"));
	});
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const hooks = supportedAntigravityHooks(ir.hooks);

	if (hooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(ir, hooks),
		...hooks.map(renderHookMetadata),
		...renderHookRuntimeFiles({
			pluginId: getManifest(ir).id,
			target: ANTIGRAVITY_TARGET,
			hooks,
			targetEvent: (hook) => toAntigravityHookEvent(hook.event),
		}).files,
	];
}

/**
 * Root `hooks.json`: named groups of lifecycle event arrays. Tool events wrap
 * handlers in `{ matcher, hooks }`; the others take handlers directly.
 * Commands run with cwd set to the plugin root.
 * https://antigravity.google/docs/build-plugins.md
 */
function renderHooksConfig(
	ir: PluginIr,
	hooks: HookDefinition[],
): RenderedFile {
	const group: Record<string, unknown> = { enabled: true };

	for (const hook of hooks) {
		const event = toAntigravityHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const handler = omitUndefined({
			type: "command",
			command: renderHookRuntimeCommand({
				runnerPath: HOOK_RUNNER_PATH,
				manifestPath: HOOK_MANIFEST_PATH,
				target: ANTIGRAVITY_TARGET,
				event: hook.event,
				hookId: hook.id,
			}),
			timeout:
				hook.timeoutMs === undefined
					? undefined
					: Math.max(1, Math.ceil(hook.timeoutMs / 1000)),
		});
		const entries = (group[event] as unknown[] | undefined) ?? [];
		entries.push(
			isToolHookEvent(event)
				? { matcher: renderHookMatcher(hook.match), hooks: [handler] }
				: handler,
		);
		group[event] = entries;
	}

	return jsonFile(
		"hooks.json",
		{ [pluginName(ir)]: group },
		sourceRef("antigravity-hooks", "hooks"),
	);
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			antigravityEvent: toAntigravityHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Antigravity hooks.json calls the generated OIAP raw-JS hook runner from the plugin root. The runner writes Antigravity hook responses (decision, injectSteps).",
			},
		},
		sourceRef(hook.id, "hook"),
	);
}

function supportedAntigravityHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toAntigravityHookEvent(hook.event)));
}

function toAntigravityHookEvent(
	event: HookDefinition["event"],
): string | undefined {
	switch (event) {
		case "session_start":
			return "SessionStart";
		case "user_prompt_submit":
		case "before_agent":
			return "PreInvocation";
		case "after_agent":
			return "PostInvocation";
		case "before_tool":
			return "PreToolUse";
		case "after_tool":
			return "PostToolUse";
		case "stop":
			return "Stop";
		case "permission_request":
			return undefined;
	}
}

function isToolHookEvent(event: string): boolean {
	return event === "PreToolUse" || event === "PostToolUse";
}

/** Tool-name regex for PreToolUse and PostToolUse. */
function renderHookMatcher(match: HookDefinition["match"]): string {
	const matcher: unknown = match;

	if (isRecord(matcher)) {
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
	}

	return ".*";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** Skipped when a plugin resource already ships a root README.md. */
function renderPackageReadme(ir: PluginIr): RenderedFile[] {
	if ((ir.resources ?? []).some((file) => file.path === "README.md")) {
		return [];
	}

	const manifest = getManifest(ir);
	const sections = [
		`# ${manifest.name}`,
		manifest.description,
		"This Google Antigravity plugin was generated by the OIAP Antigravity exporter. Install it with `agy plugin install <path or GitHub URL>`.",
		"## Contents",
		`- \`${ANTIGRAVITY_MANIFEST_PATH}\`: plugin manifest.`,
		"- `skills/`: skills, plus commands and workflows rendered as skills (invoke with `/<skill-name>`), when present. Skill files live beside each SKILL.md.",
		"- `agents/`: custom agents and subagents, when present.",
		"- `rules/`: rules, when present.",
		"- `hooks.json` and `.oiap/runtime/`: lifecycle hooks and the OIAP hook runner, when present.",
		"- `mcp_config.json`: MCP servers, when present.",
		"- `.oiap/`: source map, capability report, permission fragments, and degraded metadata.",
		"Plugin resources, when present, are at the plugin root.",
	];

	return [
		textFile(
			"README.md",
			sections.join("\n\n"),
			sourceRef(manifest.id, "readme"),
		),
	];
}

const BUNDLE_FILE_SUPPORT = {
	target: ANTIGRAVITY_TARGET,
	files: true,
	rootVariable: false,
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

	if (hasCommandOutput(ir)) {
		capabilities.push({ kind: "commands", target: ANTIGRAVITY_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: ANTIGRAVITY_TARGET });
	}

	if (supportedAntigravityHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: ANTIGRAVITY_TARGET });
		capabilities.push({ kind: "runtime", target: ANTIGRAVITY_TARGET });
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
	const degradations: CapabilityDegradation[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).degradations,
		...agentAccessDegradation(
			ANTIGRAVITY_TARGET,
			ir.agents,
			"Antigravity documents no read-only flag for agents, only a `tools` allowlist and `commandExecutionPolicy` that Gemini CLI, which reads the same agents/ folder, does not accept. Add them through targetMetadata.antigravity if the plugin targets Antigravity only.",
		),
	];

	const modelOnlySkills = ir.skills.filter(
		(skill) => skill.userInvocable === false,
	);

	if (modelOnlySkills.length > 0) {
		degradations.push({
			capability: { kind: "skills", target: ANTIGRAVITY_TARGET },
			from: "model-only-skill",
			to: "model-and-user-skill",
			reason: `Antigravity exposes every skill as /<name> and documents no key to hide one, so ${modelOnlySkills.length} model-only skill(s) (${modelOnlySkills.map((skill) => skill.id).join(", ")}) are also visible to the user.`,
		});
	}

	// Agent frontmatter (name, description, tools, mainAgent, subagent, model,
	// commandExecutionPolicy, mcpServers, skills/plugins) has no switch for the
	// workspace rules and AGENTS.md context.
	// https://antigravity.google/docs/subagents.md
	const isolatedAgents = ir.agents.filter(
		(agent) => agent.hostInstructions === "exclude",
	);

	if (isolatedAgents.length > 0) {
		degradations.push({
			capability: { kind: "agents", target: ANTIGRAVITY_TARGET },
			from: "agent-without-host-instructions",
			to: "agent-with-host-instructions",
			reason: `Antigravity agent frontmatter has no key to leave out workspace and user rules, so ${isolatedAgents.length} agent(s) (${isolatedAgents.map((agent) => agent.id).join(", ")}) may still see project and user instructions.`,
		});
	}

	if (hasCommandOutput(ir)) {
		degradations.push({
			capability: { kind: "commands", target: ANTIGRAVITY_TARGET },
			from: "slash-command",
			to: "skill",
			reason:
				"Antigravity plugins do not load commands/ or workflows; commands and workflows are rendered as skills under skills/, invoked with /<skill-name>.",
		});
	}

	const nonPortableHookIds = runtimeUnsupportedHookIds(
		supportedAntigravityHooks(ir.hooks),
	);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: ANTIGRAVITY_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	if (supportedAntigravityHooks(ir.hooks).length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: ANTIGRAVITY_TARGET },
			from: "all-hook-decisions",
			to: "documented-antigravity-responses",
			reason:
				"The OIAP runner maps block, allow, ask and inject_context to Antigravity hook responses (decision, injectSteps; https://antigravity.google/docs/hooks). modify, replace_result and schedule are not representable, and PostToolUse responses are always empty.",
		});
	}

	const unsupportedHookCount =
		ir.hooks.length - supportedAntigravityHooks(ir.hooks).length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: ANTIGRAVITY_TARGET },
			from: "all-oiap-hook-events",
			to: "antigravity-hook-events",
			reason: `${unsupportedHookCount} hook event(s) have no Antigravity lifecycle equivalent and were not emitted.`,
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
				"Antigravity plugins have no permission policy file; generated allow, deny, and ask resource strings are reviewable fragments under .oiap/.",
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
	const issues: ValidationIssue[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).issues,
	];

	if (!ir.manifest) {
		issues.push({
			severity: "warning",
			code: "missing-manifest",
			message:
				"Plugin manifest is missing; fallback Antigravity metadata was generated.",
		});
	}

	if (ir.manifest?.logo && !manifestLogo(ir)) {
		issues.push({
			severity: "warning",
			code: "invalid-logo",
			message: `Manifest logo ${ir.manifest.logo} is not a .png, .svg, .jpg, .jpeg or .webp file in plugin resources, so plugin.json has no logo.`,
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
	const issues: ValidationIssue[] = [
		...duplicateFileIssues(bundle.files),
		...unresolvedTokenIssues(bundle.files),
	];
	const manifestFile = bundle.files.find(
		(file) => file.path === ANTIGRAVITY_MANIFEST_PATH,
	);

	if (!manifestFile) {
		issues.push({
			severity: "error",
			code: "missing-antigravity-plugin-manifest",
			message: `Antigravity plugin is missing ${ANTIGRAVITY_MANIFEST_PATH}.`,
		});
	}

	for (const file of bundle.files.filter((candidate) =>
		candidate.path.endsWith(".json"),
	)) {
		if (typeof file.content !== "string") {
			continue;
		}

		try {
			const value: unknown = JSON.parse(file.content);

			if (file === manifestFile) {
				issues.push(...manifestIssues(value));
			}
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

function manifestIssues(manifest: unknown): ValidationIssue[] {
	if (!isRecord(manifest)) {
		return [
			{
				severity: "error",
				code: "invalid-antigravity-plugin-manifest",
				message: "Antigravity plugin manifest must be a JSON object.",
				path: ANTIGRAVITY_MANIFEST_PATH,
			},
		];
	}

	const issues: ValidationIssue[] = Object.keys(manifest)
		.filter((key) => !ANTIGRAVITY_MANIFEST_KEYS.has(key))
		.map((key) => ({
			severity: "error",
			code: "invalid-antigravity-plugin-manifest",
			message: `Antigravity plugin manifest does not allow the key ${key}.`,
			path: ANTIGRAVITY_MANIFEST_PATH,
		}));

	if (
		typeof manifest.name !== "string" ||
		!ANTIGRAVITY_PLUGIN_NAME.test(manifest.name)
	) {
		issues.push({
			severity: "error",
			code: "invalid-antigravity-plugin-manifest",
			message: "Antigravity plugin manifest name must be lowercase kebab-case.",
			path: ANTIGRAVITY_MANIFEST_PATH,
		});
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
			author: undefined,
			homepage: undefined,
			repository: undefined,
			license: undefined,
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

function hasCommandOutput(ir: PluginIr): boolean {
	return ir.commands.length > 0 || ir.workflows.length > 0;
}

/** Rule `trigger` values: always_on, model_decision, glob, manual. */
function antigravityRuleTrigger(activation: ProjectRule["activation"]): string {
	switch (activation) {
		case "always":
			return "always_on";
		case "glob":
		case "pattern":
			return "glob";
		case "manual":
			return "manual";
		case "model":
			return "model_decision";
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
	metadata:
		| CommandAsset["targetMetadata"]
		| SkillAsset["targetMetadata"]
		| AgentDefinition["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[ANTIGRAVITY_TARGET] ?? {};
}

/** Rules live under the plugin's `rules/` folder; workspace prefixes are dropped. */
function normalizeAntigravityRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);
	const fallback = `${slug(rule.id, "rule")}.md`;

	if (!cleanPath || cleanPath.endsWith("/")) {
		return `rules/${fallback}`;
	}

	const prefix = /^(?:\.agents?\/rules\/|rules\/)/;
	const relative = prefix.test(cleanPath)
		? cleanPath.replace(prefix, "")
		: fileBaseName(cleanPath);

	return ensureMarkdownPath(`rules/${relative || fallback}`);
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
