import { describe, expect, it } from "bun:test";
import type { AskQuestion } from "../src/protocol";
import { askAnswer, initialDraft } from "../webview/chat/ask-answers";

const question = (fields: Partial<AskQuestion> = {}): AskQuestion => ({
	id: "q",
	question: "Which?",
	options: [{ label: "A" }, { label: "B" }, { label: "C" }],
	...fields,
});

describe("ask answers", () => {
	it("answers a single-select question with the one marked option", () => {
		expect(askAnswer(question(), { selected: [1], other: false, custom: "" })).toEqual({
			id: "q",
			selectedOptions: ["B"],
		});
	});

	it("sends only the free text of a single-select question when Otra respuesta is on", () => {
		expect(askAnswer(question(), { selected: [0], other: true, custom: "  mi texto " })).toEqual({
			id: "q",
			selectedOptions: [],
			customInput: "mi texto",
		});
	});

	it("leaves a single-select question unanswered without an option or with blank free text", () => {
		expect(askAnswer(question(), { selected: [], other: false, custom: "" })).toBeUndefined();
		expect(askAnswer(question(), { selected: [], other: true, custom: "   " })).toBeUndefined();
	});

	it("lists multi-select labels once each, in option order, with free text only when Otra respuesta is on", () => {
		const multi = question({ multi: true });
		expect(askAnswer(multi, { selected: [2, 0, 2], other: false, custom: "ignored" })).toEqual({
			id: "q",
			selectedOptions: ["A", "C"],
		});
		expect(askAnswer(multi, { selected: [1], other: true, custom: " más " })).toEqual({
			id: "q",
			selectedOptions: ["B"],
			customInput: "más",
		});
	});

	it("accepts an empty multi-select answer", () => {
		expect(askAnswer(question({ multi: true }), { selected: [], other: false, custom: "" })).toEqual({
			id: "q",
			selectedOptions: [],
		});
	});

	it("preselects the recommended option only when it exists", () => {
		expect(initialDraft(question({ recommended: 1 })).selected).toEqual([1]);
		expect(initialDraft(question({ recommended: 9 })).selected).toEqual([]);
	});
});
