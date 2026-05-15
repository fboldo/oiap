import type { HookDefinition } from "./hooks";

export type JsonPrimitive = string | number | boolean | null;

export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
	[key: string]: JsonValue;
}

export type JsonSchema = JsonObject;

export type KnownTargetId =
	| "claude-code"
	| "codex"
	| "opencode"
	| "github-copilot-cli"
	| "vscode-copilot-chat"
	| "aider"
	| "openclaw"
	| "factory-droid"
	| "trae"
	| "trae-cn"
	| "gemini-cli"
	| "hermes"
	| "kimi-code"
	| "kiro"
	| "pi"
	| "cursor"
	| "antigravity";

export type TargetId = KnownTargetId | (string & {});

export type RuntimeLanguage =
	| "typescript"
	| "javascript"
	| "python"
	| "shell"
	| "wasm"
	| "native";

export type ShellDialect =
	| "posix"
	| "bash"
	| "zsh"
	| "fish"
	| "powershell"
	| "cmd";

export type CapabilityKind =
	| "package"
	| "rules"
	| "skills"
	| "commands"
	| "hooks"
	| "agents"
	| "mcp"
	| "runtime"
	| "policy"
	| "filesystem"
	| "network"
	| "process"
	| "database"
	| "secrets";

export interface HostCapability {
	kind: CapabilityKind;
	required?: boolean;
	target?: TargetId;
	reason?: string;
}

export interface PluginManifest {
	id: string;
	name: string;
	version: string;
	description: string;
	homepage?: string;
	license?: string;
	categories: string[];
	requiredCapabilities?: HostCapability[];
	optionalCapabilities?: HostCapability[];
	supportedTargets: TargetId[];
}

export interface Invocation {
	id: string;
	canonical: string;
	aliases?: string[];
	targetAliases?: Partial<Record<TargetId, string>>;
	argsSchema?: JsonSchema;
	helpText: string;
	examples: string[];
}

export type InstructionPurpose =
	| "command"
	| "always_on"
	| "workflow"
	| "safety"
	| "agent";

export interface InstructionModule {
	id: string;
	purpose: InstructionPurpose;
	triggers: string[];
	body: string;
	frontmatter?: Record<string, unknown>;
	hostOverrides?: Partial<Record<TargetId, string>>;
}

export interface CommandAsset {
	id: string;
	invocation: InvocationRef;
	prompt?: InstructionModuleRef;
	recipe?: CommandRecipeRef;
	arguments?: JsonSchema;
	targetMetadata?: Partial<Record<TargetId, Record<string, unknown>>>;
}

export interface Workflow {
	id: string;
	title: string;
	activation: Activation;
	inputs: WorkflowInput[];
	steps: WorkflowStep[];
	outputs: ArtifactRef[];
	failurePolicy: FailurePolicy;
}

export interface Activation {
	mode: "manual" | "command" | "hook" | "skill" | "always" | "model";
	invocation?: InvocationRef;
	triggers?: string[];
}

export interface WorkflowInput {
	id: string;
	name: string;
	schema: JsonSchema;
	required?: boolean;
}

export type WorkflowStep =
	| { kind: "run_command"; recipe: CommandRecipeRef; id?: string }
	| { kind: "read_file"; path: string; id?: string }
	| { kind: "write_file"; path: string; content: string; id?: string }
	| {
			kind: "patch_file";
			path: string;
			patch: JsonPatchOperation[];
			id?: string;
	  }
	| { kind: "spawn_workers"; strategy: DelegationStrategyRef; id?: string }
	| { kind: "call_tool"; tool: ToolRef; arguments?: JsonObject; id?: string }
	| { kind: "start_mcp_server"; server: McpServerRef; id?: string }
	| { kind: "ask_user"; prompt: string; schema?: JsonSchema; id?: string }
	| {
			kind: "conditional";
			condition: string;
			then: WorkflowStep[];
			otherwise?: WorkflowStep[];
			id?: string;
	  };

export interface FailurePolicy {
	mode: "fail_fast" | "continue" | "ask_user" | "rollback";
	retry?: RetryPolicy;
}

export interface RetryPolicy {
	maxAttempts: number;
	backoff: "none" | "linear" | "exponential";
	retryOn?: string[];
}

export interface CommandRecipe {
	id: string;
	intent: string;
	requiredTools: string[];
	dialects: Partial<Record<ShellDialect, string>>;
	timeoutMs?: number;
	produces?: ArtifactRef[];
	sensitiveArgs?: string[];
}

export interface Artifact {
	id: string;
	path: string;
	kind: "state" | "cache" | "report" | "config" | "output" | "temp";
	lifecycle: "persistent" | "ephemeral" | "generated";
	reviewRecommended?: boolean;
	cleanupRecommended?: boolean;
}

export interface ProjectRule {
	id: string;
	target: TargetId;
	path: string;
	marker?: string;
	scope: "user" | "workspace" | "nested" | "team" | "managed";
	mergeStrategy: "append-section" | "replace-file" | "frontmatter-file";
	activation: "always" | "pattern" | "manual" | "model" | "glob";
	globs?: string[];
	description?: string;
	frontmatter?: Record<string, unknown>;
	content: string;
}

export interface SkillAsset {
	id: string;
	name: string;
	description: string;
	instructions: InstructionModuleRef;
	assets?: PackageAssetRef[];
	targetMetadata?: Partial<Record<TargetId, Record<string, unknown>>>;
}

export interface DelegationStrategy {
	id: string;
	mode:
		| "none"
		| "native_subagents"
		| "custom_agents"
		| "browser_subagent"
		| "mcp_tools";
	maxWorkers?: number;
	chunking?: ChunkingStrategy;
	resultContract: JsonSchema;
	fallback?: WorkflowStep[];
}

export interface ChunkingStrategy {
	mode: "files" | "symbols" | "manual" | "none";
	maxItemsPerChunk?: number;
}

export interface AgentDefinition {
	id: string;
	name: string;
	description: string;
	instructions: InstructionModuleRef;
	tools?: ToolRef[];
	model?: string;
	delegation?: DelegationStrategyRef;
}

export interface ToolSurface {
	id: string;
	transport: "mcp-stdio" | "mcp-sse" | "mcp-http" | "native" | "cli";
	tools: ToolDefinition[];
	resources?: ResourceDefinition[];
	prompts?: PromptDefinition[];
	server?: McpServer;
}

export interface ToolDefinition {
	name: string;
	description: string;
	inputSchema?: JsonSchema;
	outputSchema?: JsonSchema;
}

export interface ResourceDefinition {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface PromptDefinition {
	name: string;
	description: string;
	arguments?: JsonSchema;
}

export interface McpServer {
	command?: string;
	args?: string[];
	url?: string;
	httpUrl?: string;
	env?: Record<string, string>;
	cwd?: string;
	headers?: Record<string, string>;
	includeTools?: string[];
	excludeTools?: string[];
	auth?: McpAuthPolicy;
	required?: boolean;
}

export interface McpAuthPolicy {
	mode: "none" | "env" | "header" | "oauth" | "host";
	secretRef?: string;
}

export interface RuntimeModule {
	id: string;
	target: TargetId;
	language: RuntimeLanguage;
	purpose: "host_adapter" | "tool_server" | "hook_handler" | "command_runner";
	entrypoint: string;
	generated: boolean;
	source?: string;
	bridgesTo?: ToolSurfaceRef | WorkflowRef | HookRef;
}

export interface PermissionPolicy {
	permissions: Permission[];
	approvals?: ApprovalPolicy;
	sandbox?: SandboxPolicy;
	network?: NetworkPolicy;
	secrets?: SecretPolicy;
	pathAccess?: PathPolicy;
	destructiveActions?: DestructiveActionPolicy;
	promptInjection?: PromptInjectionPolicy;
}

export interface Permission {
	kind: CapabilityKind;
	access: "allow" | "deny" | "ask";
	resources?: string[];
	reason?: string;
}

export interface ApprovalPolicy {
	mode: "never" | "on_request" | "on_risk" | "always";
}

export interface SandboxPolicy {
	mode: "none" | "read_only" | "workspace_write" | "host";
}

export interface NetworkPolicy {
	access: "deny" | "allowlist" | "allow";
	hosts?: string[];
}

export interface SecretPolicy {
	allowedRefs: string[];
	redactLogs?: boolean;
}

export interface PathPolicy {
	read?: string[];
	write?: string[];
	deny?: string[];
}

export interface DestructiveActionPolicy {
	mode: "deny" | "ask" | "allow";
	patterns?: string[];
}

export interface PromptInjectionPolicy {
	mode: "ignore" | "warn" | "block";
}

export interface TargetBundle {
	target: TargetId;
	format: "directory" | "archive" | "manifest-only";
	files: RenderedFile[];
	package?: DistributionPackage;
	report: ExportReport;
}

export interface DistributionPackage {
	id: string;
	target: TargetId;
	manifestPath: string;
	assets: PackageAssetRef[];
	marketplace?: MarketplaceMetadata;
	trustModel: "local" | "reviewed" | "managed" | "signed";
	settings?: PackageSetting[];
}

export interface RenderedFile {
	path: string;
	content: string | Uint8Array;
	mode?: number;
	source?: SourceRef;
}

export interface RenderedConfigFragment {
	path: string;
	format:
		| "json"
		| "toml"
		| "markdown"
		| "yaml"
		| "yaml-frontmatter"
		| "python"
		| "javascript";
	content: JsonValue | string;
	source?: SourceRef;
}

export interface ExportPlan {
	target: TargetId;
	outDir: string;
	files: RenderedFile[];
	package?: DistributionPackage;
	runtimeModules: RuntimeModule[];
	configFragments: RenderedConfigFragment[];
	report: ExportReport;
}

export interface ExportReport {
	target: TargetId;
	status: "ok" | "degraded" | "unsupported";
	mappedCapabilities: HostCapability[];
	degradedCapabilities: CapabilityDegradation[];
	unsupportedCapabilities: UnsupportedCapability[];
	issues: ValidationIssue[];
}

export interface CapabilityDegradation {
	capability: HostCapability;
	from: string;
	to: string;
	reason: string;
}

export interface UnsupportedCapability {
	capability: HostCapability;
	reason: string;
	required: boolean;
}

export interface ValidationIssue {
	severity: "info" | "warning" | "error";
	code: string;
	message: string;
	path?: string;
}

export interface SourceRef {
	primitiveId: string;
	primitiveKind: string;
	path?: string;
}

export interface MarketplaceMetadata {
	title?: string;
	summary?: string;
	categories?: string[];
	keywords?: string[];
}

export interface PackageSetting {
	key: string;
	description: string;
	schema: JsonSchema;
	default?: JsonValue;
}

export interface HostProfile {
	id: TargetId;
	verification: "official" | "profile-derived" | "thin";
	packageSupport?: PackageSupport;
	skillSupport?: SkillSupport;
	commandSupport?: CommandSupport;
	ruleSupport?: RuleSupport;
	hookSupport?: HookSupport;
	mcpSupport?: McpSupport;
	permissionSupport?: PermissionSupport;
	runtimeSupport?: RuntimeSupport;
	shellDialects: ShellDialect[];
	configFormats: ConfigFormat[];
}

export type ConfigFormat =
	| "json"
	| "toml"
	| "markdown"
	| "yaml-frontmatter"
	| "python"
	| "javascript";

export interface SurfaceSupport {
	supported: boolean;
	fidelity: "native" | "partial" | "fallback" | "unsupported";
	notes?: string;
}

export type PackageSupport = SurfaceSupport;
export type SkillSupport = SurfaceSupport;
export type CommandSupport = SurfaceSupport;
export type RuleSupport = SurfaceSupport;
export type HookSupport = SurfaceSupport;
export type McpSupport = SurfaceSupport;
export type PermissionSupport = SurfaceSupport;
export type RuntimeSupport = SurfaceSupport;

export interface PlatformExporter {
	target: TargetId;
	profile: HostProfile;
	lower(ir: PluginIr): LoweredTargetGraph;
	render(graph: LoweredTargetGraph): TargetBundle;
	validate(bundle: TargetBundle): ValidationIssue[];
}

export interface PluginIr {
	manifest?: PluginManifest;
	invocations: Invocation[];
	instructions: InstructionModule[];
	commands: CommandAsset[];
	workflows: Workflow[];
	rules: ProjectRule[];
	skills: SkillAsset[];
	hooks: HookDefinition[];
	agents: AgentDefinition[];
	tools: ToolSurface[];
	artifacts: Artifact[];
	recipes: CommandRecipe[];
	delegationStrategies: DelegationStrategy[];
	policies: PermissionPolicy[];
	runtimeModules: RuntimeModule[];
}

export interface LoweredTargetGraph {
	target: TargetId;
	files: RenderedFile[];
	runtimeModules: RuntimeModule[];
	configFragments: RenderedConfigFragment[];
	report: ExportReport;
}

export interface Ref<TKind extends string = string> {
	id: string;
	kind: TKind;
}

export type InvocationRef = Ref<"invocation">;
export type InstructionModuleRef = Ref<"instruction">;
export type CommandRecipeRef = Ref<"command-recipe">;
export type ArtifactRef = Ref<"artifact">;
export type DelegationStrategyRef = Ref<"delegation-strategy">;
export type ToolRef = Ref<"tool">;
export type McpServerRef = Ref<"mcp-server">;
export type ToolSurfaceRef = Ref<"tool-surface">;
export type WorkflowRef = Ref<"workflow">;
export type HookRef = Ref<"hook">;
export type PackageAssetRef = Ref<"package-asset"> & { path?: string };

export interface JsonPatchOperation {
	op: "add" | "remove" | "replace" | "move" | "copy" | "test";
	path: string;
	from?: string;
	value?: JsonValue;
}

export interface ScheduledJob {
	id: string;
	name: string;
	payload?: JsonValue;
	runAfterMs?: number;
	dedupeKey?: string;
}

export interface ScheduledJobRef {
	id: string;
	status: "scheduled" | "skipped";
}
