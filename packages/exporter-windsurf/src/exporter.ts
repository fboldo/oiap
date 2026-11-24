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
	Workflow,
	WorkflowStep,
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
import { renderHookRuntimeFiles, unsupportedHookIds } from "@oiap/runtime";
import { WINDSURF_TARGET, windsurfProfile } from "./profile.ts";

export type WindsurfPluginInput = PluginDefinition | PluginIr;

export interface WindsurfSourceMap {
	target: typeof WINDSURF_TARGET;
	entries: WindsurfSourceMapEntry[];
}

export interface WindsurfSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

interface WindsurfMcpConfig {
	mcpServers: Record<string, WindsurfMcpServerConfig>;
}

/** Fields from https://docs.devin.ai/cli/extensibility/mcp/configuration.md */
interface WindsurfMcpServerConfig {
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	url?: string;
	transport?: "http" | "sse";
	headers?: Record<string, string>;
	disabledTools?: string[];
}

/** Hook config shape from https://docs.devin.ai/cli/extensibility/hooks/overview.md */
type WindsurfHooksConfig = Record<string, WindsurfHookMatcherGroup[]>;

interface WindsurfHookMatcherGroup {
	matcher: string;
	hooks: { type: "command"; command: string; timeout?: number }[];
}

interface WindsurfHookDescriptor {
	id: string;
	event: HookDefinition["event"];
	match?: HookDefinition["match"];
	failureMode?: HookDefinition["failureMode"];
	optional?: boolean;
}

const MANIFEST_PATH = ".oiap/windsurf-target.json";
const RULES_DIR = ".windsurf/rules";
const SKILLS_DIR = ".windsurf/skills";
const AGENTS_DIR = ".devin/agents";
const HOOKS_CONFIG_PATH = ".devin/hooks.v1.json";
const MCP_CONFIG_PATH = ".devin/mcp_config.json";

/** Events listed at https://docs.devin.ai/cli/extensibility/hooks/overview.md */
const HOOK_EVENTS: Partial<Record<HookDefinition["event"], string>> = {
	session_start: "SessionStart",
	user_prompt_submit: "UserPromptSubmit",
	before_tool: "PreToolUse",
	after_tool: "PostToolUse",
	permission_request: "PermissionRequest",
	stop: "Stop",
};

/**
 * Tools named in https://docs.devin.ai/cli/subagents.md examples that only
 * read the workspace. `exec` is left out because it runs shell commands.
 */
const READ_ONLY_TOOLS = ["read", "grep", "glob"];

export const windsurfExporter = defineExporter({
	target: WINDSURF_TARGET,
	profile: windsurfProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		return {
			target: WINDSURF_TARGET,
			files: renderWindsurfFiles(ir),
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report: createExportReport(ir),
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: WINDSURF_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "windsurf-workspace-bundle",
				target: WINDSURF_TARGET,
				manifestPath: MANIFEST_PATH,
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateWindsurfBundle(bundle);
	},
});

export function exportWindsurf(plugin: WindsurfPluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = windsurfExporter.lower(ir);
	const bundle = windsurfExporter.render(graph);
	const validationIssues = windsurfExporter.validate(bundle);

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

function normalizePluginInput(plugin: WindsurfPluginInput): PluginIr {
	return isPluginIr(plugin) ? plugin : toPluginIr(plugin);
}

function isPluginIr(plugin: WindsurfPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderWindsurfFiles(ir: PluginIr): RenderedFile[] {
	const usedRulePaths = new Set<string>();
	const usedSkillSlugs = new Set<string>();
	const agentSlugs = reserveAgentSlugs(ir.agents);
	const report = createExportReport(ir);
	const generatedFiles = [
		renderTargetManifest(ir),
		...renderProjectRuleFiles(ir.rules, usedRulePaths),
		...renderInstructionRules(ir, usedRulePaths),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandsAsSkills(ir, usedSkillSlugs),
		...renderWorkflowsAsSkills(ir, usedSkillSlugs),
		...renderAgents(ir.agents, ir.instructions, agentSlugs),
		...renderHookFiles(ir),
		...renderMcpFiles(ir.tools),
		...renderPolicyEvidence(ir.policies),
		...renderRuntimeModules(ir.runtimeModules),
		renderPackageReadme(ir),
		...renderPluginFiles(
			ir.resources,
			resourceRoot(ir),
			sourceRef(getManifest(ir).id, "resource"),
		),
	];
	// Windsurf has no plugin root variable in skill or agent text, so bundle
	// paths are resolved relative to the file that references them.
	const pluginFiles = resolveBundlePaths(generatedFiles, {
		resourceRoot: resourceRoot(ir),
		agentFiles: Object.fromEntries(
			ir.agents.map((agent) => [
				agent.id,
				agentPath(agentSlugs.get(agent.id) ?? slug(agent.id, "agent")),
			]),
		),
	});

	return [
		...pluginFiles,
		jsonFile(
			".oiap/bundle.json",
			createBundleManifest(ir, pluginFiles),
			sourceRef("oiap-bundle", "bundle"),
		),
		jsonFile(
			".oiap/capability-report.json",
			report,
			sourceRef("oiap-report", "report"),
		),
		jsonFile(
			".oiap/source-map.json",
			createSourceMap(pluginFiles),
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
		target: WINDSURF_TARGET,
		rules: hasRuleOutput(ir) ? `${RULES_DIR}/` : undefined,
		skills: hasSkillOutput(ir) ? `${SKILLS_DIR}/` : undefined,
		commands: ir.commands.length > 0 ? `${SKILLS_DIR}/` : undefined,
		workflows: ir.workflows.length > 0 ? `${SKILLS_DIR}/` : undefined,
		agents: ir.agents.length > 0 ? `${AGENTS_DIR}/` : undefined,
		hooks:
			supportedWindsurfHooks(ir.hooks).length > 0
				? HOOKS_CONFIG_PATH
				: undefined,
		mcp: hasMcpOutput(ir.tools) ? MCP_CONFIG_PATH : undefined,
		policies: ir.policies.length > 0 ? ".oiap/policy.json" : undefined,
		resources:
			(ir.resources ?? []).length > 0 ? `${resourceRoot(ir)}/` : undefined,
	});

	return jsonFile(MANIFEST_PATH, content, sourceRef(manifest.id, "manifest"));
}

function renderProjectRuleFiles(
	rules: ProjectRule[],
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === WINDSURF_TARGET)
		.map((rule) => {
			const path = reservePath(normalizeWindsurfRulePath(rule), usedRulePaths);
			const body = nonEmptyBody(rule.content, rule.id);

			// AGENTS.md is plain Markdown without frontmatter.
			if (path === "AGENTS.md" || path.endsWith("/AGENTS.md")) {
				return textFile(
					path,
					`${body}\n`,
					sourceRef(rule.id, "rule", rule.path),
				);
			}

			const isGlob =
				rule.activation === "glob" || rule.activation === "pattern";
			const frontmatter = omitUndefined({
				trigger: windsurfTrigger(rule.activation),
				description: rule.description,
				globs:
					isGlob && rule.globs && rule.globs.length > 0
						? rule.globs.join(",")
						: undefined,
				...rule.frontmatter,
			});

			return textFile(
				path,
				withFrontmatter(frontmatter, body),
				sourceRef(rule.id, "rule", rule.path),
			);
		});
}

function renderInstructionRules(
	ir: PluginIr,
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return standaloneInstructions(ir).map((instruction) => {
		const path = reservePath(
			`${RULES_DIR}/${slug(instruction.id, "instruction")}.md`,
			usedRulePaths,
		);
		const alwaysOn =
			instruction.purpose === "always_on" || instruction.purpose === "safety";
		const content = withFrontmatter(
			{
				trigger: alwaysOn ? "always_on" : "model_decision",
				description: instruction.triggers[0] ?? instruction.id,
				...instruction.frontmatter,
			},
			nonEmptyBody(targetInstructionBody(instruction), instruction.id),
		);

		return textFile(path, content, sourceRef(instruction.id, "instruction"));
	});
}

function renderSkills(
	skills: SkillAsset[],
	instructions: InstructionModule[],
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return skills.flatMap((skill) => {
		const instruction = findInstruction(instructions, skill.instructions.id);
		const skillSlug = reserveSlug(
			slug(skill.name || skill.id, skill.id),
			usedSkillSlugs,
		);
		const content = withFrontmatter(
			{
				name: skillSlug,
				description: skill.description,
				...targetMetadata(skill.targetMetadata),
			},
			renderSkillBody(skill, instruction),
		);

		return [
			textFile(
				`${SKILLS_DIR}/${skillSlug}/SKILL.md`,
				content,
				sourceRef(skill.id, "skill"),
			),
			...renderPluginFiles(
				skill.files,
				`${SKILLS_DIR}/${skillSlug}`,
				sourceRef(skill.id, "skill-file"),
			),
		];
	});
}

function renderCommandsAsSkills(
	ir: PluginIr,
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return ir.commands.map((command) => {
		const invocation = findInvocation(ir.invocations, command.invocation.id);
		const instruction = command.prompt
			? findInstruction(ir.instructions, command.prompt.id)
			: undefined;
		const recipe = command.recipe
			? ir.recipes.find((candidate) => candidate.id === command.recipe?.id)
			: undefined;
		const commandName = commandNameForWindsurf(command, invocation);
		const skillSlug = reserveSlug(
			slug(commandName, command.id),
			usedSkillSlugs,
		);
		const description =
			stringMetadata(
				command.targetMetadata?.[WINDSURF_TARGET],
				"description",
			) ??
			invocation?.helpText ??
			`Run OIAP command ${command.id}.`;
		const content = withFrontmatter(
			{
				name: skillSlug,
				description,
				triggers: ["user"],
				...targetMetadata(command.targetMetadata),
			},
			renderCommandSkillBody(command, invocation, instruction, recipe),
		);

		return textFile(
			`${SKILLS_DIR}/${skillSlug}/SKILL.md`,
			content,
			sourceRef(command.id, "command"),
		);
	});
}

function renderWorkflowsAsSkills(
	ir: PluginIr,
	usedSkillSlugs: Set<string>,
): RenderedFile[] {
	return ir.workflows.map((workflow) => {
		const invocation = workflow.activation.invocation
			? findInvocation(ir.invocations, workflow.activation.invocation.id)
			: undefined;
		const name = invocation ? invocationName(invocation) : workflow.id;
		const skillSlug = reserveSlug(slug(name, workflow.id), usedSkillSlugs);
		const manualOnly =
			workflow.activation.mode === "manual" ||
			workflow.activation.mode === "command";
		const content = withFrontmatter(
			omitUndefined({
				name: skillSlug,
				description:
					invocation?.helpText ??
					workflow.activation.triggers?.[0] ??
					workflow.title,
				triggers: manualOnly ? ["user"] : undefined,
			}),
			renderWorkflowBody(workflow),
		);

		return textFile(
			`${SKILLS_DIR}/${skillSlug}/SKILL.md`,
			content,
			sourceRef(workflow.id, "workflow"),
		);
	});
}

function renderAgents(
	agents: AgentDefinition[],
	instructions: InstructionModule[],
	agentSlugs: Map<string, string>,
): RenderedFile[] {
	return agents.map((agent) => {
		const instruction = findInstruction(instructions, agent.instructions.id);
		const agentSlug = agentSlugs.get(agent.id) ?? slug(agent.id, "agent");
		const frontmatter = omitUndefined({
			name: agentSlug,
			description: agent.description,
			model: agent.model,
			"allowed-tools": agentTools(agent),
			...targetMetadata(agent.targetMetadata),
		});

		return textFile(
			agentPath(agentSlug),
			withFrontmatter(frontmatter, renderAgentBody(agent, instruction)),
			sourceRef(agent.id, "agent"),
		);
	});
}

function reserveAgentSlugs(agents: AgentDefinition[]): Map<string, string> {
	const used = new Set<string>();

	return new Map(
		agents.map((agent) => [
			agent.id,
			reserveSlug(slug(agent.name || agent.id, agent.id), used),
		]),
	);
}

function agentPath(agentSlug: string): string {
	return `${AGENTS_DIR}/${agentSlug}.md`;
}

/**
 * `allowed-tools` restricts a subagent's tools. Author tool lists pass through
 * as host tool names; `access: "read-only"` maps to the documented read tools.
 */
function agentTools(agent: AgentDefinition): string[] | undefined {
	if (agent.tools && agent.tools.length > 0) {
		return agent.tools.map((tool) => tool.id);
	}

	return agent.access === "read-only" ? READ_ONLY_TOOLS : undefined;
}

/** Workspace bundle: resources live under `.windsurf/<plugin slug>/` so they stay out of the project root. */
function resourceRoot(ir: PluginIr): string {
	return `.windsurf/${slug(getManifest(ir).id, "oiap-plugin")}`;
}

function hookBridgePath(ir: PluginIr): string {
	return `.devin/hooks/oiap-${slug(getManifest(ir).id, "oiap-plugin")}.cjs`;
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const hooks = supportedWindsurfHooks(ir.hooks);

	if (hooks.length === 0) {
		return [];
	}

	const bridgePath = hookBridgePath(ir);
	const groups = new Map<string, HookDefinition[]>();

	for (const hook of hooks) {
		const event = HOOK_EVENTS[hook.event];

		if (event) {
			groups.set(event, [...(groups.get(event) ?? []), hook]);
		}
	}

	const config: WindsurfHooksConfig = Object.fromEntries(
		[...groups.entries()].map(([event, grouped]) => {
			const timeoutMs = Math.max(
				0,
				...grouped.map((hook) => hook.timeoutMs ?? 0),
			);

			return [
				event,
				[
					{
						matcher: "",
						hooks: [
							omitUndefined({
								type: "command" as const,
								command: `node "$DEVIN_PROJECT_DIR/${bridgePath}" ${event}`,
								timeout:
									timeoutMs > 0 ? Math.ceil(timeoutMs / 1000) + 1 : undefined,
							}),
						],
					},
				],
			];
		}),
	);
	const descriptors = Object.fromEntries(
		[...groups.entries()].map(([event, grouped]) => [
			event,
			grouped.map(
				(hook): WindsurfHookDescriptor => ({
					id: hook.id,
					event: hook.event,
					match: hook.match,
					failureMode: hook.failureMode,
					optional: hook.optional,
				}),
			),
		]),
	);
	const hookMetadata = hooks.map((hook) =>
		jsonFile(
			`.oiap/hooks/${slug(hook.id, "hook")}.json`,
			omitUndefined({
				id: hook.id,
				event: hook.event,
				windsurfEvent: HOOK_EVENTS[hook.event],
				config: HOOKS_CONFIG_PATH,
				match: hook.match,
				timeoutMs: hook.timeoutMs,
				failureMode: hook.failureMode,
				optional: hook.optional,
			}),
			sourceRef(hook.id, "hook"),
		),
	);
	const runtime = renderHookRuntimeFiles({
		pluginId: getManifest(ir).id,
		target: WINDSURF_TARGET,
		hooks,
		targetEvent: (hook) => HOOK_EVENTS[hook.event],
	});

	return [
		jsonFile(HOOKS_CONFIG_PATH, config, sourceRef("windsurf-hooks", "hook")),
		textFile(
			bridgePath,
			renderHookBridge(descriptors),
			sourceRef("windsurf-hook-bridge", "hook"),
			0o755,
		),
		...hookMetadata,
		...runtime.files,
	];
}

/**
 * Node bridge between Windsurf command hooks and the OIAP runtime. Output
 * follows https://docs.devin.ai/cli/extensibility/hooks/overview.md: exit 2
 * blocks, stdout carries `decision`/`reason` and
 * `hookSpecificOutput.additionalContext`.
 */
function renderHookBridge(
	descriptors: Record<string, WindsurfHookDescriptor[]>,
): string {
	return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");

const hooksByEvent = ${JSON.stringify(descriptors, null, "\t")};
const contextEvents = new Set(["UserPromptSubmit", "SessionStart", "PostToolUse"]);
const bundleRoot = resolve(__dirname, "..", "..");
const manifestPath = join(bundleRoot, ".oiap", "runtime", "manifest.json");
const runnerPath = join(bundleRoot, ".oiap", "runtime", "runner.mjs");

main().catch((error) => {
	const message = error && error.message ? String(error.message) : String(error);
	process.stderr.write("OIAP hook bridge failure: " + message + "\\n");
	process.exitCode = 1;
});

async function main() {
	const event = process.argv[2] || "";
	const payload = await readPayload();
	const hooks = hooksByEvent[event] || [];
	const blocks = [];
	const contexts = [];

	for (const hook of hooks) {
		if (!matchesHook(hook, payload)) {
			continue;
		}

		const result = await runHook(hook, payload);

		switch (result && result.decision) {
			case "block":
				blocks.push(String(result.message || result.reason || "Blocked by OIAP hook " + hook.id + "."));
				break;
			case "inject_context":
				contexts.push(String(result.content || ""));
				break;
			case "ask":
				contexts.push("OIAP hook " + hook.id + " asked for review: " + String(result.message || ""));
				break;
			case "modify":
				contexts.push("OIAP hook " + hook.id + " requested input changes that were not applied: " + JSON.stringify(result.patch || []));
				break;
			case "replace_result":
				contexts.push("OIAP hook " + hook.id + " requested result replacement that was not applied.");
				break;
			case "schedule":
				contexts.push("OIAP hook " + hook.id + " requested scheduled work: " + JSON.stringify(result.job || {}));
				break;
			default:
				break;
		}
	}

	if (blocks.length > 0) {
		const reason = blocks.join("\\n");
		process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\\n");
		process.stderr.write(reason + "\\n");
		process.exitCode = 2;
		return;
	}

	const text = contexts.filter(Boolean).join("\\n\\n");

	if (!text) {
		return;
	}

	if (contextEvents.has(event)) {
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }) + "\\n");
		return;
	}

	process.stderr.write(text + "\\n");
}

function readPayload() {
	return new Promise((resolvePayload) => {
		let input = "";
		process.stdin.on("data", (chunk) => {
			input += chunk.toString();
		});
		process.stdin.on("end", () => {
			if (!input.trim()) {
				resolvePayload({});
				return;
			}

			try {
				resolvePayload(JSON.parse(input));
			} catch {
				resolvePayload({ raw: input });
			}
		});
	});
}

function runHook(hook, payload) {
	return new Promise((resolveHook) => {
		const child = spawn(process.execPath, [
			runnerPath,
			"run-hook",
			"--manifest",
			manifestPath,
			"--target",
			"windsurf",
			"--event",
			hook.event,
			"--hook",
			hook.id,
		], {
			cwd: bundleRoot,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", (error) => {
			resolveHook(failureResult(hook, error && error.message ? String(error.message) : String(error)));
		});
		child.on("close", (exitCode) => {
			const parsed = parseRuntimeResult(stdout);

			if (parsed) {
				resolveHook(parsed);
				return;
			}

			if (exitCode === 0) {
				resolveHook({ decision: "noop" });
				return;
			}

			resolveHook(failureResult(hook, stderr.trim() || stdout.trim() || "OIAP hook " + hook.id + " failed."));
		});

		child.stdin.end(JSON.stringify(payload));
	});
}

function parseRuntimeResult(stdout) {
	const lines = stdout.trim().split(/\\r?\\n/).filter(Boolean).reverse();

	for (const line of lines) {
		try {
			const parsed = JSON.parse(line);

			if (parsed && parsed.result && typeof parsed.result.decision === "string") {
				return parsed.result;
			}
		} catch {
			// Keep scanning older lines.
		}
	}

	return undefined;
}

function failureResult(hook, message) {
	if (hook.optional || hook.failureMode === "fail_open" || hook.failureMode === "log_only") {
		return { decision: "inject_context", content: "OIAP hook " + hook.id + " failed open: " + message };
	}

	if (hook.failureMode === "ask_user") {
		return { decision: "ask", message };
	}

	return { decision: "block", reason: message };
}

function matchesHook(hook, payload) {
	const matcher = hook.match;

	if (!matcher || typeof matcher !== "object" || matcher.kind === "expression") {
		return true;
	}

	if (matcher.tool && matcher.tool.name && matcher.tool.name !== String(payload.tool_name || "")) {
		return false;
	}

	return true;
}
`;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	const mcpTools = tools.filter((tool) => tool.server);

	if (mcpTools.length === 0) {
		return [];
	}

	const usedServerNames = new Set<string>();
	const mcpServers: Record<string, WindsurfMcpServerConfig> = {};

	for (const tool of mcpTools) {
		const server = tool.server;

		if (!server) {
			continue;
		}

		const serverName = reserveSlug(
			slug(tool.id, "mcp-server"),
			usedServerNames,
		);
		const remoteUrl = server.url ?? server.httpUrl;
		const remote = tool.transport !== "mcp-stdio" && Boolean(remoteUrl);

		mcpServers[serverName] = omitUndefined({
			command: remote ? undefined : server.command,
			args: remote ? undefined : server.args,
			env: remote ? undefined : server.env,
			url: remote ? remoteUrl : undefined,
			transport: remote
				? tool.transport === "mcp-sse"
					? ("sse" as const)
					: ("http" as const)
				: undefined,
			headers: remote ? server.headers : undefined,
			disabledTools:
				server.excludeTools && server.excludeTools.length > 0
					? server.excludeTools
					: undefined,
		});
	}

	const config: WindsurfMcpConfig = { mcpServers };

	return [
		jsonFile(MCP_CONFIG_PATH, config, sourceRef("windsurf-mcp", "mcp")),
		jsonFile(
			".oiap/mcp.json",
			{
				target: WINDSURF_TARGET,
				configPath: MCP_CONFIG_PATH,
				servers: mcpTools.map((tool) => ({
					id: tool.id,
					transport: tool.transport,
					toolNames: tool.tools.map((definition) => definition.name),
					unsupportedOptions: unsupportedMcpOptions(tool),
				})),
			},
			sourceRef("oiap-mcp", "mcp"),
		),
	];
}

function renderPolicyEvidence(policies: PermissionPolicy[]): RenderedFile[] {
	if (policies.length === 0) {
		return [];
	}

	return [
		jsonFile(
			".oiap/policy.json",
			{
				target: WINDSURF_TARGET,
				note: "Windsurf permission controls do not map one-to-one with OIAP. Review these policies before installing the generated bundle.",
				policies,
			},
			sourceRef("oiap-policy", "policy"),
		),
	];
}

function renderRuntimeModules(runtimeModules: RuntimeModule[]): RenderedFile[] {
	const modules = runtimeModules.filter(
		(runtimeModule) => runtimeModule.target === WINDSURF_TARGET,
	);

	if (modules.length === 0) {
		return [];
	}

	return [
		jsonFile(
			".oiap/runtime-modules.json",
			{ target: WINDSURF_TARGET, modules },
			sourceRef("oiap-runtime-modules", "runtime"),
		),
	];
}

function renderPackageReadme(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const lines = [
		`# ${manifest.name}`,
		"",
		manifest.description,
		"",
		"Generated Windsurf (Devin Desktop) workspace bundle from an OIAP plugin definition.",
		"Copy `.windsurf/` and `.devin/` into the workspace root to activate it.",
		"",
		"## Generated Surfaces",
		"",
		...(hasRuleOutput(ir) ? [`- \`${RULES_DIR}/\` workspace rules`] : []),
		...(hasSkillOutput(ir)
			? [
					`- \`${SKILLS_DIR}/\` Agent Skills; commands are user-only skills invoked as \`/name\``,
				]
			: []),
		...(ir.agents.length > 0 ? [`- \`${AGENTS_DIR}/\` custom subagents`] : []),
		...(supportedWindsurfHooks(ir.hooks).length > 0
			? [
					`- \`${HOOKS_CONFIG_PATH}\` command hooks backed by \`.oiap/runtime/\``,
				]
			: []),
		...(hasMcpOutput(ir.tools)
			? [`- \`${MCP_CONFIG_PATH}\` project MCP servers`]
			: []),
		...(ir.policies.length > 0
			? ["- `.oiap/policy.json` policy evidence"]
			: []),
		...((ir.resources ?? []).length > 0
			? [`- \`${resourceRoot(ir)}/\` plugin resources`]
			: []),
		"",
		"See `.oiap/capability-report.json` for fidelity details and degradations.",
		"",
	];

	return textFile(
		".oiap/README.md",
		lines.join("\n"),
		sourceRef(manifest.id, "manifest"),
	);
}

function createBundleManifest(ir: PluginIr, files: RenderedFile[]): unknown {
	const manifest = getManifest(ir);

	return {
		id: manifest.id,
		name: manifest.name,
		version: manifest.version,
		description: manifest.description,
		target: WINDSURF_TARGET,
		format: "directory",
		files: files.map((file) => file.path).sort(),
		capabilityReport: ".oiap/capability-report.json",
		sourceMap: ".oiap/source-map.json",
	};
}

function createSourceMap(files: RenderedFile[]): WindsurfSourceMap {
	return {
		target: WINDSURF_TARGET,
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

const BUNDLE_FILE_SUPPORT = {
	target: WINDSURF_TARGET,
	files: true,
	rootVariable: false,
};

function createExportReport(ir: PluginIr): ExportReport {
	const unsupportedCapabilities = collectUnsupportedCapabilities(ir);
	const degradedCapabilities = collectDegradedCapabilities(ir);
	const hasRequiredUnsupported = unsupportedCapabilities.some(
		(capability) => capability.required,
	);

	return {
		target: WINDSURF_TARGET,
		status: hasRequiredUnsupported
			? "unsupported"
			: unsupportedCapabilities.length > 0 || degradedCapabilities.length > 0
				? "degraded"
				: "ok",
		mappedCapabilities: collectMappedCapabilities(ir),
		degradedCapabilities,
		unsupportedCapabilities,
		issues: bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const mapped: HostCapability[] = [
		{
			kind: "package",
			target: WINDSURF_TARGET,
			reason: ".oiap target manifest",
		},
	];

	if (hasRuleOutput(ir)) {
		mapped.push({ kind: "rules", target: WINDSURF_TARGET });
	}

	if (ir.skills.length > 0) {
		mapped.push({ kind: "skills", target: WINDSURF_TARGET });
	}

	if (ir.commands.length > 0 || ir.workflows.length > 0) {
		mapped.push({ kind: "commands", target: WINDSURF_TARGET });
	}

	if (supportedWindsurfHooks(ir.hooks).length > 0) {
		mapped.push({ kind: "hooks", target: WINDSURF_TARGET });
		mapped.push({ kind: "runtime", target: WINDSURF_TARGET });
	}

	if (ir.agents.length > 0) {
		mapped.push({ kind: "agents", target: WINDSURF_TARGET });
	}

	if (hasMcpOutput(ir.tools)) {
		mapped.push({ kind: "mcp", target: WINDSURF_TARGET });
	}

	if (ir.policies.length > 0) {
		mapped.push({ kind: "policy", target: WINDSURF_TARGET });
	}

	return mapped;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degraded: CapabilityDegradation[] = [
		...bundleFileFindings(ir, BUNDLE_FILE_SUPPORT).degradations,
	];
	const supportedHooks = supportedWindsurfHooks(ir.hooks);
	const unsupportedHookEvents = ir.hooks.filter(
		(hook) => !HOOK_EVENTS[hook.event],
	);
	const nonPortableHookIds = unsupportedHookIds(supportedHooks);

	if (ir.commands.length > 0 || ir.workflows.length > 0) {
		degraded.push({
			capability: { kind: "commands", target: WINDSURF_TARGET },
			from: "OIAP commands and workflows",
			to: "user-invocable Windsurf skills",
			reason:
				"Cascade workflows are not supported by Devin Local and the docs recommend migrating them to skills, so commands are emitted as skills with triggers: [user] and invoked as /name.",
		});
	}

	if (supportedHooks.length > 0) {
		degraded.push({
			capability: { kind: "hooks", target: WINDSURF_TARGET },
			from: "full OIAP HookResult decisions",
			to: ".devin/hooks.v1.json command hook output",
			reason:
				"Windsurf command hooks support block (exit 2) and additionalContext on UserPromptSubmit, SessionStart and PostToolUse; ask, modify, replace_result and schedule are preserved as advisory text. Hooks use the Devin Local format because the legacy Cascade .windsurf/hooks.json events are no longer documented.",
		});
	}

	if (unsupportedHookEvents.length > 0) {
		degraded.push({
			capability: { kind: "hooks", target: WINDSURF_TARGET },
			from: unsupportedHookEvents.map((hook) => hook.event).join(", "),
			to: "no generated Windsurf hook",
			reason:
				"Windsurf hooks document no equivalent for OIAP before_agent and after_agent events.",
		});
	}

	if (nonPortableHookIds.length > 0) {
		degraded.push({
			capability: { kind: "runtime", target: WINDSURF_TARGET },
			from: nonPortableHookIds.join(", "),
			to: "runtime manifest metadata",
			reason:
				"Target-module hook handlers are recorded but cannot be bundled by the generated JavaScript runtime.",
		});
	}

	if (ir.agents.length > 0) {
		degraded.push({
			capability: { kind: "agents", target: WINDSURF_TARGET },
			from: "OIAP agents",
			to: ".devin/agents subagent profiles",
			reason:
				"Custom subagent files are documented for Devin CLI; Devin Desktop gates subagents behind a preview setting and does not document reading these files.",
		});
	}

	if (hasMcpGaps(ir.tools)) {
		degraded.push({
			capability: { kind: "mcp", target: WINDSURF_TARGET },
			from: "OIAP MCP server options",
			to: `${MCP_CONFIG_PATH} mcpServers entries`,
			reason:
				"Windsurf MCP config documents disabledTools but not cwd, includeTools, required, or non-header auth policies.",
		});
	}

	if (ir.policies.length > 0) {
		degraded.push({
			capability: { kind: "policy", target: WINDSURF_TARGET },
			from: "OIAP permission policy",
			to: ".oiap/policy.json evidence",
			reason:
				"Windsurf documents no project policy file equivalent to OIAP policies; they require user review.",
		});
	}

	if (ir.runtimeModules.some((module) => module.target === WINDSURF_TARGET)) {
		degraded.push({
			capability: { kind: "runtime", target: WINDSURF_TARGET },
			from: "generated-runtime-module",
			to: "runtime-module-manifest",
			reason:
				"Windsurf documents no runtime plugin adapters, so runtime modules are recorded but not generated.",
		});
	}

	return degraded;
}

function collectUnsupportedCapabilities(ir: PluginIr): UnsupportedCapability[] {
	const manifest = getManifest(ir);
	const declared = [
		...(manifest.requiredCapabilities ?? []).map((capability) => ({
			capability,
			required: true,
		})),
		...(manifest.optionalCapabilities ?? []).map((capability) => ({
			capability,
			required: false,
		})),
	];

	return declared
		.filter(
			(entry) =>
				entry.capability.target && entry.capability.target !== WINDSURF_TARGET,
		)
		.map((entry) => ({
			capability: entry.capability,
			required: entry.required,
			reason: `Capability is scoped to target ${entry.capability.target}.`,
		}));
}

function validateWindsurfBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [
		...duplicateFileIssues(bundle.files),
		...unresolvedTokenIssues(bundle.files),
	];

	if (bundle.target !== WINDSURF_TARGET) {
		issues.push({
			severity: "error",
			code: "windsurf-target-mismatch",
			message: `Expected target ${WINDSURF_TARGET}, received ${bundle.target}.`,
		});
	}

	if (!bundle.files.some((file) => file.path === MANIFEST_PATH)) {
		issues.push({
			severity: "error",
			code: "windsurf-missing-target-manifest",
			message: `Windsurf bundle is missing ${MANIFEST_PATH}.`,
		});
	}

	for (const file of bundle.files) {
		if (file.path.endsWith(".json") && typeof file.content === "string") {
			try {
				JSON.parse(file.content);
			} catch {
				issues.push({
					severity: "error",
					code: "windsurf-invalid-json",
					message: `Generated JSON file is invalid: ${file.path}.`,
					path: file.path,
				});
			}
		}
	}

	const mcpFile = bundle.files.find((file) => file.path === MCP_CONFIG_PATH);

	if (mcpFile && typeof mcpFile.content === "string") {
		const parsed = safeJson(mcpFile.content) as Partial<WindsurfMcpConfig>;

		if (!parsed?.mcpServers || typeof parsed.mcpServers !== "object") {
			issues.push({
				severity: "error",
				code: "windsurf-invalid-mcp",
				message: `${MCP_CONFIG_PATH} must contain a top-level mcpServers object.`,
				path: mcpFile.path,
			});
		}
	}

	return issues;
}

function safeJson(content: string): unknown {
	try {
		return JSON.parse(content);
	} catch {
		return undefined;
	}
}

function supportedWindsurfHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(HOOK_EVENTS[hook.event]));
}

function windsurfTrigger(activation: ProjectRule["activation"]): string {
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

function renderSkillBody(
	skill: SkillAsset,
	instruction: InstructionModule | undefined,
): string {
	const sections = [
		`# ${skill.name}`,
		"",
		skill.description,
		"",
		nonEmptyBody(targetInstructionBody(instruction), skill.id),
	];

	if (skill.assets && skill.assets.length > 0) {
		sections.push(
			"",
			"## Assets",
			"",
			...skill.assets.map((asset) => `- ${asset.path ?? asset.id}`),
		);
	}

	return sections.join("\n").trim();
}

function renderCommandSkillBody(
	command: CommandAsset,
	invocation: Invocation | undefined,
	instruction: InstructionModule | undefined,
	recipe: PluginIr["recipes"][number] | undefined,
): string {
	const prompt =
		stringMetadata(command.targetMetadata?.[WINDSURF_TARGET], "prompt") ??
		targetInstructionBody(instruction);
	const lines = [
		`# ${commandNameForWindsurf(command, invocation)}`,
		"",
		invocation?.helpText ?? `Run OIAP command ${command.id}.`,
		"",
		nonEmptyBody(prompt, command.id),
	];

	if (recipe) {
		lines.push("", "## Command Recipe", "", recipe.intent);

		for (const [dialect, commandLine] of Object.entries(recipe.dialects)) {
			lines.push(`- ${dialect}: \`${commandLine}\``);
		}
	}

	if (invocation?.examples.length) {
		lines.push(
			"",
			"## Examples",
			"",
			...invocation.examples.map((example) => `- ${example}`),
		);
	}

	return lines.join("\n").trim();
}

function renderWorkflowBody(workflow: Workflow): string {
	return [
		`# ${workflow.title}`,
		"",
		"## Steps",
		"",
		...workflow.steps.map(
			(step, index) => `${index + 1}. ${describeWorkflowStep(step)}`,
		),
		"",
		`Failure policy: ${workflow.failurePolicy.mode}`,
	].join("\n");
}

function describeWorkflowStep(step: WorkflowStep): string {
	switch (step.kind) {
		case "run_command":
			return `Run command recipe \`${step.recipe.id}\`.`;
		case "read_file":
			return `Read \`${step.path}\`.`;
		case "write_file":
			return `Write \`${step.path}\`.`;
		case "patch_file":
			return `Patch \`${step.path}\`.`;
		case "spawn_workers":
			return `Spawn workers using strategy \`${step.strategy.id}\`.`;
		case "call_tool":
			return `Call tool \`${step.tool.id}\`.`;
		case "start_mcp_server":
			return `Start MCP server \`${step.server.id}\`.`;
		case "ask_user":
			return `Ask the user: ${step.prompt}`;
		case "conditional":
			return `If \`${step.condition}\`: ${step.then.map(describeWorkflowStep).join(" ")}${
				step.otherwise && step.otherwise.length > 0
					? ` Otherwise: ${step.otherwise.map(describeWorkflowStep).join(" ")}`
					: ""
			}`;
	}
}

function renderAgentBody(
	agent: AgentDefinition,
	instruction: InstructionModule | undefined,
): string {
	const lines = [
		`# ${agent.name}`,
		"",
		agent.description,
		"",
		nonEmptyBody(targetInstructionBody(instruction), agent.id),
	];

	if (agent.delegation) {
		lines.push("", "## OIAP Delegation", "", `- ${agent.delegation.id}`);
	}

	return lines.join("\n").trim();
}

function commandNameForWindsurf(
	command: CommandAsset,
	invocation: Invocation | undefined,
): string {
	return (
		stringMetadata(command.targetMetadata?.[WINDSURF_TARGET], "name") ??
		(invocation ? invocationName(invocation) : command.id)
	);
}

function invocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[WINDSURF_TARGET] ?? invocation.canonical;
}

function standaloneInstructions(ir: PluginIr): InstructionModule[] {
	const consumed = new Set<string>([
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
	]);

	return ir.instructions.filter(
		(instruction) =>
			!consumed.has(instruction.id) &&
			(instruction.purpose === "always_on" ||
				instruction.purpose === "safety" ||
				instruction.purpose === "workflow"),
	);
}

function normalizeWindsurfRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);

	if (cleanPath === "AGENTS.md" || cleanPath.endsWith("/AGENTS.md")) {
		return cleanPath;
	}

	if (cleanPath.startsWith(`${RULES_DIR}/`)) {
		return ensureMarkdownPath(cleanPath);
	}

	return `${RULES_DIR}/${ensureMarkdownPath(fileBaseName(cleanPath) || slug(rule.id, "rule"))}`;
}

function hasRuleOutput(ir: PluginIr): boolean {
	return (
		ir.rules.some((rule) => rule.target === WINDSURF_TARGET) ||
		standaloneInstructions(ir).length > 0
	);
}

function hasSkillOutput(ir: PluginIr): boolean {
	return (
		ir.skills.length > 0 || ir.commands.length > 0 || ir.workflows.length > 0
	);
}

function hasMcpOutput(tools: ToolSurface[]): boolean {
	return tools.some((tool) => tool.server);
}

function hasMcpGaps(tools: ToolSurface[]): boolean {
	return tools.some((tool) => unsupportedMcpOptions(tool).length > 0);
}

function unsupportedMcpOptions(tool: ToolSurface): string[] {
	const server = tool.server;

	if (!server) {
		return [];
	}

	const unsupported: string[] = [];

	if (server.cwd) {
		unsupported.push("cwd");
	}

	if (server.includeTools && server.includeTools.length > 0) {
		unsupported.push("includeTools");
	}

	if (server.auth && server.auth.mode !== "none") {
		unsupported.push("auth");
	}

	if (server.required !== undefined) {
		unsupported.push("required");
	}

	return unsupported;
}

function targetInstructionBody(
	instruction: InstructionModule | undefined,
): string {
	if (!instruction) {
		return "";
	}

	return instruction.hostOverrides?.[WINDSURF_TARGET] ?? instruction.body;
}

function findInstruction(
	instructions: InstructionModule[],
	id: string,
): InstructionModule | undefined {
	return instructions.find((instruction) => instruction.id === id);
}

function findInvocation(
	invocations: Invocation[],
	id: string,
): Invocation | undefined {
	return invocations.find((invocation) => invocation.id === id);
}

function targetMetadata(
	metadata: Partial<Record<string, Record<string, unknown>>> | undefined,
): Record<string, unknown> {
	return metadata?.[WINDSURF_TARGET] ?? {};
}

function stringMetadata(
	metadata: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	const value = metadata?.[key];
	return typeof value === "string" && value.trim() ? value : undefined;
}

function nonEmptyBody(body: string, fallbackId: string): string {
	const trimmed = body.trim();
	return trimmed || `OIAP source ${fallbackId} did not provide body content.`;
}

function withFrontmatter(
	frontmatter: Record<string, unknown>,
	body: string,
): string {
	const yaml = Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined && value !== null)
		.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
		.join("\n");

	return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

function jsonFile(
	path: string,
	value: unknown,
	source?: SourceRef,
): RenderedFile {
	return textFile(path, `${JSON.stringify(value, null, "\t")}\n`, source);
}

function textFile(
	path: string,
	content: string,
	source?: SourceRef,
	mode?: number,
): RenderedFile {
	return { path, content, source, mode };
}

function sourceRef(
	primitiveId: string,
	primitiveKind: string,
	path?: string,
): SourceRef {
	return { primitiveId, primitiveKind, path };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}

function getManifest(ir: PluginIr): NonNullable<PluginIr["manifest"]> {
	return (
		ir.manifest ?? {
			id: "oiap-plugin",
			name: "OIAP Plugin",
			version: "0.0.0",
			description: "Generated OIAP plugin bundle.",
			categories: [],
			supportedTargets: [WINDSURF_TARGET],
		}
	);
}

function slug(value: string, fallback: string): string {
	const normalized = value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");

	return normalized || fallback;
}

function reserveSlug(value: string, used: Set<string>): string {
	let candidate = value;
	let suffix = 2;

	while (used.has(candidate)) {
		candidate = `${value}-${suffix}`;
		suffix += 1;
	}

	used.add(candidate);
	return candidate;
}

function reservePath(path: string, used: Set<string>): string {
	let candidate = path;
	let suffix = 2;

	while (used.has(candidate)) {
		const extensionIndex = path.lastIndexOf(".");
		candidate =
			extensionIndex <= path.lastIndexOf("/")
				? `${path}-${suffix}`
				: `${path.slice(0, extensionIndex)}-${suffix}${path.slice(extensionIndex)}`;
		suffix += 1;
	}

	used.add(candidate);
	return candidate;
}

function ensureMarkdownPath(path: string): string {
	return /\.md$/i.test(path) ? path : `${path}.md`;
}

function fileBaseName(path: string): string {
	const last = path.split("/").filter(Boolean).at(-1) ?? "";
	return last.replace(/\.[^.]+$/, "");
}

function sanitizeRelativePath(path: string): string {
	return path
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.split("/")
		.filter((segment) => segment && segment !== "." && segment !== "..")
		.join("/");
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
	) as T;
}
