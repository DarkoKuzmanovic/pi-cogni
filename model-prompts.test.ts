/**
 * Tests for model-prompts matching logic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PromptFile } from "./model-prompts.ts";
import {
	findMatchingPrompts,
	findPromptMatch,
	analyzePromptFiles,
} from "./model-prompts.ts";

function pf(stem: string, content?: string): PromptFile {
	return { stem: stem.toLowerCase(), fullPath: `/tmp/${stem}.md`, content };
}

describe("findMatchingPrompts (compatibility wrapper)", () => {
	it("matches exact provider--model first", () => {
		const files = [
			pf("ollama--glm-5.1-cloud"),
			pf("glm-5.1"),
			pf("glm"),
		];
		const result = findMatchingPrompts("ollama", "glm-5.1-cloud", files);
		assert.deepEqual(result.map((r) => r.stem), ["ollama--glm-5.1-cloud"]);
	});

	it("matches model-only when no exact match exists", () => {
		const files = [pf("glm-5.1"), pf("glm")];
		const result = findMatchingPrompts("wafer", "glm-5.1", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1"]);
	});

	it("falls back to fuzzy match", () => {
		const files = [pf("glm-5.1")];
		const result = findMatchingPrompts("wafer", "glm-5.1:cloud", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1"]);
	});

	it("does not match when stem crosses a boundary", () => {
		const files = [pf("glm-5.1")];
		const result = findMatchingPrompts("wafer", "glm-5.10-cloud", files);
		assert.equal(result.length, 0);
	});

	it("does not match short stems", () => {
		const files = [pf("ai")];
		const result = findMatchingPrompts("wafer", "ai-model-pro", files);
		assert.equal(result.length, 0);
	});

	it("returns only the best fuzzy match", () => {
		const files = [pf("claude"), pf("claude-opus")];
		const result = findMatchingPrompts("anthropic", "claude-opus-4-6", files);
		assert.equal(result.length, 1);
		assert.equal(result[0].stem, "claude-opus");
	});

	it("handles colons in model ID", () => {
		const files = [pf("glm-5.1-cloud")];
		const result = findMatchingPrompts("ollama", "glm-5.1:cloud", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1-cloud"]);
	});

	it("handles slashes in provider", () => {
		const files = [pf("glm-5.1")];
		const result = findMatchingPrompts("wafer/api-key", "glm-5.1", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1"]);
	});

	it("returns empty when nothing matches", () => {
		const files = [pf("glm-5.1"), pf("deepseek-v4")];
		const result = findMatchingPrompts("wafer", "qwen-3.5", files);
		assert.equal(result.length, 0);
	});

	it("handles uppercase stems case-insensitively", () => {
		const files = [pf("Foo")];
		const result = findMatchingPrompts("wafer", "Foo", files);
		assert.equal(result.length, 1);
		assert.equal(result[0].stem, "foo");
	});

	it("does not match gpt-4 against gpt-40", () => {
		const files = [pf("gpt-4")];
		const result = findMatchingPrompts("openai", "gpt-40-turbo", files);
		assert.equal(result.length, 0);
	});

	it("prefers exact match over model-only and fuzzy", () => {
		const files = [pf("wafer--glm-5.1"), pf("glm-5.1"), pf("glm")];
		const result = findMatchingPrompts("wafer", "glm-5.1", files);
		assert.deepEqual(result.map((r) => r.stem), ["wafer--glm-5.1"]);
	});
});

describe("findPromptMatch", () => {
	it("reports exact-provider-model matchType", () => {
		const files = [pf("wafer--glm-5.1"), pf("glm-5.1")];
		const result = findPromptMatch("wafer", "glm-5.1", files);
		assert.ok(result);
		assert.equal(result.matchType, "exact-provider-model");
		assert.equal(result.file.stem, "wafer--glm-5.1");
		assert.equal(result.normalizedModel, "glm-5.1");
		assert.equal(result.normalizedProviderModel, "wafer--glm-5.1");
	});

	it("reports exact-model matchType", () => {
		const files = [pf("glm-5.1"), pf("glm")];
		const result = findPromptMatch("wafer", "glm-5.1", files);
		assert.ok(result);
		assert.equal(result.matchType, "exact-model");
		assert.equal(result.file.stem, "glm-5.1");
	});

	it("reports fuzzy matchType", () => {
		const files = [pf("glm-5.1")];
		const result = findPromptMatch("wafer", "glm-5.1:cloud", files);
		assert.ok(result);
		assert.equal(result.matchType, "fuzzy");
		assert.equal(result.file.stem, "glm-5.1");
	});

	it("returns undefined when no match", () => {
		const files = [pf("glm-5.1"), pf("deepseek-v4")];
		const result = findPromptMatch("wafer", "qwen-3.5", files);
		assert.equal(result, undefined);
	});

	it("does not fabricate a match for empty files list", () => {
		const result = findPromptMatch("wafer", "glm-5.1", []);
		assert.equal(result, undefined);
	});

	it("match includes normalized fields", () => {
		const files = [pf("deepseek-v4")];
		const result = findPromptMatch("wafer", "DeepSeek-V4:pro", files);
		assert.ok(result);
		assert.equal(result.normalizedModel, "deepseek-v4-pro");
		assert.equal(result.normalizedProviderModel, "wafer--deepseek-v4-pro");
	});

	it("fuzzy picks longest bounded match", () => {
		const files = [pf("claude"), pf("claude-opus")];
		const result = findPromptMatch("anthropic", "claude-opus-4-6", files);
		assert.ok(result);
		assert.equal(result.matchType, "fuzzy");
		assert.equal(result.file.stem, "claude-opus");
	});
});

describe("analyzePromptFiles", () => {
	it("detects empty prompt files when content is set", () => {
		const files = [pf("glm-5.1", ""), pf("deepseek-v4", "some content")];
		const warnings = analyzePromptFiles(files);
		const emptyWarnings = warnings.filter((w) => w.type === "empty");
		assert.equal(emptyWarnings.length, 1);
		assert.equal(emptyWarnings[0].file, "glm-5.1.md");
	});

	it("does not warn about empty content when content is undefined (not loaded)", () => {
		const files = [pf("glm-5.1"), pf("deepseek-v4", "content")];
		const warnings = analyzePromptFiles(files);
		const emptyWarnings = warnings.filter((w) => w.type === "empty");
		assert.equal(emptyWarnings.length, 0);
	});

	it("detects fuzzy overlaps where one stem is a bounded substring of another", () => {
		const files = [pf("glm", "a"), pf("glm-5.1", "b")];
		const warnings = analyzePromptFiles(files);
		const overlapWarnings = warnings.filter((w) => w.type === "overlap");
		assert.ok(overlapWarnings.length >= 1);
		// Should mention both files
		assert.ok(overlapWarnings[0].file.includes("glm.md"));
		assert.ok(overlapWarnings[0].file.includes("glm-5.1.md"));
	});

	it("does not report overlap for short stems below threshold", () => {
		const files = [pf("ai", "a"), pf("ai-model", "b")];
		const warnings = analyzePromptFiles(files);
		const overlapWarnings = warnings.filter((w) => w.type === "overlap");
		assert.equal(overlapWarnings.length, 0);
	});

	it("returns no warnings for clean files", () => {
		const files = [
			pf("deepseek-v4", "content"),
			pf("glm-5.1", "other content"),
		];
		const warnings = analyzePromptFiles(files);
		assert.equal(warnings.length, 0);
	});

	it("does not report overlap for unrelated stems", () => {
		const files = [pf("kimi", "a"), pf("glm-5.1", "b")];
		const warnings = analyzePromptFiles(files);
		const overlapWarnings = warnings.filter((w) => w.type === "overlap");
		assert.equal(overlapWarnings.length, 0);
	});

	it("detects multiple empty files", () => {
		const files = [pf("a", ""), pf("b", ""), pf("c", "real content")];
		const warnings = analyzePromptFiles(files);
		const emptyWarnings = warnings.filter((w) => w.type === "empty");
		assert.equal(emptyWarnings.length, 2);
	});
});
