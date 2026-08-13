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
	hasModelPromptsBlock,
	SENTINEL_BEGIN_PREFIX,
	setRoleStatus,
	resolveSubagentVariant,
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

	it("falls back to the first variant when only variant files exist and no role is active", () => {
		// Variant-only stems used to inject nothing silently (luna@worker class).
		// Prefer a base `<stem>.md`; until then, surface the first variant loudly.
		const m = findVariantMatch("wafer", "glm-5.1", [precision, worker]);
		assert.equal(m?.file.fullPath, precision.fullPath); // precision < worker
		assert.equal(m?.variant, "precision");
		assert.equal(m?.variantFallback, true);
		assert.equal(m?.missingBaseFallback, true);
	});

	it("uses the sole variant as the missing-base fallback", () => {
		const m = findVariantMatch("wafer", "glm-5.1", [worker]);
		assert.equal(m?.file.fullPath, worker.fullPath);
		assert.equal(m?.variant, "worker");
		assert.equal(m?.missingBaseFallback, true);
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

describe("hasModelPromptsBlock", () => {
	it("returns true when a begin marker is anywhere in the prompt", () => {
		const prompt = `Some preamble\n\n<!-- model-prompts: begin x.md -->\ncontent\n<!-- model-prompts: end x.md -->`;
		assert.equal(hasModelPromptsBlock(prompt), true);
	});

	it("returns false for empty string", () => {
		assert.equal(hasModelPromptsBlock(""), false);
	});

	it("returns false for undefined", () => {
		assert.equal(hasModelPromptsBlock(undefined), false);
	});

	it("returns false for a plain prompt without the sentinel", () => {
		const prompt = "Just a regular system prompt with no model-prompts block";
		assert.equal(hasModelPromptsBlock(prompt), false);
	});

	it("returns false for a prompt containing only the end marker", () => {
		const prompt = "Some text containing <!-- model-prompts: end x.md --> but no begin";
		assert.equal(hasModelPromptsBlock(prompt), false);
	});

	it("returns false for a begin marker without an end marker (doc mention)", () => {
		const prompt =
			"Here is how <!-- model-prompts: begin markers work in the extension.";
		assert.equal(hasModelPromptsBlock(prompt), false);
	});

	it("requires both markers: begin-only injected-looking line is not a block", () => {
		const prompt = `preamble\n<!-- model-prompts: begin x.md -->\ncontent without end marker`;
		assert.equal(hasModelPromptsBlock(prompt), false);
	});

	it("returns true for a full wrapped block", () => {
		const prompt = `Base prompt\n\n<!-- model-prompts: begin foo@worker.md -->\ninjected content\n<!-- model-prompts: end foo@worker.md -->`;
		assert.equal(hasModelPromptsBlock(prompt), true);
	});
});

describe("SENTINEL_BEGIN_PREFIX format", () => {
	it("renders correctly when composed with filename", () => {
		const fileName = "minimax-m3@worker.md";
		const composed = `${SENTINEL_BEGIN_PREFIX} ${fileName} -->`;
		assert.equal(composed, "<!-- model-prompts: begin minimax-m3@worker.md -->");
	});

	it("matches the guard detection substring", () => {
		const prompt = `<!-- model-prompts: begin x.md -->\nsome content\n<!-- model-prompts: end x.md -->`;
		assert.ok(prompt.includes(SENTINEL_BEGIN_PREFIX));
	});
});

describe("setRoleStatus (early-bootstrap HUD status)", () => {
const worker: PromptFile = {
		stem: "wafer--glm-5.1",
		variant: "worker",
		fullPath: "/p/wafer--glm-5.1@worker.md",
		content: "worker body",
	};
	const precision: PromptFile = {
		stem: "wafer--glm-5.1",
		variant: "precision",
		fullPath: "/p/wafer--glm-5.1@precision.md",
		content: "precision body",
	};
	const def: PromptFile = pf("wafer--glm-5.1", "default body");

	function makeCtx() {
		const calls: Array<[string, string | undefined]> = [];
		return {
			ctx: {
				ui: {
					setStatus: (key: string, text: string | undefined) => {
						calls.push([key, text]);
					},
				},
			},
			calls,
		};
	}

	it("sets icon-prefixed status and returns the match when a variant is active", () => {
		const { ctx, calls } = makeCtx();
		const result = setRoleStatus(
			{ provider: "wafer", id: "glm-5.1" },
			[def, precision, worker],
			{ "wafer/glm-5.1": "precision" },
			ctx,
		);
		assert.equal(calls.length, 1);
		assert.deepEqual(calls[0], ["model-prompts", "󰯂 precision"]);
		assert.ok(result);
assert.equal(result?.file.stem, "wafer--glm-5.1");
		assert.equal(result?.variant, "precision");
	});

	it("sets icon-prefixed default status when the default file matches", () => {
		const { ctx, calls } = makeCtx();
		const result = setRoleStatus(
			{ provider: "wafer", id: "glm-5.1" },
			[def, precision],
			{},
			ctx,
		);
		assert.deepEqual(calls[0], ["model-prompts", "󰯂 default"]);
		assert.ok(result);
		assert.equal(result?.file.stem, "wafer--glm-5.1");
	});

	it("sets undefined and returns null when nothing matches", () => {
		const { ctx, calls } = makeCtx();
		const result = setRoleStatus(
			{ provider: "wafer", id: "unknown-model" },
			[def, precision, worker],
			{},
			ctx,
		);
		assert.deepEqual(calls[0], ["model-prompts", undefined]);
		assert.equal(result, null);
	});
});

describe("resolveSubagentVariant (subagent-aware role selection)", () => {
	const PREV_CHILD = process.env.PI_SUBAGENT_CHILD;
	const PREV_AGENT = process.env.PI_SUBAGENT_CHILD_AGENT;

	function restoreEnv() {
		if (PREV_CHILD === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = PREV_CHILD;
		if (PREV_AGENT === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
		else process.env.PI_SUBAGENT_CHILD_AGENT = PREV_AGENT;
	}

	it("returns undefined outside a subagent child", () => {
		delete process.env.PI_SUBAGENT_CHILD;
		delete process.env.PI_SUBAGENT_CHILD_AGENT;
		try {
			assert.equal(resolveSubagentVariant(), undefined);
		} finally {
			restoreEnv();
		}
	});

	it("returns the child agent name when PI_SUBAGENT_CHILD=1", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
		try {
			assert.equal(resolveSubagentVariant(), "worker");
		} finally {
			restoreEnv();
		}
	});

	it("ignores reserved agent names (list/test/default)", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		process.env.PI_SUBAGENT_CHILD_AGENT = "default";
		try {
			assert.equal(resolveSubagentVariant(), undefined);
		} finally {
			restoreEnv();
		}
	});

	it("returns undefined when child flag is set but agent name is empty", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		delete process.env.PI_SUBAGENT_CHILD_AGENT;
		try {
			assert.equal(resolveSubagentVariant(), undefined);
		} finally {
			restoreEnv();
		}
	});
});

describe("setRoleStatus subagent override", () => {
	const PREV_CHILD = process.env.PI_SUBAGENT_CHILD;
	const PREV_AGENT = process.env.PI_SUBAGENT_CHILD_AGENT;

	function restoreEnv() {
		if (PREV_CHILD === undefined) delete process.env.PI_SUBAGENT_CHILD;
		else process.env.PI_SUBAGENT_CHILD = PREV_CHILD;
		if (PREV_AGENT === undefined) delete process.env.PI_SUBAGENT_CHILD_AGENT;
		else process.env.PI_SUBAGENT_CHILD_AGENT = PREV_AGENT;
	}

	const worker: PromptFile = {
		stem: "deepseek-v4-flash",
		variant: "worker",
		fullPath: "/p/deepseek-v4-flash@worker.md",
		content: "worker body",
	};
	const def: PromptFile = {
		stem: "deepseek-v4-flash",
		fullPath: "/p/deepseek-v4-flash.md",
		content: "default body",
	};

	function makeCtx() {
		const calls: Array<[string, string | undefined]> = [];
		return {
			ctx: {
				ui: {
					setStatus: (key: string, text: string | undefined) => {
						calls.push([key, text]);
					},
				},
			},
			calls,
		};
	}

	it("prefers @worker over persisted /role when running as a worker child", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
		const { ctx, calls } = makeCtx();
		try {
			const result = setRoleStatus(
				{ provider: "deepseek", id: "deepseek-v4-flash" },
				[def, worker],
				// persisted role is precision — subagent agent name must win
				{ "deepseek/deepseek-v4-flash": "precision" },
				ctx,
			);
			assert.ok(result);
			assert.equal(result?.variant, "worker");
			assert.deepEqual(calls[0], ["model-prompts", "\udb82\udfc2 worker"]);
		} finally {
			restoreEnv();
		}
	});

	it("falls back to default when @worker file is missing", () => {
		process.env.PI_SUBAGENT_CHILD = "1";
		process.env.PI_SUBAGENT_CHILD_AGENT = "worker";
		const { ctx, calls } = makeCtx();
		try {
			const result = setRoleStatus(
				{ provider: "deepseek", id: "deepseek-v4-flash" },
				[def], // no @worker file
				{},
				ctx,
			);
			assert.ok(result);
			assert.equal(result?.variant, undefined);
			assert.equal(result?.variantFallback, true);
			assert.equal(result?.requestedVariant, "worker");
			assert.deepEqual(calls[0], ["model-prompts", "\udb82\udfc2 default"]);
		} finally {
			restoreEnv();
		}
	});

	it("uses persisted /role when not a subagent child", () => {
		delete process.env.PI_SUBAGENT_CHILD;
		delete process.env.PI_SUBAGENT_CHILD_AGENT;
		const { ctx } = makeCtx();
		try {
			const result = setRoleStatus(
				{ provider: "deepseek", id: "deepseek-v4-flash" },
				[def, worker],
				{ "deepseek/deepseek-v4-flash": "worker" },
				ctx,
			);
			assert.ok(result);
			assert.equal(result?.variant, "worker");
		} finally {
			restoreEnv();
		}
	});
});