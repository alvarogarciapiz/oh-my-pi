import { describe, expect, test } from "bun:test";
import { formatWorkspaceMention, rankWorkspaceMentions } from "../src/chat/workspace-mentions";
import type { WorkspaceMention } from "../src/protocol";
import { replaceMention } from "../webview/chat/mention-token";

function entry(name: string, shown: string, mention: string): WorkspaceMention {
	return { name, path: shown, kind: "file", mention, openPath: mention.slice(1) };
}

describe("workspace mentions", () => {
	test("inserts project-relative paths without unnecessary quotes", () => {
		expect(formatWorkspaceMention("crates/pi-builtins/README.md")).toBe("@crates/pi-builtins/README.md");
	});

	// omp's `extractFileMentions` reads `@"…"`/`@'…'` verbatim and strips leading/trailing
	// punctuation from bare mentions, so those paths must be quoted to survive.
	test("quotes paths omp's parser would split or trim", () => {
		expect(formatWorkspaceMention("project folder/example file.txt")).toBe('@"project folder/example file.txt"');
		expect(formatWorkspaceMention("docs/notes.")).toBe('@"docs/notes."');
		expect(formatWorkspaceMention("(draft)/plan.md")).toBe('@"(draft)/plan.md"');
		expect(formatWorkspaceMention("/project/it's a file.ts")).toBe(`@"/project/it's a file.ts"`);
		expect(formatWorkspaceMention('/project/a "quoted" file.ts')).toBe(`@'/project/a "quoted" file.ts'`);
	});

	test("refuses a path holding both quote kinds, which no mention form carries", () => {
		expect(formatWorkspaceMention(`it's "both".ts`)).toBeUndefined();
	});

	test("preserves surrounding draft and replaces the whole token at a mid-token caret", () => {
		expect(replaceMention("Review @src/old.ts\nthen explain", 11, '@"/my project/new.ts"')).toEqual({
			value: 'Review @"/my project/new.ts"\nthen explain',
			cursor: 28,
		});
	});

	test("ranks name prefixes and keeps same-named files in different roots", () => {
		const entries = [
			entry("other.ts", "first/src/component-other.ts", "@/one/other.ts"),
			entry("Component.ts", "second/src/Component.ts", "@/two/Component.ts"),
			entry("Component.ts", "first/src/Component.ts", "@/one/Component.ts"),
		];
		expect(rankWorkspaceMentions(entries, "comp").map(item => item.path)).toEqual([
			"first/src/Component.ts",
			"second/src/Component.ts",
			"first/src/component-other.ts",
		]);
	});
});
