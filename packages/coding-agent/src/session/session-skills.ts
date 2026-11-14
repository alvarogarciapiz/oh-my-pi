import type { SessionEntry } from "./session-entries";

/** Custom entry recording the skills a session switched off for itself before its first prompt. */
export const SESSION_DISABLED_SKILLS_ENTRY_TYPE = "session_disabled_skills";

export interface SessionDisabledSkillsEntry {
	version: 1;
	names: string[];
}

function isSessionDisabledSkillsData(data: unknown): data is SessionDisabledSkillsEntry {
	if (data === null || typeof data !== "object") return false;
	const candidate = data as Record<string, unknown>;
	return (
		candidate.version === 1 &&
		Array.isArray(candidate.names) &&
		candidate.names.every(name => typeof name === "string")
	);
}

/**
 * Names of the skills the session on `entries` (its active branch) switched off:
 * the latest valid record wins; none recorded means every skill stays on.
 */
export function getSessionDisabledSkills(entries: readonly SessionEntry[]): string[] {
	for (let index = entries.length - 1; index >= 0; index--) {
		const entry = entries[index];
		if (entry.type !== "custom" || entry.customType !== SESSION_DISABLED_SKILLS_ENTRY_TYPE) continue;
		if (isSessionDisabledSkillsData(entry.data)) return entry.data.names;
	}
	return [];
}
