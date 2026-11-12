/** A compact mention in the draft (`@name`) and the full mention it sends. */
export interface DraftMention {
	start: number;
	end: number;
	/** The text shown in the draft, `@name`. */
	label: string;
	/** The `@path` sent in its place. */
	mention: string;
	/** Absolute path opened when the label is clicked. */
	path: string;
}

/** Mentions after an edit from `previous` to `next`: those before it stay, those after it move, those it touched are dropped. */
export function updateDraftMentions(previous: string, next: string, mentions: readonly DraftMention[]): DraftMention[] {
	let start = 0;
	while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
	let oldEnd = previous.length;
	let newEnd = next.length;
	while (oldEnd > start && newEnd > start && previous[oldEnd - 1] === next[newEnd - 1]) {
		oldEnd--;
		newEnd--;
	}
	const delta = newEnd - oldEnd;
	return mentions.flatMap(mention => {
		if (mention.end <= start) return [mention];
		if (mention.start >= oldEnd) return [{ ...mention, start: mention.start + delta, end: mention.end + delta }];
		return [];
	});
}

/** `draft` with every intact compact mention replaced by its full mention; text typed by hand is left as is. */
export function expandDraftMentions(draft: string, mentions: readonly DraftMention[]): string {
	let result = draft;
	for (const entry of [...mentions].sort((a, b) => b.start - a.start)) {
		if (draft.slice(entry.start, entry.end) === entry.label) {
			result = result.slice(0, entry.start) + entry.mention + result.slice(entry.end);
		}
	}
	return result;
}
