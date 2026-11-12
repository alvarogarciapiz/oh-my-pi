import { describe, expect, test } from "bun:test";
import { type DraftMention, expandDraftMentions, updateDraftMentions } from "../webview/chat/draft-mentions";

describe("compact draft mentions", () => {
	const first: DraftMention = {
		start: 5,
		end: 15,
		label: "@README.md",
		mention: "@docs/skills/README.md",
		path: "/workspace/docs/skills/README.md",
	};
	const second: DraftMention = {
		start: 20,
		end: 30,
		label: "@README.md",
		mention: "@examples/README.md",
		path: "/workspace/examples/README.md",
	};

	test("expands same-named selections to their respective paths", () => {
		expect(expandDraftMentions("Read @README.md and @README.md", [first, second])).toBe(
			"Read @docs/skills/README.md and @examples/README.md",
		);
	});

	test("moves mentions when typing before them and drops a mention edited inside", () => {
		const original = "Read @README.md and @README.md";
		const next = `Please ${original}`;
		const moved = updateDraftMentions(original, next, [first, second]);
		expect(expandDraftMentions(next, moved)).toBe("Please Read @docs/skills/README.md and @examples/README.md");
		const edited = next.replace("@README.md", "@README.txt");
		const remaining = updateDraftMentions(next, edited, moved);
		expect(expandDraftMentions(edited, remaining)).toBe("Please Read @README.txt and @examples/README.md");
	});
});
