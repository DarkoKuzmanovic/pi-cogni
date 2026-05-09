/**
 * Tests for pi-cogni matching logic.
 *
 * Run:  npx tsx pi-cogni.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// --- Inline the matching functions so tests don't need the full Pi runtime ---

function normalize(s: string): string {
	return s.replace(/[:/\\]/g, "-").toLowerCase();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MIN_FUZZY_STEM_LENGTH = 3;

interface PromptFile {
	stem: string;
	fullPath: string;
	content?: string;
}

function findMatchingPrompts(
	provider: string,
	modelId: string,
	files: PromptFile[],
): PromptFile[] {
	const normalizedFull = normalize(`${provider}--${modelId}`);
	const normalizedModel = normalize(modelId);
	const fuzzyKey = normalizedFull;

	const exact = files.find((f) => f.stem === normalizedFull);
	if (exact) return [exact];

	const modelOnly = files.find((f) => f.stem === normalizedModel);
	if (modelOnly) return [modelOnly];

	const matched: PromptFile[] = [];
	for (const pf of files) {
		if (pf.stem.length < MIN_FUZZY_STEM_LENGTH) continue;
		const re = new RegExp(`(^|-)${escapeRegex(pf.stem)}($|-)`);
		if (re.test(fuzzyKey)) matched.push(pf);
	}

	matched.sort(
		(a, b) => b.stem.length - a.stem.length || a.stem.localeCompare(b.stem),
	);
	return matched.length > 0 ? [matched[0]] : [];
}

// Helper to create test prompt files
function pf(stem: string): PromptFile {
	return { stem: stem.toLowerCase(), fullPath: `/tmp/${stem}.md` };
}

// --- Tests ---

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
		// provider/wafer/glm-5.1:cloud → normalized: wafer--glm-5.1-cloud
		const result = findMatchingPrompts("wafer", "glm-5.1:cloud", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1"]);
	});

	it("does NOT match when stem crosses a boundary (5.1 vs 5.10)", () => {
		const files = [pf("glm-5.1")];
		// glm-5.10-cloud → boundaries are 5, 10, cloud — "5.1" is not a whole segment
		const result = findMatchingPrompts("wafer", "glm-5.10-cloud", files);
		assert.equal(result.length, 0);
	});

	it("does NOT match short stems (< 3 chars)", () => {
		const files = [pf("ai")];
		const result = findMatchingPrompts("wafer", "ai-model-pro", files);
		assert.equal(result.length, 0);
	});

	it("returns only the best fuzzy match (first match wins)", () => {
		const files = [pf("claude"), pf("claude-opus")];
		// Both would fuzzy-match, but "claude-opus" is longer → wins
		const result = findMatchingPrompts("anthropic", "claude-opus-4-6", files);
		assert.equal(result.length, 1);
		assert.equal(result[0].stem, "claude-opus");
	});

	it("handles colons in model ID (normalizes to dashes)", () => {
		const files = [pf("glm-5.1-cloud")];
		const result = findMatchingPrompts("ollama", "glm-5.1:cloud", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1-cloud"]);
	});

	it("handles slashes in provider (normalizes to dashes)", () => {
		const files = [pf("glm-5.1")];
		// provider "wafer/api-key" → normalized full key "wafer-api-key--glm-5.1"
		// "glm-5.1" is a dash-bounded segment in that key → matches
		const result = findMatchingPrompts("wafer/api-key", "glm-5.1", files);
		assert.deepEqual(result.map((r) => r.stem), ["glm-5.1"]);
	});

	it("returns empty when nothing matches", () => {
		const files = [pf("glm-5.1"), pf("deepseek-v4")];
		const result = findMatchingPrompts("wafer", "qwen-3.5", files);
		assert.equal(result.length, 0);
	});

	it("handles uppercase .MD stems correctly (case-insensitive)", () => {
		// Simulates what loadPromptFiles produces after the extname fix:
		// Foo.MD → stem "foo" (not "foo.md")
		const files = [pf("Foo")]; // stem becomes "foo" via toLowerCase
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
		const files = [
			pf("wafer--glm-5.1"),
			pf("glm-5.1"),
			pf("glm"),
		];
		const result = findMatchingPrompts("wafer", "glm-5.1", files);
		assert.deepEqual(result.map((r) => r.stem), ["wafer--glm-5.1"]);
	});
});

describe("normalize", () => {
	it("lowercases and replaces : / \\ with dashes", () => {
		assert.equal(normalize("Ollama/API-Key"), "ollama-api-key");
		assert.equal(normalize("glm-5.1:cloud"), "glm-5.1-cloud");
		assert.equal(normalize("a\\b"), "a-b");
	});

	it("leaves already-normalized strings unchanged", () => {
		assert.equal(normalize("glm-5.1"), "glm-5.1");
	});
});
