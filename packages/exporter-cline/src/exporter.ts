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
import { renderHookRuntimeFiles, unsupportedHookIds } from "@oiap/runtime";
import { CLINE_TARGET, clineProfile } from "./profile";

export type ClinePluginInput = PluginDefinition | PluginIr;

export interface ClineSourceMap {
	target: typeof CLINE_TARGET;
	entries: ClineSourceMapEntry[];
}

export interface ClineSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

interface ClineMcpConfig {
	mcpServers: Record<string, ClineMcpServerConfig>;
}

interface ClineMcpServerConfig {
	command?: string;
	args?: string[];
	url?: string;
	env?: Record<string, string>;
	headers?: Record<string, string>;
	disabled?: boolean;
	autoApprove?: string[];
}

interface ClineHookDescriptor {
	id: string;
	event: HookDefinition["event"];
	clineEvent: string;
	match?: HookDefinition["match"];
	failureMode?: HookDefinition["failureMode"];
	optional?: boolean;
}

export const clineExporter = defineExporter({
	target: CLINE_TARGET,
	profile: clineProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderClineFiles(ir);
		const report = createExportReport(ir);

		return {
			target: CLINE_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: CLINE_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "cline-project-bundle",
				target: CLINE_TARGET,
				manifestPath: ".oiap/cline-target.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateClineBundle(bundle);
	},
});

export function exportCline(plugin: ClinePluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = clineExporter.lower(ir);
	const bundle = clineExporter.render(graph);
	const validationIssues = clineExporter.validate(bundle);

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

function normalizePluginInput(plugin: ClinePluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: ClinePluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderClineFiles(ir: PluginIr): RenderedFile[] {
	const usedRulePaths = new Set<string>();
	const usedSkillSlugs = new Set<string>();
	const usedAgentSlugs = new Set<string>();
	const report = createExportReport(ir);
	const pluginFiles = [
		renderTargetManifest(ir),
		...renderProjectRuleFiles(ir.rules, usedRulePaths),
		...renderInstructionRules(ir, usedRulePaths),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandsAsSkills(ir, usedSkillSlugs),
		...renderAgents(ir.agents, ir.instructions, usedAgentSlugs),
		...renderHookFiles(ir),
		...renderMcpFiles(ir.tools),
		...renderPolicyEvidence(ir.policies),
		...renderRuntimeModules(ir.runtimeModules),
		renderPackageReadme(ir),
	];
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
		target: CLINE_TARGET,
		rules: hasRuleOutput(ir) ? ".clinerules/" : undefined,
		skills: hasSkillOutput(ir) ? ".cline/skills/" : undefined,
		commands: ir.commands.length > 0 ? ".cline/skills/" : undefined,
		agents: ir.agents.length > 0 ? ".cline/agents/" : undefined,
		hooks:
			supportedClineHooks(ir.hooks).length > 0 ? ".cline/hooks/" : undefined,
		mcp: hasMcpOutput(ir.tools) ? ".cline/mcp.json" : undefined,
		policies: ir.policies.length > 0 ? ".oiap/policy.json" : undefined,
	});

	return jsonFile(
		".oiap/cline-target.json",
		content,
		sourceRef(manifest.id, "manifest"),
	);
}

function renderProjectRuleFiles(
	rules: ProjectRule[],
	usedRulePaths: Set<string>,
): RenderedFile[] {
	return rules
		.filter((rule) => rule.target === CLINE_TARGET)
		.map((rule) => {
			const path = reservePath(normalizeClineRulePath(rule), usedRulePaths);
			const frontmatter = omitUndefined({
				name: rule.description ? slug(rule.description, rule.id) : undefined,
				description: rule.description,
				paths:
					(rule.activation === "pattern" || rule.activation === "glob") &&
					rule.globs &&
					rule.globs.length > 0
						? rule.globs
						: undefined,
				...rule.frontmatter,
			});

			return textFile(
				path,
				withFrontmatter(frontmatter, nonEmptyBody(rule.content, rule.id)),
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
			`.clinerules/${slug(instruction.id, "instruction")}.md`,
			usedRulePaths,
		);
		const content = withFrontmatter(
			{
				name: slug(instruction.id, "instruction"),
				purpose: instruction.purpose,
				triggers:
					instruction.triggers.length > 0 ? instruction.triggers : undefined,
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
	return skills.map((skill) => {
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

		return textFile(
			`.cline/skills/${skillSlug}/SKILL.md`,
			content,
			sourceRef(skill.id, "skill"),
		);
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
		const commandName = commandNameForCline(command, invocation);
		const skillSlug = reserveSlug(
			slug(commandName, command.id),
			usedSkillSlugs,
		);
		const description =
			stringMetadata(command.targetMetadata?.[CLINE_TARGET], "description") ??
			invocation?.helpText ??
			`Run OIAP command ${command.id}.`;
		const content = withFrontmatter(
			{
				name: skillSlug,
				description,
				"oiap-kind": "command",
				"oiap-command-id": command.id,
				...targetMetadata(command.targetMetadata),
			},
			renderCommandSkillBody(command, invocation, instruction),
		);

		return textFile(
			`.cline/skills/${skillSlug}/SKILL.md`,
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
		const instruction = findInstruction(instructions, agent.instructions.id);
		const agentSlug = reserveSlug(
			slug(agent.name || agent.id, agent.id),
			usedAgentSlugs,
		);
		const frontmatter = omitUndefined({
			name: agentSlug,
			description: agent.description,
			modelId: agent.model,
		});
		const content = withFrontmatter(
			frontmatter,
			renderAgentBody(agent, instruction),
		);

		return textFile(
			`.cline/agents/${agentSlug}.yaml`,
			content,
			sourceRef(agent.id, "agent"),
		);
	});
}

function renderHookFiles(ir: PluginIr): RenderedFile[] {
	const hooks = supportedClineHooks(ir.hooks);

	if (hooks.length === 0) {
		return [];
	}

	const hookGroups = new Map<string, HookDefinition[]>();

	for (const hook of hooks) {
		const hookFile = toClineHookFile(hook.event);

		if (!hookFile) {
			continue;
		}

		const groupedHooks = hookGroups.get(hookFile) ?? [];
		groupedHooks.push(hook);
		hookGroups.set(hookFile, groupedHooks);
	}

	const scriptFiles = [...hookGroups.entries()].map(
		([hookFile, groupedHooks]) =>
			textFile(
				`.cline/hooks/${hookFile}.cjs`,
				renderClineHookScript(hookFile, groupedHooks),
				sourceRef(`cline-hook-${hookFile}`, "hook"),
				0o755,
			),
	);
	const hookMetadata = hooks.map((hook) =>
		jsonFile(
			`.oiap/hooks/${slug(hook.id, "hook")}.json`,
			omitUndefined({
				id: hook.id,
				event: hook.event,
				clineEvent: toClineHookEvent(hook.event),
				clineHookFile: toClineHookFile(hook.event),
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
		target: CLINE_TARGET,
		hooks,
		targetEvent: (hook) => toClineHookEvent(hook.event),
	});

	return [...scriptFiles, ...hookMetadata, ...runtime.files];
}

function renderClineHookScript(
	hookFile: string,
	hooks: HookDefinition[],
): string {
	const descriptors: ClineHookDescriptor[] = hooks.map((hook) => ({
		id: hook.id,
		event: hook.event,
		clineEvent: toClineHookEvent(hook.event) ?? hookFile,
		match: hook.match,
		failureMode: hook.failureMode,
		optional: hook.optional,
	}));

	return `#!/usr/bin/env node
const { spawn } = require("node:child_process");
const { join, resolve } = require("node:path");

const hooks = ${JSON.stringify(descriptors, null, "\t")};
const pluginRoot = resolve(__dirname, "..", "..");
const manifestPath = join(pluginRoot, ".oiap", "runtime", "manifest.json");
const runnerPath = join(pluginRoot, ".oiap", "runtime", "runner.mjs");

main().catch((error) => {
	const message = error && error.message ? String(error.message) : String(error);
	console.log(JSON.stringify({ errorMessage: message, context: "OIAP hook bridge failure: " + message }));
	process.exitCode = 0;
});

async function main() {
	const payload = await readPayload();
	const controls = [];

	for (const hook of hooks) {
		if (!matchesHook(hook, payload)) {
			continue;
		}

		const result = await runHook(hook, payload);
		const control = toClineControl(result);

		if (control) {
			controls.push(control);
		}
	}

	console.log(JSON.stringify(mergeControls(controls)));
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
			"cline",
			"--event",
			hook.event,
			"--hook",
			hook.id,
		], {
			cwd: pluginRoot,
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

	if (!matcher || typeof matcher !== "object") {
		return true;
	}

	if (matcher.kind === "expression") {
		return true;
	}

	if (matcher.tool && matcher.tool.name && matcher.tool.name !== toolName(payload)) {
		return false;
	}

	if (matcher.permission && matcher.permission !== permissionName(payload)) {
		return false;
	}

	if (matcher.agentName && matcher.agentName !== agentName(payload)) {
		return false;
	}

	return true;
}

function toolName(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	const tool = source.tool || source.toolCall || source.tool_call;

	if (tool && typeof tool === "object" && typeof tool.name === "string") {
		return tool.name;
	}

	return String(source.toolName || source.tool_name || source.name || "");
}

function permissionName(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	return String(source.permission || source.name || "");
}

function agentName(payload) {
	const source = payload && typeof payload === "object" ? payload : {};
	const agent = source.agent;

	if (agent && typeof agent === "object" && typeof agent.name === "string") {
		return agent.name;
	}

	return String(source.agentName || source.agent_name || "");
}

function toClineControl(result) {
	if (!result || typeof result !== "object") {
		return undefined;
	}

	switch (result.decision) {
		case "allow":
		case "noop":
			return undefined;
		case "block":
			return {
				cancel: true,
				errorMessage: String(result.message || result.reason || "Blocked by OIAP hook."),
				context: String(result.message || result.reason || "Blocked by OIAP hook."),
			};
		case "ask":
			return { review: true, context: String(result.message || "Review requested by OIAP hook.") };
		case "inject_context":
			return { context: String(result.content || "") };
		case "modify":
			return { context: "OIAP hook requested input modification that Cline file hooks cannot apply automatically: " + JSON.stringify(result.patch || []) };
		case "replace_result":
			return { context: "OIAP hook requested result replacement; Cline file hooks preserve this as advisory context." };
		case "schedule":
			return { context: "OIAP hook requested scheduled work: " + JSON.stringify(result.job || {}) };
		default:
			return { context: "OIAP hook returned unsupported decision: " + String(result.decision) };
	}
}

function mergeControls(controls) {
	const merged = {};
	const contexts = [];

	for (const control of controls) {
		if (control.cancel) {
			merged.cancel = true;
		}

		if (control.review) {
			merged.review = true;
		}

		if (control.errorMessage) {
			merged.errorMessage = control.errorMessage;
		}

		if (control.overrideInput) {
			merged.overrideInput = control.overrideInput;
		}

		if (control.context) {
			contexts.push(control.context);
		}
	}

	if (contexts.length > 0) {
		merged.context = contexts.join("\\n\\n");
	}

	return merged;
}
`;
}

function renderMcpFiles(tools: ToolSurface[]): RenderedFile[] {
	const mcpTools = tools.filter((tool) => tool.server);

	if (mcpTools.length === 0) {
		return [];
	}

	const usedServerNames = new Set<string>();
	const mcpServers: Record<string, ClineMcpServerConfig> = {};

	for (const tool of mcpTools) {
		if (!tool.server) {
			continue;
		}

		const serverName = reserveSlug(
			slug(tool.id, "mcp-server"),
			usedServerNames,
		);
		mcpServers[serverName] = omitUndefined({
			command: tool.server.command,
			args: tool.server.args,
			url: tool.server.url ?? tool.server.httpUrl,
			env: tool.server.env,
			headers: tool.server.headers,
			disabled: false,
			autoApprove: [],
		});
	}

	const clineConfig: ClineMcpConfig = { mcpServers };

	return [
		jsonFile(".cline/mcp.json", clineConfig, sourceRef("cline-mcp", "mcp")),
		jsonFile(
			".oiap/mcp.json",
			{
				target: CLINE_TARGET,
				configPath: ".cline/mcp.json",
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
				target: CLINE_TARGET,
				note: "Cline policy controls do not map one-to-one with OIAP. Review these policies before installing the generated bundle.",
				policies,
			},
			sourceRef("oiap-policy", "policy"),
		),
	];
}

function renderRuntimeModules(runtimeModules: RuntimeModule[]): RenderedFile[] {
	const clineModules = runtimeModules.filter(
		(runtimeModule) => runtimeModule.target === CLINE_TARGET,
	);

	if (clineModules.length === 0) {
		return [];
	}

	return [
		jsonFile(
			".oiap/runtime-modules.json",
			{
				target: CLINE_TARGET,
				modules: clineModules,
			},
			sourceRef("oiap-runtime-modules", "runtime"),
		),
	];
}

function renderPackageReadme(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const lines = [
		`# ${manifest.name}`,
		"",
		"Generated Cline target bundle from an OIAP plugin definition.",
		"",
		"## Generated Surfaces",
		"",
		...(hasRuleOutput(ir) ? ["- `.clinerules/` project rules"] : []),
		...(hasSkillOutput(ir) ? ["- `.cline/skills/` project skills"] : []),
		...(ir.agents.length > 0 ? ["- `.cline/agents/` project agents"] : []),
		...(supportedClineHooks(ir.hooks).length > 0
			? ["- `.cline/hooks/` file hooks backed by `.oiap/runtime/`"]
			: []),
		...(hasMcpOutput(ir.tools)
			? ["- `.cline/mcp.json` MCP server config"]
			: []),
		...(ir.policies.length > 0
			? ["- `.oiap/policy.json` policy evidence"]
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
		target: CLINE_TARGET,
		format: "directory",
		files: files.map((file) => file.path).sort(),
		capabilityReport: ".oiap/capability-report.json",
		sourceMap: ".oiap/source-map.json",
	};
}

function createSourceMap(files: RenderedFile[]): ClineSourceMap {
	return {
		target: CLINE_TARGET,
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

function createExportReport(ir: PluginIr): ExportReport {
	const unsupportedCapabilities = collectUnsupportedCapabilities(ir);
	const degradedCapabilities = collectDegradedCapabilities(ir);
	const hasRequiredUnsupported = unsupportedCapabilities.some(
		(capability) => capability.required,
	);

	return {
		target: CLINE_TARGET,
		status: hasRequiredUnsupported
			? "unsupported"
			: unsupportedCapabilities.length > 0 || degradedCapabilities.length > 0
				? "degraded"
				: "ok",
		mappedCapabilities: collectMappedCapabilities(ir),
		degradedCapabilities,
		unsupportedCapabilities,
		issues: [],
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const mapped: HostCapability[] = [
		{ kind: "package", target: CLINE_TARGET, reason: ".oiap target manifest" },
	];

	if (hasRuleOutput(ir)) {
		mapped.push({ kind: "rules", target: CLINE_TARGET });
	}

	if (hasSkillOutput(ir)) {
		mapped.push({ kind: "skills", target: CLINE_TARGET });
	}

	if (ir.commands.length > 0) {
		mapped.push({ kind: "commands", target: CLINE_TARGET });
	}

	if (supportedClineHooks(ir.hooks).length > 0) {
		mapped.push({ kind: "hooks", target: CLINE_TARGET });
		mapped.push({ kind: "runtime", target: CLINE_TARGET });
	}

	if (ir.agents.length > 0) {
		mapped.push({ kind: "agents", target: CLINE_TARGET });
	}

	if (hasMcpOutput(ir.tools)) {
		mapped.push({ kind: "mcp", target: CLINE_TARGET });
	}

	if (ir.policies.length > 0) {
		mapped.push({ kind: "policy", target: CLINE_TARGET });
	}

	return mapped;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degraded: CapabilityDegradation[] = [];
	const supportedHooks = supportedClineHooks(ir.hooks);
	const unsupportedHookEvents = ir.hooks.filter(
		(hook) => !toClineHookEvent(hook.event),
	);
	const nonPortableHookIds = unsupportedHookIds(supportedHooks);

	if (ir.commands.length > 0) {
		degraded.push({
			capability: { kind: "commands", target: CLINE_TARGET },
			from: "OIAP command assets",
			to: "Cline project skills",
			reason:
				"Cline exposes custom slash invocation through enabled skills rather than a separate project command file format.",
		});
	}

	if (supportedHooks.length > 0) {
		degraded.push({
			capability: { kind: "hooks", target: CLINE_TARGET },
			from: "full OIAP HookResult decisions",
			to: "Cline file hook control fields",
			reason:
				"Cline file hooks support cancel, review, context, and input override controls; unsupported decisions are preserved as advisory context.",
		});
	}

	if (unsupportedHookEvents.length > 0) {
		degraded.push({
			capability: { kind: "hooks", target: CLINE_TARGET },
			from: unsupportedHookEvents.map((hook) => hook.event).join(", "),
			to: "no generated Cline hook file",
			reason:
				"Cline file hooks do not expose equivalent events for every OIAP lifecycle hook.",
		});
	}

	if (nonPortableHookIds.length > 0) {
		degraded.push({
			capability: { kind: "runtime", target: CLINE_TARGET },
			from: nonPortableHookIds.join(", "),
			to: "runtime manifest metadata",
			reason:
				"Target-module hook handlers are recorded but cannot be bundled by the generated JavaScript runtime.",
		});
	}

	if (ir.agents.some((agent) => agent.tools && agent.tools.length > 0)) {
		degraded.push({
			capability: { kind: "agents", target: CLINE_TARGET },
			from: "OIAP agent tool references",
			to: "agent body metadata",
			reason:
				"Cline validates agent tool ids against its built-in tool catalog, so OIAP tool refs are not emitted as active tool frontmatter.",
		});
	}

	if (hasMcpGaps(ir.tools)) {
		degraded.push({
			capability: { kind: "mcp", target: CLINE_TARGET },
			from: "OIAP MCP server options",
			to: ".cline/mcp.json mcpServers entries",
			reason:
				"Cline MCP config does not carry OIAP include/exclude tool filters, cwd, required, or auth policy semantics directly.",
		});
	}

	if (ir.policies.length > 0) {
		degraded.push({
			capability: { kind: "policy", target: CLINE_TARGET },
			from: "OIAP permission policy",
			to: ".oiap/policy.json evidence",
			reason:
				"Cline policy and approval controls are not equivalent to every OIAP policy field and require user review.",
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
				entry.capability.target && entry.capability.target !== CLINE_TARGET,
		)
		.map((entry) => ({
			capability: entry.capability,
			required: entry.required,
			reason: `Capability is scoped to target ${entry.capability.target}.`,
		}));
}

function validateClineBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];

	if (bundle.target !== CLINE_TARGET) {
		issues.push({
			severity: "error",
			code: "cline-target-mismatch",
			message: `Expected target ${CLINE_TARGET}, received ${bundle.target}.`,
		});
	}

	if (!bundle.files.some((file) => file.path === ".oiap/cline-target.json")) {
		issues.push({
			severity: "error",
			code: "cline-missing-target-manifest",
			message: "Cline bundle is missing .oiap/cline-target.json.",
		});
	}

	const seenPaths = new Set<string>();

	for (const file of bundle.files) {
		if (seenPaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "cline-duplicate-file",
				message: `Duplicate output path: ${file.path}.`,
				path: file.path,
			});
		}

		seenPaths.add(file.path);

		if (file.path.endsWith(".json") && typeof file.content === "string") {
			try {
				JSON.parse(file.content);
			} catch {
				issues.push({
					severity: "error",
					code: "cline-invalid-json",
					message: `Generated JSON file is invalid: ${file.path}.`,
					path: file.path,
				});
			}
		}

		if (file.path.startsWith(".cline/hooks/") && file.mode !== 0o755) {
			issues.push({
				severity: "warning",
				code: "cline-hook-not-executable",
				message: `Cline hook file should be executable: ${file.path}.`,
				path: file.path,
			});
		}
	}

	const mcpFile = bundle.files.find((file) => file.path === ".cline/mcp.json");

	if (mcpFile && typeof mcpFile.content === "string") {
		const parsed = JSON.parse(mcpFile.content) as Partial<ClineMcpConfig>;

		if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
			issues.push({
				severity: "error",
				code: "cline-invalid-mcp",
				message: ".cline/mcp.json must contain a top-level mcpServers object.",
				path: mcpFile.path,
			});
		}
	}

	return issues;
}

function supportedClineHooks(hooks: HookDefinition[]): HookDefinition[] {
	return hooks.filter((hook) => Boolean(toClineHookEvent(hook.event)));
}

function toClineHookEvent(event: HookDefinition["event"]): string | undefined {
	switch (event) {
		case "session_start":
			return "agent_start";
		case "user_prompt_submit":
			return "prompt_submit";
		case "before_tool":
			return "tool_call";
		case "after_tool":
			return "tool_result";
		case "stop":
			return "agent_end";
		default:
			return undefined;
	}
}

function toClineHookFile(event: HookDefinition["event"]): string | undefined {
	switch (event) {
		case "session_start":
			return "TaskStart";
		case "user_prompt_submit":
			return "UserPromptSubmit";
		case "before_tool":
			return "PreToolUse";
		case "after_tool":
			return "PostToolUse";
		case "stop":
			return "TaskComplete";
		default:
			return undefined;
	}
}

function renderSkillBody(
	skill: SkillAsset,
	instruction: InstructionModule | undefined,
): string {
	const body = targetInstructionBody(instruction);
	const sections = [
		`# ${skill.name}`,
		"",
		skill.description,
		"",
		nonEmptyBody(body, skill.id),
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
): string {
	const commandPrompt =
		stringMetadata(command.targetMetadata?.[CLINE_TARGET], "prompt") ??
		targetInstructionBody(instruction);
	const lines = [
		`# ${commandNameForCline(command, invocation)}`,
		"",
		invocation?.helpText ?? `Run OIAP command ${command.id}.`,
		"",
		nonEmptyBody(commandPrompt, command.id),
	];

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

	if (agent.tools && agent.tools.length > 0) {
		lines.push(
			"",
			"## OIAP Tool References",
			"",
			...agent.tools.map((tool) => `- ${tool.id}`),
		);
	}

	if (agent.delegation) {
		lines.push("", "## OIAP Delegation", "", `- ${agent.delegation.id}`);
	}

	return lines.join("\n").trim();
}

function commandNameForCline(
	command: CommandAsset,
	invocation: Invocation | undefined,
): string {
	return (
		stringMetadata(command.targetMetadata?.[CLINE_TARGET], "name") ??
		invocation?.targetAliases?.[CLINE_TARGET] ??
		invocation?.canonical ??
		command.id
	);
}

function standaloneInstructions(ir: PluginIr): InstructionModule[] {
	const consumedInstructionIds = new Set<string>([
		...ir.commands.flatMap((command) =>
			command.prompt ? [command.prompt.id] : [],
		),
		...ir.skills.map((skill) => skill.instructions.id),
		...ir.agents.map((agent) => agent.instructions.id),
	]);

	return ir.instructions.filter(
		(instruction) =>
			!consumedInstructionIds.has(instruction.id) &&
			(instruction.purpose === "always_on" ||
				instruction.purpose === "safety" ||
				instruction.purpose === "workflow"),
	);
}

function normalizeClineRulePath(rule: ProjectRule): string {
	const cleanPath = sanitizeRelativePath(rule.path);

	if (cleanPath === "AGENTS.md") {
		return cleanPath;
	}

	if (cleanPath === ".clinerules" || cleanPath === ".clinerules/") {
		return `.clinerules/${slug(rule.id, "rule")}.md`;
	}

	if (cleanPath.startsWith(".clinerules/")) {
		return ensureMarkdownPath(cleanPath);
	}

	if (cleanPath.startsWith(".cline/rules/")) {
		return ensureMarkdownPath(
			cleanPath.replace(/^\.cline\/rules\//, ".clinerules/"),
		);
	}

	return `.clinerules/${ensureMarkdownPath(fileBaseName(cleanPath) || slug(rule.id, "rule"))}`;
}

function hasRuleOutput(ir: PluginIr): boolean {
	return (
		ir.rules.some((rule) => rule.target === CLINE_TARGET) ||
		standaloneInstructions(ir).length > 0
	);
}

function hasSkillOutput(ir: PluginIr): boolean {
	return ir.skills.length > 0 || ir.commands.length > 0;
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

	if (server.excludeTools && server.excludeTools.length > 0) {
		unsupported.push("excludeTools");
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

	return instruction.hostOverrides?.[CLINE_TARGET] ?? instruction.body;
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
	return metadata?.[CLINE_TARGET] ?? {};
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
	const entries = Object.entries(frontmatter).filter(
		([, value]) => value !== undefined && value !== null,
	);
	const yaml = entries
		.map(([key, value]) => `${key}: ${formatFrontmatterValue(value)}`)
		.join("\n");

	return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}

function formatFrontmatterValue(value: unknown): string {
	if (typeof value === "string") {
		return JSON.stringify(value);
	}

	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}

	return JSON.stringify(value);
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
			supportedTargets: [CLINE_TARGET],
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
		candidate = addPathSuffix(path, suffix);
		suffix += 1;
	}

	used.add(candidate);
	return candidate;
}

function addPathSuffix(path: string, suffix: number): string {
	const extensionIndex = path.lastIndexOf(".");

	if (extensionIndex <= path.lastIndexOf("/")) {
		return `${path}-${suffix}`;
	}

	return `${path.slice(0, extensionIndex)}-${suffix}${path.slice(extensionIndex)}`;
}

function ensureMarkdownPath(path: string): string {
	return /\.(md|markdown|txt)$/i.test(path) ? path : `${path}.md`;
}

function fileBaseName(path: string): string {
	const segments = path.split("/").filter(Boolean);
	const last = segments.at(-1) ?? "";

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
