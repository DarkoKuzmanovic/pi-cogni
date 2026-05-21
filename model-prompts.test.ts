/**
 * Tests for model-prompts matching logic.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findMatchingPrompts } from "./model-prompts.ts";

interface TestPromptFile {
	stem: string;
	fullPath: string;
	content?: string;
}

function pf(stem: string): TestPromptFile {
	return { stem: stem.toLowerCase(), fullPath: `/tmp/${stem}.md` };
}

describe("findMatchingPrompts", () => {
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
