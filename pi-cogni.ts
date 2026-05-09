/**
 * pi-cogni — Cognitive coaching for AI models.
 *
 * Injects per-model cognitive coaching prompts that target each model's
 * specific failure modes (sycophancy, narration, privilege escalation, etc.)
 * identified through empirical diagnostic testing.
 *
 * Place markdown files in ~/.pi/agent/model-prompts/ and they'll be appended
 * to the system prompt when the matching model is active.
 *
 * Matching rules (first match wins, most specific first):
 *   1. Exact:  {provider}--{modelId}.md    e.g. "ollama-api-key--glm-5.1-cloud.md"
 *   2. Model:  {modelId}.md                e.g. "glm-5.1-cloud.md"
 *   3. Fuzzy:  any filename whose stem appears as a dash-bounded segment of
 *              "{provider}--{modelId}" (normalized).
 *              e.g. "glm-5.1.md" matches "ollama-api-key/glm-5.1:cloud"
 *              but does NOT match "glm-5.10-cloud" (boundary-anchored).
 *              Stems shorter than 3 chars are ignored.
 *              Longer stems match first (more specific wins).
 *
 * Coaching workflow (manual — run these yourself):
 *   1. Dispatch diagnostic tasks to the model via interactive_shell
 *   2. Analyze session output for behavioral patterns
 *   3. Write a .md file targeting observed weaknesses
 *   4. Re-run pushback test to verify the fix
 *   See README.md for the full diagnostic method.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROMPTS_DIR = join(homedir(), ".pi", "agent", "model-prompts");

/** Minimum stem length eligible for fuzzy matching (avoids 1–2 char footguns). */
const MIN_FUZZY_STEM_LENGTH = 3;

/** Normalize colons and slashes to dashes for filename matching */
function normalize(s: string): string {
	return s.replace(/[:/\\]/g, "-").toLowerCase();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface PromptFile {
	stem: string; // filename without .md, lowercased
	fullPath: string;
	content?: string; // lazy-loaded
}

function loadPromptFiles(): PromptFile[] {
	if (!existsSync(PROMPTS_DIR)) return [];
	try {
		return readdirSync(PROMPTS_DIR)
			.filter((f) => extname(f).toLowerCase() === ".md")
			.map((f) => ({
				stem: f.slice(0, -extname(f).length).toLowerCase(),
				fullPath: join(PROMPTS_DIR, f),
			}))
			.filter((pf) => pf.stem.length > 0)
			.filter((pf) => {
				try {
					return statSync(pf.fullPath).isFile();
				} catch {
					return false;
				}
			});
	} catch {
		return [];
	}
}

function readPromptContent(pf: PromptFile): string {
	if (pf.content === undefined) {
		try {
			pf.content = readFileSync(pf.fullPath, "utf-8").trim();
		} catch {
			pf.content = "";
		}
	}
	return pf.content ?? "";
}

function findMatchingPrompts(
	provider: string,
	modelId: string,
	files: PromptFile[],
): PromptFile[] {
	const normalizedFull = normalize(`${provider}--${modelId}`);
	const normalizedModel = normalize(modelId);
	// Unified key for fuzzy matching — same form as the exact key so a
	// stem that contains a dash (e.g. "ollama-api-key") still anchors cleanly.
	const fuzzyKey = normalizedFull;

	// 1. Exact provider--model match
	const exact = files.find((f) => f.stem === normalizedFull);
	if (exact) return [exact];

	// 2. Exact model-only match
	const modelOnly = files.find((f) => f.stem === normalizedModel);
	if (modelOnly) return [modelOnly];

	// 3. Fuzzy: stem must appear in the key with dash/start/end boundaries on
	// both sides — prevents "5.1" from matching "5.10", "gpt-4" matching "gpt-40",
	// or "ai" matching every model that contains those two letters.
	const matched: PromptFile[] = [];
	for (const pf of files) {
		if (pf.stem.length < MIN_FUZZY_STEM_LENGTH) continue;
		const re = new RegExp(`(^|-)${escapeRegex(pf.stem)}($|-)`);
		if (re.test(fuzzyKey)) matched.push(pf);
	}

	// Sort by specificity: longer stem first; stable tiebreak on stem name.
	matched.sort(
		(a, b) => b.stem.length - a.stem.length || a.stem.localeCompare(b.stem),
	);
	// First match wins — return only the most specific fuzzy match
	// to prevent layered conflicting instructions.
	return matched.length > 0 ? [matched[0]] : [];
}

export default function piCogni(pi: ExtensionAPI) {
	let promptFiles = loadPromptFiles();

	// Reload files on session start (picks up new/edited files after /reload)
	pi.on("session_start", async () => {
		promptFiles = loadPromptFiles();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		const matches = findMatchingPrompts(model.provider, model.id, promptFiles);
		if (matches.length === 0) return;

		const sections = matches
			.map((pf) => readPromptContent(pf))
			.filter((content) => content.length > 0);

		if (sections.length === 0) return;

		const body = sections.join("\n\n");
		const base = event.systemPrompt ?? "";
		return {
			systemPrompt: base ? `${base}\n\n${body}` : body,
		};
	});

	// Command to check which prompt file matches the current model
	pi.registerCommand("cogni", {
		description: "Show which cognitive coaching prompt matches the current model",
		handler: async (_args, ctx) => {
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "warning");
				return;
			}

			const key = `${model.provider}/${model.id}`;
			const matches = findMatchingPrompts(
				model.provider,
				model.id,
				promptFiles,
			);

			if (matches.length === 0) {
				ctx.ui.notify(
					`No model prompt for ${key}\nDir: ${PROMPTS_DIR}`,
					"info",
				);
			} else {
				const fileList = matches.map((pf) => basename(pf.fullPath)).join(", ");
				ctx.ui.notify(
					`Model: ${key}\nMatched: ${fileList}\nDir: ${PROMPTS_DIR}`,
					"success",
				);
			}
		},
	});
}
