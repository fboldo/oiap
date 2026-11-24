/**
 * Checks that every internal link and asset in the built site resolves under
 * the `/oiap` base, including `#fragment` targets. Run after `astro build`:
 * `bun scripts/check-links.ts`.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const BASE = "/oiap";
const DIST = resolve(import.meta.dir, "../dist");

function htmlFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return htmlFiles(path);
		}
		return entry.name.endsWith(".html") ? [path] : [];
	});
}

/** Maps a site path to the built file that serves it. */
function builtFile(pathname: string): string | undefined {
	const path = join(DIST, decodeURIComponent(pathname.slice(BASE.length)));
	if (existsSync(path) && statSync(path).isFile()) {
		return path;
	}
	const index = join(path, "index.html");
	return existsSync(index) ? index : undefined;
}

const idCache = new Map<string, Set<string>>();

async function ids(file: string): Promise<Set<string>> {
	const cached = idCache.get(file);
	if (cached) {
		return cached;
	}
	const html = await Bun.file(file).text();
	const found = new Set(
		[...html.matchAll(/\sid="([^"]+)"/g)].flatMap((match) =>
			match[1] ? [match[1]] : [],
		),
	);
	idCache.set(file, found);
	return found;
}

const problems: string[] = [];
const files = htmlFiles(DIST);

for (const file of files) {
	const html = await Bun.file(file).text();
	const page = `/${relative(DIST, file)}`;
	for (const match of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
		const url = match[1] ?? "";
		if (!url.startsWith("/") || url.startsWith("//")) {
			continue;
		}
		if (!url.startsWith(`${BASE}/`) && url !== BASE) {
			problems.push(`${page}: ${url} is outside ${BASE}/`);
			continue;
		}
		const [pathname = "", fragment] = url.split("#");
		const target = builtFile(pathname.split("?")[0] ?? "");
		if (!target) {
			problems.push(`${page}: ${url} does not exist`);
			continue;
		}
		if (
			fragment &&
			target.endsWith(".html") &&
			!(await ids(target)).has(decodeURIComponent(fragment))
		) {
			problems.push(`${page}: ${url} has no #${fragment}`);
		}
	}
}

if (problems.length > 0) {
	console.error(problems.join("\n"));
	console.error(`check-links: ${problems.length} broken link(s)`);
	process.exit(1);
}

console.log(`check-links: ${files.length} pages, all internal links resolve`);
