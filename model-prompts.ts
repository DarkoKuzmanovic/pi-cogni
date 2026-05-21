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

interface PromptFile {
	stem: string;
	fullPath: string;
	content?: string;
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

export function findMatchingPrompts(
	provider: string,
	modelId: string,
	files: PromptFile[],
): PromptFile[] {
	const normalizedFull = normalize(`${provider}--${modelId}`);
	const normalizedModel = normalize(modelId);
	const fuzzyKey = normalizedFull;

	const exact = files.find((file) => file.stem === normalizedFull);
	if (exact) return [exact];

	const modelOnly = files.find((file) => file.stem === normalizedModel);
	if (modelOnly) return [modelOnly];

	const matched: PromptFile[] = [];
	for (const promptFile of files) {
		if (promptFile.stem.length < MIN_FUZZY_STEM_LENGTH) continue;
		const re = new RegExp(`(^|-)${escapeRegex(promptFile.stem)}($|-)`);
		if (re.test(fuzzyKey)) matched.push(promptFile);
	}

	matched.sort(
		(a, b) => b.stem.length - a.stem.length || a.stem.localeCompare(b.stem),
	);
	return matched.length > 0 ? [matched[0]] : [];
}

export default function modelPrompts(pi: ExtensionAPI): void {
	let promptFiles = loadPromptFiles();

	pi.on("session_start", async () => {
		promptFiles = loadPromptFiles();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		const matches = findMatchingPrompts(model.provider, model.id, promptFiles);
		if (matches.length === 0) return;

		const sections = matches
			.map((promptFile) => readPromptContent(promptFile))
			.filter((content) => content.length > 0);
		if (sections.length === 0) return;

		const body = sections.join("\n\n");
		const base = event.systemPrompt ?? "";
		return {
			systemPrompt: base ? `${base}\n\n${body}` : body,
		};
	});

	pi.registerCommand("model-prompt", {
		description: "Show which per-model prompt matches the current model",
		handler: async (_args, ctx) => {
			promptFiles = loadPromptFiles();
			const model = ctx.model;
			if (!model) {
				ctx.ui.notify("No model selected", "warning");
				return;
			}

			const key = `${model.provider}/${model.id}`;
			const matches = findMatchingPrompts(model.provider, model.id, promptFiles);

			if (matches.length === 0) {
				ctx.ui.notify(`No model prompt for ${key}\nDir: ${PROMPTS_DIR}`, "info");
				return;
			}

			const fileList = matches
				.map((promptFile) => basename(promptFile.fullPath))
				.join(", ");
			ctx.ui.notify(
				`Model: ${key}\nMatched: ${fileList}\nDir: ${PROMPTS_DIR}`,
				"info",
			);
		},
	});
}
