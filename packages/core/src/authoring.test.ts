/// <reference types="bun" />

import { describe, expect, test } from "bun:test";
import { markdownFile } from "./authoring";

describe("markdownFile", () => {
	test("reads markdown relative to the calling module", () => {
		expect(markdownFile("fixtures/authoring-markdown.md")).toBe(
			"# Authoring Markdown\n\nLoaded from a file.",
		);
	});

	test("reads markdown relative to an explicit base URL", () => {
		expect(
			markdownFile("fixtures/authoring-markdown.md", {
				baseUrl: import.meta.url,
			}),
		).toContain("Loaded from a file.");
	});

	test("throws a clear error for missing markdown files", () => {
		expect(() => markdownFile("fixtures/missing.md")).toThrow(
			/Markdown file not found:/,
		);
	});
});
