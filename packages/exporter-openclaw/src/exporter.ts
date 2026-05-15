import type {
	AgentDefinition,
	CapabilityDegradation,
	CommandAsset,
	ExportReport,
	HookDefinition,
	HostCapability,
	InstructionModule,
	Invocation,
	JsonSchema,
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
	renderHookRuntimeFiles,
	unsupportedHookIds as runtimeUnsupportedHookIds,
} from "@oiap/runtime";
import { OPENCLAW_TARGET, openClawProfile } from "./profile";

export type OpenClawPluginInput = PluginDefinition | PluginIr;

export interface OpenClawSourceMap {
	target: typeof OPENCLAW_TARGET;
	entries: OpenClawSourceMapEntry[];
}

export interface OpenClawSourceMapEntry {
	file: string;
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

interface OpenClawToolDescriptor {
	name: string;
	description: string;
	parameters: JsonSchema;
	optional?: boolean;
	sourceId: string;
}

interface OpenClawHookDescriptor {
	id: string;
	event: string;
	timeoutMs?: number;
	sourceEvent: HookDefinition["event"];
}

export const openClawExporter = defineExporter({
	target: OPENCLAW_TARGET,
	profile: openClawProfile,
	lower(ir: PluginIr): LoweredTargetGraph {
		const files = renderOpenClawFiles(ir);
		const report = createExportReport(ir);

		return {
			target: OPENCLAW_TARGET,
			files,
			runtimeModules: ir.runtimeModules,
			configFragments: [],
			report,
		};
	},
	render(graph: LoweredTargetGraph): TargetBundle {
		return {
			target: OPENCLAW_TARGET,
			format: "directory",
			files: graph.files,
			package: {
				id: "openclaw-plugin",
				target: OPENCLAW_TARGET,
				manifestPath: "openclaw.plugin.json",
				assets: graph.files.map(toPackageAssetRef),
				trustModel: "local",
			},
			report: graph.report,
		};
	},
	validate(bundle: TargetBundle): ValidationIssue[] {
		return validateOpenClawBundle(bundle);
	},
});

export function exportOpenClaw(plugin: OpenClawPluginInput): TargetBundle {
	const ir = normalizePluginInput(plugin);
	const graph = openClawExporter.lower(ir);
	const bundle = openClawExporter.render(graph);
	const validationIssues = openClawExporter.validate(bundle);

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

function normalizePluginInput(plugin: OpenClawPluginInput): PluginIr {
	if (isPluginIr(plugin)) {
		return plugin;
	}

	return toPluginIr(plugin);
}

function isPluginIr(plugin: OpenClawPluginInput): plugin is PluginIr {
	return (
		Array.isArray(plugin.invocations) &&
		Array.isArray(plugin.instructions) &&
		Array.isArray(plugin.commands) &&
		Array.isArray(plugin.workflows) &&
		Array.isArray(plugin.hooks) &&
		Array.isArray(plugin.runtimeModules)
	);
}

function renderOpenClawFiles(ir: PluginIr): RenderedFile[] {
	const usedSkillSlugs = new Set<string>();
	const pluginFiles = [
		renderPackageJson(ir),
		renderPluginManifest(ir),
		renderEntrypoint(ir),
		...renderSkills(ir.skills, ir.instructions, usedSkillSlugs),
		...renderCommandsAsSkills(
			ir.commands,
			ir.invocations,
			ir.instructions,
			usedSkillSlugs,
		),
		...renderInstructionSkills(ir, usedSkillSlugs),
		...renderRuleSkills(ir.rules, usedSkillSlugs),
		...ir.agents.map(renderAgentMetadata),
		...renderHookMetadata(ir.hooks),
		...renderHookRuntime(ir),
		...renderMcpEvidence(ir.tools),
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

function renderPackageJson(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const packageJson = {
		name: `@oiap/openclaw-${slug(manifest.id)}`,
		version: manifest.version,
		type: "module",
		private: true,
		description: manifest.description,
		openclaw: {
			extensions: ["./index.ts"],
			compat: {
				pluginApi: ">=2026.3.24-beta.2",
				minGatewayVersion: "2026.3.24-beta.2",
			},
			build: {
				openclawVersion: "2026.3.24-beta.2",
				pluginSdkVersion: "2026.3.24-beta.2",
			},
		},
	};

	return jsonFile(
		"package.json",
		packageJson,
		sourceRef(manifest.id, "package"),
	);
}

function renderPluginManifest(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const commandNames = collectCommandNames(ir.commands, ir.invocations);
	const toolDescriptors = collectToolDescriptors(ir.tools);
	const hookDescriptors = collectHookDescriptors(ir.hooks);
	const skillRoots = hasSkillOutput(ir) ? ["./skills"] : undefined;
	const contracts = omitEmpty({
		tools:
			toolDescriptors.length > 0
				? toolDescriptors.map((descriptor) => descriptor.name)
				: undefined,
	});
	const activationCapabilities = [
		toolDescriptors.length > 0 ? "tool" : undefined,
		hookDescriptors.length > 0 ? "hook" : undefined,
	].filter(Boolean);
	const manifestContent = omitUndefined({
		id: slug(manifest.id),
		name: manifest.name,
		description: manifest.description,
		version: manifest.version,
		configSchema: {
			type: "object",
			additionalProperties: false,
			properties: {},
		},
		skills: skillRoots,
		commandAliases:
			commandNames.length > 0
				? commandNames.map((name) => ({ name, kind: "runtime-slash" }))
				: undefined,
		activation: omitUndefined({
			onStartup: hookDescriptors.length > 0,
			onCommands: commandNames.length > 0 ? commandNames : undefined,
			onCapabilities:
				activationCapabilities.length > 0 ? activationCapabilities : undefined,
		}),
		contracts: Object.keys(contracts).length > 0 ? contracts : undefined,
		toolMetadata: renderToolMetadata(toolDescriptors),
	});

	return jsonFile(
		"openclaw.plugin.json",
		manifestContent,
		sourceRef(manifest.id, "manifest"),
	);
}

function renderEntrypoint(ir: PluginIr): RenderedFile {
	const manifest = getManifest(ir);
	const pluginId = slug(manifest.id);
	const toolDescriptors = collectToolDescriptors(ir.tools);
	const hookDescriptors = collectHookDescriptors(ir.hooks);
	const hasHooks = hookDescriptors.length > 0;
	const content = [
		...(hasHooks
			? [
					'import { spawn } from "node:child_process";',
					'import { dirname, join } from "node:path";',
					'import { fileURLToPath } from "node:url";',
				]
			: []),
		'import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";',
		"",
		...(hasHooks
			? ["const pluginRoot = dirname(fileURLToPath(import.meta.url));"]
			: []),
		`const toolDescriptors = ${JSON.stringify(toolDescriptors, null, "\t")};`,
		"",
		"export default definePluginEntry({",
		`	id: ${JSON.stringify(pluginId)},`,
		`	name: ${JSON.stringify(manifest.name)},`,
		`	description: ${JSON.stringify(manifest.description)},`,
		"\tregister(api) {",
		...renderToolRegistrationLines(),
		...hookDescriptors.flatMap(renderHookRegistrationLines),
		"\t},",
		"});",
		"",
		"function createPendingToolResult(toolName, params) {",
		"\treturn {",
		"\t\tcontent: [",
		"\t\t\t{",
		'\t\t\t\ttype: "text",',
		"\t\t\t\ttext: `OIAP tool $" +
			"{toolName} is declared for this OpenClaw plugin, but the native runtime handler has not been generated yet.`,",
		"\t\t\t},",
		"\t\t],",
		"\t\tdetails: {",
		"\t\t\toiap: {",
		`				pluginId: ${JSON.stringify(pluginId)},`,
		'\t\t\t\tstatus: "pending-runtime",',
		"\t\t\t\ttoolName,",
		"\t\t\t\tparams,",
		"\t\t\t},",
		"\t\t},",
		"\t};",
		"}",
		"",
		...renderOpenClawRuntimeEntrypointLines(hasHooks),
	].join("\n");

	return textFile("index.ts", content, sourceRef(manifest.id, "entrypoint"));
}

function renderOpenClawRuntimeEntrypointLines(hasHooks: boolean): string[] {
	if (!hasHooks) {
		return [];
	}

	return [
		"async function runOiapHook(request: { hookId: string; event: string; targetEvent: string; args: unknown[] }) {",
		'\tconst runnerPath = join(pluginRoot, ".oiap/runtime/runner.mjs");',
		'\tconst manifestPath = join(pluginRoot, ".oiap/runtime/manifest.json");',
		"\tconst payload = JSON.stringify({ openclaw: { event: request.targetEvent, args: request.args } });",
		"\tconst result = await runNode([",
		"\t\trunnerPath,",
		'\t\t"run-hook",',
		'\t\t"--manifest",',
		"\t\tmanifestPath,",
		'\t\t"--target",',
		`\t\t${JSON.stringify(OPENCLAW_TARGET)},`,
		'\t\t"--event",',
		"\t\trequest.event,",
		'\t\t"--hook",',
		"\t\trequest.hookId,",
		"\t], payload);",
		"",
		"\tif (result.stdout.trim()) {",
		"\t\tconst parsed = JSON.parse(result.stdout);",
		"\t\treturn parsed.result ?? parsed;",
		"\t}",
		"",
		"\tif (result.exitCode !== 0) {",
		'\t\tthrow new Error(result.stderr || "OIAP hook runner failed.");',
		"\t}",
		"",
		'\treturn { decision: "noop" };',
		"}",
		"",
		"function runNode(args: string[], input: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {",
		"\treturn new Promise((resolve, reject) => {",
		'\t\tconst child = spawn(process.execPath, args, { stdio: ["pipe", "pipe", "pipe"] });',
		'\t\tlet stdout = "";',
		'\t\tlet stderr = "";',
		"",
		'\t\tchild.stdout.on("data", (chunk) => { stdout += chunk.toString(); });',
		'\t\tchild.stderr.on("data", (chunk) => { stderr += chunk.toString(); });',
		'\t\tchild.on("error", reject);',
		'\t\tchild.on("close", (exitCode) => { resolve({ exitCode: exitCode ?? 0, stdout, stderr }); });',
		"\t\tchild.stdin.end(input);",
		"\t});",
		"}",
		"",
	];
}

function renderToolRegistrationLines(): string[] {
	return [
		"\t\tfor (const tool of toolDescriptors) {",
		"\t\t\tconst registration = {",
		"\t\t\t\tname: tool.name,",
		"\t\t\t\tdescription: tool.description,",
		"\t\t\t\tparameters: tool.parameters,",
		"\t\t\t\tasync execute(_id, params) {",
		"\t\t\t\t\treturn createPendingToolResult(tool.name, params);",
		"\t\t\t\t},",
		"\t\t\t};",
		"",
		"\t\t\tif (tool.optional) {",
		"\t\t\t\tapi.registerTool(registration, { optional: true });",
		"\t\t\t} else {",
		"\t\t\t\tapi.registerTool(registration);",
		"\t\t\t}",
		"\t\t}",
	];
}

function renderHookRegistrationLines(hook: OpenClawHookDescriptor): string[] {
	const options = omitUndefined({ timeoutMs: hook.timeoutMs });

	return [
		"",
		`\t\tapi.on(${JSON.stringify(hook.event)}, async (...hookArgs) => runOiapHook({ hookId: ${JSON.stringify(hook.id)}, event: ${JSON.stringify(hook.sourceEvent)}, targetEvent: ${JSON.stringify(hook.event)}, args: hookArgs }), ${JSON.stringify(options)});`,
	];
}

function renderHookRuntime(ir: PluginIr): RenderedFile[] {
	return renderHookRuntimeFiles({
		pluginId: getManifest(ir).id,
		target: OPENCLAW_TARGET,
		hooks: ir.hooks,
		targetEvent: (hook) => toOpenClawHookEvent(hook.event),
	}).files;
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
				"user-invocable": true,
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
				metadata: { openclaw: { always: true } },
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
		.filter((rule) => rule.target === OPENCLAW_TARGET)
		.map((rule) => {
			const skillSlug = reserveSlug(rule.id, usedSkillSlugs);
			const content = withFrontmatter(
				{
					name: skillSlug,
					description: rule.description ?? rule.id,
					metadata: { openclaw: { always: true } },
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

function renderAgentMetadata(agent: AgentDefinition): RenderedFile {
	return jsonFile(
		`.oiap/agents/${slug(agent.id)}.json`,
		{
			id: agent.id,
			name: agent.name,
			description: agent.description,
			model: agent.model,
			tools: agent.tools,
			degradation: "OpenClaw custom agent lowering is not implemented yet.",
		},
		sourceRef(agent.id, "agent"),
	);
}

function renderHookMetadata(hooks: HookDefinition[]): RenderedFile[] {
	return hooks.map((hook) =>
		jsonFile(
			`.oiap/hooks/${slug(hook.id)}.json`,
			{
				id: hook.id,
				event: hook.event,
				openClawEvent: toOpenClawHookEvent(hook.event),
				match: hook.match,
				timeoutMs: hook.timeoutMs,
				failureMode: hook.failureMode,
				optional: hook.optional ?? false,
				capabilities: hook.capabilities ?? {},
				runtime: {
					status: "generated-js-runner",
					message:
						"OpenClaw api.on registrations call the generated OIAP raw-JS hook runner.",
				},
			},
			sourceRef(hook.id, "hook"),
		),
	);
}

function renderMcpEvidence(tools: ToolSurface[]): RenderedFile[] {
	if (!tools.some((tool) => tool.server)) {
		return [];
	}

	const servers = Object.fromEntries(
		tools
			.filter((tool) => tool.server)
			.map((tool) => [tool.id, toOpenClawMcpServer(tool)]),
	);

	return [
		jsonFile(
			".openclaw/mcp.json",
			{ mcp: { servers } },
			sourceRef("openclaw-mcp", "mcp"),
		),
	];
}

function renderPolicyEvidence(policies: PermissionPolicy[]): RenderedFile {
	return jsonFile(
		".openclaw/policy.json",
		{ policies },
		sourceRef("openclaw-policy", "policy"),
	);
}

function renderRuntimeModules(runtimeModules: RuntimeModule[]): RenderedFile {
	return jsonFile(
		".oiap/runtime-modules.json",
		{
			runtimeModules: runtimeModules.filter(
				(module) => module.target === OPENCLAW_TARGET,
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
		"This OpenClaw native plugin bundle was generated by the OIAP OpenClaw exporter.",
		"## Contents",
		"- `package.json`: package metadata and `openclaw.extensions` entrypoint declaration.",
		"- `openclaw.plugin.json`: native OpenClaw discovery manifest.",
		"- `index.ts`: generated OpenClaw plugin entrypoint.",
		"- `skills/`: generated AgentSkills-compatible skill folders.",
		"- `.openclaw/`: generated MCP and policy evidence that is not loaded directly by native OpenClaw plugins yet.",
		"- `.oiap/`: source map, capability report, and degraded runtime metadata.",
		"## Current Limitations",
		"Commands are exported as user-invocable skills and commandAliases metadata. Hooks call the generated raw-JS OIAP runtime; tools still use placeholder handlers until tool runtime generation exists.",
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
		target: OPENCLAW_TARGET,
		status,
		mappedCapabilities,
		degradedCapabilities,
		unsupportedCapabilities,
		issues,
	};
}

function collectMappedCapabilities(ir: PluginIr): HostCapability[] {
	const capabilities: HostCapability[] = [
		{ kind: "package", target: OPENCLAW_TARGET },
	];

	if (hasSkillOutput(ir)) {
		capabilities.push({ kind: "skills", target: OPENCLAW_TARGET });
	}

	if (ir.hooks.length > 0) {
		capabilities.push({ kind: "hooks", target: OPENCLAW_TARGET });
		capabilities.push({ kind: "runtime", target: OPENCLAW_TARGET });
	}

	if (collectToolDescriptors(ir.tools).length > 0) {
		capabilities.push({ kind: "mcp", target: OPENCLAW_TARGET });
	}

	return capabilities;
}

function collectDegradedCapabilities(ir: PluginIr): CapabilityDegradation[] {
	const degradations: CapabilityDegradation[] = [];

	if (ir.commands.length > 0) {
		degradations.push({
			capability: { kind: "commands", target: OPENCLAW_TARGET },
			from: "native-registerCommand",
			to: "user-invocable-skill",
			reason:
				"OpenClaw command definitions are exported as skills and commandAliases until registerCommand lowering is implemented.",
		});
	}

	if (ir.rules.some((rule) => rule.target === OPENCLAW_TARGET)) {
		degradations.push({
			capability: { kind: "rules", target: OPENCLAW_TARGET },
			from: "project-rule",
			to: "always-on-skill",
			reason:
				"OpenClaw native plugins load skills, so OIAP rules are represented as always-on plugin skills.",
		});
	}

	const nonPortableHookIds = runtimeUnsupportedHookIds(ir.hooks);

	if (nonPortableHookIds.length > 0) {
		degradations.push({
			capability: { kind: "hooks", target: OPENCLAW_TARGET },
			from: "portable-function-hook",
			to: "metadata-only-hook",
			reason: `${nonPortableHookIds.length} hook(s) are not serializable portable functions and were recorded as runtime metadata only.`,
		});
	}

	if (collectToolDescriptors(ir.tools).length > 0) {
		degradations.push({
			capability: { kind: "mcp", target: OPENCLAW_TARGET },
			from: "native-tool-implementation",
			to: "placeholder-tool-handler",
			reason:
				"OpenClaw tool contracts and registrations are emitted, but executable OIAP tool handlers are not generated yet.",
		});
	}

	if (ir.tools.some((tool) => tool.server)) {
		degradations.push({
			capability: { kind: "mcp", target: OPENCLAW_TARGET },
			from: "mcp-server-runtime",
			to: "mcp-evidence-file",
			reason:
				"MCP server configuration is recorded as evidence; native OpenClaw plugin MCP bridging is not generated yet.",
		});
	}

	if (ir.agents.length > 0) {
		degradations.push({
			capability: { kind: "agents", target: OPENCLAW_TARGET },
			from: "custom-agent",
			to: "metadata-only",
			reason:
				"OpenClaw custom agent lowering is not implemented by this exporter yet.",
		});
	}

	if (ir.policies.length > 0) {
		degradations.push({
			capability: { kind: "policy", target: OPENCLAW_TARGET },
			from: "policy-enforcement",
			to: "policy-evidence",
			reason:
				"Permission policies are emitted as evidence until OpenClaw policy/hook lowering is implemented.",
		});
	}

	const ungeneratedRuntimeModules = ir.runtimeModules.filter(
		(module) =>
			module.target === OPENCLAW_TARGET &&
			!(module.generated && module.purpose === "hook_handler"),
	);

	if (ungeneratedRuntimeModules.length > 0) {
		degradations.push({
			capability: { kind: "runtime", target: OPENCLAW_TARGET },
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
				capability.target && capability.target !== OPENCLAW_TARGET,
		)
		.map((capability) => ({
			capability,
			reason: `Capability is scoped to ${capability.target}, not OpenClaw.`,
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
				"Plugin manifest is missing; fallback OpenClaw metadata was generated.",
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

function validateOpenClawBundle(bundle: TargetBundle): ValidationIssue[] {
	const issues: ValidationIssue[] = [];
	const filePaths = new Set<string>();

	for (const file of bundle.files) {
		if (filePaths.has(file.path)) {
			issues.push({
				severity: "error",
				code: "duplicate-file-path",
				message: `OpenClaw bundle contains duplicate file path: ${file.path}`,
				path: file.path,
			});
		}

		filePaths.add(file.path);
	}

	for (const requiredPath of [
		"package.json",
		"openclaw.plugin.json",
		"index.ts",
	]) {
		if (!filePaths.has(requiredPath)) {
			issues.push({
				severity: "error",
				code: "missing-openclaw-file",
				message: `OpenClaw bundle is missing ${requiredPath}.`,
				path: requiredPath,
			});
		}
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

function createSourceMap(files: RenderedFile[]): OpenClawSourceMap {
	return {
		target: OPENCLAW_TARGET,
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
		target: OPENCLAW_TARGET,
		exporter: "@oiap/exporter-openclaw",
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
			supportedTargets: [OPENCLAW_TARGET],
		}
	);
}

function collectCommandNames(
	commands: CommandAsset[],
	invocations: Invocation[],
): string[] {
	return commands.map((command) => {
		const invocation = findInvocation(command.invocation.id, invocations);

		return slug(invocation ? targetInvocationName(invocation) : command.id);
	});
}

function collectToolDescriptors(
	tools: ToolSurface[],
): OpenClawToolDescriptor[] {
	const usedToolNames = new Set<string>();
	const descriptors: OpenClawToolDescriptor[] = [];

	for (const surface of tools) {
		for (const tool of surface.tools) {
			const name = reserveOpenClawToolName(tool.name, usedToolNames);
			descriptors.push({
				name,
				description: tool.description,
				parameters: tool.inputSchema ?? emptyObjectSchema(),
				optional: surface.server?.required === false,
				sourceId: surface.id,
			});
		}
	}

	return descriptors;
}

function collectHookDescriptors(
	hooks: HookDefinition[],
): OpenClawHookDescriptor[] {
	return hooks.map((hook) => ({
		id: hook.id,
		event: toOpenClawHookEvent(hook.event),
		timeoutMs: hook.timeoutMs,
		sourceEvent: hook.event,
	}));
}

function renderToolMetadata(
	toolDescriptors: OpenClawToolDescriptor[],
): Record<string, unknown> | undefined {
	const metadata = Object.fromEntries(
		toolDescriptors
			.filter((descriptor) => descriptor.optional)
			.map((descriptor) => [descriptor.name, { optional: true }]),
	);

	return Object.keys(metadata).length > 0 ? metadata : undefined;
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
	return instruction.hostOverrides?.[OPENCLAW_TARGET] ?? instruction.body;
}

function targetInvocationName(invocation: Invocation): string {
	return invocation.targetAliases?.[OPENCLAW_TARGET] ?? invocation.canonical;
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
		ir.commands.length > 0 ||
		standaloneInstructions(ir).length > 0 ||
		ir.rules.some((rule) => rule.target === OPENCLAW_TARGET)
	);
}

function toOpenClawHookEvent(event: HookDefinition["event"]): string {
	switch (event) {
		case "session_start":
			return "session_start";
		case "user_prompt_submit":
			return "before_prompt_build";
		case "before_tool":
		case "permission_request":
			return "before_tool_call";
		case "after_tool":
			return "after_tool_call";
		case "before_agent":
			return "before_agent_run";
		case "after_agent":
			return "agent_end";
		case "stop":
			return "before_agent_finalize";
	}
}

function toOpenClawMcpServer(tool: ToolSurface): Record<string, unknown> {
	const server = tool.server;

	if (!server) {
		return {};
	}

	const headers = omitUndefined({
		...server.headers,
		Authorization:
			server.auth?.mode === "env" && server.auth.secretRef
				? `Bearer \${${server.auth.secretRef}}`
				: undefined,
	});

	return omitUndefined({
		command: server.command,
		args: server.args,
		env: server.env,
		url: server.url ?? server.httpUrl,
		transport: toOpenClawMcpTransport(tool.transport),
		headers: Object.keys(headers).length > 0 ? headers : undefined,
	});
}

function toOpenClawMcpTransport(
	transport: ToolSurface["transport"],
): string | undefined {
	switch (transport) {
		case "mcp-http":
			return "streamable-http";
		case "mcp-sse":
			return "sse";
		case "mcp-stdio":
		case "native":
		case "cli":
			return undefined;
	}
}

function emptyObjectSchema(): JsonSchema {
	return { type: "object", additionalProperties: true };
}

function reserveOpenClawToolName(
	value: string,
	usedToolNames: Set<string>,
): string {
	const baseName = openClawIdentifier(value);
	let candidate = baseName;
	let suffix = 2;

	while (usedToolNames.has(candidate)) {
		candidate = `${baseName}_${suffix}`;
		suffix += 1;
	}

	usedToolNames.add(candidate);
	return candidate;
}

function openClawIdentifier(value: string): string {
	const normalized = value
		.trim()
		.replace(/[^A-Za-z0-9_-]+/g, "_")
		.replace(/^_+|_+$/g, "");

	if (!normalized) {
		return "oiap_tool";
	}

	if (/^[A-Za-z]/.test(normalized)) {
		return normalized;
	}

	return `oiap_${normalized}`;
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

function formatFrontmatterValue(value: unknown): string {
	return JSON.stringify(value);
}

function targetMetadata(
	metadata: CommandAsset["targetMetadata"] | SkillAsset["targetMetadata"],
): Record<string, unknown> {
	return metadata?.[OPENCLAW_TARGET] ?? {};
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

function omitUndefined(
	value: Record<string, unknown>,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(value).filter((entry) => entry[1] !== undefined),
	);
}

function omitEmpty(
	value: Record<string, unknown[] | undefined>,
): Record<string, unknown[]> {
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, unknown[]] => {
			const entryValue = entry[1];
			return Array.isArray(entryValue) && entryValue.length > 0;
		}),
	);
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
): RenderedFile {
	return { path, content, source };
}

function toPackageAssetRef(file: RenderedFile): PackageAssetRef {
	return { id: file.path, kind: "package-asset", path: file.path };
}
