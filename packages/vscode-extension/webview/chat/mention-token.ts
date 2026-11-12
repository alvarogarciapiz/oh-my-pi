/** `@` mentions in composer and prompt text, matched the way omp's `extractFileMentions` reads them. */

/** A character after which an `@` starts a mention (omp's `MENTION_BOUNDARY_REGEX`). */
const BOUNDARY = /[\s([{<"'`]/;
/** Punctuation omp strips from the end of an unquoted mention. */
const TRAILING_PUNCTUATION = /[)\]}>.,;:!?"'`]+$/;

/** The `@token` ending at `cursor`: where its `@` is and what follows it. */
export function mentionToken(value: string, cursor: number): { start: number; query: string } | undefined {
	const match = /(^|[\s([{<"'`])@([^\s@]*)$/.exec(value.slice(0, cursor));
	if (!match) return undefined;
	return { start: match.index + match[1]!.length, query: match[2]! };
}

/** Replace the whole `@token` around `cursor` with `mention` (and a space unless one follows), keeping the text around it. */
export function replaceMention(
	value: string,
	cursor: number,
	mention: string,
): { value: string; cursor: number } | undefined {
	const token = mentionToken(value, cursor);
	if (!token) return undefined;
	const end = cursor + (/^[^\s@]*/.exec(value.slice(cursor))?.[0].length ?? 0);
	const suffix = value.slice(end);
	const inserted = mention + (!suffix || !/^\s/.test(suffix) ? " " : "");
	return {
		value: value.slice(0, token.start) + inserted + suffix,
		cursor: token.start + inserted.length,
	};
}

/**
 * `text` cut into plain text and file mentions, each mention with its path and
 * a short `@name` label. Only tokens that look like paths (holding a `/` or
 * ending in an extension) count, so `@team` in prose stays text.
 */
export function splitMentions(text: string): Array<string | { path: string; label: string }> {
	const parts: Array<string | { path: string; label: string }> = [];
	let offset = 0;
	for (const match of text.matchAll(/@(?:"([^"]+)"|'([^']+)'|([^\s@]+))/g)) {
		const start = match.index;
		if (start > 0 && !BOUNDARY.test(text[start - 1]!)) continue;
		let path = match[1] ?? match[2] ?? match[3]!;
		let end = start + match[0].length;
		if (match[3] !== undefined) {
			const trailing = TRAILING_PUNCTUATION.exec(path)?.[0].length ?? 0;
			path = path.slice(0, path.length - trailing);
			end -= trailing;
		}
		if (!path.includes("/") && !/\.[\w-]+$/.test(path)) continue;
		if (start > offset) parts.push(text.slice(offset, start));
		parts.push({ path, label: `@${path.split(/[\\/]/).filter(Boolean).pop() ?? path}` });
		offset = end;
	}
	if (offset < text.length) parts.push(text.slice(offset));
	return parts;
}
