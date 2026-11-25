/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isEntrypoint } from "./cli.ts";

describe("isEntrypoint", () => {
	test("matches a bin started through a symlink, as npm's .bin does", () => {
		const directory = mkdtempSync(join(tmpdir(), "oiap-bin-"));
		const target = resolve(import.meta.dir, "cli.ts");
		const link = join(directory, "bin");
		symlinkSync(target, link);

		try {
			expect(isEntrypoint(link, pathToFileURL(target).href)).toBe(true);
			expect(isEntrypoint(link, pathToFileURL(import.meta.path).href)).toBe(
				false,
			);
			expect(isEntrypoint(undefined, pathToFileURL(target).href)).toBe(false);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
});
