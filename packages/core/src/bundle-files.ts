import { dirname, posix } from "node:path";
import type {
	AgentDefinition,
	CapabilityDegradation,
	PluginFile,
	PluginIr,
	RenderedFile,
	SourceRef,
	TargetId,
	ValidationIssue,
} from "./primitives.ts";

/** Expands to the directory holding the plugin's `resources`. */
export const PLUGIN_ROOT_TOKEN = "$" + "{OIAP_PLUGIN_ROOT}";

const AGENT_FILE_TOKEN = /\$\{OIAP_AGENT_FILE:([^}]+)\}/g;

const ANY_TOKEN = /\$\{OIAP_(?:PLUGIN_ROOT|AGENT_FILE:[^}]*)\}/;

/**
 * OIAP evidence files describe the source plugin and keep its tokens as
 * written. Every other text file in a bundle is resolved.
 */
const EVIDENCE_FILES = new Set([
	".oiap/bundle.json",
	".oiap/capability-report.json",
	".oiap/source-map.json",
	".oiap/policy.json",
	".oiap/runtime-modules.json",
]);

function isEvidenceFile(path: string): boolean {
	return EVIDENCE_FILES.has(path);
}

export interface BundlePathContext {
	/** Bundle-relative directory where `resources` are written; "" is the bundle root. */
	resourceRoot: string;
	/** Host variable that expands to the bundle root at run time, such as `${CLAUDE_PLUGIN_ROOT}`. */
	rootVariable?: string;
	/** Agent id to the bundle-relative path of its exported file. */
	agentFiles: Record<string, string>;
}

/**
 * Rewrite `${OIAP_PLUGIN_ROOT}` and `${OIAP_AGENT_FILE:<id>}` in every text
 * file of a bundle. With a root variable the result is absolute at run time;
 * without one it is relative to the file that contains the reference.
 * OIAP evidence files (`.oiap/bundle.json`, reports, source map) are left
 * untouched.
 */
export function resolveBundlePaths(
	files: RenderedFile[],
	context: BundlePathContext,
): RenderedFile[] {
	return files.map((file) => {
		if (typeof file.content !== "string" || isEvidenceFile(file.path)) {
			return file;
		}

		const content = file.content
			.replaceAll(PLUGIN_ROOT_TOKEN, () =>
				bundlePath(file.path, context.resourceRoot, context),
			)
			.replace(AGENT_FILE_TOKEN, (token, id: string) => {
				const agentFile = context.agentFiles[id];
				return agentFile ? bundlePath(file.path, agentFile, context) : token;
			});

		return content === file.content ? file : { ...file, content };
	});
}

function bundlePath(
	fromFile: string,
	target: string,
	context: BundlePathContext,
): string {
	if (context.rootVariable) {
		return target ? `${context.rootVariable}/${target}` : context.rootVariable;
	}

	return posix.relative(dirname(fromFile), target) || ".";
}

/**
 * Place plugin files under a bundle directory, keeping their relative paths.
 * Throws for a path that is absolute or leaves its directory.
 */
export function renderPluginFiles(
	files: PluginFile[] | undefined,
	baseDir: string,
	source: SourceRef,
): RenderedFile[] {
	for (const file of files ?? []) {
		assertSafePluginFilePath(file.path);
	}

	return (files ?? []).map((file) => ({
		path: baseDir ? `${baseDir}/${file.path}` : file.path,
		content: file.content,
		mode: file.mode,
		source: { ...source, path: file.path },
	}));
}

function assertSafePluginFilePath(path: string): void {
	const segments = path.split("/");

	if (
		path.length === 0 ||
		segments[0] === ".oiap" ||
		path.startsWith("/") ||
		path.includes("\\") ||
		/^[A-Za-z]:/.test(path) ||
		segments.some(
			(segment) => segment === "" || segment === "." || segment === "..",
		)
	) {
		throw new Error(
			`Plugin file path must be relative, stay inside its directory and not use .oiap/: ${path}`,
		);
	}
}

export interface BundleFileUsage {
	/** The plugin ships skill files or resources. */
	hasFiles: boolean;
	/** Text references `${OIAP_PLUGIN_ROOT}` or `${OIAP_AGENT_FILE:...}`. */
	usesPathTokens: boolean;
	/** Agent ids referenced with `${OIAP_AGENT_FILE:...}` that the plugin does not define. */
	unknownAgents: string[];
}

export function bundleFileUsage(ir: PluginIr): BundleFileUsage {
	const files = [
		...(ir.resources ?? []),
		...ir.skills.flatMap((skill) => skill.files ?? []),
	];
	// Every string an exporter may render: instructions, rules, workflows,
	// commands, agents and file contents. Hook functions are not serialised.
	const texts = [JSON.stringify({ ...ir, hooks: undefined }, binaryAsEmpty)];
	const agentIds = new Set(ir.agents.map((agent) => agent.id));
	const referenced = new Set(
		texts.flatMap((text) =>
			[...text.matchAll(AGENT_FILE_TOKEN)].map((match) => match[1] ?? ""),
		),
	);

	return {
		hasFiles: files.length > 0,
		usesPathTokens:
			referenced.size > 0 ||
			texts.some((text) => text.includes(PLUGIN_ROOT_TOKEN)),
		unknownAgents: [...referenced].filter((id) => !agentIds.has(id)).sort(),
	};
}

function binaryAsEmpty(_key: string, value: unknown): unknown {
	return value instanceof Uint8Array ? "" : value;
}

export interface BundleFileSupport {
	target: TargetId;
	/** The target writes skill files and resources into the bundle. */
	files: boolean;
	/** The host expands a plugin root variable at run time. */
	rootVariable: boolean;
}

/** Report findings shared by every exporter for skill files, resources and path tokens. */
export function bundleFileFindings(
	ir: PluginIr,
	support: BundleFileSupport,
): { degradations: CapabilityDegradation[]; issues: ValidationIssue[] } {
	const usage = bundleFileUsage(ir);
	const degradations: CapabilityDegradation[] = [];
	const issues: ValidationIssue[] = [];
	const capability = { kind: "package" as const, target: support.target };

	if (usage.hasFiles && !support.files) {
		degradations.push({
			capability,
			from: "bundled-plugin-files",
			to: "not-emitted",
			reason:
				"This exporter does not write skill files or plugin resources, so instructions that read them will fail.",
		});
	}

	if (usage.usesPathTokens && !support.rootVariable) {
		degradations.push({
			capability,
			from: "plugin-root-variable",
			to: "file-relative-path",
			reason:
				"The host has no plugin root variable; bundled file references are relative to the file that contains them, and the agent must resolve them from that file's location.",
		});
	}

	for (const skill of ir.skills) {
		if (skill.assets && skill.assets.length > 0) {
			issues.push({
				severity: "warning",
				code: "skill-assets-not-bundled",
				message: `Skill ${skill.id} declares asset references without content; use SkillAsset.files to ship them.`,
			});
		}
	}

	return { degradations, issues };
}

/**
 * Degradation for agents whose `access` the target cannot enforce. Pass the
 * agents the exporter could not map.
 */
export function agentAccessDegradation(
	target: TargetId,
	agents: AgentDefinition[],
	reason: string,
): CapabilityDegradation[] {
	const restricted = agents.filter((agent) => agent.access === "read-only");

	if (restricted.length === 0) {
		return [];
	}

	return [
		{
			capability: { kind: "agents", target },
			from: "read-only-agent",
			to: "unrestricted-agent",
			reason: `${restricted.length} read-only agent(s) are not restricted: ${reason}`,
		},
	];
}

/** Errors for bundle paths written more than once, such as a resource that shadows a generated file. */
export function duplicateFileIssues(files: RenderedFile[]): ValidationIssue[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();

	for (const file of files) {
		if (seen.has(file.path)) {
			duplicates.add(file.path);
		}
		seen.add(file.path);
	}

	return [...duplicates].sort().map((path) => ({
		severity: "error",
		code: "duplicate-bundle-file",
		message: `More than one file is written to ${path}.`,
		path,
	}));
}

/**
 * Errors for OIAP path tokens left in a bundle after `resolveBundlePaths`,
 * such as a reference to an agent the plugin does not define.
 */
export function unresolvedTokenIssues(
	files: RenderedFile[],
): ValidationIssue[] {
	return files
		.filter(
			(file) =>
				typeof file.content === "string" &&
				!isEvidenceFile(file.path) &&
				ANY_TOKEN.test(file.content),
		)
		.map((file) => {
			const token = ANY_TOKEN.exec(file.content as string)?.[0] ?? "";
			return {
				severity: "error",
				code: "unresolved-path-token",
				message: `${file.path} still contains ${token}; the referenced agent may not exist or the exporter does not resolve this file.`,
				path: file.path,
			};
		});
}
