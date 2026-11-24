/**
 * Generates documentation pages from Markdown that already lives in the
 * repository (MATRIX.md, ARCHITECTURE.md, package and example READMEs), so
 * the site never drifts from the source files. Pages are written under
 * `src/content/docs/` at their URL path (Starlight builds sidebar groups from
 * file paths), into the gitignored locations listed in `GENERATED`.
 *
 * Run with `bun scripts/sync-content.ts` (the `dev`, `build` and `check`
 * scripts run it first).
 */
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { plugin } from "bun";

const REPO_URL = "https://github.com/fboldo/oiap";
const BLOB_URL = `${REPO_URL}/blob/main`;
const TREE_URL = `${REPO_URL}/tree/main`;
const EDIT_URL = `${REPO_URL}/edit/main`;
const RAW_URL = "https://raw.githubusercontent.com/fboldo/oiap/main";
const BASE = "/oiap";

const ROOT = resolve(import.meta.dir, "../..");
const CONTENT = resolve(import.meta.dir, "../src/content/docs");

/** Paths under CONTENT owned by this script; keep in sync with docs/.gitignore. */
const GENERATED = [
	"targets",
	"examples",
	"reference/packages",
	"reference/architecture.md",
];

interface Page {
	/** Site path without base or slashes, such as `targets/claude-code`. */
	slug: string;
	/** Repository-relative source file; unset for pages assembled from several files. */
	source?: string;
	title: string;
	description?: string;
	order?: number;
	sidebarLabel?: string;
	body: string;
}

interface MatrixRow {
	name: string;
	cells: string[];
	adapter: string;
}

interface InstallPath {
	base: string;
	segments: string[];
}

interface Target {
	id: string;
	name: string;
	directory: string;
	packageName: string;
	description: string;
	readme: string;
	row?: MatrixRow;
	notes?: string;
	paths: Partial<Record<"local" | "global", InstallPath>>;
}

// Exporter profiles import `defineHostProfile` from @oiap/core, an identity
// helper. Resolve it here so loading a profile needs no repository install.
plugin({
	name: "oiap-core-stub",
	setup(build) {
		build.module("@oiap/core", () => ({
			loader: "object",
			exports: { defineHostProfile: (profile: unknown) => profile },
		}));
	},
});

function read(path: string): Promise<string> {
	return Bun.file(join(ROOT, path)).text();
}

function readJson<T>(path: string): Promise<T> {
	return Bun.file(join(ROOT, path)).json() as Promise<T>;
}

function listDirectories(path: string): string[] {
	return readdirSync(join(ROOT, path), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name)
		.sort();
}

/** Splits a Markdown file into its first H1 and the rest. */
function splitTitle(markdown: string): { title?: string; body: string } {
	const match = /^\s*# (.+)\n/.exec(markdown);
	if (!match) {
		return { body: markdown };
	}
	return {
		title: match[1]?.trim(),
		body: markdown.slice(match[0].length),
	};
}

/** Returns the body of a `##`/`###` section, without its heading. */
function section(markdown: string, heading: string, level = 3): string {
	const marks = "#".repeat(level);
	const lines = markdown.split("\n");
	const start = lines.indexOf(`${marks} ${heading}`);
	if (start === -1) {
		return "";
	}
	const rest = lines.slice(start + 1);
	const end = rest.findIndex((line) =>
		new RegExp(`^#{1,${level}} `).test(line),
	);
	return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

function tableCells(line: string): string[] {
	return line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map((cell) => cell.trim());
}

function parseCapabilityMatrix(matrix: string): {
	header: string[];
	rows: MatrixRow[];
} {
	const lines = section(matrix, "Capability Matrix", 2)
		.split("\n")
		.filter((line) => line.startsWith("|"));
	const [headerLine, , ...rowLines] = lines;
	const header = headerLine ? tableCells(headerLine) : [];
	const rows = rowLines.map((line) => {
		const cells = tableCells(line);
		return {
			name: cells[0] ?? "",
			cells,
			adapter: (cells.at(-1) ?? "").replaceAll("`", ""),
		};
	});
	return { header, rows };
}

function siteLink(slug: string, anchor = ""): string {
	return `${BASE}/${slug}/${anchor}`;
}

/** Maps a repository path to a site page when one exists. */
function pageForRepoPath(
	repoPath: string,
	targets: Map<string, string>,
): string | undefined {
	const path = repoPath.replace(/\/README\.md$/, "").replace(/\/$/, "");
	if (path === "MATRIX.md") {
		return "targets/matrix";
	}
	if (path === "ARCHITECTURE.md") {
		return "reference/architecture";
	}
	const packageMatch = /^packages\/([^/]+)$/.exec(path);
	if (packageMatch?.[1]) {
		const target = targets.get(packageMatch[1]);
		return target
			? `targets/${target}`
			: `reference/packages/${packageMatch[1]}`;
	}
	const exampleMatch = /^examples\/([^/]+)$/.exec(path);
	if (exampleMatch?.[1]) {
		return `examples/${exampleMatch[1]}`;
	}
	return undefined;
}

/**
 * Rewrites repository-relative links to site pages where one exists and to
 * GitHub otherwise. Fenced code blocks are left alone.
 */
function rewriteLinks(
	markdown: string,
	source: string,
	targets: Map<string, string>,
): string {
	const sourceDir = posix.dirname(source);
	let inFence = false;

	return markdown
		.split("\n")
		.map((line) => {
			if (/^\s*(```|~~~)/.test(line)) {
				inFence = !inFence;
				return line;
			}
			if (inFence) {
				return line;
			}
			return line.replace(
				/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g,
				(match, bang: string, text: string, href: string) => {
					if (/^([a-z]+:|#|\/)/i.test(href)) {
						return match;
					}
					const [pathPart = "", anchor = ""] = href.split(/(?=#)/);
					const repoPath = posix.normalize(posix.join(sourceDir, pathPart));
					if (bang) {
						return `![${text}](${RAW_URL}/${repoPath})`;
					}
					const page = pageForRepoPath(repoPath, targets);
					if (page) {
						return `[${text}](${siteLink(page, anchor)})`;
					}
					const absolute = join(ROOT, repoPath);
					const isDirectory =
						existsSync(absolute) && statSync(absolute).isDirectory();
					return `[${text}](${isDirectory ? TREE_URL : BLOB_URL}/${repoPath}${anchor})`;
				},
			);
		})
		.join("\n");
}

function yamlString(value: string): string {
	return JSON.stringify(value);
}

function sidebarFrontmatter(page: Page): string[] {
	const lines = [
		...(page.order === undefined ? [] : [`  order: ${page.order}`]),
		...(page.sidebarLabel ? [`  label: ${yamlString(page.sidebarLabel)}`] : []),
	];
	return lines.length > 0 ? ["sidebar:", ...lines] : [];
}

function renderPage(page: Page, targets: Map<string, string>): string {
	const frontmatter = [
		"---",
		`title: ${yamlString(page.title)}`,
		...(page.description
			? [`description: ${yamlString(page.description)}`]
			: []),
		`editUrl: ${page.source ? `${EDIT_URL}/${page.source}` : "false"}`,
		...sidebarFrontmatter(page),
		"---",
	];
	const notice = page.source
		? `<!-- Generated by docs/scripts/sync-content.ts from ${page.source}. Edit that file instead. -->`
		: "<!-- Generated by docs/scripts/sync-content.ts. -->";
	const body = page.source
		? rewriteLinks(page.body.trim(), page.source, targets)
		: page.body.trim();
	return `${frontmatter.join("\n")}\n\n${notice}\n\n${body}\n`;
}

function formatInstallPath(path: InstallPath): string {
	const base =
		path.base === "home"
			? "~"
			: path.base === "xdg-config-home"
				? "$XDG_CONFIG_HOME"
				: ".";
	const segments = path.segments.map((segment) =>
		segment.replace("{pluginId}", "<plugin-id>"),
	);
	return [base, ...segments].join("/");
}

async function loadInstallPaths(directory: string): Promise<Target["paths"]> {
	const profilePath = join(ROOT, "packages", directory, "src/profile.ts");
	if (!existsSync(profilePath)) {
		return {};
	}
	const module = (await import(profilePath)) as Record<string, unknown>;
	for (const value of Object.values(module)) {
		if (value && typeof value === "object" && "installSupport" in value) {
			const support = (value as { installSupport?: { paths?: unknown } })
				.installSupport;
			return (support?.paths ?? {}) as Target["paths"];
		}
	}
	return {};
}

async function loadSyncTargets(): Promise<string[]> {
	const source = await read("packages/cli/src/sync.ts");
	const match = /const SYNC_TARGET_ORDER = \[([^\]]*)\]/.exec(source);
	return [...(match?.[1] ?? "").matchAll(/"([^"]+)"/g)].flatMap((item) =>
		item[1] ? [item[1]] : [],
	);
}

async function loadTargets(matrix: string): Promise<Target[]> {
	const { rows } = parseCapabilityMatrix(matrix);
	const directories = listDirectories("packages").filter((name) =>
		name.startsWith("exporter-"),
	);

	return Promise.all(
		directories.map(async (directory) => {
			const pkg = await readJson<{ name: string; description?: string }>(
				`packages/${directory}/package.json`,
			);
			const profile = await read(`packages/${directory}/src/profile.ts`);
			const id = /_TARGET = "([^"]+)"/.exec(profile)?.[1];
			if (!id) {
				throw new Error(`No target id found in packages/${directory}`);
			}
			const row = rows.find((item) => item.adapter === `packages/${directory}`);
			const name = row?.name ?? id;
			return {
				id,
				name,
				directory,
				packageName: pkg.name,
				description: pkg.description ?? "",
				readme: await read(`packages/${directory}/README.md`),
				row,
				notes: row ? section(matrix, row.name) : undefined,
				paths: await loadInstallPaths(directory),
			};
		}),
	);
}

function targetPage(
	target: Target,
	order: number,
	header: string[],
	syncTargets: string[],
): Page {
	const { body } = splitTitle(target.readme);
	const viaSync = syncTargets.includes(target.id);
	const ships = viaSync
		? "`oiap sync` (git install) or `install-agent-plugin`"
		: "`install-agent-plugin`";
	const parts = [
		"| Target id | Package | Ship with |",
		"| --- | --- | --- |",
		`| \`${target.id}\` | [\`${target.packageName}\`](https://www.npmjs.com/package/${target.packageName}) | ${ships} |`,
		"",
		"```sh",
		`npx oiap build oiap.plugin.ts --target ${target.id} --out dist/${target.id}`,
		`npx install-agent-plugin <owner>/<repo> --plugin <plugin-id> --agent ${target.id}`,
		"```",
		"",
		body.trim(),
	];

	if (target.paths.local || target.paths.global) {
		parts.push(
			"",
			"## Install paths",
			"",
			"Where `install-agent-plugin` and `installPlugin()` write the bundle, from the target profile. `--out <dir>` overrides them.",
			"",
			"| Scope | Path |",
			"| --- | --- |",
		);
		if (target.paths.local) {
			parts.push(
				`| Local (default) | \`${formatInstallPath(target.paths.local)}\` |`,
			);
		}
		if (target.paths.global) {
			parts.push(
				`| Global (\`--global\`) | \`${formatInstallPath(target.paths.global)}\` |`,
			);
		}
	}

	if (target.row) {
		parts.push(
			"",
			"## Support matrix",
			"",
			`From the [platform support matrix](${siteLink("targets/matrix")}) (see its [legend](${siteLink("targets/matrix", "#legend")})).`,
			"",
			`| ${header.slice(1, -1).join(" | ")} |`,
			`| ${header
				.slice(1, -1)
				.map(() => "---")
				.join(" | ")} |`,
			`| ${target.row.cells.slice(1, -1).join(" | ")} |`,
		);
	}

	if (target.notes) {
		parts.push("", "## Platform notes", "", target.notes);
	}

	return {
		slug: `targets/${target.id}`,
		source: `packages/${target.directory}/README.md`,
		title: target.name,
		description: target.description,
		order,
		body: parts.join("\n"),
	};
}

function targetsOverview(targets: Target[], syncTargets: string[]): Page {
	const rows = targets.map((target) => {
		const ships = syncTargets.includes(target.id)
			? "`oiap sync` or `install-agent-plugin`"
			: "`install-agent-plugin`";
		return `| [${target.name}](${siteLink(`targets/${target.id}`)}) | \`${target.id}\` | [\`${target.packageName}\`](https://www.npmjs.com/package/${target.packageName}) | ${ships} |`;
	});
	return {
		slug: "targets",
		title: "Targets",
		description:
			"The agent hosts OIAP exports to, their target ids and how each one is shipped.",
		order: 0,
		sidebarLabel: "Overview",
		body: [
			"Every target has an exporter package that the CLI registers. Pass the target id to `oiap build --target`, `oiap sync --target` or `install-agent-plugin --agent`; `npx oiap targets` lists them.",
			"",
			"| Host | Target id | Exporter | Ship with |",
			"| --- | --- | --- | --- |",
			...rows,
			"",
			`Targets that install from git are written by [\`oiap sync\`](${siteLink("guides/oiap-sync")}); the others read files from the user's project and are installed with [\`install-agent-plugin\`](${siteLink("guides/install-agent-plugin")}). See [Two ways to ship a plugin](${siteLink("start/two-ways-to-ship")}).`,
			"",
			`The [support matrix](${siteLink("targets/matrix")}) covers these targets and the hosts OIAP has researched but does not export to yet.`,
		].join("\n"),
	};
}

async function readmePage(
	path: string,
	slug: string,
	options: { title?: string; description?: string; footer?: string } = {},
): Promise<Page> {
	const { title, body } = splitTitle(await read(path));
	return {
		slug,
		source: path,
		title: options.title ?? title ?? slug,
		description: options.description,
		body: options.footer ? `${body.trim()}\n\n${options.footer}` : body,
	};
}

async function packagePages(targets: Target[]): Promise<Page[]> {
	const byDirectory = new Map(
		targets.map((target) => [target.directory, target]),
	);
	const pages: Page[] = [];
	const rows: string[] = [];

	for (const directory of listDirectories("packages")) {
		const pkg = await readJson<{
			name: string;
			description?: string;
			private?: boolean;
		}>(`packages/${directory}/package.json`);
		const target = byDirectory.get(directory);
		const slug = target
			? `targets/${target.id}`
			: `reference/packages/${directory}`;
		rows.push(
			`| [\`${pkg.name}\`](${siteLink(slug)}) | ${pkg.description ?? ""} | [npm](https://www.npmjs.com/package/${pkg.name}) · [source](${TREE_URL}/packages/${directory}) |`,
		);
		if (!target) {
			pages.push(
				await readmePage(`packages/${directory}/README.md`, slug, {
					description: pkg.description,
					footer: `Source: [\`packages/${directory}\`](${TREE_URL}/packages/${directory}) · npm: [\`${pkg.name}\`](https://www.npmjs.com/package/${pkg.name})`,
				}),
			);
		}
	}

	pages.push({
		slug: "reference/packages",
		title: "Packages",
		description: "Every package published from the OIAP monorepo.",
		order: 0,
		sidebarLabel: "Overview",
		body: [
			"All `@oiap/*` packages share one version (Lerna fixed versioning). Exporter packages are documented on their target pages.",
			"",
			"| Package | Description | Links |",
			"| --- | --- | --- |",
			...rows,
		].join("\n"),
	});

	return pages;
}

async function examplePages(): Promise<Page[]> {
	return Promise.all(
		listDirectories("examples").map((directory) =>
			readmePage(`examples/${directory}/README.md`, `examples/${directory}`, {
				footer: `Source: [\`examples/${directory}\`](${TREE_URL}/examples/${directory}) ([\`oiap.plugin.ts\`](${BLOB_URL}/examples/${directory}/oiap.plugin.ts))`,
			}),
		),
	);
}

async function main(): Promise<void> {
	const matrix = await read("MATRIX.md");
	const { header } = parseCapabilityMatrix(matrix);
	const targets = (await loadTargets(matrix)).sort((a, b) =>
		a.id.localeCompare(b.id),
	);
	const syncTargets = await loadSyncTargets();
	const targetsByDirectory = new Map(
		targets.map((target) => [target.directory, target.id]),
	);

	const pages: Page[] = [
		targetsOverview(targets, syncTargets),
		{
			...(await readmePage("MATRIX.md", "targets/matrix", {
				title: "Support matrix",
				description:
					"Which surfaces each agent host supports and which OIAP exporters exist.",
			})),
			order: 1,
		},
		{
			...(await readmePage("ARCHITECTURE.md", "reference/architecture", {
				title: "Architecture",
				description:
					"OIAP's authoring model, glossary, primitives, export pipeline and runtime bridge.",
			})),
		},
		...targets.map((target, index) =>
			targetPage(target, 10 + index, header, syncTargets),
		),
		...(await packagePages(targets)),
		...(await examplePages()),
	];

	for (const path of GENERATED) {
		rmSync(join(CONTENT, path), { recursive: true, force: true });
	}
	for (const page of pages) {
		// A slug with child pages becomes that directory's index page.
		const isIndex = pages.some((other) =>
			other.slug.startsWith(`${page.slug}/`),
		);
		const path = isIndex ? `${page.slug}/index.md` : `${page.slug}.md`;
		if (
			!GENERATED.some((root) => path === root || path.startsWith(`${root}/`))
		) {
			throw new Error(
				`${path} is not under a generated path; add it to GENERATED and docs/.gitignore`,
			);
		}
		const file = join(CONTENT, path);
		mkdirSync(dirname(file), { recursive: true });
		await Bun.write(file, renderPage(page, targetsByDirectory));
	}

	console.log(
		`sync-content: wrote ${pages.length} pages under ${relative(process.cwd(), CONTENT)}`,
	);
}

await main();
