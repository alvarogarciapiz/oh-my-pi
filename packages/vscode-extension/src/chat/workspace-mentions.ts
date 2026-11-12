/**
 * Workspace `@` mentions without VS Code APIs: the folders never searched, the
 * `@path` form omp's mention parser resolves, and how search results rank.
 */
import type { WorkspaceMention } from "../protocol";

/** Folders never searched for or offered as mentions. */
export const EXCLUDED_DIRS = ["node_modules", ".git", ".venv", "venv", "dist", "build", "out", "target"] as const;
/** `findFiles` exclude glob for {@link EXCLUDED_DIRS}. */
export const SEARCH_EXCLUDE = `**/{${EXCLUDED_DIRS.join(",")}}/**`;
/** Results the composer's `@` popup lists. */
const MAX_MENTION_RESULTS = 50;

const EXCLUDED = new Set<string>(EXCLUDED_DIRS);

/** Whether any folder of `relative` (either slash) is one of {@link EXCLUDED_DIRS}. */
export function isExcludedPath(relative: string): boolean {
	return relative.split(/[\\/]/).some(segment => EXCLUDED.has(segment));
}

/**
 * `relative` as an `@path` omp's parser (`extractFileMentions`) resolves exactly:
 * quoted when it holds whitespace, `@` or quotes, or starts or ends with the
 * punctuation the parser strips. Undefined for a path holding both quote kinds,
 * which no mention form can carry.
 */
export function formatWorkspaceMention(relative: string): string | undefined {
	const hasDouble = relative.includes('"');
	if (hasDouble && relative.includes("'")) return undefined;
	const quote = hasDouble ? "'" : '"';
	return /[\s@'"]/.test(relative) || /^[`"'([{<]/.test(relative) || /[)\]}>.,;:!?"'`]$/.test(relative)
		? `@${quote}${relative}${quote}`
		: `@${relative}`;
}

/** Entries whose shown path contains `query`, names starting with it first; same-named files in different folders all stay. */
export function rankWorkspaceMentions(entries: readonly WorkspaceMention[], query: string): WorkspaceMention[] {
	const needle = query.toLowerCase();
	const unique = new Map(entries.map(entry => [entry.mention, entry]));
	const matches = [...unique.values()].filter(entry => entry.path.toLowerCase().includes(needle));
	matches.sort((a, b) => {
		const prefix = Number(b.name.toLowerCase().startsWith(needle)) - Number(a.name.toLowerCase().startsWith(needle));
		return prefix || a.path.localeCompare(b.path);
	});
	return matches.slice(0, MAX_MENTION_RESULTS);
}
