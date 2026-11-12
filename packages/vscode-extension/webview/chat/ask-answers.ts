/**
 * What the user marked on one `ask` question, and the answer omp accepts for
 * it (`parseAskDialogResponse` in packages/coding-agent/src/modes/rpc/rpc-mode.ts):
 * exact option labels without duplicates; a single-select question carries
 * either one option or free text, never both; a multi-select one any subset
 * (none is a valid answer) plus optional free text.
 */
import type { AskAnswer, AskQuestion } from "../../src/protocol";

/** Option indices marked, and the free text when "Otra respuesta" is on. */
export interface AskDraft {
	selected: number[];
	other: boolean;
	custom: string;
}

/** Starting marks: the recommended option preselected, nothing else. */
export function initialDraft(question: AskQuestion): AskDraft {
	const { recommended } = question;
	const valid = recommended !== undefined && recommended >= 0 && recommended < question.options.length;
	return { selected: valid ? [recommended] : [], other: false, custom: "" };
}

/** The answer omp accepts for `draft`, or undefined while a single-select question is not answered yet. */
export function askAnswer(question: AskQuestion, draft: AskDraft): AskAnswer | undefined {
	const custom = draft.custom.trim();
	const labels = question.options.filter((_, index) => draft.selected.includes(index)).map(option => option.label);
	if (question.multi) {
		return draft.other && custom
			? { id: question.id, selectedOptions: labels, customInput: custom }
			: { id: question.id, selectedOptions: labels };
	}
	if (draft.other) return custom ? { id: question.id, selectedOptions: [], customInput: custom } : undefined;
	return labels.length === 1 ? { id: question.id, selectedOptions: labels } : undefined;
}
