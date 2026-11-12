/**
 * omp's `ask` questions as a card over the chat: the transcript and composer
 * blur behind it (and turn `inert`) until the user answers or dismisses, while
 * the header stays usable to open the History or another chat. Several
 * questions go one per step with a progress bar; every question also takes a
 * free answer, typed or dictated. Dismissing answers `cancelled`, which stops
 * omp's task, so Escape never dismisses.
 *
 * Questions of a chat the view moves away from are kept with what the user
 * marked; the host re-sends them with the chat's transcript on return.
 * While open (or its dictation is still transcribing) it owns omp's dictation
 * updates instead of the composer.
 */
import type { AskAnswer, AskQuestion, ChatRequest } from "../../src/protocol";
import { button, h } from "../dom";
import { icon } from "../icons";
import { setTooltip } from "../tooltip";
import { type AskDraft, askAnswer, initialDraft } from "./ask-answers";
import { DictationControl, type DictationState } from "./dictation";
import { renderMarkdown } from "./markdown";

type Post = (request: ChatRequest) => void;

interface Pending {
	id: string;
	questions: AskQuestion[];
	drafts: AskDraft[];
	step: number;
	/** The furthest step shown: the progress bar jumps back to any step up to it. */
	reached: number;
}

/** Questions of other chats kept with their marks, oldest dropped first. */
const MAX_STASHED = 10;
const PLACEHOLDER = "Escribe tu respuesta…";
const PLACEHOLDER_LISTENING = "Escuchando… pulsa el micrófono para terminar, Esc para cancelar";
const PLACEHOLDER_TRANSCRIBING = "Transcribiendo…";

export class AskDialog {
	readonly element: HTMLElement;
	#card: HTMLElement;
	#chip = h("span", { className: "ask-chip", hidden: true });
	#stepLabel = h("span", { className: "ask-step", hidden: true });
	#progress = h("div", { className: "ask-progress", hidden: true });
	#body = h("div", { className: "ask-body" });
	#back: HTMLButtonElement;
	#primary: HTMLButtonElement;
	#dictation: DictationControl;
	#input = h("textarea", { className: "ask-other-input", rows: 3, placeholder: PLACEHOLDER });
	#preview = h("div", { className: "dictation-preview", hidden: true });
	#error = h("div", { className: "ask-error", role: "alert", hidden: true });
	#otherField: HTMLElement;
	/** The shown step's option buttons; the last one is "Otra respuesta…". */
	#options: HTMLButtonElement[] = [];
	/** Rich previews aligned with the shown step's options. */
	#previews: (HTMLElement | undefined)[] = [];
	#queue: Pending[] = [];
	#stash = new Map<string, Pending>();
	#suspended = false;
	#visible = false;
	/** The request and step on screen, so updates that leave them alone keep focus where it is. */
	#shown: { id: string; step: number } | undefined;
	#restore: Element | null = null;

	constructor(
		private readonly post: Post,
		/** Runs before the box shows: the composer drops a recording so the microphone is free. */
		private readonly onOpen: () => void,
		/** The chat's transcript area and composer: `inert` while the box shows. */
		private readonly covered: HTMLElement[],
	) {
		this.#dictation = new DictationControl(post, state => this.#onDictationState(state));
		const dismiss = button("Descartar", "ask-dismiss", () => this.#dismiss());
		setTooltip(dismiss, "Cerrar sin responder: MarIA Code detiene la tarea");
		this.#back = button("Atrás", "ask-back", () => this.#goTo((this.#queue[0]?.step ?? 0) - 1));
		setTooltip(this.#back, "Pregunta anterior (Alt+←)");
		this.#primary = button("Siguiente", "ask-primary", () => this.#advance());
		this.#input.addEventListener("input", () => this.#onInput());
		this.#otherField = h(
			"div",
			{ className: "ask-other-field", hidden: true },
			this.#input,
			this.#preview,
			this.#error,
			h(
				"div",
				{ className: "ask-other-tools" },
				this.#dictation.element,
				h("span", { className: "ask-other-hint" }, "Enter para continuar · Mayús+Enter salto de línea"),
			),
		);
		this.#card = h(
			"div",
			{ className: "ask-card", role: "dialog", ariaModal: "true" },
			h(
				"div",
				{ className: "ask-header" },
				h("span", { className: "ask-mark", ariaHidden: "true" }),
				h("span", { className: "ask-label" }, "MarIA Code pregunta"),
				this.#chip,
				h("span", { className: "ask-spacer" }),
				this.#stepLabel,
			),
			this.#progress,
			this.#body,
			h(
				"div",
				{ className: "ask-footer" },
				dismiss,
				h("span", { className: "ask-spacer" }),
				this.#back,
				this.#primary,
			),
		);
		this.#card.addEventListener("keydown", event => this.#onKeyDown(event));
		this.element = h("div", { className: "ask-overlay", role: "presentation", hidden: true }, this.#card);
	}

	/** Dictation updates belong here while open, and until a capture started here has finished. */
	get ownsDictation(): boolean {
		return this.#visible || this.#dictation.state !== "idle";
	}

	/** omp asks (or asks again, after the chat's transcript was re-sent). */
	show(update: { id: string; questions: AskQuestion[] }): void {
		const queued = this.#queue.find(pending => pending.id === update.id);
		if (queued) {
			if (queued.questions.length !== update.questions.length) {
				Object.assign(queued, { drafts: update.questions.map(initialDraft), step: 0, reached: 0 });
			}
			queued.questions = update.questions;
			if (this.#shown?.id === update.id) this.#shown = undefined;
		} else {
			const stashed = this.#stash.get(update.id);
			this.#stash.delete(update.id);
			this.#queue.push(
				stashed && stashed.questions.length === update.questions.length
					? { ...stashed, questions: update.questions }
					: {
							id: update.id,
							questions: update.questions,
							drafts: update.questions.map(initialDraft),
							step: 0,
							reached: 0,
						},
			);
		}
		this.#update();
	}

	/** The question `id` no longer waits for an answer. */
	close(id: string): void {
		this.#stash.delete(id);
		this.#queue = this.#queue.filter(pending => pending.id !== id);
		this.#update();
	}

	/** The view shows another transcript: keep the questions and their marks for when it comes back. */
	clear(): void {
		for (const pending of this.#queue) this.#stash.set(pending.id, pending);
		for (const id of this.#stash.keys()) {
			if (this.#stash.size <= MAX_STASHED) break;
			this.#stash.delete(id);
		}
		this.#queue = [];
		this.#update();
	}

	/** The History covers the chat: step aside until it closes. */
	setSuspended(suspended: boolean): void {
		this.#suspended = suspended;
		this.#update();
	}

	/** "Toggle Voice Input" from the command palette or a keybinding while the box is open. */
	toggleDictation(): void {
		const current = this.#current();
		if (current && !current.draft.other) this.#choose(current.question.options.length);
		this.#dictation.toggle();
	}

	/** omp's dictation state; `text` is a streaming model's running transcript. */
	dictationUpdate(
		state: "recording" | "transcribing" | "idle",
		text: string | undefined,
		error: string | undefined,
	): void {
		this.#dictation.update(state);
		this.#preview.textContent = text ?? "";
		this.#preview.hidden = state !== "recording" || !text;
		if (error) this.#showError(error);
	}

	/** A finished dictation: the text goes in at the cursor, and is sent when omp's submit trigger fired. */
	dictationText(text: string, submit: boolean): void {
		this.#dictation.update("idle");
		// Closed while transcribing: the speech was meant for a box that is gone.
		if (!this.#visible) return;
		if (!text) {
			this.#showError("No se ha detectado voz.");
			return;
		}
		const { selectionStart, selectionEnd, value } = this.#input;
		const before = value.slice(0, selectionStart);
		const pad = before !== "" && !/\s$/.test(before) && !/^\s/.test(text) ? " " : "";
		this.#input.setRangeText(pad + text, selectionStart, selectionEnd, "end");
		this.#onInput();
		this.#input.focus();
		if (submit) this.#advance();
	}

	#current(): { pending: Pending; question: AskQuestion; draft: AskDraft } | undefined {
		const pending = this.#queue[0];
		const question = pending?.questions[pending.step];
		const draft = pending?.drafts[pending.step];
		return pending && question && draft ? { pending, question, draft } : undefined;
	}

	/** Show, re-render, or hide after the queue or suspension changed. */
	#update(): void {
		const head = this.#queue[0];
		if (!head || this.#suspended) {
			if (this.#visible) this.#hide(!this.#suspended);
			return;
		}
		if (!this.#visible) {
			this.onOpen();
			this.#restore = document.activeElement;
			this.element.hidden = false;
			for (const element of this.covered) element.inert = true;
			this.#visible = true;
		}
		if (this.#shown?.id !== head.id || this.#shown.step !== head.step) this.#render();
	}

	#hide(restoreFocus: boolean): void {
		this.#visible = false;
		this.#shown = undefined;
		this.#dictation.cancel();
		this.element.hidden = true;
		for (const element of this.covered) element.inert = false;
		const restore = this.#restore;
		this.#restore = null;
		if (restoreFocus && restore instanceof HTMLElement && restore.isConnected) restore.focus();
	}

	#render(direction?: "forward" | "back"): void {
		const current = this.#current();
		if (!current) return;
		const { pending, question, draft } = current;
		const count = pending.questions.length;
		this.#shown = { id: pending.id, step: pending.step };
		const header = question.header?.trim();
		this.#chip.textContent = header ?? "";
		this.#chip.hidden = !header;
		this.#stepLabel.textContent = `${pending.step + 1} de ${count}`;
		this.#stepLabel.hidden = count === 1;
		this.#progress.hidden = count === 1;
		this.#back.hidden = pending.step === 0;
		this.#primary.textContent = pending.step === count - 1 ? "Enviar" : "Siguiente";
		setTooltip(
			this.#primary,
			pending.step === count - 1 ? "Enviar tus respuestas (Ctrl+Enter)" : "Siguiente pregunta (Ctrl+Enter)",
		);

		const multi = question.multi === true;
		const role = multi ? "checkbox" : "radio";
		const questionId = `ask-q-${pending.step}`;
		const text = h("div", { className: "ask-question markdown", id: questionId });
		text.innerHTML = renderMarkdown(question.question);
		this.#card.setAttribute("aria-labelledby", questionId);
		const list = h("div", { className: "ask-options", role: multi ? "group" : "radiogroup" });
		list.setAttribute("aria-labelledby", questionId);
		this.#options = [];
		this.#previews = [];
		for (const [index, option] of question.options.entries()) {
			const choice = h(
				"button",
				{ type: "button", className: "ask-option", role },
				h("span", { className: "ask-indicator", ariaHidden: "true" }, multi && icon("check")),
				h(
					"span",
					{ className: "ask-option-text" },
					h(
						"span",
						{ className: "ask-option-title" },
						h("span", { className: "ask-option-label" }, option.label),
						index === question.recommended && h("span", { className: "ask-badge" }, "Recomendada"),
					),
					option.description && h("span", { className: "ask-option-desc" }, option.description),
				),
				index < 9 && h("kbd", { className: "ask-key", ariaHidden: "true" }, String(index + 1)),
			);
			choice.addEventListener("click", () => this.#choose(index));
			list.append(choice);
			this.#options.push(choice);
			const preview = option.preview?.trim();
			if (preview) {
				const block = h("div", { className: "ask-option-preview markdown", hidden: true });
				block.innerHTML = renderMarkdown(preview);
				list.append(block);
				this.#previews.push(block);
			} else {
				this.#previews.push(undefined);
			}
		}
		const other = h(
			"button",
			{ type: "button", className: "ask-option ask-other", role },
			h("span", { className: "ask-indicator", ariaHidden: "true" }, multi && icon("check")),
			h(
				"span",
				{ className: "ask-option-text" },
				h(
					"span",
					{ className: "ask-option-title" },
					icon("pencil"),
					h("span", { className: "ask-option-label" }, "Otra respuesta…"),
				),
			),
		);
		other.addEventListener("click", () => this.#choose(question.options.length));
		list.append(other);
		this.#options.push(other);

		this.#input.value = draft.custom;
		this.#error.hidden = true;
		const body = h(
			"div",
			{ className: direction ? `ask-body enter-${direction}` : "ask-body" },
			text,
			h("div", { className: "ask-hint" }, multi ? "Elige todas las que quieras" : "Elige una opción"),
			list,
			this.#otherField,
		);
		this.#body.replaceWith(body);
		this.#body = body;
		this.#sync();
		if (draft.other) this.#input.focus();
		else this.#options[draft.selected[0] ?? 0]?.focus();
	}

	/** Reflect the shown step's marks: checks, previews, the free-text field, progress and the primary button. */
	#sync(): void {
		const current = this.#current();
		if (!current) return;
		const { pending, question, draft } = current;
		for (const [index, choice] of this.#options.entries()) {
			const checked = index === question.options.length ? draft.other : draft.selected.includes(index);
			choice.ariaChecked = String(checked);
			const preview = this.#previews[index];
			if (preview) preview.hidden = !checked;
		}
		this.#otherField.hidden = !draft.other;
		this.#primary.disabled = askAnswer(question, draft) === undefined || this.#dictation.state !== "idle";
		this.#input.placeholder =
			this.#dictation.state === "recording"
				? PLACEHOLDER_LISTENING
				: this.#dictation.state === "transcribing"
					? PLACEHOLDER_TRANSCRIBING
					: PLACEHOLDER;
		this.#progress.replaceChildren(
			...pending.questions.map((step, index) => {
				const answered = askAnswer(step, pending.drafts[index] ?? initialDraft(step)) !== undefined;
				const done = index !== pending.step && index <= pending.reached && answered;
				const dot = h("button", {
					type: "button",
					className: `ask-dot${done ? " done" : ""}${index === pending.step ? " current" : ""}`,
					ariaLabel: `Pregunta ${index + 1}`,
					disabled: index > pending.reached,
					tabIndex: -1,
				});
				dot.addEventListener("click", () => this.#goTo(index));
				return dot;
			}),
		);
	}

	/** Mark option `index` (the options' length: "Otra respuesta…"). */
	#choose(index: number): void {
		const current = this.#current();
		if (!current) return;
		const { question, draft } = current;
		const isOther = index === question.options.length;
		if (question.multi) {
			if (isOther) draft.other = !draft.other;
			else
				draft.selected = draft.selected.includes(index)
					? draft.selected.filter(marked => marked !== index)
					: [...draft.selected, index];
		} else if (isOther) {
			draft.other = true;
			draft.selected = [];
		} else {
			draft.selected = [index];
			draft.other = false;
		}
		this.#sync();
		if (isOther && draft.other) this.#input.focus();
	}

	#onInput(): void {
		const current = this.#current();
		if (!current) return;
		const { question, draft } = current;
		draft.custom = this.#input.value;
		if (!draft.other) {
			draft.other = true;
			if (!question.multi) draft.selected = [];
		}
		this.#sync();
	}

	#goTo(step: number): void {
		const pending = this.#queue[0];
		if (!pending || step < 0 || step > pending.reached || step === pending.step) return;
		const direction = step < pending.step ? "back" : "forward";
		pending.step = step;
		this.#render(direction);
	}

	/** Next question, or send every answer from the last one. */
	#advance(): void {
		const current = this.#current();
		if (!current || this.#primary.disabled) return;
		const { pending } = current;
		if (pending.step < pending.questions.length - 1) {
			pending.step++;
			pending.reached = Math.max(pending.reached, pending.step);
			this.#render("forward");
			return;
		}
		const answers: AskAnswer[] = [];
		for (const [index, question] of pending.questions.entries()) {
			const answer = askAnswer(question, pending.drafts[index] ?? initialDraft(question));
			if (!answer) {
				this.#goTo(index);
				return;
			}
			answers.push(answer);
		}
		this.post({ type: "askAnswer", id: pending.id, answers });
		this.close(pending.id);
	}

	#dismiss(): void {
		const pending = this.#queue[0];
		if (!pending) return;
		this.post({ type: "askDismiss", id: pending.id });
		this.close(pending.id);
	}

	#onKeyDown(event: KeyboardEvent): void {
		const current = this.#current();
		if (!current) return;
		const inInput = event.target === this.#input;
		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();
			const state = this.#dictation.state;
			if (state === "starting" || state === "recording") this.#dictation.cancel();
			else if (inInput) this.#options.at(-1)?.focus();
			return;
		}
		if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			this.#advance();
			return;
		}
		if (event.key === "Tab") {
			this.#trapTab(event);
			return;
		}
		if (event.key === "ArrowLeft" && event.altKey) {
			event.preventDefault();
			this.#goTo(current.pending.step - 1);
			return;
		}
		if (inInput) {
			if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
				event.preventDefault();
				this.#advance();
			}
			return;
		}
		const focused = this.#options.indexOf(event.target as HTMLButtonElement);
		if ((event.key === "ArrowDown" || event.key === "ArrowUp") && focused >= 0) {
			event.preventDefault();
			const count = this.#options.length;
			this.#options[(focused + (event.key === "ArrowDown" ? 1 : -1) + count) % count]?.focus();
			return;
		}
		if (/^[1-9]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
			const index = Number(event.key) - 1;
			if (index >= current.question.options.length) return;
			event.preventDefault();
			this.#choose(index);
			this.#options[index]?.focus();
			return;
		}
		if (event.key === "Enter" && focused >= 0 && !current.question.multi) {
			event.preventDefault();
			this.#choose(focused);
			if (focused < current.question.options.length) this.#advance();
		}
	}

	/** Keep Tab inside the card: the chat behind it is inert, and the header is for the pointer. */
	#trapTab(event: KeyboardEvent): void {
		const focusable = [...this.#card.querySelectorAll<HTMLElement>("button:not([disabled]), textarea")].filter(
			element => element.tabIndex >= 0 && element.offsetParent !== null,
		);
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!first || !last) return;
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	#onDictationState(state: DictationState): void {
		if (state !== "recording") this.#preview.hidden = true;
		if (state !== "idle") this.#error.hidden = true;
		this.#sync();
		if (state === "idle" && this.#visible && !this.#otherField.hidden) this.#input.focus();
	}

	#showError(message: string): void {
		this.#error.textContent = message;
		this.#error.hidden = false;
	}
}
