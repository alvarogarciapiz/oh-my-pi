/**
 * Actions on selected answer text, as in ChatGPT: selecting text inside omp's
 * answers floats two buttons at the end of the selection. "Reply" hands the
 * text to the composer as a quote the next prompt replies to (quoted-prompt.ts);
 * "Ask something" opens a small side chat about it (ask-selection.ts).
 * Selections touching anything but answers (prompts, notices) get no buttons.
 */
import { h } from "../dom";
import { icon } from "../icons";

/** Gap between the selection and the buttons, and the buttons and the view's edges. */
const GAP_PX = 4;
const EDGE_PX = 8;

export class SelectionReply {
	readonly #reply = h(
		"button",
		{
			type: "button",
			className: "selection-reply",
			ariaLabel: "Reply to selection",
			dataset: { tooltip: "Ask MarIA Code about the selected text" },
		},
		icon("reply"),
		"Reply",
	);
	readonly #ask = h(
		"button",
		{
			type: "button",
			className: "selection-reply",
			ariaLabel: "Ask something about the selection",
			dataset: { tooltip: "Ask a quick question about the selected text in a side chat, outside this session" },
		},
		icon("askBubble"),
		"Ask something",
	);
	readonly element = h("div", { className: "selection-actions", hidden: true }, this.#reply, this.#ask);
	/** The mouse is down in the transcript: the selection is still being made. */
	#dragging = false;
	#frame = 0;

	/**
	 * @param scroller the scrolling transcript holding the answers
	 * @param container the positioned element the buttons are placed in
	 * @param onAsk gets the selected text and the text of the answer it lies in
	 */
	constructor(
		private readonly scroller: HTMLElement,
		private readonly container: HTMLElement,
		onReply: (text: string) => void,
		onAsk: (selection: string, answer: string) => void,
	) {
		scroller.addEventListener("mousedown", () => {
			this.#dragging = true;
			this.#hide();
		});
		document.addEventListener("mouseup", () => {
			if (!this.#dragging) return;
			this.#dragging = false;
			this.#update();
		});
		// Keyboard and double-click selections; drags show the buttons on release only.
		document.addEventListener("selectionchange", () => {
			if (!this.#dragging) this.#update();
		});
		scroller.addEventListener("scroll", () => {
			cancelAnimationFrame(this.#frame);
			this.#frame = requestAnimationFrame(() => this.#update());
		});
		// Clicking must not clear the selection before it is read.
		this.element.addEventListener("mousedown", event => event.preventDefault());
		this.#reply.addEventListener("click", () => {
			const picked = this.#take();
			if (picked) onReply(picked.text);
		});
		this.#ask.addEventListener("click", () => {
			const picked = this.#take();
			if (picked) onAsk(picked.text, picked.answer);
		});
	}

	/** The selected text and its answer's text, clearing the selection; undefined when none is usable. */
	#take(): { text: string; answer: string } | undefined {
		const range = this.#selectedRange();
		const text = range && getSelection()?.toString().trim();
		this.#hide();
		if (!range || !text) return undefined;
		const element =
			range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement;
		const message = element?.closest(".msg.assistant");
		// The answer's text blocks, without its thinking and tool cards.
		const answer = message
			? [...message.children]
					.filter(child => child.classList.contains("markdown"))
					.map(child => child.textContent?.trim() ?? "")
					.filter(Boolean)
					.join("\n\n")
			: "";
		getSelection()?.removeAllRanges();
		return { text, answer };
	}

	/** The selection's range when it lies within omp's answers and holds text. */
	#selectedRange(): Range | undefined {
		const selection = getSelection();
		if (!selection || selection.isCollapsed || selection.rangeCount === 0) return undefined;
		if (selection.toString().trim() === "") return undefined;
		const range = selection.getRangeAt(0);
		const inAnswer = (node: Node) => {
			const element = node instanceof Element ? node : node.parentElement;
			const answer = element?.closest(".msg.assistant");
			return answer !== null && answer !== undefined && this.scroller.contains(answer);
		};
		return inAnswer(range.startContainer) && inAnswer(range.endContainer) ? range : undefined;
	}

	#update(): void {
		const range = this.#selectedRange();
		const rects = range ? range.getClientRects() : undefined;
		const last = rects?.[rects.length - 1];
		const first = rects?.[0];
		if (!last || !first) {
			this.#hide();
			return;
		}
		const view = this.scroller.getBoundingClientRect();
		if (last.bottom < view.top || first.top > view.bottom) {
			this.#hide();
			return;
		}
		this.element.hidden = false;
		const box = this.container.getBoundingClientRect();
		const width = this.element.offsetWidth;
		const height = this.element.offsetHeight;
		const maxLeft = this.container.clientWidth - width - EDGE_PX;
		const left = Math.max(EDGE_PX, Math.min(last.right - box.left - width, maxLeft));
		let top = last.bottom - box.top + GAP_PX;
		if (top > this.container.clientHeight - height - GAP_PX) top = first.top - box.top - height - GAP_PX;
		this.element.style.left = `${left}px`;
		this.element.style.top = `${Math.max(GAP_PX, top)}px`;
	}

	#hide(): void {
		this.element.hidden = true;
	}
}
