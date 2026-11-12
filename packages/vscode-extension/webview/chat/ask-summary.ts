/**
 * What the user answered to omp's `ask`, for its activity row: each question
 * with the options chosen, the free answer, and the options left out. Built
 * from the call's `questions` and the result's `details` (one flat answer for
 * a single question, `results` by id for several).
 */
import { h } from "../dom";
import { icon } from "../icons";
import { str } from "./activity";
import { renderMarkdown } from "./markdown";

export interface AskSummaryOption {
	label: string;
	description?: string;
	chosen: boolean;
}

export interface AskSummaryItem {
	header?: string;
	question: string;
	multi: boolean;
	options: AskSummaryOption[];
	/** The user's own words ("Otra respuesta"). */
	custom?: string;
	note?: string;
	/** No answer came in time: omp took the recommended option. */
	timedOut: boolean;
	/** The result carries an answer for this question (false while waiting, or when dismissed). */
	answered: boolean;
}

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The questions of an `ask` call merged with the answers in its result `details` (absent until answered). */
export function askSummary(args: Record<string, unknown>, details: unknown): AskSummaryItem[] {
	const questions = Array.isArray(args.questions) ? args.questions.map(record) : [];
	const answers = record(details);
	const byId = new Map<string, Record<string, unknown>>();
	if (Array.isArray(answers.results)) {
		for (const result of answers.results.map(record)) {
			const id = str(result.id);
			if (id) byId.set(id, result);
		}
	}
	const single = Array.isArray(answers.selectedOptions) ? answers : undefined;
	return questions.map((question, index) => {
		const answer = (index === 0 && questions.length === 1 ? single : undefined) ?? byId.get(str(question.id) ?? "");
		const selected = Array.isArray(answer?.selectedOptions) ? answer.selectedOptions : [];
		const options = (Array.isArray(question.options) ? question.options.map(record) : []).flatMap(option => {
			const label = str(option.label);
			if (!label) return [];
			const description = str(option.description);
			const chosen = selected.includes(label);
			return [description ? { label, description, chosen } : { label, chosen }];
		});
		const header = str(question.header)?.trim();
		const custom = str(answer?.customInput)?.trim();
		const note = str(answer?.note)?.trim();
		return {
			...(header ? { header } : {}),
			question: str(question.question) ?? "",
			multi: question.multi === true,
			options,
			...(custom ? { custom } : {}),
			...(note ? { note } : {}),
			timedOut: answer?.timedOut === true,
			answered: answer !== undefined,
		};
	});
}

/** The questions as cards: chosen options and the free answer up front, the rest as faint chips. */
export function askSummaryView(items: AskSummaryItem[]): HTMLElement {
	return h(
		"div",
		{ className: "ask-summary" },
		...items.map((item, index) => {
			const question = h("div", { className: "ask-summary-question markdown" });
			question.innerHTML = renderMarkdown(item.question);
			const chosen = item.options.filter(option => option.chosen);
			const others = item.options.filter(option => !option.chosen);
			const answers: Node[] = chosen.map(option =>
				h(
					"div",
					{ className: "ask-summary-answer" },
					h("span", { className: "ask-summary-mark" }, icon("check")),
					h(
						"span",
						{ className: "ask-summary-answer-text" },
						h("span", { className: "ask-summary-answer-label" }, option.label),
						option.description && h("span", { className: "ask-summary-answer-desc" }, option.description),
					),
				),
			);
			if (item.custom) {
				answers.push(
					h(
						"div",
						{ className: "ask-summary-answer custom" },
						h("span", { className: "ask-summary-mark" }, icon("pencil")),
						h(
							"span",
							{ className: "ask-summary-answer-text" },
							h("span", { className: "ask-summary-answer-desc" }, "Your answer"),
							h("span", { className: "ask-summary-answer-label" }, item.custom),
						),
					),
				);
			}
			if (answers.length === 0) {
				answers.push(
					h("div", { className: "ask-summary-empty" }, item.answered ? "No option chosen" : "No answer"),
				);
			}
			return h(
				"div",
				{ className: "ask-summary-item" },
				h(
					"div",
					{ className: "ask-summary-head" },
					h("span", { className: "ask-summary-index" }, String(index + 1)),
					item.header && h("span", { className: "ask-summary-chip" }, item.header),
					item.multi && h("span", { className: "ask-summary-kind" }, "Multiple choice"),
					item.timedOut && h("span", { className: "ask-summary-kind warning" }, "Timed out"),
				),
				question,
				h("div", { className: "ask-summary-answers" }, ...answers),
				item.note && h("div", { className: "ask-summary-note" }, `Note: ${item.note}`),
				others.length > 0 &&
					h(
						"div",
						{ className: "ask-summary-others" },
						h("span", { className: "ask-summary-others-label" }, "Not chosen"),
						...others.map(option => h("span", { className: "ask-summary-other" }, option.label)),
					),
			);
		}),
	);
}
