import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	rmdir,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type {
	PluginManifest,
	RenderedFile,
	TargetBundle,
	ValidationIssue,
} from "@oiap/core";
import { mergeTargetMetadata } from "@oiap/core";
import { bundleHooksFromSource, loadPluginFile } from "./build.ts";
import type { CliPluginInput } from "./registry.ts";
import { getRegisteredExporter } from "./registry.ts";

/**
 * Where each git-installed host looks for plugin files, from its docs:
 * - rootOnly: the host installs the repository root and cannot be pointed at a
 *   subdirectory (Gemini CLI extensions, OpenClaw `git:` installs, Antigravity).
 * - reads: paths the host loads from its plugin root by default, whatever its
 *   manifest says. A directory ends with "/".
 * - marketplace: the catalog file that points the host at the plugin.
 */
interface SyncTargetRule {
	rootOnly: boolean;
	reads: string[];
	marketplace?: MarketplaceKind;
	/**
	 * Files the exporter writes for project installs that a plugin installed
	 * from git never loads; in a plugin repository they would configure the
	 * repository itself, so sync leaves them out.
	 */
	projectOnly?: string[];
}

type MarketplaceKind = "claude" | "codex" | "cursor" | "copilot";

const SYNC_TARGET_RULES: Record<string, SyncTargetRule> = {
	// https://github.com/google-gemini/gemini-cli/blob/main/docs/extensions/reference.md
	"gemini-cli": {
		rootOnly: true,
		reads: [
			"gemini-extension.json",
			"GEMINI.md",
			"commands/*.toml",
			"hooks/hooks.json",
			"skills/",
			"agents/",
			"policies/",
		],
	},
	// https://github.com/agentplugins/agent-plugins-spec/blob/main/spec/1.0.0.md
	// The open manifest at the root. Copilot CLI and VS Code read it in place
	// of their own manifest, so it also serves them through the Copilot catalog.
	"agent-plugins": {
		rootOnly: true,
		reads: ["plugin.json", "skills/", "mcp.json"],
		marketplace: "copilot",
	},
	// https://antigravity.google/docs/build-plugins.md
	// Its .antigravity-plugin/plugin.json wins over a root plugin.json.
	antigravity: {
		rootOnly: true,
		reads: [
			".antigravity-plugin/",
			"skills/",
			"agents/",
			"rules/",
			"hooks.json",
			"mcp_config.json",
		],
	},
	// https://github.com/openclaw/openclaw/blob/main/docs/cli/plugins/install.md
	// `git:` installs read the root, but a checkout or package can point at a
	// subdirectory, so OpenClaw moves when the root already has a package.json.
	openclaw: {
		rootOnly: false,
		reads: ["openclaw.plugin.json", "package.json", "skills/"],
	},
	// https://code.claude.com/docs/en/plugins-reference: skills, hooks and MCP
	// defaults always load; commands and agents load unless the manifest sets them.
	"claude-code": {
		rootOnly: false,
		reads: [
			".claude-plugin/plugin.json",
			"skills/",
			"commands/*.md",
			"agents/",
			"hooks/hooks.json",
			".mcp.json",
		],
		marketplace: "claude",
	},
	// https://developers.openai.com/codex/plugins/build
	// Codex reads a root plugin.json only with the Agent Plugins $schema, and
	// layers .codex-plugin/plugin.json over it, so the two share the root.
	codex: {
		rootOnly: false,
		reads: [
			".codex-plugin/plugin.json",
			"skills/",
			"hooks/hooks.json",
			".mcp.json",
		],
		marketplace: "codex",
		// Codex plugins have no agents, rules or instructions component.
		projectOnly: ["AGENTS.md", ".codex/"],
	},
	// https://cursor.com/docs/reference/plugins
	cursor: {
		rootOnly: false,
		reads: [
			".cursor-plugin/plugin.json",
			"skills/",
			"rules/",
			"agents/",
			"commands/",
			"hooks/hooks.json",
			"mcp.json",
		],
		marketplace: "cursor",
	},
	// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
	// Its own root plugin.json is found before .claude-plugin/plugin.json.
	"github-copilot-cli": {
		rootOnly: false,
		reads: [
			"plugin.json",
			".plugin/plugin.json",
			"skills/",
			"agents/",
			"hooks.json",
			"hooks/hooks.json",
			".mcp.json",
		],
		marketplace: "copilot",
	},
	// https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference
	"vscode-copilot-chat": {
		rootOnly: false,
		reads: [
			"plugin.json",
			".plugin/plugin.json",
			".claude-plugin/plugin.json",
			"skills/",
			"agents/",
			"commands/*.md",
			"hooks.json",
			".mcp.json",
		],
		marketplace: "copilot",
	},
};

/** Root-only hosts first, then the order movable hosts try the root. */
const SYNC_TARGET_ORDER = [
	"agent-plugins",
	"gemini-cli",
	"antigravity",
	"openclaw",
	"claude-code",
	"codex",
	"cursor",
	"github-copilot-cli",
	"vscode-copilot-chat",
];

export const syncTargets = [...SYNC_TARGET_ORDER];

/**
 * Bundle files that describe a build and do not belong in a plugin repository;
 * per-hook evidence under `.oiap/hooks/` and permission fragments no host reads
 * (`.oiap/<target>-permissions.json`) are left out too.
 */
const BUNDLE_ONLY_FILES = new Set([
	"README.md",
	".oiap/bundle.json",
	".oiap/capability-report.json",
	".oiap/source-map.json",
	".oiap/policy.json",
	".oiap/runtime-modules.json",
]);

export const SYNC_LOCK_PATH = ".oiap/sync.json";

export type SyncLayout = "root" | "plugins";

export interface SyncPlacement {
	target: string;
	/** Repository directory holding the target's plugin; "" is the root. */
	directory: string;
	status: TargetBundle["report"]["status"];
	issues: ValidationIssue[];
}

export interface SyncPlan {
	files: RenderedFile[];
	/** Targets that wrote each file. */
	owners: Record<string, string[]>;
	placements: SyncPlacement[];
	notes: string[];
	errors: string[];
}

/** What the repository already holds, as planSync needs to know it. */
export interface SyncRepositoryState {
	/**
	 * Files the author wrote, by path. A target that would write different
	 * content at one of these paths moves off the root; identical files, such
	 * as skills used with `skillsFrom`, are shared and stay the author's.
	 */
	authored?: ReadonlyMap<string, Buffer>;
	/** Indentation for each catalog file, to match the repository. */
	catalogIndents?: ReadonlyMap<string, string>;
}

export interface SyncLock {
	plugin: string;
	version: string;
	layout: SyncLayout;
	targets: Record<
		string,
		{ directory: string; status: SyncPlacement["status"] }
	>;
	files: Record<string, string>;
}

interface PlacedFile {
	content: Buffer;
	file: RenderedFile;
	owners: Set<string>;
}

/**
 * Lay out the bundles of several targets in one repository: root-only hosts at
 * the root, other hosts at the root when no host would load another's files,
 * otherwise under `plugins/<target>/`, plus the marketplace catalogs that point
 * each host at its plugin.
 */
export function planSync(
	plugin: CliPluginInput,
	bundles: Map<string, TargetBundle>,
	layout: SyncLayout,
	repository: SyncRepositoryState = {},
): SyncPlan {
	const authored = repository.authored ?? new Map<string, Buffer>();
	const catalogIndents = repository.catalogIndents ?? new Map<string, string>();
	const manifest = getManifest(plugin);
	const placed = new Map<string, PlacedFile>();
	declaredReads.clear();
	optedInPaths.clear();
	for (const [target, bundle] of bundles) {
		optedInPaths.set(target, declaredPaths(target, bundle.files));
	}
	const cursorBundle = bundles.get("cursor");
	const cursorPaths = cursorBundle
		? cursorReads(cursorBundle.files)
		: undefined;
	if (cursorPaths) {
		declaredReads.set("cursor", cursorPaths);
	}
	const rootTargets: string[] = [];
	const placements: SyncPlacement[] = [];
	const notes: string[] = [];
	const errors: string[] = [];

	for (const target of SYNC_TARGET_ORDER) {
		const bundle = bundles.get(target);
		const rule = SYNC_TARGET_RULES[target];

		if (!bundle || !rule) {
			continue;
		}

		const projectOnly = bundle.files.filter((file) =>
			rule.projectOnly?.some((entry) =>
				entry.endsWith("/") ? file.path.startsWith(entry) : file.path === entry,
			),
		);
		const files = bundle.files.filter(
			(file) =>
				!projectOnly.includes(file) &&
				!BUNDLE_ONLY_FILES.has(file.path) &&
				!file.path.startsWith(".oiap/hooks/") &&
				!/^\.oiap\/[^/]+-permissions\.json$/.test(file.path),
		);

		if (projectOnly.length > 0) {
			notes.push(
				`${target}: left out ${projectOnly.length} project-only file(s) (${[
					...new Set(projectOnly.map((file) => file.path.split("/")[0])),
				].join(
					", ",
				)}) that a plugin installed from git never loads; use install-agent-plugin to install them into a project.`,
			);
		}
		let directory = "";

		if (rule.rootOnly) {
			// Hosts that must share the root share one copy of each file: the
			// first host's copy wins. Hook runtimes are target-specific, so a
			// clash there cannot be shared.
			const conflicts = pathConflicts(files, placed);

			for (const conflict of conflicts.filter((entry) =>
				entry.path.startsWith(".oiap/runtime/"),
			)) {
				errors.push(
					`${target} and ${conflict.owners} both need ${conflict.path} at the repository root with different content; build them from separate repositories.`,
				);
			}

			notes.push(
				...summarize(
					conflicts
						.filter((entry) => !entry.path.startsWith(".oiap/runtime/"))
						.map((entry) => ({
							key: `${target} uses the ${entry.owners} copy of`,
							path: entry.path,
						})),
				),
				...summarize(
					foreignReads(target, files, placed, rootTargets)
						.filter((entry) => !conflicts.some((c) => c.path === entry.path))
						.map((entry) => ({
							key: `${entry.reader} also loads, from ${entry.writer},`,
							path: entry.path,
						})),
				),
			);
		} else if (
			layout === "plugins" ||
			files.some((file) => {
				const own = authored.get(file.path);
				return own !== undefined && !own.equals(toBuffer(file.content));
			}) ||
			pathConflicts(files, placed).length > 0 ||
			foreignReads(target, files, placed, rootTargets).length > 0
		) {
			directory = `plugins/${target}`;
		}

		for (const file of files) {
			const path = directory ? `${directory}/${file.path}` : file.path;
			const existing = placed.get(path);

			if (existing) {
				existing.owners.add(target);
				continue;
			}

			placed.set(path, {
				content: toBuffer(file.content),
				file: { ...file, path },
				owners: new Set([target]),
			});
		}

		if (!directory) {
			rootTargets.push(target);
		}

		placements.push({
			target,
			directory,
			status: bundle.report.status,
			issues: bundle.report.issues,
		});
	}

	const marketplaceFiles = renderMarketplaces(manifest, placements).map(
		(file) => {
			const indent = catalogIndents.get(file.path);
			return indent === undefined ? file : reindent(file, indent);
		},
	);

	for (const file of marketplaceFiles) {
		if (placed.has(file.path)) {
			errors.push(`A marketplace catalog would overwrite ${file.path}.`);
			continue;
		}

		placed.set(file.path, {
			content: toBuffer(file.content),
			file,
			owners: new Set(["marketplace"]),
		});
	}

	const files = [...placed.values()]
		.filter((entry) => !authored.get(entry.file.path)?.equals(entry.content))
		.map((entry) => entry.file)
		.sort((left, right) => left.path.localeCompare(right.path));
	const lock: SyncLock = {
		plugin: manifest.id,
		version: manifest.version,
		layout,
		targets: Object.fromEntries(
			placements.map((placement) => [
				placement.target,
				{ directory: placement.directory, status: placement.status },
			]),
		),
		files: Object.fromEntries(
			files.map((file) => [file.path, hash(toBuffer(file.content))]),
		),
	};

	const owners = Object.fromEntries(
		[...placed].map(([path, entry]) => [path, [...entry.owners]]),
	);

	files.push({
		path: SYNC_LOCK_PATH,
		content: `${JSON.stringify(lock, null, "\t")}\n`,
	});

	return { files, owners, placements, notes, errors };
}

/** Group per-file notes by top-level directory: "<key> 12 file(s) in skills/". */
function summarize(entries: Array<{ key: string; path: string }>): string[] {
	const groups = new Map<string, number>();

	for (const entry of entries) {
		const slash = entry.path.indexOf("/");
		const area = slash === -1 ? entry.path : `${entry.path.slice(0, slash)}/`;
		const key = `${entry.key}\u0000${area}`;
		groups.set(key, (groups.get(key) ?? 0) + 1);
	}

	return [...groups].map(([key, count]) => {
		const [prefix, area] = key.split("\u0000");
		return area?.endsWith("/")
			? `${prefix} ${count} file(s) in ${area}`
			: `${prefix} ${area}`;
	});
}

function pathConflicts(
	files: RenderedFile[],
	placed: Map<string, PlacedFile>,
): Array<{ path: string; owners: string }> {
	return files.flatMap((file) => {
		const existing = placed.get(file.path);
		return existing && !existing.content.equals(toBuffer(file.content))
			? [{ path: file.path, owners: [...existing.owners].join(", ") }]
			: [];
	});
}

/**
 * Files one root host would load although another host wrote them: either an
 * existing root file inside this target's default paths, or one of this
 * target's files inside a root host's default paths. Identical files written
 * by both are shared, not foreign.
 */
function foreignReads(
	target: string,
	files: RenderedFile[],
	placed: Map<string, PlacedFile>,
	rootTargets: string[],
): Array<{ reader: string; writer: string; path: string }> {
	const own = new Map(files.map((file) => [file.path, toBuffer(file.content)]));
	const found: Array<{ reader: string; writer: string; path: string }> = [];

	for (const [path, entry] of placed) {
		const mine = own.get(path);

		if (
			reads(target, path) &&
			!optsIn(target, path) &&
			!mine?.equals(entry.content)
		) {
			found.push({
				reader: target,
				writer: [...entry.owners].join(", "),
				path,
			});
		}
	}

	for (const file of files) {
		const existing = placed.get(file.path);

		// An identical file is already there; nothing new is loaded.
		if (existing?.content.equals(toBuffer(file.content))) {
			continue;
		}

		for (const rootTarget of rootTargets) {
			if (reads(rootTarget, file.path) && !optsIn(rootTarget, file.path)) {
				found.push({ reader: rootTarget, writer: target, path: file.path });
			}
		}
	}

	return found;
}

/**
 * A read entry is a file path, a directory ending in "/", or "dir/*.ext" for
 * the files with that extension anywhere under dir (Claude Code loads only
 * Markdown commands; Gemini CLI only TOML ones).
 */
function reads(target: string, path: string): boolean {
	return (
		declaredReads.get(target) ??
		SYNC_TARGET_RULES[target]?.reads ??
		[]
	).some((entry) => {
		const star = entry.indexOf("/*.");
		if (star !== -1) {
			return (
				path.startsWith(entry.slice(0, star + 1)) &&
				path.endsWith(entry.slice(star + 2))
			);
		}
		return entry.endsWith("/") ? path.startsWith(entry) : path === entry;
	});
}

/**
 * Files a host's own manifest names explicitly, such as Cursor or Codex
 * `"mcpServers": "./.mcp.json"`: the author chose to share that file, so
 * loading it is not a foreign read. Directories (`skills/`) stay protected.
 */
const optedInPaths = new Map<string, string[]>();

const MANIFEST_FILES: Record<string, string> = {
	"claude-code": ".claude-plugin/plugin.json",
	codex: ".codex-plugin/plugin.json",
	cursor: ".cursor-plugin/plugin.json",
};

const COMPONENT_KEYS = [
	"skills",
	"agents",
	"commands",
	"rules",
	"hooks",
	"mcpServers",
	"lspServers",
	"apps",
];

function declaredPaths(target: string, files: RenderedFile[]): string[] {
	const manifestPath = MANIFEST_FILES[target];
	const manifestFile = files.find((file) => file.path === manifestPath);

	if (!manifestFile) {
		return [];
	}

	const manifest = JSON.parse(String(manifestFile.content)) as Record<
		string,
		unknown
	>;

	return COMPONENT_KEYS.flatMap((key) => {
		const value = manifest[key];
		const values = Array.isArray(value) ? value : [value];
		return values
			.filter((entry): entry is string => typeof entry === "string")
			.map((entry) => entry.replace(/^\.\//, ""))
			.filter((entry) => /\.[a-z]+$/i.test(entry) && !entry.endsWith("/"));
	});
}

function optsIn(target: string, path: string): boolean {
	return (optedInPaths.get(target) ?? []).includes(path);
}

/**
 * Cursor's manifest paths replace its default component locations
 * (https://cursor.com/docs/reference/plugins), so what it reads depends on the
 * manifest it was given. Filled in by planSync from each bundle.
 */
const declaredReads = new Map<string, string[]>();

const CURSOR_COMPONENTS: Record<string, string> = {
	skills: "skills/",
	agents: "agents/",
	commands: "commands/",
	rules: "rules/",
	hooks: "hooks/hooks.json",
	mcpServers: "mcp.json",
};

function cursorReads(files: RenderedFile[]): string[] | undefined {
	const manifestFile = files.find(
		(file) => file.path === ".cursor-plugin/plugin.json",
	);

	if (!manifestFile) {
		return undefined;
	}

	const manifest = JSON.parse(String(manifestFile.content)) as Record<
		string,
		unknown
	>;

	return [
		".cursor-plugin/plugin.json",
		...Object.entries(CURSOR_COMPONENTS).map(([key, fallback]) => {
			const declared = manifest[key];
			if (typeof declared !== "string") {
				return fallback;
			}
			const path = declared.replace(/^\.\//, "");
			return fallback.endsWith("/") && !path.endsWith("/") ? `${path}/` : path;
		}),
	];
}

function renderMarketplaces(
	manifest: PluginManifest,
	placements: SyncPlacement[],
): RenderedFile[] {
	const settings = manifest.marketplace ?? {};
	const catalogName = settings.name ?? manifest.id;
	const owner = settings.owner ?? manifest.author ?? { name: manifest.name };
	const source = (placement: SyncPlacement): string =>
		placement.directory ? `./${placement.directory}` : "./";
	const placementFor = (kind: MarketplaceKind): SyncPlacement | undefined =>
		placements.find(
			(placement) => SYNC_TARGET_RULES[placement.target]?.marketplace === kind,
		);
	// Fields every catalog format accepts for an entry; hosts ignore the rest.
	const entry = (placement: SyncPlacement): Record<string, unknown> =>
		mergeTargetMetadata(
			mergeTargetMetadata(
				omitUndefined({
					name: manifest.id,
					source: source(placement),
					description: manifest.description,
					version: manifest.version,
					author: manifest.author,
					homepage: manifest.homepage,
					repository: manifest.repository,
					license: manifest.license,
					keywords: manifest.keywords,
					category: manifest.categories[0],
				}),
				settings.entry,
			),
			settings.targetMetadata?.[placement.target]?.entry,
		);
	const catalog = (
		placement: SyncPlacement,
		base: Record<string, unknown>,
	): Record<string, unknown> =>
		mergeTargetMetadata(
			base,
			settings.targetMetadata?.[placement.target]?.catalog,
		);
	const files: RenderedFile[] = [];

	// https://code.claude.com/docs/en/plugins/marketplace-reference
	const claude = placementFor("claude");
	if (claude) {
		files.push(
			jsonFile(
				".claude-plugin/marketplace.json",
				catalog(
					claude,
					omitUndefined({
						name: catalogName,
						owner,
						metadata: settings.description
							? { description: settings.description }
							: undefined,
						plugins: [entry(claude)],
					}),
				),
			),
		);
	}

	// https://developers.openai.com/codex/plugins/build
	const codex = placementFor("codex");
	if (codex) {
		files.push(
			jsonFile(
				".agents/plugins/marketplace.json",
				catalog(codex, {
					name: catalogName,
					interface: { displayName: manifest.displayName ?? manifest.name },
					plugins: [
						mergeTargetMetadata(
							mergeTargetMetadata(
								omitUndefined({
									name: manifest.id,
									source: source(codex),
									policy: {
										installation: "AVAILABLE",
										authentication: "ON_INSTALL",
									},
									category: manifest.categories[0],
								}),
								settings.entry,
							),
							settings.targetMetadata?.codex?.entry,
						),
					],
				}),
			),
		);
	}

	// https://cursor.com/docs/reference/plugins
	const cursor = placementFor("cursor");
	if (cursor) {
		files.push(
			jsonFile(
				".cursor-plugin/marketplace.json",
				catalog(
					cursor,
					omitUndefined({
						name: catalogName,
						owner,
						metadata: settings.description
							? { description: settings.description }
							: undefined,
						plugins: [entry(cursor)],
					}),
				),
			),
		);
	}

	// https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference
	const copilot = placementFor("copilot");
	if (copilot) {
		files.push(
			jsonFile(
				".github/plugin/marketplace.json",
				catalog(
					copilot,
					omitUndefined({
						name: catalogName,
						owner,
						metadata: settings.description
							? { description: settings.description }
							: undefined,
						plugins: [entry(copilot)],
					}),
				),
			),
		);
	}

	return files;
}

export interface SyncOptions {
	inputPath: string;
	repoDir: string;
	layout: SyncLayout;
	targets?: string[];
	exportName?: string;
	check: boolean;
	/** Overwrite files that exist but were not written by a previous sync. */
	force?: boolean;
}

export interface SyncDifference {
	path: string;
	kind: "missing" | "changed" | "stale" | "hand-written";
}

export interface SyncResult {
	plan: SyncPlan;
	differences: SyncDifference[];
	written: string[];
	removed: string[];
}

export async function syncPluginFile(
	options: SyncOptions,
): Promise<SyncResult> {
	const plugin = await loadPluginFile(options.inputPath, options.exportName);
	const selected = selectSyncTargets(plugin, options.targets);
	// Copilot CLI and VS Code read the same catalog, and VS Code discovers
	// plugins installed with Copilot CLI, so one Copilot plugin serves both.
	const servesVsCode =
		selected.includes("github-copilot-cli") &&
		selected.includes("vscode-copilot-chat");
	// A root Agent Plugins manifest is what Copilot CLI and VS Code read first,
	// so it serves them both.
	const servedByAgentPlugins: string[] = selected.includes("agent-plugins")
		? selected.filter(
				(target) =>
					target === "github-copilot-cli" || target === "vscode-copilot-chat",
			)
		: [];
	const targets = selected.filter(
		(target) =>
			!servedByAgentPlugins.includes(target) &&
			!(servesVsCode && target === "vscode-copilot-chat"),
	);
	const bundles = new Map<string, TargetBundle>();

	for (const target of targets) {
		const exporter = getRegisteredExporter(target);

		if (!exporter) {
			throw new Error(`No exporter registered for target: ${target}`);
		}

		bundles.set(
			target,
			await bundleHooksFromSource(
				exporter.exportBundle(plugin),
				options.inputPath,
				options.exportName,
			),
		);
	}

	const repoDir = resolve(options.repoDir);
	const previous = await readLock(repoDir);
	const catalogIndents = await matchJsonIndentation(repoDir, bundles);
	const plan = planSync(plugin, bundles, options.layout, {
		authored: await authorFiles(repoDir, bundles, previous),
		catalogIndents,
	});

	if (servedByAgentPlugins.length > 0) {
		plan.notes.push(
			`${servedByAgentPlugins.join(" and ")} ${servedByAgentPlugins.length === 1 ? "reads" : "read"} the root Agent Plugins plugin.json, so the agent-plugins target serves ${servedByAgentPlugins.length === 1 ? "it" : "them"}; ship Copilot-only agents or hooks with targetFiles["agent-plugins"] under com.github.copilot/.`,
		);
	} else if (servesVsCode) {
		plan.notes.push(
			"vscode-copilot-chat is served by the github-copilot-cli plugin: VS Code reads the same .github/plugin/marketplace.json and discovers plugins installed with Copilot CLI.",
		);
	}

	if (targets.includes("gemini-cli")) {
		plan.notes.push(
			"Gemini CLI installs the latest GitHub Release instead of the default branch when the repository has releases; keep releases off this repository or attach the full tree.",
		);
	}

	const differences = await diffRepository(repoDir, plan.files, previous);
	const result: SyncResult = { plan, differences, written: [], removed: [] };

	if (options.check || plan.errors.length > 0) {
		return result;
	}

	const handWritten = differences.filter(
		(difference) => difference.kind === "hand-written",
	);

	if (handWritten.length > 0 && !options.force) {
		throw new Error(
			`Refusing to overwrite files that a previous sync did not write: ${handWritten
				.map(
					(difference) =>
						`${difference.path} (${(plan.owners[difference.path] ?? []).join(", ")})`,
				)
				.join(
					", ",
				)}. Move them, leave out the target that writes them with --target, or pass --force to overwrite them.`,
		);
	}

	for (const difference of differences) {
		const target = resolveRepoPath(repoDir, difference.path);

		if (difference.kind === "stale") {
			// Only remove a file that is still exactly what the last sync wrote.
			const current = await readOptional(target);
			const expected = previous?.files[difference.path];

			if (current && expected && hash(current) !== expected) {
				plan.notes.push(
					`Kept ${difference.path}: it changed since the last sync. Delete it by hand if it is no longer needed.`,
				);
				continue;
			}

			await rm(target, { force: true });
			await removeEmptyParents(repoDir, dirname(target));
			result.removed.push(difference.path);
			continue;
		}

		const file = plan.files.find((entry) => entry.path === difference.path);

		if (!file) {
			continue;
		}

		await mkdir(dirname(target), { recursive: true });
		await writeFile(
			target,
			file.content,
			file.mode === undefined ? undefined : { mode: file.mode },
		);
		result.written.push(difference.path);
	}

	return result;
}

/**
 * Write generated JSON with the indentation the repository already uses: the
 * existing file's, else the root package.json's. A first sync then changes
 * only the values that differ, not every line.
 */
const VERBATIM_KINDS = new Set(["skill-file", "resource", "target-file"]);

const CATALOG_PATHS = [
	".claude-plugin/marketplace.json",
	".agents/plugins/marketplace.json",
	".cursor-plugin/marketplace.json",
	".github/plugin/marketplace.json",
];

async function matchJsonIndentation(
	repoDir: string,
	bundles: Map<string, TargetBundle>,
): Promise<Map<string, string>> {
	const packageJson = await readOptional(
		resolveRepoPath(repoDir, "package.json"),
	);
	const fallback = packageJson
		? jsonIndent(packageJson.toString("utf8"))
		: undefined;

	for (const [target, bundle] of bundles) {
		const files: RenderedFile[] = [];

		for (const file of bundle.files) {
			// Files copied as written (skill files, resources, target files) keep
			// their exact bytes; only JSON OIAP generates is reindented.
			if (
				!file.path.endsWith(".json") ||
				typeof file.content !== "string" ||
				VERBATIM_KINDS.has(file.source?.primitiveKind ?? "")
			) {
				files.push(file);
				continue;
			}

			const existing = await readOptional(resolveRepoPath(repoDir, file.path));
			const indent = existing
				? jsonIndent(existing.toString("utf8"))
				: fallback;

			files.push(indent === undefined ? file : reindent(file, indent));
		}

		bundles.set(target, { ...bundle, files });
	}

	// Indentation for the catalogs sync writes itself.
	const catalogIndents = new Map<string, string>();

	for (const path of CATALOG_PATHS) {
		const existing = await readOptional(resolveRepoPath(repoDir, path));
		const indent = existing ? jsonIndent(existing.toString("utf8")) : fallback;

		if (indent !== undefined) {
			catalogIndents.set(path, indent);
		}
	}

	return catalogIndents;
}

function jsonIndent(text: string): string | undefined {
	const match = /^[[{]\s*\n([ \t]+)\S/m.exec(text);
	return match?.[1];
}

function reindent(file: RenderedFile, indent: string): RenderedFile {
	try {
		const value: unknown = JSON.parse(String(file.content));
		return { ...file, content: `${JSON.stringify(value, null, indent)}\n` };
	} catch {
		return file;
	}
}

/**
 * Paths some target would write that already exist in the repository without
 * a previous sync having written them: the author's files, with their content.
 */
async function authorFiles(
	repoDir: string,
	bundles: Map<string, TargetBundle>,
	previous: SyncLock | undefined,
): Promise<Map<string, Buffer>> {
	const generated = new Set(Object.keys(previous?.files ?? {}));
	const candidates = new Set(
		[...bundles.values()].flatMap((bundle) =>
			bundle.files.map((file) => file.path),
		),
	);
	const authored = new Map<string, Buffer>();

	for (const path of candidates) {
		if (generated.has(path) || BUNDLE_ONLY_FILES.has(path)) {
			continue;
		}

		const content = await readOptional(resolveRepoPath(repoDir, path));

		if (content) {
			authored.set(path, content);
		}
	}

	return authored;
}

export function selectSyncTargets(
	plugin: CliPluginInput,
	requested?: string[],
): string[] {
	if (requested && requested.length > 0) {
		const unknown = requested.filter((target) => !SYNC_TARGET_RULES[target]);

		if (unknown.length > 0) {
			throw new Error(
				`oiap sync writes hosts that install plugins from git: ${syncTargets.join(", ")}. ${unknown.join(", ")} install into a project; use install-agent-plugin for them.`,
			);
		}

		return SYNC_TARGET_ORDER.filter((target) => requested.includes(target));
	}

	const supported = getManifest(plugin).supportedTargets;

	return SYNC_TARGET_ORDER.filter(
		(target) => supported.length === 0 || supported.includes(target),
	);
}

async function diffRepository(
	repoDir: string,
	files: RenderedFile[],
	previous: SyncLock | undefined,
): Promise<SyncDifference[]> {
	const differences: SyncDifference[] = [];
	const desired = new Set(files.map((file) => file.path));
	const previouslyWritten = new Set(Object.keys(previous?.files ?? {}));
	previouslyWritten.add(SYNC_LOCK_PATH);

	for (const file of files) {
		const current = await readOptional(resolveRepoPath(repoDir, file.path));

		if (!current) {
			differences.push({ path: file.path, kind: "missing" });
		} else if (!current.equals(toBuffer(file.content))) {
			differences.push({
				path: file.path,
				kind: previouslyWritten.has(file.path) ? "changed" : "hand-written",
			});
		}
	}

	for (const path of [...previouslyWritten].sort()) {
		if (!desired.has(path) && existsSync(resolveRepoPath(repoDir, path))) {
			differences.push({ path, kind: "stale" });
		}
	}

	return differences;
}

async function readLock(repoDir: string): Promise<SyncLock | undefined> {
	const content = await readOptional(resolveRepoPath(repoDir, SYNC_LOCK_PATH));

	if (!content) {
		return undefined;
	}

	try {
		return JSON.parse(content.toString("utf8")) as SyncLock;
	} catch {
		throw new Error(`${SYNC_LOCK_PATH} is not valid JSON.`);
	}
}

async function readOptional(path: string): Promise<Buffer | undefined> {
	try {
		return await readFile(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		}
		throw error;
	}
}

async function removeEmptyParents(
	repoDir: string,
	directory: string,
): Promise<void> {
	let current = directory;

	while (current !== repoDir && isInside(repoDir, current)) {
		const entries = await readdir(current).catch(() => undefined);

		if (!entries || entries.length > 0) {
			return;
		}

		await rmdir(current);
		current = dirname(current);
	}
}

function resolveRepoPath(repoDir: string, path: string): string {
	const target = resolve(repoDir, ...path.split("/"));

	if (!isInside(repoDir, target) || target === repoDir) {
		throw new Error(`Refusing to write outside the repository: ${path}`);
	}

	return target;
}

function isInside(parent: string, child: string): boolean {
	const path = relative(parent, child);
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

function getManifest(plugin: CliPluginInput): PluginManifest {
	if (!plugin.manifest) {
		throw new Error("oiap sync needs a plugin manifest with id and version.");
	}

	return plugin.manifest;
}

function jsonFile(path: string, value: unknown): RenderedFile {
	return { path, content: `${JSON.stringify(value, null, "\t")}\n` };
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

function toBuffer(content: string | Uint8Array): Buffer {
	return typeof content === "string"
		? Buffer.from(content, "utf8")
		: Buffer.from(content);
}

function hash(content: Buffer): string {
	return createHash("sha256").update(content).digest("hex");
}
