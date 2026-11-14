/**
 * "Mejorar prompt": the `enhance_prompt` and `enhance_prompt_cancel` commands.
 *
 * One tool-less call proposes a faithful rewrite of the composer draft — clearer,
 * better ordered, more precise, never wider in scope — on the `enhance` model role
 * (else `smol`, else the session's model). The call sees a bounded, static slice of
 * context (recent user messages, the latest answer, workspace facts the host sent)
 * and never the session's prompt, tools or history object. Nothing is recorded in
 * the session, and on Unicaja's LiteLLM gateway the request carries `"no-log": true`.
 *
 * The model's output is validated deterministically: literal tokens of the draft
 * (code, URLs, `@mentions`, a leading `/command`, paths) must survive verbatim.
 */
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { type Model, streamSimple } from "@oh-my-pi/pi-ai";
import {
	type ConfiguredThinkingLevel,
	concreteThinkingLevel,
	resolveThinkingLevelForModel,
	shouldDisableReasoning,
	toReasoningEffort,
} from "@oh-my-pi/pi-tui/thinking";
import { prompt, Snowflake } from "@oh-my-pi/pi-utils";
import { getModelMatchPreferences, resolveModelRoleValue } from "../../config/model-resolver";
import type { Settings } from "../../config/settings";
import { cfgDisabledExtensions } from "../../extensibility/settings";
import enhancePromptRequestPrompt from "../../prompts/system/enhance-prompt-request.md" with { type: "text" };
import enhancePromptSystemPrompt from "../../prompts/system/enhance-prompt.md" with { type: "text" };
import type { AgentSession } from "../../session/agent-session";
import { loadProjectContextFiles } from "../../system-prompt";
import { noLogPayload } from "../../utils/litellm-no-log";
import { resolveWorkspaceSnapshot } from "../../utils/workspace-snapshot";
import type { RpcEnhancePromptContext, RpcEnhancePromptResult } from "./rpc-types";

export interface EnhancePromptRequest {
	/** Client-chosen id of this request; cancellation uses it. */
	requestId: string;
	/** The composer text to rewrite. */
	draft: string;
	context?: RpcEnhancePromptContext;
}

/** A proposal longer than this many times the draft is flagged. */
const LENGTH_WARNING_RATIO = 2.5;
const MAX_CHANGES = 4;
/** Output ceiling: a rewrite of a composer draft, plus headroom for backends that ignore `disableReasoning`. */
const ENHANCE_MAX_TOKENS = 8192;

// Context bounds: at most ~12k characters reach the model besides the draft.
const RECENT_USER_MESSAGES = 3;
const MESSAGE_CHARS = 1500;
const SELECTION_CHARS = 3000;
const MAX_MENTIONS = 20;
const MAX_CONTEXT_FILES = 12;
const PATH_CHARS = 300;

/**
 * The model "Mejorar prompt" runs on: the `enhance` model role (`modelRoles.enhance`,
 * with an optional `:level` thinking suffix), else a configured `smol` role, resolved
 * against `availableModels`; undefined when neither applies. An `enhance` role that
 * matches no available model throws; an unmatched `smol` role is skipped.
 */
export function resolveEnhancePromptModel(
	settings: Settings,
	availableModels: Model[],
): { model: Model; thinkingLevel?: ConfiguredThinkingLevel } | undefined {
	const options = { settings, matchPreferences: getModelMatchPreferences(settings) };
	const enhance = settings.getModelRole("enhance")?.trim();
	if (enhance) {
		const resolved = resolveModelRoleValue(enhance, availableModels, options);
		if (!resolved.model) throw new Error(`modelRoles.enhance (${enhance}) matches no available model`);
		return { model: resolved.model, thinkingLevel: resolved.thinkingLevel };
	}
	const smol = settings.getModelRole("smol")?.trim();
	if (!smol) return undefined;
	const resolved = resolveModelRoleValue(smol, availableModels, options);
	return resolved.model ? { model: resolved.model, thinkingLevel: resolved.thinkingLevel } : undefined;
}

type EnhanceSession = Pick<AgentSession, "model" | "settings" | "modelRegistry" | "sessionId" | "messages"> & {
	readonly sessionManager: { getCwd(): string };
};

export class RpcEnhancePromptController {
	readonly #session: EnhanceSession;
	readonly #running = new Map<string, AbortController>();

	constructor(session: EnhanceSession) {
		this.#session = session;
	}

	/** Propose a rewrite of one draft; resolves once the model's whole output is validated. */
	async enhance(request: EnhancePromptRequest): Promise<RpcEnhancePromptResult> {
		const { requestId } = request;
		if (typeof requestId !== "string" || !requestId) throw new Error("enhance_prompt requires a requestId");
		const draft = typeof request.draft === "string" ? request.draft : "";
		if (!draft.trim()) throw new Error("enhance_prompt requires a non-empty draft");
		if (this.#running.has(requestId)) throw new Error(`Request ${requestId} is already running`);

		const abort = new AbortController();
		this.#running.set(requestId, abort);
		try {
			const session = this.#session;
			const role = resolveEnhancePromptModel(session.settings, session.modelRegistry.getAvailable());
			const model = role?.model ?? session.model;
			if (!model) throw new Error("No model available: set modelRoles.enhance or pick a model for the chat");
			// Reasoning stays off unless the role asks for a level explicitly.
			const level = role?.thinkingLevel
				? resolveThinkingLevelForModel(model, concreteThinkingLevel(role.thinkingLevel))
				: undefined;
			const reasoningOff = level === undefined || shouldDisableReasoning(level);

			const userTurn = prompt.render(enhancePromptRequestPrompt, {
				draft,
				recentUserMessages: recentUserTexts(session.messages),
				lastAnswer: lastAssistantText(session.messages),
				workspace: request.context?.noWorkspace
					? undefined
					: await this.#workspaceContext(request.context, abort.signal),
			});
			if (abort.signal.aborted) throw new Error("Cancelled");

			const stream = streamSimple(
				model,
				{
					systemPrompt: [prompt.render(enhancePromptSystemPrompt)],
					messages: [{ role: "user", content: userTurn, timestamp: Date.now() }],
				},
				{
					// Its own provider session: nothing is shared with the chat's conversation.
					apiKey: session.modelRegistry.resolver(model, session.sessionId),
					sessionId: `${session.sessionId}:enhance-prompt:${Snowflake.next()}`,
					maxTokens: Math.min(model.maxTokens || ENHANCE_MAX_TOKENS, ENHANCE_MAX_TOKENS),
					reasoning: level === undefined ? undefined : toReasoningEffort(level),
					disableReasoning: reasoningOff,
					// A rewrite should stay as close to the draft as possible.
					temperature: reasoningOff ? 0 : undefined,
					signal: abort.signal,
					onPayload: payload => noLogPayload(payload, model),
				},
			);
			let text = "";
			for await (const event of stream) {
				if (event.type === "text_delta") {
					text += event.delta;
				} else if (event.type === "error") {
					if (abort.signal.aborted) throw new Error("Cancelled");
					throw new Error(event.error.errorMessage || "The model returned an error");
				}
			}
			if (abort.signal.aborted) throw new Error("Cancelled");
			return buildEnhancePromptResult(draft, text, `${model.provider}/${model.id}`);
		} finally {
			this.#running.delete(requestId);
		}
	}

	/** Stop request `requestId`; false when it is not running. */
	cancel(requestId: string): boolean {
		const abort = this.#running.get(requestId);
		if (!abort) return false;
		abort.abort();
		return true;
	}

	/** Stop every running request (the process is going away). */
	cancelAll(): void {
		for (const abort of this.#running.values()) abort.abort();
	}

	async #workspaceContext(context: RpcEnhancePromptContext | undefined, signal: AbortSignal) {
		const cwd = this.#session.sessionManager.getCwd();
		const [snapshot, contextFiles] = await Promise.all([
			resolveWorkspaceSnapshot(cwd),
			loadProjectContextFiles({ cwd, disabledExtensions: [...cfgDisabledExtensions.get(this.#session.settings)] }),
		]);
		if (signal.aborted) return undefined;
		const mentions = (context?.mentions ?? [])
			.filter((mention): mention is string => typeof mention === "string" && mention.trim().length > 0)
			.slice(0, MAX_MENTIONS)
			.map(mention => truncate(mention.trim(), PATH_CHARS));
		const activeFile = typeof context?.activeFile === "string" ? context.activeFile.trim() : "";
		const selection = typeof context?.selection === "string" ? context.selection.trim() : "";
		return {
			root: snapshot ? path.basename(snapshot.root) : undefined,
			branch: snapshot?.branch,
			status: snapshot?.status,
			manifests: snapshot?.manifests ?? [],
			contextFiles: contextFiles.slice(-MAX_CONTEXT_FILES).map(file => contextFileName(cwd, file.path)),
			activeFile: activeFile ? truncate(activeFile, PATH_CHARS) : undefined,
			selection: selection ? truncate(selection, SELECTION_CHARS) : undefined,
			mentions,
		};
	}
}

function truncate(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** A context file as the model sees it: its path relative to `cwd`, or its folder and name outside it. */
function contextFileName(cwd: string, file: string): string {
	const relative = path.relative(cwd, file);
	return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
		? relative
		: path.join(path.basename(path.dirname(file)), path.basename(file));
}

function messageText(content: string | readonly { type: string; text?: string }[]): string {
	if (typeof content === "string") return content;
	return content
		.map(block => (block.type === "text" && typeof block.text === "string" ? block.text : ""))
		.join("")
		.trim();
}

/** The last few prompts the user typed (synthetic turns skipped), oldest first, each truncated. */
export function recentUserTexts(messages: readonly AgentMessage[]): string[] {
	const texts: string[] = [];
	for (let i = messages.length - 1; i >= 0 && texts.length < RECENT_USER_MESSAGES; i--) {
		const message = messages[i];
		if (message.role !== "user" || message.synthetic) continue;
		const text = messageText(message.content).trim();
		if (text) texts.unshift(truncate(text, MESSAGE_CHARS));
	}
	return texts;
}

/** Visible text of the latest assistant message with any, truncated. */
export function lastAssistantText(messages: readonly AgentMessage[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant") continue;
		const text = messageText(message.content);
		if (text) return truncate(text, MESSAGE_CHARS);
	}
	return undefined;
}

// =============================================================================
// Output parsing and validation (pure)
// =============================================================================

export type ParsedEnhanceOutput =
	| { kind: "prompt"; prompt: string; changes: string[]; ambiguities: string[] }
	| { kind: "unchanged"; ambiguities: string[] }
	| { kind: "invalid"; reason: string };

const THINKING_ENVELOPE_RE = /<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi;
const UNTERMINATED_THINKING_RE = /^\s*<(think|thinking|reasoning)>[\s\S]*$/i;
const WHOLE_FENCE_RE = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/;
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
	['"', '"'],
	["'", "'"],
	["“", "”"],
	["«", "»"],
];
const UNCHANGED_RE = /<unchanged\s*\/>|<unchanged>\s*<\/unchanged>/i;
const EMPTY_ITEM_RE = /^(?:none|n\/a|ninguna?o?|nada|-+)\.?$/i;

/** Model output with thinking envelopes, a whole-output code fence and surrounding quotes removed. */
export function cleanEnhanceOutput(raw: string): string {
	let text = raw.replace(THINKING_ENVELOPE_RE, "").trim();
	if (UNTERMINATED_THINKING_RE.test(text)) return "";
	const fenced = WHOLE_FENCE_RE.exec(text);
	if (fenced) text = fenced[2].trim();
	for (const [open, close] of QUOTE_PAIRS) {
		if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) {
			text = text.slice(open.length, -close.length).trim();
			break;
		}
	}
	return text;
}

function tagBody(text: string, tag: string): string | undefined {
	const open = `<${tag}>`;
	const start = text.indexOf(open);
	if (start === -1) return undefined;
	const end = text.indexOf(`</${tag}>`, start + open.length);
	return end === -1 ? undefined : text.slice(start + open.length, end);
}

function listItems(body: string | undefined): string[] {
	if (!body) return [];
	return body
		.split("\n")
		.map(line =>
			line
				.trim()
				.replace(/^(?:[-*•]|\d+[.)])\s*/, "")
				.trim(),
		)
		.filter(item => item.length > 0 && !EMPTY_ITEM_RE.test(item));
}

/** Parse the rewriter's tagged output; anything without `<prompt>` or `<unchanged/>` is invalid. */
export function parseEnhanceOutput(raw: string): ParsedEnhanceOutput {
	const text = cleanEnhanceOutput(raw);
	if (!text) return { kind: "invalid", reason: "The model returned no output" };
	const ambiguities = listItems(tagBody(text, "ambiguities"));
	const open = text.indexOf("<prompt>");
	if (open !== -1) {
		// The last closing tag: a rewritten draft may itself mention `</prompt>`.
		const close = text.lastIndexOf("</prompt>");
		if (close < open) return { kind: "invalid", reason: "The model output has an unterminated <prompt> tag" };
		const body = text.slice(open + "<prompt>".length, close).trim();
		if (!body) return { kind: "invalid", reason: "The model returned an empty <prompt>" };
		const rest = text.slice(close);
		return {
			kind: "prompt",
			prompt: body,
			changes: listItems(tagBody(rest, "changes")).slice(0, MAX_CHANGES),
			ambiguities: listItems(tagBody(rest, "ambiguities")),
		};
	}
	if (UNCHANGED_RE.test(text)) return { kind: "unchanged", ambiguities };
	return { kind: "invalid", reason: "The model output has no <prompt> or <unchanged/> tag" };
}

const FENCED_BLOCK_RE = /(`{3,}|~{3,})[\s\S]*?\1/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;
const URL_RE = /\b(?:https?|file):\/\/[^\s<>"'`]+/g;
const MENTION_RE = /(?<![\w.@])@[\w.\-/\\:]+/g;
const SLASH_COMMAND_RE = /^\s*(\/[A-Za-z][\w:.-]*)/;
const TRAILING_PUNCTUATION_RE = /[.,;:!?)\]}>»"'”’]+$/;
const LEADING_PUNCTUATION_RE = /^[([{<«"'“‘¿¡]+/;
const PATH_PREFIX_RE = /^(?:~?\/|\.{1,2}[\\/]|[A-Za-z]:\\)/;
const FILE_EXTENSION_RE = /\.[a-z][a-z0-9]{0,7}$/;
const FILE_NAME_RE = /^[\w-]{2,}(?:\.[\w-]+)*\.[a-z][a-z0-9]{0,7}$/;
const PATH_CHARS_RE = /^[\w.\-~/\\:@+]+$/;

function trimToken(token: string): string {
	return token.replace(TRAILING_PUNCTUATION_RE, "");
}

function isPathLike(token: string): boolean {
	if (!PATH_CHARS_RE.test(token)) return false;
	const separators = token.match(/[\\/]/g)?.length ?? 0;
	if (separators === 0) return FILE_NAME_RE.test(token);
	if (/^[\\/]+$/.test(token)) return false;
	return PATH_PREFIX_RE.test(token) || separators >= 2 || FILE_EXTENSION_RE.test(token);
}

/**
 * Literal tokens of a draft a rewrite must keep verbatim: fenced code blocks, inline
 * code spans, URLs, `@mentions`, a leading slash command, and path-like tokens
 * (`src/a.ts`, `./x`, `C:\dir\f`, `name.ext`). Deduplicated, in discovery order.
 */
export function extractProtectedTokens(draft: string): string[] {
	const tokens = new Set<string>();
	let rest = draft.replace(/\r\n/g, "\n");
	const take = (re: RegExp, transform: (match: string) => string = match => match) => {
		rest = rest.replace(re, match => {
			const token = transform(match);
			if (token) tokens.add(token);
			// Keep what a trimmed suffix removed so later passes still see the rest of the text.
			return ` ${match.slice(token.length)} `;
		});
	};
	take(FENCED_BLOCK_RE);
	take(INLINE_CODE_RE);
	take(URL_RE, trimToken);
	take(MENTION_RE, trimToken);
	const command = SLASH_COMMAND_RE.exec(rest)?.[1];
	if (command) tokens.add(trimToken(command));
	for (const word of rest.split(/\s+/)) {
		const token = trimToken(word.replace(LEADING_PUNCTUATION_RE, ""));
		if (token && isPathLike(token)) tokens.add(token);
	}
	return [...tokens];
}

/** Line endings unified and trailing whitespace per line dropped, as prompt rendering does. */
function normalizeForComparison(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "");
}

/** Protected tokens of `draft` missing verbatim from `proposal`. */
export function missingProtectedTokens(draft: string, proposal: string): string[] {
	const haystack = normalizeForComparison(proposal);
	return extractProtectedTokens(draft).filter(token => !haystack.includes(normalizeForComparison(token)));
}

function describeTokens(tokens: readonly string[]): string {
	const shown = tokens.slice(0, 5).map(token => JSON.stringify(token.length > 80 ? `${token.slice(0, 80)}…` : token));
	return tokens.length > 5 ? `${shown.join(", ")} and ${tokens.length - 5} more` : shown.join(", ");
}

/** The `enhance_prompt` result for `draft` from the model's raw output. */
export function buildEnhancePromptResult(draft: string, raw: string, model: string): RpcEnhancePromptResult {
	const parsed = parseEnhanceOutput(raw);
	const kept = { prompt: draft, changes: [], lengthWarning: false, model };
	if (parsed.kind === "invalid") {
		return { status: "invalid", ...kept, ambiguities: [], invalidReason: parsed.reason };
	}
	if (parsed.kind === "unchanged" || parsed.prompt.trim() === draft.trim()) {
		return { status: "unchanged", ...kept, ambiguities: parsed.ambiguities };
	}
	const missing = missingProtectedTokens(draft, parsed.prompt);
	if (missing.length > 0) {
		return {
			status: "invalid",
			...kept,
			ambiguities: [],
			invalidReason: `The proposal altered or dropped literal text of the draft: ${describeTokens(missing)}`,
		};
	}
	return {
		status: "improved",
		prompt: parsed.prompt,
		changes: parsed.changes,
		ambiguities: parsed.ambiguities,
		lengthWarning: parsed.prompt.length > draft.trim().length * LENGTH_WARNING_RATIO,
		model,
	};
}
