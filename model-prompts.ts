/**
 * model-prompts — per-model Markdown prompt injection for Pi.
 *
 * Place Markdown files in ~/.pi/agent/model-prompts/ and the matching file
 * is appended to the system prompt when that model is active.
 *
 * Matching rules (first match wins, most specific first):
 *   1. Exact:  {provider}--{modelId}.md    e.g. "ollama--glm-5.1-cloud.md"
 *   2. Model:  {modelId}.md                e.g. "glm-5.1-cloud.md"
 *   3. Fuzzy:  any filename whose stem appears as a dash-bounded segment of
 *              "{provider}--{modelId}" after normalizing : / \ to dashes.
 *              e.g. "glm-5.1.md" matches "ollama/glm-5.1:cloud"
 *              but does NOT match "glm-5.10-cloud".
 */

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROMPTS_DIR = join(homedir(), ".pi", "agent", "model-prompts");
const MIN_FUZZY_STEM_LENGTH = 3;

function normalize(s: string): string {
	return s.replace(/[:/\\]/g, "-").toLowerCase();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface PromptFile {
	stem: string;
	fullPath: string;
	content?: string;
}

export type MatchType = "exact-provider-model" | "exact-model" | "fuzzy";

export interface PromptMatch {
	file: PromptFile;
	matchType: MatchType;
	normalizedModel: string;
	normalizedProviderModel: string;
}

function loadPromptFiles(): PromptFile[] {
	if (!existsSync(PROMPTS_DIR)) return [];
	try {
		return readdirSync(PROMPTS_DIR)
			.filter((fileName) => extname(fileName).toLowerCase() === ".md")
			.map((fileName) => ({
				stem: fileName.slice(0, -extname(fileName).length).toLowerCase(),
				fullPath: join(PROMPTS_DIR, fileName),
			}))
			.filter((promptFile) => promptFile.stem.length > 0)
			.filter((promptFile) => {
				try {
					return statSync(promptFile.fullPath).isFile();
				} catch {
					return false;
				}
			});
	} catch {
		return [];
	}
}

function readPromptContent(promptFile: PromptFile): string {
	if (promptFile.content === undefined) {
		try {
			promptFile.content = readFileSync(promptFile.fullPath, "utf-8").trim();
		} catch {
			promptFile.content = "";
		}
	}
	return promptFile.content ?? "";
}

function computeContentHash(content: string): string {
	return createHash("sha256").update(content, "utf-8").digest("hex").slice(0, 12);
}

function getFileSize(promptFile: PromptFile): number | "unknown" {
	try {
		return statSync(promptFile.fullPath).size;
	} catch {
		return "unknown";
	}
}

export function findPromptMatch(
	provider: string,
	modelId: string,
	files: PromptFile[],
): PromptMatch | undefined {
	const normalizedFull = normalize(`${provider}--${modelId}`);
	const normalizedModel = normalize(modelId);

	// Rule 1: Exact provider--model match
	const exact = files.find((file) => file.stem === normalizedFull);
	if (exact) {
		return {
			file: exact,
			matchType: "exact-provider-model",
			normalizedModel,
			normalizedProviderModel: normalizedFull,
		};
	}

	// Rule 2: Exact model match
	const modelOnly = files.find((file) => file.stem === normalizedModel);
	if (modelOnly) {
		return {
			file: modelOnly,
			matchType: "exact-model",
			normalizedModel,
			normalizedProviderModel: normalizedFull,
		};
	}

	// Rule 3: Fuzzy bounded segment match — first collect all, then pick longest
	const matched: PromptFile[] = [];
	for (const promptFile of files) {
		if (promptFile.stem.length < MIN_FUZZY_STEM_LENGTH) continue;
		const re = new RegExp(`(^|-)${escapeRegex(promptFile.stem)}($|-)`);
		if (re.test(normalizedFull)) matched.push(promptFile);
	}
	if (matched.length === 0) return undefined;

	matched.sort(
		(a, b) => b.stem.length - a.stem.length || a.stem.localeCompare(b.stem),
	);
	return {
		file: matched[0],
		matchType: "fuzzy",
		normalizedModel,
		normalizedProviderModel: normalizedFull,
	};
}

/**
 * Compatibility wrapper — returns PromptFile[] matching the old API.
 * Use findPromptMatch directly for richer diagnostics.
 */
export function findMatchingPrompts(
	provider: string,
	modelId: string,
	files: PromptFile[],
): PromptFile[] {
	const match = findPromptMatch(provider, modelId, files);
	return match ? [match.file] : [];
}

export interface PromptWarning {
	type: "empty" | "overlap";
	file: string;
	message: string;
}

/**
 * Analyze an array of PromptFile objects for potential issues.
 * Only checks content fields that are already populated (not undefined).
 * Detects:
 *  - Empty files (content === "")
 *  - Fuzzy overlaps where one stem is a dash-bounded substring of another
 */
export function analyzePromptFiles(files: PromptFile[]): PromptWarning[] {
	const warnings: PromptWarning[] = [];

	// Check for empty files
	for (const f of files) {
		if (f.content !== undefined && f.content.trim().length === 0) {
			warnings.push({
				type: "empty",
				file: basename(f.fullPath),
				message: `Empty prompt file: ${basename(f.fullPath)}`,
			});
		}
	}

	// Check for fuzzy overlaps: when a shorter stem is a dash-bounded
	// segment of a longer stem, the shorter file may match unexpectedly.
	const sorted = [...files].sort(
		(a, b) => b.stem.length - a.stem.length || a.stem.localeCompare(b.stem),
	);
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			const longer = sorted[i];
			const shorter = sorted[j];
			if (shorter.stem.length < MIN_FUZZY_STEM_LENGTH) continue;
			const re = new RegExp(
				`(^|-)${escapeRegex(shorter.stem)}($|-)`,
			);
			if (re.test(longer.stem)) {
				warnings.push({
					type: "overlap",
					file: `${basename(longer.fullPath)} / ${basename(shorter.fullPath)}`,
					message: `Fuzzy overlap: "${basename(shorter.fullPath)}" is a bounded substring of "${basename(longer.fullPath)}"`,
				});
			}
		}
	}

	return warnings;
}

export default function modelPrompts(pi: ExtensionAPI): void {
	let promptFiles = loadPromptFiles();

	pi.on("session_start", async () => {
		promptFiles = loadPromptFiles();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		const match = findPromptMatch(model.provider, model.id, promptFiles);
		if (!match) return;

		const content = readPromptContent(match.file);
		if (content.length === 0) return;

		const name = basename(match.file.fullPath);
		const body = `<!-- model-prompts: begin ${name} -->\n${content}\n<!-- model-prompts: end ${name} -->`;

		const base = event.systemPrompt ?? "";
		return {
			systemPrompt: base ? `${base}\n\n${body}` : body,
		};
	});

	pi.registerCommand("model-prompt", {
		description:
			"Show per-model prompt match. Use 'list' to show all, 'test <p>/<m>' to dry-run.",
		handler: async (args, ctx) => {
			promptFiles = loadPromptFiles();
			const model = ctx.model;
			const parts = args.trim().split(/\s+/).filter(Boolean);

			if (parts.length === 0) {
				if (!model) {
					ctx.ui.notify("No model selected", "warning");
					return;
				}
				const key = `${model.provider}/${model.id}`;
				const match = findPromptMatch(
					model.provider,
					model.id,
					promptFiles,
				);

				if (!match) {
					ctx.ui.notify(
						`No model prompt for ${key}\nDir: ${PROMPTS_DIR}`,
						"info",
					);
					return;
				}

				const content = readPromptContent(match.file);
				const hash = content ? computeContentHash(content) : "empty";
				const size = getFileSize(match.file);
				ctx.ui.notify(
					[
						`Model: ${key}`,
						`Matched: ${basename(match.file.fullPath)}`,
						`Type: ${match.matchType}`,
						`Size: ${size}`,
						`SHA256: ${hash}`,
						`Dir: ${PROMPTS_DIR}`,
					].join("\n"),
					"info",
				);
				return;
			}

			const cmd = parts[0].toLowerCase();

			if (cmd === "list") {
				if (promptFiles.length === 0) {
					ctx.ui.notify(
						`No prompt files found in ${PROMPTS_DIR}`,
						"info",
					);
					return;
				}

				const lines = promptFiles.map((pf) => {
					const content = readPromptContent(pf);
					const status = content.length === 0 ? " [empty]" : "";
					return `  ${basename(pf.fullPath)}${status}`;
				});

				const warnings = analyzePromptFiles(promptFiles);
				const warnLines = warnings.map((w) => `  ⚠ ${w.message}`);
				const msgLines: string[] = [
					`Available prompt files (${promptFiles.length}):`,
					...lines,
				];
				if (warnLines.length > 0) {
					msgLines.push("", "Warnings:", ...warnLines);
				}
				ctx.ui.notify(
					msgLines.join("\n"),
					warnLines.length > 0 ? "warning" : "info",
				);
				return;
			}

			if (cmd === "test") {
				if (parts.length < 2) {
					ctx.ui.notify(
						"Usage: /model-prompt test <provider>/<model> or /model-prompt test <provider> <model>",
						"info",
					);
					return;
				}

				let testProvider: string;
				let testModel: string;
				if (parts[1].includes("/")) {
					const slashIdx = parts[1].indexOf("/");
					testProvider = parts[1].slice(0, slashIdx);
					testModel = parts[1].slice(slashIdx + 1);
				} else {
					testProvider = parts[1];
					testModel = parts.slice(2).join(" ");
				}

				if (!testProvider || !testModel) {
					ctx.ui.notify(
						"Usage: /model-prompt test <provider>/<model> or /model-prompt test <provider> <model>",
						"info",
					);
					return;
				}

				const match = findPromptMatch(
					testProvider,
					testModel,
					promptFiles,
				);

				if (!match) {
					ctx.ui.notify(
						`No match for ${testProvider}/${testModel}`,
						"info",
					);
					return;
				}

				const content = readPromptContent(match.file);
				const hash = content ? computeContentHash(content) : "empty";
				const size = getFileSize(match.file);
				const preview =
					content.length > 200
						? content.slice(0, 200) + "..."
						: content;
				ctx.ui.notify(
					[
						`Test: ${testProvider}/${testModel}`,
						`Matched: ${basename(match.file.fullPath)}`,
						`Type: ${match.matchType}`,
						`Size: ${size}`,
						`SHA256: ${hash}`,
						"Preview:",
						preview,
					].join("\n"),
					"info",
				);
				return;
			}

			// Unknown subcommand
			ctx.ui.notify(
				"Usage:\n  /model-prompt          – show current match\n  /model-prompt list     – list available prompts\n  /model-prompt test <provider>/<model> – dry-run match",
				"info",
			);
		},
	});
}
