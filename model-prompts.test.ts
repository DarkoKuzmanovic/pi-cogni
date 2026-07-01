/**
 * Tests for model-prompts matching logic.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { PromptFile } from "./model-prompts.ts";
import {
	activeVariantKey,
	findMatchingPrompts,
	findPromptMatch,
	findVariantMatch,
	analyzePromptFiles,
	parsePromptFileName,
	readActiveVariants,
	readPromptContent,
	writeActiveVariants,
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

describe("readPromptContent freshness (C1)", () => {
	it("reflects on-disk edits on a subsequent read (no stale cache)", () => {
		const dir = mkdtempSync(join(tmpdir(), "mp-c1-"));
		try {
			const full = join(dir, "glm-5.1.md");
			writeFileSync(full, "first version");
			const file: PromptFile = { stem: "glm-5.1", fullPath: full };

			assert.equal(readPromptContent(file), "first version");

			// Simulate a mid-session edit to the prompt file.
			writeFileSync(full, "second version");
			assert.equal(
				readPromptContent(file),
				"second version",
				"expected the edited content, not a memoized stale value",
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("returns empty string for an unreadable/missing file", () => {
		const file: PromptFile = { stem: "gone", fullPath: "/nonexistent/gone.md" };
		assert.equal(readPromptContent(file), "");
	});
});

describe("parsePromptFileName", () => {
	it("parses a plain model file (no variant)", () => {
		assert.deepEqual(parsePromptFileName("glm-5.1.md"), { stem: "glm-5.1" });
	});

	it("splits {model}@{variant}.md", () => {
		assert.deepEqual(parsePromptFileName("glm-5.1@precision.md"), {
			stem: "glm-5.1",
			variant: "precision",
		});
	});

	it("splits {provider}--{model}@{variant}.md", () => {
		assert.deepEqual(parsePromptFileName("wafer--glm-5.1@worker.md"), {
			stem: "wafer--glm-5.1",
			variant: "worker",
		});
	});

	it("lowercases stem and variant", () => {
		assert.deepEqual(parsePromptFileName("GLM-5.1@Precision.md"), {
			stem: "glm-5.1",
			variant: "precision",
		});
	});

	it("treats a trailing/leading @ (empty side) as a plain stem", () => {
		assert.deepEqual(parsePromptFileName("glm-5.1@.md"), { stem: "glm-5.1@" });
		assert.deepEqual(parsePromptFileName("@precision.md"), { stem: "@precision" });
	});

	it("ignores non-markdown and empty stems", () => {
		assert.equal(parsePromptFileName("notes.txt"), undefined);
		assert.equal(parsePromptFileName(".md"), undefined);
	});
});

describe("findVariantMatch", () => {
	const def: PromptFile = { stem: "glm-5.1", fullPath: "/p/glm-5.1.md" };
	const precision: PromptFile = {
		stem: "glm-5.1",
		variant: "precision",
		fullPath: "/p/glm-5.1@precision.md",
	};
	const worker: PromptFile = {
		stem: "glm-5.1",
		variant: "worker",
		fullPath: "/p/glm-5.1@worker.md",
	};

	it("selects the default (no-variant) file when no variant is active", () => {
		const m = findVariantMatch("wafer", "glm-5.1", [def, precision, worker]);
		assert.equal(m?.file.fullPath, def.fullPath);
		assert.equal(m?.variant, undefined);
		assert.equal(m?.variantFallback, false);
	});

	it("selects the active variant file when one is set", () => {
		const m = findVariantMatch("wafer", "glm-5.1", [def, precision, worker], "precision");
		assert.equal(m?.file.fullPath, precision.fullPath);
		assert.equal(m?.variant, "precision");
		assert.equal(m?.variantFallback, false);
	});

	it("falls back to default and flags it when the active variant has no file", () => {
		const m = findVariantMatch("wafer", "glm-5.1", [def, precision], "ghost");
		assert.equal(m?.file.fullPath, def.fullPath);
		assert.equal(m?.variant, undefined);
		assert.equal(m?.requestedVariant, "ghost");
		assert.equal(m?.variantFallback, true);
	});

	it("resolves variants at the exact-provider-model tier", () => {
		const d: PromptFile = { stem: "wafer--glm-5.1", fullPath: "/p/wafer--glm-5.1.md" };
		const p: PromptFile = {
			stem: "wafer--glm-5.1",
			variant: "precision",
			fullPath: "/p/wafer--glm-5.1@precision.md",
		};
		const m = findVariantMatch("wafer", "glm-5.1", [d, p], "precision");
		assert.equal(m?.matchType, "exact-provider-model");
		assert.equal(m?.file.fullPath, p.fullPath);
	});

	it("resolves variants at the fuzzy tier", () => {
		const p: PromptFile = {
			stem: "glm-5.1",
			variant: "precision",
			fullPath: "/p/glm-5.1@precision.md",
		};
		const m = findVariantMatch("ollama", "glm-5.1:cloud", [def, p], "precision");
		assert.equal(m?.matchType, "fuzzy");
		assert.equal(m?.file.fullPath, p.fullPath);
	});

	it("returns undefined when nothing matches the model", () => {
		assert.equal(findVariantMatch("wafer", "other-model", [def, precision]), undefined);
	});

	it("returns undefined when only variant files exist and no variant is active", () => {
		// No default file to inject; a role must be chosen explicitly.
		assert.equal(findVariantMatch("wafer", "glm-5.1", [precision, worker]), undefined);
	});
});

describe("active-variant persistence", () => {
	it("builds a provider/model key", () => {
		assert.equal(activeVariantKey("wafer", "glm-5.1"), "wafer/glm-5.1");
	});

	it("round-trips through disk", () => {
		const dir = mkdtempSync(join(tmpdir(), "mp-active-"));
		try {
			const file = join(dir, "active.json");
			assert.deepEqual(readActiveVariants(file), {}); // missing file
			assert.equal(
				writeActiveVariants(file, { "wafer/glm-5.1": "precision" }),
				true,
			);
			assert.deepEqual(readActiveVariants(file), {
				"wafer/glm-5.1": "precision",
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("creates the parent directory on write", () => {
		const dir = mkdtempSync(join(tmpdir(), "mp-active-"));
		try {
			const file = join(dir, "nested", "active.json");
			assert.equal(writeActiveVariants(file, { a: "b" }), true);
			assert.deepEqual(readActiveVariants(file), { a: "b" });
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("ignores malformed json and non-string / array values", () => {
		const dir = mkdtempSync(join(tmpdir(), "mp-active-"));
		try {
			const file = join(dir, "active.json");
			writeFileSync(file, "{ not json");
			assert.deepEqual(readActiveVariants(file), {});
			writeFileSync(file, JSON.stringify({ ok: "x", bad: 3, empty: "" }));
			assert.deepEqual(readActiveVariants(file), { ok: "x" });
			writeFileSync(file, JSON.stringify(["a", "b"]));
			assert.deepEqual(readActiveVariants(file), {});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});