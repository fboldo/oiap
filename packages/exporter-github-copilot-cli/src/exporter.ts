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
	renderHookRuntimeCommand,
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import {
	GITHUB_COPILOT_CLI_TARGET,
	gitHubCopilotCliProfile,
} from "./profile.ts";

export type GitHubCopilotCliPluginInput = PluginDefinition | PluginIr;

export interface GitHubCopilotCliSourceMap {
	target: typeof GITHUB_COPILOT_CLI_TARGET;
	entries: GitHubCopilotCliSourceMapEntry[];
}

export interface GitHubCopilotCliSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export const gitHubCopilotCliExporter = defineExporter({
	target: GITHUB_COPILOT_CLI_TARGET,
	profile: gitHubCopilotCliProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderGitHubCopilotCliFiles(ir);
		const report = createExportReport(ir);

		return {
			target: GITHUB_COPILOT_CLI_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: GITHUB_COPILOT_CLI_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "github-copilot-cli-plugin",
				target: GITHUB_COPILOT_CLI_TARGET,
				manifestPath: "plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateGitHubCopilotCliBundle(bundle);
	},
});

export function exportGitHubCopilotCli(
	plugin: GitHubCopilotCliPluginInput,
): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = gitHubCopilotCliExporter.lower(ir);
	const bundle = gitHubCopilotCliExporter.render(graph);
	const validationIssues = gitHubCopilotCliExporter.validate(bundle);

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

// Primitives limited to other hosts with `targets` never reach this exporter.
function normalizePluginInput(plugin: GitHubCopilotCliPluginInput): PluginIr {
	const ir = isPluginIr(plugin) ? plugin : toPluginIr(plugin);

	return dropOrphanedInstructions(
		ir,
		scopeToTarget(ir, GITHUB_COPILOT_CLI_TARGET),
	);
}

// An instruction that only backed a skill, agent or command scoped to another
// host would otherwise be exported here as a standalone instruction skill.
function dropOrphanedInstructions(full: PluginIr, scoped: PluginIr): PluginIr {
	const before = referencedInstructionIds(full);
	const after = referencedInstructionIds(scoped);

	return {
		...scoped,
		instructions: scoped.instructions.filter(
			(instruction) => !before.has(instruction.id) || after.has(instruction.id),
		),
	};
}

function referencedInstructionIds(ir: PluginIr): Set<string> {
	return new Set([
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
	]);
}

function isPluginIr(plugin: GitHubCopilotCliPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderGitHubCopilotCliFiles(ir: PluginIr): RenderedFile[] {
	const usedSkillSlugs = new Set<string>();
	const generatedFiles = [
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
		...renderPluginFiles(
			ir.resources,
			RESOURCE_ROOT,
			sourceRef(getManifest(ir).id, "resource"),
		),
		// Author files for this host (hand-written hook scripts, extra command
		// files, ...) land at the plugin root, where plugin.json lives.
		...renderPluginFiles(
			ir.targetFiles?.[GITHUB_COPILOT_CLI_TARGET],
			"",
			sourceRef(getManifest(ir).id, "target-file"),
		),
	];
	// Copilot CLI exposes the plugin root to hook processes (PLUGIN_ROOT env var)
	// and agent mcp-servers frontmatter, not to skill or agent text, so bundle
	// paths stay file-relative.
	const pluginFiles = resolveBundlePaths(generatedFiles, {
		resourceRoot: RESOURCE_ROOT,
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

// Legacy (non-Agent Plugins 1.0) manifest: Agent Plugins 1.0 has a closed
// schema without component path fields and does not define a commands or rules
// file format, so OIAP emits the legacy manifest with explicit component paths.
// The legacy manifest documents author ({name, email?, url?}), repository and
// keywords, but no display name or logo field, so `displayName` and `logo` are
// not emitted (the logo file still ships as a plugin resource).
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const hasSkills = hasSkillOutput(ir);
	const hasCommands = ir.commands.length > 0;
	const hasAgents = ir.agents.length > 0;
	const hooks = supportedCopilotCliHooks(ir.hooks);
	const hasMcp = ir.tools.some((tool) => tool.server);
	const generated = omitUndefined({
		name: slug(manifest.id, "oiap-plugin"),
		description: manifest.description,
		version: manifest.version,
		author: manifest.author ? omitUndefined({ ...manifest.author }) : undefined,
		homepage: manifest.homepage,
		repository: manifest.repository,
		license: manifest.license,
		keywords: manifestKeywords(manifest),
		category: manifest.categories[0],
		skills: hasSkills ? "skills/" : undefined,
		commands: hasCommands ? "commands/" : undefined,
		agents: hasAgents ? "agents/" : undefined,
		hooks: hooks.length > 0 ? "hooks.json" : undefined,
		mcpServers: hasMcp ? ".mcp.json" : undefined,
	});
	const content = mergeTargetMetadata(
		generated,
		manifest.targetMetadata?.[GITHUB_COPILOT_CLI_TARGET],
	);

	return jsonFile("plugin.json", content, sourceRef(manifest.id, "manifest"));
}

function manifestKeywords(
	manifest: Pick<PluginManifest, "keywords" | "categories">,
): string[] | undefined {
	if (manifest.keywords && manifest.keywords.length > 0) {
		return manifest.keywords;
	}

	return manifest.categories.length > 0 ? manifest.categories : undefined;
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
		const skillSlug = reserveSlug(skill.id, usedSkillSlugs);
		// A skill from skillsFrom() keeps its SKILL.md exactly as written.
		const content =
			skill.source?.skillFile ??
			withFrontmatter(
				{
					name: skillSlug,
					description: skill.description,
					...skillInvocationFrontmatter(skill),
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

// SKILL.md `user-invocable` (default true) and `disable-model-invocation`
// (default false); only non-default values are written.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
function skillInvocationFrontmatter(
	skill: SkillAsset,
): Record<string, unknown> {
	return omitUndefined({
		"user-invocable": skill.userInvocable === false ? false : undefined,
		"disable-model-invocation":
			skill.modelInvocable === false ? true : undefined,
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
		.filter((rule) => rule.target === GITHUB_COPILOT_CLI_TARGET)
		.map((rule) => {
			const skillSlug = reserveSlug(rule.id, usedSkillSlugs);
			const content = withFrontmatter(
				{
					name: skillSlug,
					description: rule.description ?? rule.id,
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
			tools: agentTools(agent),
			"include-custom-instructions": includeCustomInstructions(agent),
			...targetMetadata(agent.targetMetadata),
		},
		body,
	);

	return textFile(agentPath(agent), content, sourceRef(agent.id, "agent"));
}

// `include-custom-instructions` controls whether a custom agent running as a
// subagent reads the repository instruction files (copilot-instructions.md,
// AGENTS.md, CLAUDE.md); it defaults to false. An agent the user selects with
// `--agent` or `/agent` always reads them, so "exclude" is only partial and is
// reported as a degradation.
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli
function includeCustomInstructions(
	agent: AgentDefinition,
): boolean | undefined {
	if (agent.hostInstructions === "include") {
		return true;
	}

	return agent.hostInstructions === "exclude" ? false : undefined;
}

function agentPath(agent: AgentDefinition): string {
	return `agents/${slug(agent.id, "agent")}.agent.md`;
}

// Copilot custom agent tool aliases for reading files (`read`) and finding
// files or text (`search`); `edit` and `execute` are left out.
// https://docs.github.com/en/copilot/reference/custom-agents-configuration
const READ_ONLY_TOOLS = ["read", "search"];

function agentTools(agent: AgentDefinition): string[] | undefined {
	if (agent.tools) {
		return agent.tools.map((tool) => tool.id);
	}

	return agent.access === "read-only" ? READ_ONLY_TOOLS : undefined;
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const hooks = supportedCopilotCliHooks(ir.hooks);

	if (hooks.length === 0) {
		return [];
	}

	return [
		renderHooksConfig(hooks),
		...hooks.map(renderHookMetadata),
		...renderHookRuntime(ir, hooks),
	];
}

// Copilot CLI hooks file: `version: 1`, camelCase event keys, command entries
// with `bash` / `powershell`, `timeoutSec` and an optional `matcher` regex.
// https://docs.github.com/en/copilot/reference/hooks-reference
// Plugin hook processes receive PLUGIN_ROOT (changelog 1.0.26), and commands
// without `cwd` run in the project root (changelog 1.0.88), so the runner is
// located through the environment variable rather than a relative path.
// https://github.com/github/copilot-cli/blob/main/changelog.md
function renderHooksConfig(hooks: HookDefinition[]): RenderedFile {
	const groupedHooks: Record<string, unknown[]> = {};

	for (const hook of hooks) {
		const event = toCopilotCliHookEvent(hook.event);

		if (!event) {
			continue;
		}

		const commandHook = omitUndefined({
			type: "command",
			bash: hookCommand(hook, "$PLUGIN_ROOT"),
			powershell: hookCommand(hook, "$env:PLUGIN_ROOT"),
			timeoutSec: hook.timeoutMs ? Math.ceil(hook.timeoutMs / 1000) : undefined,
			matcher: MATCHER_EVENTS.has(event)
				? renderHookMatcher(hook.match)
				: undefined,
		});

		groupedHooks[event] = [...(groupedHooks[event] ?? []), commandHook];
	}

	return jsonFile(
		"hooks.json",
		{ version: 1, hooks: groupedHooks },
		sourceRef("github-copilot-cli-hooks", "hooks"),
	);
}

function hookCommand(hook: HookDefinition, pluginRoot: string): string {
	return renderHookRuntimeCommand({
		runnerPath: `${pluginRoot}/.oiap/runtime/runner.mjs`,
		manifestPath: `${pluginRoot}/.oiap/runtime/manifest.json`,
		target: GITHUB_COPILOT_CLI_TARGET,
		event: hook.event,
		hookId: hook.id,
	});
}

// Events whose `matcher` is documented: tool name for tool and permission
// events, agent name for subagentStart.
const MATCHER_EVENTS = new Set([
	"preToolUse",
	"postToolUse",
	"permissionRequest",
	"subagentStart",
]);

function hasIgnoredMatcher(hook: HookDefinition): boolean {
	const event = toCopilotCliHookEvent(hook.event);
	return Boolean(hook.match && event && !MATCHER_EVENTS.has(event));
}

function renderHookMetadata(hook: HookDefinition): RenderedFile {
	return jsonFile(
		`.oiap/hooks/${slug(hook.id, "hook")}.json`,
		{
			id: hook.id,
			event: hook.event,
			copilotCliEvent: toCopilotCliHookEvent(hook.event),
			match: hook.match,
			timeoutMs: hook.timeoutMs,
			failureMode: hook.failureMode,
			optional: hook.optional ?? false,
			capabilities: hook.capabilities ?? {},
			runtime: {
				status: "generated-js-runner",
				message:
					"Copilot CLI hook config calls the generated OIAP raw-JS hook runner through the PLUGIN_ROOT environment variable.",
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
		target: GITHUB_COPILOT_CLI_TARGET,
		hooks,
		targetEvent: (hook) => toCopilotCliHookEvent(hook.event),
	}).files;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const mcpServers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [slug(tool.id, "server"), toCopilotCliMcpServer(tool)]),
	);

	return [
		jsonFile(
			".mcp.json",
			{ mcpServers },
			sourceRef("github-copilot-cli-mcp", "mcp"),
		),
	];
}

// Copilot CLI MCP server fields: `type` (`local` / `stdio`, `http`, `sse`),
// `command`, `args`, `env`, `tools`, `url`, `headers`; `cwd` is documented for
// plugin stdio servers.
// https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
function toCopilotCliMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	const url = server.url ?? server.httpUrl;

	if (url) {
		return omitUndefined({
			type: tool.transport === "mcp-sse" ? "sse" : "http",
			url,
			headers: server.headers,
			tools: server.includeTools ?? ["*"],
		});
	}

	return omitUndefined({
		type: "local",
		command: server.command,
		args: server.args,
		env: server.env,
		cwd: server.cwd,
		tools: server.includeTools ?? ["*"],
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
				(module) => module.target === GITHUB_COPILOT_CLI_TARGET,
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
		"This GitHub Copilot CLI plugin bundle was generated by the OIAP GitHub Copilot CLI exporter.",
		"## Install",
		"Run `copilot plugin install <path-to-this-directory>`, or load it for one session with `copilot --plugin-dir <path-to-this-directory>`.",
		"## Contents",
		"- `plugin.json`: Copilot CLI plugin manifest with component paths.",
		"- `commands/`: generated slash command Markdown files, when present.",
		"- `skills/`: generated Agent Skills folders, when present.",
		"- `agents/`: generated `.agent.md` custom agents, when present.",
		"- `hooks.json`: generated hook configuration (`version: 1`), when present.",
		"- `.mcp.json`: generated MCP server configuration, when present.",
		"- Plugin resources and skill files: written at the plugin root and beside each SKILL.md, when present.",
		"- Copilot CLI target files (`targetFiles`): written as-is relative to the plugin root, when present.",
		"- `.oiap/`: hook runtime, source map, capability report, and policy evidence.",
		"## Current Limitations",
		"Copilot CLI plugins have no rules or custom-instruction surface, so OIAP rules and always-on instructions are exported as model-invoked skills. Hook results are written in Copilot CLI's documented hook output fields; modify and schedule decisions are not representable. Paths to bundled files in skill and agent text are relative to the file that contains them.",
	];

	return textFile(
		"README.md",
		sections.join("\n\n"),
		sourceRef(manifest.id, "readme"),
	);
}

const RESOURCE_ROOT = "";

const BUNDLE_FILE_SUPPORT = {
	target: GITHUB_COPILOT_CLI_TARGET,
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
		target: GITHUB_COPILOT_CLI_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: GITHUB_COPILOT_CLI_TARGET },
	];

	if (hasSkillOutput(ir)) {
		capabilities.push({ kind: "skills", target: GITHUB_COPILOT_CLI_TARGET });
	}

	if (ir.commands.length > 0) {
		capabilities.push({ kind: "commands", target: GITHUB_COPILOT_CLI_TARGET });
	}

	if (ir.agents.length > 0) {
		capabilities.push({ kind: "agents", target: GITHUB_COPILOT_CLI_TARGET });
	}

	if (ir.tools.some((tool) => tool.server)) {
		capabilities.push({ kind: "mcp", target: GITHUB_COPILOT_CLI_TARGET });
	}

	if (supportedCopilotCliHooks(ir.hooks).length > 0) {
		capabilities.push({ kind: "hooks", target: GITHUB_COPILOT_CLI_TARGET });
		capabilities.push({ kind: "runtime", target: GITHUB_COPILOT_CLI_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).degradations,
	];
	const ruleCount = ir.rules.filter(
		(rule) => rule.target === GITHUB_COPILOT_CLI_TARGET,
	).length;

	if (ruleCount > 0 || standaloneInstructions(ir).length > 0) {
		degradations.push({
			capability: { kind: "rules", target: GITHUB_COPILOT_CLI_TARGET },
			from: "always-on-instruction-rule",
			to: "model-invoked-skill",
			reason:
				"Copilot CLI plugins do not define a rules or custom-instruction component, so rules and standalone instructions are exported as model-invoked skills.",
		});
	}

	// include-custom-instructions: false applies when the agent runs as a
	// subagent, which is what plugin agents are for; a user who selects the
	// agent with --agent or /agent still gets repository instructions. Claude
	// Code's omitClaudeMd behaves the same way, so neither is reported.

	const supportedHooks = supportedCopilotCliHooks(ir.hooks);
	const nonPortableHookIds = runtimeUnsupportedHookIds(supportedHooks);

	if (supportedHooks.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GITHUB_COPILOT_CLI_TARGET },
			from: "all-hook-decisions",
			to: "documented-copilot-cli-outputs",
			reason:
				"The OIAP hook runner maps block, allow, ask, inject_context and replace_result to the outputs Copilot CLI documents for each event (https://docs.github.com/en/copilot/reference/hooks-reference). modify and schedule are not representable, and userPromptSubmitted output is not documented, so those results are ignored.",
		});
	}

	const ignoredMatcherCount = supportedHooks.filter(hasIgnoredMatcher).length;

	if (ignoredMatcherCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GITHUB_COPILOT_CLI_TARGET },
			from: "matched-hook",
			to: "unmatched-hook",
			reason: `${ignoredMatcherCount} hook(s) declare a match on an event where Copilot CLI does not document a matcher, so they run for every occurrence of the event.`,
		});
	}

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GITHUB_COPILOT_CLI_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} supported Copilot CLI hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	const unsupportedHookCount = ir.hooks.length - supportedHooks.length;

	if (unsupportedHookCount > 0) {
		degradations.push({
			capability: { kind: "hooks", target: GITHUB_COPILOT_CLI_TARGET },
			from: "all-oiap-hook-events",
			to: "copilot-cli-supported-hook-events",
			reason: `${unsupportedHookCount} hook event(s) do not have a documented Copilot CLI hook event equivalent today.`,
		});
	}

	const excludedToolServers = ir.tools.filter(
		(tool) => (tool.server?.excludeTools?.length ?? 0) > 0,
	);

	if (excludedToolServers.length > 0) {
		degradations.push({
			capability: { kind: "mcp", target: GITHUB_COPILOT_CLI_TARGET },
			from: "mcp-exclude-tools",
			to: "not-emitted",
			reason: `${excludedToolServers.length} MCP server(s) declare excludeTools; Copilot CLI documents only an allow-list (tools), so the exclusions are dropped.`,
		});
	}

	if (ir.policies.length > 0) {
		degradations.push({
			capability: { kind: "policy", target: GITHUB_COPILOT_CLI_TARGET },
			from: "policy-enforcement",
			to: "policy-evidence",
			reason:
				"Permission policies are emitted as evidence until policy-specific Copilot CLI hook lowering is implemented.",
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === GITHUB_COPILOT_CLI_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: GITHUB_COPILOT_CLI_TARGET },
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
				capability.target && capability.target !== GITHUB_COPILOT_CLI_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not GitHub Copilot CLI.`,
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
				"Plugin manifest is missing; fallback Copilot CLI metadata was generated.",
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

function validateGitHubCopilotCliBundle(
	bundle: TargetBundle,
): ValidationIssue[] {
	const issues: ValidationIssue[] = [
		...duplicateFileIssues(bundle.files),
		...unresolvedTokenIssues(bundle.files),
	];
	const filePaths = new Set(bundle.files.map((file) => file.path));

	if (!filePaths.has("plugin.json")) {
		issues.push({
			severity: "error",
			code: "missing-plugin-json",
			message: "GitHub Copilot CLI bundle is missing root plugin.json.",
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

function createSourceMap(files: RenderedFile[]): GitHubCopilotCliSourceMap {
	return {
		target: GITHUB_COPILOT_CLI_TARGET,
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
		target: GITHUB_COPILOT_CLI_TARGET,
		exporter: "@oiap/exporter-github-copilot-cli",
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
			supportedTargets: [GITHUB_COPILOT_CLI_TARGET],
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
	return (
		instruction.hostOverrides?.[GITHUB_COPILOT_CLI_TARGET] ?? instruction.body
	);
}

function targetInvocationName(invocation: Invocation): string {
	return (
		invocation.targetAliases?.[GITHUB_COPILOT_CLI_TARGET] ??
		invocation.canonical
	);
}

function standaloneInstructions(ir: PluginIr): InstructionModule[] {
	const referencedInstructions = referencedInstructionIds(ir);

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
		ir.rules.some((rule) => rule.target === GITHUB_COPILOT_CLI_TARGET)
	);
}

function supportedCopilotCliHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toCopilotCliHookEvent(hook.event)));
}

function toCopilotCliHookEvent(
	event: HookDefinition["event"],
): string | undefined {
	// camelCase keys select Copilot CLI's native payload format; PascalCase
	// keys would switch to the VS Code compatible payload.
	// https://docs.github.com/en/copilot/reference/hooks-reference
	switch (event) {
		case "session_start":
			return "sessionStart";
		case "user_prompt_submit":
			return "userPromptSubmitted";
		case "before_tool":
			return "preToolUse";
		case "after_tool":
			return "postToolUse";
		case "permission_request":
			return "permissionRequest";
		case "before_agent":
			return "subagentStart";
		case "after_agent":
			return "subagentStop";
		case "stop":
			return "agentStop";
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
	metadata:
		| CommandAsset["targetMetadata"]
		| SkillAsset["targetMetadata"]
		| AgentDefinition["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[GITHUB_COPILOT_CLI_TARGET] ?? {};
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
