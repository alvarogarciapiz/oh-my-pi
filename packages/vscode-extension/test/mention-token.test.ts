import { describe, expect, test } from "bun:test";
import { mentionToken, splitMentions } from "../webview/chat/mention-token";

describe("workspace mention detection", () => {
	test("finds a mention at the caret inside a longer draft", () => {
		expect(mentionToken("Please check @src/fo and explain", 20)).toEqual({ start: 13, query: "src/fo" });
	});

	test("does not treat an email address as a mention", () => {
		expect(mentionToken("mail user@example.com", 21)).toBeUndefined();
	});
});

describe("splitMentions", () => {
	test("links path-like mentions, leaves trailing punctuation and plain @words as text", () => {
		expect(splitMentions("Mira @src/a.ts, y @equipo")).toEqual([
			"Mira ",
			{ path: "src/a.ts", label: "@a.ts" },
			", y @equipo",
		]);
	});

	test("reads quoted paths with spaces and skips an @ inside a word", () => {
		expect(splitMentions('Open @"my dir/file name.md" not user@host.com')).toEqual([
			"Open ",
			{ path: "my dir/file name.md", label: "@file name.md" },
			" not user@host.com",
		]);
	});
});
