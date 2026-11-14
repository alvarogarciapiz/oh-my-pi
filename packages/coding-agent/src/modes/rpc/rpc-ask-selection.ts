/**
 * "Ask something" about text selected in an answer: the `ask_selection` and
 * `ask_selection_cancel` commands plus the `ask_selection_delta` frames.
 *
 * A small chat beside the session: the excerpt (and the answer it comes from)
 * plus the questions asked so far go to the `ask` model role — the session's
 * model when unset — without the session's prompt, tools or history. Nothing
 * is recorded in the session, and on Unicaja's LiteLLM gateway the request
 * carries `"no-log": true` so the proxy keeps it out of its logs too.
 */
import { type AssistantMessage, type Message, type Model, streamSimple } from "@oh-my-pi/pi-ai";
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
import askSelectionPrompt from "../../prompts/system/ask-selection.md" with { type: "text" };
import type { AgentSession } from "../../session/agent-session";
import { noLogPayload } from "../../utils/litellm-no-log";
import type { RpcAskSelectionDeltaFrame, RpcAskSelectionTurn } from "./rpc-types";

export interface AskSelectionRequest {
	/** Client-chosen id of this question; its deltas and cancellation use it. */
	askId: string;
	/** The selected excerpt. */
	selection: string;
	/** The whole answer the excerpt was selected in. */
	answer?: string;
	question: string;
	/** Earlier questions about the same excerpt, oldest first. */
	history?: readonly RpcAskSelectionTurn[];
}

export interface AskSelectionResult {
	answer: string;
	/** `provider/id` of the model that answered. */
	model: string;
}

/**
 * The model "Ask something" runs on: the `ask` model role (`modelRoles.ask`,
 * with an optional `:level` thinking suffix) resolved against `availableModels`;
 * undefined when the role is unset. A role that matches no available model throws.
 */
export function resolveAskSelectionModel(
	settings: Settings,
	availableModels: Model[],
): { model: Model; thinkingLevel?: ConfiguredThinkingLevel } | undefined {
	const selector = settings.getModelRole("ask")?.trim();
	if (!selector) return undefined;
	const resolved = resolveModelRoleValue(selector, availableModels, {
		settings,
		matchPreferences: getModelMatchPreferences(settings),
	});
	if (!resolved.model) throw new Error(`modelRoles.ask (${selector}) matches no available model`);
	return { model: resolved.model, thinkingLevel: resolved.thinkingLevel };
}

type AskSession = Pick<AgentSession, "model" | "thinkingLevel" | "settings" | "modelRegistry" | "sessionId">;

export class RpcAskSelectionController {
	readonly #session: AskSession;
	readonly #output: (frame: RpcAskSelectionDeltaFrame) => void;
	readonly #running = new Map<string, AbortController>();

	constructor(session: AskSession, output: (frame: RpcAskSelectionDeltaFrame) => void) {
		this.#session = session;
		this.#output = output;
	}

	/** Answer one question, streaming its text as `ask_selection_delta` frames; resolves once it is complete. */
	async ask(request: AskSelectionRequest): Promise<AskSelectionResult> {
		const { askId } = request;
		if (typeof askId !== "string" || !askId) throw new Error("ask_selection requires an askId");
		const selection = typeof request.selection === "string" ? request.selection.trim() : "";
		const question = typeof request.question === "string" ? request.question.trim() : "";
		if (!selection || !question) throw new Error("ask_selection requires a selection and a question");
		if (this.#running.has(askId)) throw new Error(`Question ${askId} is already running`);

		const session = this.#session;
		const role = resolveAskSelectionModel(session.settings, session.modelRegistry.getAvailable());
		const model = role?.model ?? session.model;
		if (!model) throw new Error("No model available: set modelRoles.ask or pick a model for the chat");
		const level = resolveThinkingLevelForModel(
			model,
			concreteThinkingLevel(role?.thinkingLevel) ?? session.thinkingLevel,
		);

		const history: Message[] = [];
		for (const turn of request.history ?? []) {
			history.push({ role: "user", content: turn.question, timestamp: Date.now() });
			history.push(answerMessage(model, turn.answer));
		}
		history.push({ role: "user", content: question, timestamp: Date.now() });

		const abort = new AbortController();
		this.#running.set(askId, abort);
		try {
			const stream = streamSimple(
				model,
				{
					systemPrompt: [
						prompt.render(askSelectionPrompt, { selection, answer: request.answer?.trim() || undefined }),
					],
					messages: history,
				},
				{
					// Its own provider session: nothing is shared with the chat's conversation.
					apiKey: session.modelRegistry.resolver(model, session.sessionId),
					sessionId: `${session.sessionId}:ask-selection:${Snowflake.next()}`,
					reasoning: toReasoningEffort(level),
					disableReasoning: shouldDisableReasoning(level),
					signal: abort.signal,
					onPayload: payload => noLogPayload(payload, model),
				},
			);
			let text = "";
			for await (const event of stream) {
				if (event.type === "text_delta") {
					text += event.delta;
					this.#output({ type: "ask_selection_delta", askId, delta: event.delta });
				} else if (event.type === "error") {
					if (abort.signal.aborted) throw new Error("Cancelled");
					throw new Error(event.error.errorMessage || "The model returned an error");
				}
			}
			return { answer: text.trim(), model: `${model.provider}/${model.id}` };
		} finally {
			this.#running.delete(askId);
		}
	}

	/** Stop question `askId`; false when it is not running. */
	cancel(askId: string): boolean {
		const abort = this.#running.get(askId);
		if (!abort) return false;
		abort.abort();
		return true;
	}

	/** Stop every running question (the process is going away). */
	cancelAll(): void {
		for (const abort of this.#running.values()) abort.abort();
	}
}

/** An earlier answer replayed as context: visible text only, no billed usage. */
function answerMessage(model: Model, text: string): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}
