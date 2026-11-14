/**
 * "Ask something" on selected answer text: a small chat over the transcript for
 * quick questions about the excerpt (what is this, summarize it…). omp answers
 * them on its `ask` model role, outside the session: nothing reaches the
 * transcript, and closing the window forgets the conversation.
 */
import type { AskSelectionTurn, ChatRequest } from "../../src/protocol";
import { h, iconButton } from "../dom";
import { icon } from "../icons";
import { setTooltip } from "../tooltip";
import { handleMarkdownClick } from "./content";
import { renderMarkdown } from "./markdown";

type Post = (request: ChatRequest) => void;

const PLACEHOLDER = "Pregunta algo sobre el texto seleccionado…";
const SUGGESTIONS = ["¿Qué es esto?", "Resúmelo", "Explícalo con un ejemplo"];
/** Distance from the bottom within which streaming text keeps the log scrolled down. */
const STICK_PX = 40;

interface Turn {
	question: string;
	answer: string;
	error?: string;
	/** Where the answer (or its error) is shown. */
	el: HTMLElement;
}

interface Running {
	askId: string;
	turn: Turn;
	frame: number;
	/** The user stopped it: its error is the stop, not a failure. */
	stopped: boolean;
}

export class AskSelectionDialog {
	#overlay: HTMLElement;
	#quote = h("div", { className: "ask-selection-quote" });
	#model = h("span", { className: "ask-selection-model" });
	#log = h("div", { className: "ask-selection-log" });
	#suggestions: HTMLElement;
	#input = h("textarea", { className: "ask-selection-input", rows: 2, placeholder: PLACEHOLDER });
	#send: HTMLButtonElement;
	#selection = "";
	#answer = "";
	#turns: Turn[] = [];
	#running: Running | undefined;
	#restore: Element | null = null;
	#nextId = 0;

	constructor(private readonly post: Post) {
		this.#send = h("button", { type: "button", className: "ask-selection-send" });
		this.#send.addEventListener("click", () => (this.#running ? this.#stop() : this.#submit()));
		this.#suggestions = h(
			"div",
			{ className: "ask-selection-suggestions" },
			...SUGGESTIONS.map(text => {
				const chip = h("button", { type: "button", className: "ask-selection-suggestion" }, text);
				chip.addEventListener("click", () => this.#ask(text));
				return chip;
			}),
		);
		this.#input.addEventListener("input", () => this.#refresh());
		this.#input.addEventListener("keydown", event => {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.#submit();
			}
		});
		this.#log.addEventListener("click", event => handleMarkdownClick(event, event.target as Element, post));
		const close = iconButton("close", "Cerrar (Esc)", () => this.close());
		const card = h(
			"div",
			{ className: "ask-selection-card", role: "dialog", ariaModal: "true", ariaLabel: "Ask something" },
			h(
				"div",
				{ className: "ask-selection-header" },
				h("span", { className: "ask-selection-icon" }, icon("askBubble")),
				h("span", { className: "ask-selection-title" }, "Ask something"),
				this.#model,
				h("span", { className: "ask-selection-spacer" }),
				close,
			),
			this.#quote,
			this.#log,
			this.#suggestions,
			h("div", { className: "ask-selection-form" }, this.#input, this.#send),
			h(
				"div",
				{ className: "ask-selection-hint" },
				"Chat aparte: no se guarda en la sesión. Enter para enviar, Mayús+Enter para salto de línea.",
			),
		);
		this.#overlay = h("div", { className: "ask-selection", hidden: true }, card);
		this.#overlay.addEventListener("keydown", event => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			if (this.#running) this.#stop();
			else this.close();
		});
		// A click on the dimmed backdrop closes the window; clicks inside the card do not.
		this.#overlay.addEventListener("mousedown", event => {
			if (event.target === this.#overlay) this.close();
		});
		document.body.append(this.#overlay);
	}

	/** Open a fresh chat about `selection`, text selected in an answer whose text is `answer`. */
	open(selection: string, answer: string): void {
		this.#reset();
		this.#restore = this.#overlay.hidden ? document.activeElement : this.#restore;
		this.#selection = selection;
		this.#answer = answer;
		this.#quote.textContent = selection;
		this.#quote.dataset.tooltip = selection;
		this.#overlay.hidden = false;
		this.#refresh();
		this.#input.focus();
	}

	/** Close the window, stopping a running answer and forgetting the conversation. */
	close(): void {
		if (this.#overlay.hidden) return;
		this.#reset();
		this.#overlay.hidden = true;
		const restore = this.#restore;
		this.#restore = null;
		if (restore instanceof HTMLElement && restore.isConnected) restore.focus();
	}

	/** Text of the running answer `askId`. */
	delta(askId: string, delta: string): void {
		const running = this.#running;
		if (running?.askId !== askId) return;
		running.turn.answer += delta;
		if (running.frame) return;
		running.frame = requestAnimationFrame(() => {
			running.frame = 0;
			if (this.#running === running) this.#renderAnswer(running.turn);
		});
	}

	/** The question `askId` ended with its whole `answer`, or with `error`. */
	done(askId: string, answer: string | undefined, model: string | undefined, error: string | undefined): void {
		const running = this.#running;
		if (running?.askId !== askId) return;
		cancelAnimationFrame(running.frame);
		this.#running = undefined;
		const { turn } = running;
		if (error) turn.error = running.stopped ? "Detenido." : error;
		else turn.answer = answer ?? turn.answer;
		if (model) {
			this.#model.textContent = model;
			setTooltip(
				this.#model,
				`Responde ${model}: el rol "ask" (modelRoles.ask) o, sin configurar, el modelo del chat`,
			);
		}
		this.#renderAnswer(turn);
		this.#refresh();
		this.#input.focus();
	}

	#submit(): void {
		const question = this.#input.value.trim();
		if (!question || this.#running) return;
		this.#input.value = "";
		this.#ask(question);
	}

	#ask(question: string): void {
		if (this.#running || this.#overlay.hidden) return;
		// Only answered turns are context: a failed or stopped question is not.
		const history: AskSelectionTurn[] = this.#turns
			.filter(turn => !turn.error && turn.answer)
			.map(turn => ({ question: turn.question, answer: turn.answer }));
		const el = h("div", { className: "ask-selection-answer markdown" });
		el.append(h("span", { className: "ask-selection-pending" }, "Pensando…"));
		const turn: Turn = { question, answer: "", el };
		this.#turns.push(turn);
		this.#log.append(h("div", { className: "ask-selection-question" }, question), el);
		this.#log.scrollTop = this.#log.scrollHeight;
		const askId = `ask-${Date.now()}-${this.#nextId++}`;
		this.#running = { askId, turn, frame: 0, stopped: false };
		this.#refresh();
		this.post({
			type: "askSelection",
			askId,
			selection: this.#selection,
			answer: this.#answer || undefined,
			question,
			history,
		});
	}

	#stop(): void {
		const running = this.#running;
		if (!running) return;
		running.stopped = true;
		this.post({ type: "askSelectionCancel", askId: running.askId });
	}

	#reset(): void {
		this.#stop();
		if (this.#running) cancelAnimationFrame(this.#running.frame);
		this.#running = undefined;
		this.#turns = [];
		this.#log.replaceChildren();
		this.#input.value = "";
		this.#model.textContent = "";
		setTooltip(this.#model, undefined);
	}

	#renderAnswer(turn: Turn): void {
		const log = this.#log;
		const stick = log.scrollHeight - log.scrollTop - log.clientHeight < STICK_PX;
		if (turn.answer) turn.el.innerHTML = renderMarkdown(turn.answer);
		else turn.el.replaceChildren();
		if (turn.error) turn.el.append(h("div", { className: "ask-selection-error" }, turn.error));
		if (stick) log.scrollTop = log.scrollHeight;
	}

	#refresh(): void {
		const running = this.#running !== undefined;
		this.#suggestions.hidden = this.#turns.length > 0;
		this.#send.replaceChildren(icon(running ? "stop" : "arrowRight"));
		this.#send.disabled = !running && this.#input.value.trim() === "";
		setTooltip(this.#send, running ? "Detener (Esc)" : "Enviar (Enter)");
		this.#send.ariaLabel = running ? "Detener" : "Enviar";
	}
}
