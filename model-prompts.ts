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
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROMPTS_DIR = join(homedir(), ".pi", "agent", "model-prompts");
/** Persisted active-variant selections, keyed by `provider/model`. */
const ACTIVE_FILE = join(PROMPTS_DIR, "active.json");
const MIN_FUZZY_STEM_LENGTH = 3;
/** Subcommand keywords that cannot be used as variant names. */
const RESERVED_VARIANTS = new Set(["list", "test", "default"]);
/** Sentinel prefixes to detect if a model-prompts block is already injected. */
export const SENTINEL_BEGIN_PREFIX = "<!-- model-prompts: begin";
export const SENTINEL_END_PREFIX = "<!-- model-prompts: end";

function normalize(s: string): string {
	return s.replace(/[:/\\]/g, "-").toLowerCase();
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check if a system prompt already contains a model-prompts block.
 * Requires BOTH the begin and end sentinel markers: an injected block always
 * carries both, while a prompt merely mentioning one marker (docs, examples)
 * does not. Casual text containing both full markers can still false-trigger;
 * accepted as a negligible collision surface.
 */
export function hasModelPromptsBlock(systemPrompt: string | undefined): boolean {
	const prompt = systemPrompt ?? "";
	return (
		prompt.includes(SENTINEL_BEGIN_PREFIX) && prompt.includes(SENTINEL_END_PREFIX)
	);
}

export interface PromptFile {
	/** Base stem with any `@variant` suffix stripped (used for matching). */
	stem: string;
	/** Variant name after `@`, or undefined for the default file. */
	variant?: string;
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

/**
 * Split a prompt file name into its base stem and optional `@variant`.
 * `glm-5.1@precision.md` -> { stem: "glm-5.1", variant: "precision" }.
 * A leading/trailing `@` (empty side) is treated as part of a plain stem.
 * Returns undefined for non-Markdown files or empty stems.
 */
export function parsePromptFileName(
	fileName: string,
): { stem: string; variant?: string } | undefined {
	if (extname(fileName).toLowerCase() !== ".md") return undefined;
	const base = fileName.slice(0, -extname(fileName).length).toLowerCase();
	if (base.length === 0) return undefined;
	const at = base.indexOf("@");
	if (at <= 0 || at === base.length - 1) return { stem: base };
	return { stem: base.slice(0, at), variant: base.slice(at + 1) };
}

function loadPromptFiles(): PromptFile[] {
	if (!existsSync(PROMPTS_DIR)) return [];
	try {
		return readdirSync(PROMPTS_DIR)
			.map((fileName) => ({ fileName, parsed: parsePromptFileName(fileName) }))
			.flatMap(({ fileName, parsed }) =>
				parsed
					? [
							{
								stem: parsed.stem,
								variant: parsed.variant,
								fullPath: join(PROMPTS_DIR, fileName),
							} satisfies PromptFile,
						]
					: [],
			)
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

export function readPromptContent(promptFile: PromptFile): string {
	// Read fresh on every call so mid-session edits to a prompt file are
	// reflected without a /reload (C1). The `content` field is still populated
	// so analyzePromptFiles() can inspect it, but it is never used as a cache.
	let content: string;
	try {
		content = readFileSync(promptFile.fullPath, "utf-8").trim();
	} catch {
		content = "";
	}
	promptFile.content = content;
	return content;
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
 * A prompt match resolved through the variant layer.
 */
export interface VariantMatch extends PromptMatch {
	/** The resolved variant, or undefined for the default (no-`@`) file. */
	variant?: string;
	/** The variant that was requested/active, if any. */
	requestedVariant?: string;
	/** True when the requested variant had no file and we fell back to default. */
	variantFallback: boolean;
}

/**
 * Match a model to a prompt file, honoring the active variant.
 *
 * Files are grouped by base stem; the standard tier logic
 * (exact-provider-model -> exact-model -> fuzzy) picks the winning stem, then
 * the variant is resolved within that group:
 *   - active variant present with a file   -> that file
 *   - active variant present, file missing  -> default file, variantFallback=true
 *   - no active variant                     -> default file
 * Returns undefined when no stem matches, or when the only files for the winning
 * stem are variants and no variant is active (a role must be chosen explicitly).
 */
export function findVariantMatch(
	provider: string,
	modelId: string,
	files: PromptFile[],
	activeVariant?: string,
): VariantMatch | undefined {
	const groups = new Map<string, PromptFile[]>();
	for (const file of files) {
		const group = groups.get(file.stem);
		if (group) group.push(file);
		else groups.set(file.stem, [file]);
	}

	const representatives: PromptFile[] = [...groups.keys()].map((stem) => ({
		stem,
		fullPath: "",
	}));
	const base = findPromptMatch(provider, modelId, representatives);
	if (!base) return undefined;

	const group = groups.get(base.file.stem) ?? [];
	const defaultFile = group.find((file) => file.variant === undefined);

	if (activeVariant) {
		const wanted = group.find((file) => file.variant === activeVariant);
		if (wanted) {
			return {
				...base,
				file: wanted,
				variant: activeVariant,
				requestedVariant: activeVariant,
				variantFallback: false,
			};
		}
		if (defaultFile) {
			return {
				...base,
				file: defaultFile,
				variant: undefined,
				requestedVariant: activeVariant,
				variantFallback: true,
			};
		}
		return undefined;
	}

	if (!defaultFile) return undefined;
	return {
		...base,
		file: defaultFile,
		variant: undefined,
		requestedVariant: undefined,
		variantFallback: false,
	};
}

/** Storage key for a model's active variant. */
export function activeVariantKey(provider: string, modelId: string): string {
	return `${provider}/${modelId}`;
}

/** Read the active-variant map from disk; tolerant of missing/malformed files. */
export function readActiveVariants(filePath: string): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(readFileSync(filePath, "utf-8"));
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			const out: Record<string, string> = {};
			for (const [key, value] of Object.entries(parsed)) {
				if (typeof value === "string" && value.length > 0) out[key] = value;
			}
			return out;
		}
	} catch {
		// missing file or invalid JSON -> empty map
	}
	return {};
}

/** Persist the active-variant map. Returns false on write failure. */
export function writeActiveVariants(
	filePath: string,
	map: Record<string, string>,
): boolean {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
		writeFileSync(filePath, `${JSON.stringify(map, null, 2)}\n`);
		return true;
	} catch {
		return false;
	}
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

/** Format a resolved variant match for command output. */
function formatMatch(
	match: VariantMatch,
	label: string,
	withPreview: boolean,
): string[] {
	const content = readPromptContent(match.file);
	const hash = content ? computeContentHash(content) : "empty";
	const size = getFileSize(match.file);
	const roleLine = match.variant
		? `Role: ${match.variant}`
		: match.requestedVariant
			? `Role: ${match.requestedVariant} (no file \u2192 default)`
			: "Role: (default)";
	const out = [
		label,
		`Matched: ${basename(match.file.fullPath)}`,
		`Type: ${match.matchType}`,
		roleLine,
		`Size: ${size}`,
		`SHA256: ${hash}`,
	];
	if (withPreview) {
		const preview =
			content.length > 200 ? `${content.slice(0, 200)}...` : content;
		out.push("Preview:", preview);
	} else {
		out.push(`Dir: ${PROMPTS_DIR}`);
	}
	return out;
}
/**
 * Resolve the active role for `model` and surface it as the "model-prompts"
 * UI status. Used by both session_start (model known, no systemPrompt yet)
 * and the non-sentinel path of before_agent_start. Idempotent apart from the
 * redundant setStatus call. Duck-typed to avoid importing Model<any> from
 * the host package just for a helper signature.
 */
export function setRoleStatus(
	model: { provider: string; id: string },
	promptFiles: PromptFile[],
	activeVariants: Record<string, string>,
	ctx: { ui: { setStatus(key: string, text: string | undefined): void } },
): VariantMatch | null {
	const active = activeVariants[activeVariantKey(model.provider, model.id)];
	const match = findVariantMatch(
		model.provider,
		model.id,
		promptFiles,
		active,
	);
	if (!match) {
		ctx.ui.setStatus("model-prompts", undefined);
		return null;
	}
	ctx.ui.setStatus(
		"model-prompts",
		`role: ${match.variant ?? "default"}`,
	);
	return match;
}

export default function modelPrompts(pi: ExtensionAPI): void {
	let promptFiles = loadPromptFiles();
	let activeVariants = readActiveVariants(ACTIVE_FILE);

	pi.on("session_start", async (_event, ctx) => {
		promptFiles = loadPromptFiles();
		activeVariants = readActiveVariants(ACTIVE_FILE);
		// Surface the active role in the HUD before the first message so
		// pi-hud can render the role chip from turn zero. before_agent_start
		// will re-run this on every turn (and handle the sentinel case), so
		// this is purely an early-bootstrap setStatus.
		if (ctx.model) setRoleStatus(ctx.model, promptFiles, activeVariants, ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const model = ctx.model;
		if (!model) return;

		// Guard against duplicate injection: if a model-prompts block is already
		// present (e.g. injected by a dispatching supervisor like pi-subagents),
		// surface that and return early before matching/injecting.
		if (hasModelPromptsBlock(event.systemPrompt)) {
			ctx.ui.setStatus("model-prompts", "role: external");
			return;
		}

		const match = setRoleStatus(
			model,
			promptFiles,
			activeVariants,
			ctx,
		);
		if (!match) return;

		const content = readPromptContent(match.file);
		if (content.length === 0) return;

		const name = basename(match.file.fullPath);
		const body = `${SENTINEL_BEGIN_PREFIX} ${name} -->\n${content}\n${SENTINEL_END_PREFIX} ${name} -->`;

		const base = event.systemPrompt ?? "";
		return {
			systemPrompt: base ? `${base}\n\n${body}` : body,
		};
	});
	pi.registerCommand("role", {
		description:
			"Per-model prompt role. '/role <name>' switches variant; 'list', 'test <p>/<m>', 'default' also supported.",
		handler: async (args, ctx) => {
			promptFiles = loadPromptFiles();
			activeVariants = readActiveVariants(ACTIVE_FILE);
			const model = ctx.model;
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const sub = parts[0]?.toLowerCase();

			// /role list — group by base stem, mark the current model's active variant
			if (sub === "list") {
				if (promptFiles.length === 0) {
					ctx.ui.notify(`No prompt files found in ${PROMPTS_DIR}`, "info");
					return;
				}
				const groups = new Map<string, PromptFile[]>();
				for (const pf of promptFiles) {
					const g = groups.get(pf.stem) ?? [];
					g.push(pf);
					groups.set(pf.stem, g);
				}
				const activeForModel = model
					? activeVariants[activeVariantKey(model.provider, model.id)]
					: undefined;
				const currentMatch = model
					? findVariantMatch(
							model.provider,
							model.id,
							promptFiles,
							activeForModel,
						)
					: undefined;
				const lines: string[] = [];
				for (const [stem, files] of [...groups.entries()].sort(([a], [b]) =>
					a.localeCompare(b),
				)) {
					const isCurrent = currentMatch?.file.stem === stem;
					lines.push(`  ${stem}${isCurrent ? " (current model)" : ""}`);
					const sorted = [...files].sort((a, b) =>
						(a.variant ?? "").localeCompare(b.variant ?? ""),
					);
					for (const f of sorted) {
						const label = f.variant ?? "(default)";
						const active =
							isCurrent && currentMatch?.variant === f.variant
								? " [active]"
								: "";
						const empty = readPromptContent(f).length === 0 ? " [empty]" : "";
						const reserved =
							f.variant && RESERVED_VARIANTS.has(f.variant)
								? " [reserved name — unreachable]"
								: "";
						lines.push(`      ${label}${active}${empty}${reserved}`);
					}
				}
				const warnings = analyzePromptFiles(promptFiles);
				const msg = [`Prompt roles (${promptFiles.length} files):`, ...lines];
				if (warnings.length > 0) {
					msg.push("", "Warnings:", ...warnings.map((w) => `  ⚠ ${w.message}`));
				}
				ctx.ui.notify(msg.join("\n"), warnings.length > 0 ? "warning" : "info");
				return;
			}

			// /role test <p>/<m> — dry-run using that model's active variant
			if (sub === "test") {
				if (parts.length < 2) {
					ctx.ui.notify(
						"Usage: /role test <provider>/<model>  (or <provider> <model>)",
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
						"Usage: /role test <provider>/<model>  (or <provider> <model>)",
						"info",
					);
					return;
				}
				const active =
					activeVariants[activeVariantKey(testProvider, testModel)];
				const match = findVariantMatch(
					testProvider,
					testModel,
					promptFiles,
					active,
				);
				if (!match) {
					ctx.ui.notify(`No match for ${testProvider}/${testModel}`, "info");
					return;
				}
				ctx.ui.notify(
					formatMatch(match, `Test: ${testProvider}/${testModel}`, true).join(
						"\n",
					),
					"info",
				);
				return;
			}

			// The remaining forms operate on the current model.
			if (!model) {
				ctx.ui.notify("No model selected", "warning");
				return;
			}
			const key = activeVariantKey(model.provider, model.id);

			// /role default — clear the active variant
			if (sub === "default") {
				if (activeVariants[key] === undefined) {
					ctx.ui.notify(
						`No active role for ${key}; already using default.`,
						"info",
					);
					return;
				}
				delete activeVariants[key];
				const ok = writeActiveVariants(ACTIVE_FILE, activeVariants);
				ctx.ui.notify(
					ok
						? `Cleared role for ${key}; using default prompt.`
						: `Failed to persist ${ACTIVE_FILE}`,
					ok ? "info" : "error",
				);
				return;
			}

			// /role <name> — set the active variant
			if (sub !== undefined) {
				const name = sub;
				const match = findVariantMatch(
					model.provider,
					model.id,
					promptFiles,
					name,
				);
				if (!match) {
					ctx.ui.notify(
						`No prompt matches ${key}; create a prompt file in ${PROMPTS_DIR} first.`,
						"warning",
					);
					return;
				}
				activeVariants[key] = name;
				if (!writeActiveVariants(ACTIVE_FILE, activeVariants)) {
					ctx.ui.notify(`Failed to persist ${ACTIVE_FILE}`, "error");
					return;
				}
				if (match.variantFallback) {
					ctx.ui.notify(
						`Role '${name}' set for ${key}, but ${match.file.stem}@${name}.md does not exist yet — injecting the default prompt until you create it.`,
						"warning",
					);
				} else {
					ctx.ui.notify(
						`Role '${name}' active for ${key} (${basename(match.file.fullPath)}).`,
						"info",
					);
				}
				return;
			}

			// bare /role — interactive picker of the current model's roles
			const active = activeVariants[key];
			const probe = findVariantMatch(
				model.provider,
				model.id,
				promptFiles,
				active,
			);
			if (!probe) {
				ctx.ui.notify(`No model prompt for ${key}\nDir: ${PROMPTS_DIR}`, "info");
				return;
			}
			const group = promptFiles.filter((f) => f.stem === probe.file.stem);
			const hasDefault = group.some((f) => f.variant === undefined);
			const variants = group
				.map((f) => f.variant)
				.filter((v): v is string => v !== undefined)
				.sort((a, b) => a.localeCompare(b));
			const options = [...(hasDefault ? ["default"] : []), ...variants];
			const currentLabel = active ?? "default";
			const labeled = options.map((o) =>
				o === currentLabel ? `${o} (active)` : o,
			);
			const picked = await ctx.ui.select(`Role for ${key}:`, labeled);
			if (picked === undefined) {
				// cancelled — just report the current match
				ctx.ui.notify(
					formatMatch(probe, `Model: ${key}`, false).join("\n"),
					"info",
				);
				return;
			}
			const choice = picked.replace(/ \(active\)$/, "");
			if (choice === "default") delete activeVariants[key];
			else activeVariants[key] = choice;
			if (!writeActiveVariants(ACTIVE_FILE, activeVariants)) {
				ctx.ui.notify(`Failed to persist ${ACTIVE_FILE}`, "error");
				return;
			}
			const resolved = findVariantMatch(
				model.provider,
				model.id,
				promptFiles,
				choice === "default" ? undefined : choice,
			);
			ctx.ui.setStatus("model-prompts", `role: ${choice}`);
			ctx.ui.notify(
				resolved
					? formatMatch(resolved, `Role set for ${key}`, false).join("\n")
					: `Role '${choice}' set for ${key}.`,
				"info",
			);
		},
	});
}
