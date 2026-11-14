/**
 * Lucide-style line icons built as SVG DOM nodes (no `innerHTML`, so the
 * webview CSP stays strict). Size them with CSS `width`/`height`.
 */

export type IconName =
	| "plus"
	| "history"
	| "settings"
	| "arrowUp"
	| "arrowRight"
	| "stop"
	| "chevronDown"
	| "chevronRight"
	| "back"
	| "copy"
	| "check"
	| "search"
	| "terminal"
	| "file"
	| "pencil"
	| "trash"
	| "globe"
	| "bot"
	| "eyeOff"
	| "wrench"
	| "brain"
	| "plan"
	| "shrink"
	| "eraser"
	| "handoff"
	| "python"
	| "close"
	| "mic"
	| "chevronUp"
	| "bash"
	| "plusGlobe"
	| "copyPlus"
	| "reply"
	| "askBubble"
	| "zap"
	| "timer"
	| "layers"
	| "info"
	| "fileDiff"
	| "listTodo"
	| "folder"
	| "mailDot"
	| "messageQuestion"
	| "bookOpen"
	| "lock"
	| "download"
	| "sparkles"
	| "litellm";

const SVG_NS = "http://www.w3.org/2000/svg";

const PATHS: Record<IconName, string> = {
	plus: "M5 12h14M12 5v14",
	history: "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5M12 7v5l4 2",
	settings:
		"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
	arrowUp: "M12 19V5M5 12l7-7 7 7",
	arrowRight: "M5 12h14M12 5l7 7-7 7",
	stop: "M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
	chevronDown: "m6 9 6 6 6-6",
	chevronUp: "m18 15-6-6-6 6",
	chevronRight: "m9 18 6-6-6-6",
	back: "M19 12H5M12 19l-7-7 7-7",
	copy: "M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",
	check: "M20 6 9 17l-5-5",
	search: "M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0zM21 21l-4.3-4.3",
	terminal: "m4 17 6-6-6-6M12 19h8",
	file: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4",
	pencil:
		"M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5zM15 5l4 4",
	trash: "M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M10 11v6M14 11v6",
	globe: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20",
	bot: "M12 8V4H8M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2zM2 14h2M20 14h2M15 13v2M9 13v2",
	eyeOff:
		"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49M14.084 14.158a3 3 0 0 1-4.242-4.242M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143M2 2l20 20",
	wrench:
		"M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z",
	brain: "M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18zM12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18zM15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4M17.599 6.5a3 3 0 0 0 .399-1.375M6.003 5.125A3 3 0 0 0 6.401 6.5M3.477 10.896a4 4 0 0 1 .585-.396M19.938 10.5a4 4 0 0 1 .585.396M6 18a4 4 0 0 1-1.967-.516M19.967 17.484A4 4 0 0 1 18 18",
	plan: "M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M12 11h4M12 16h4M8 11h.01M8 16h.01",
	shrink:
		"m15 15 6 6m-6-6v4.8m0-4.8h4.8M9 19.8V15m0 0H4.2M9 15l-6 6M15 4.2V9m0 0h4.8M15 9l6-6M9 4.2V9m0 0H4.2M9 9 3 3",
	eraser: "m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9",
	handoff: "m16 3 4 4-4 4M20 7H4M8 21l-4-4 4-4M4 17h16",
	// The Python logo's two interlocking snakes, as an outline.
	python:
		"M12 2c-3 0-4 1.3-4 3v2h4v1H5c-2 0-3 1.5-3 4s1 4 3 4h2v-2.5c0-1.9 1.6-3.5 3.5-3.5h3c1.4 0 2.5-1.1 2.5-2.5V5c0-1.7-1-3-4-3zM12 22c3 0 4-1.3 4-3v-2h-4v-1h7c2 0 3-1.5 3-4s-1-4-3-4h-2v2.5c0 1.9-1.6 3.5-3.5 3.5h-3C9.1 14 8 15.1 8 16.5V19c0 1.7 1 3 4 3zM10 4.5h.01M14 19.5h.01",
	close: "M18 6 6 18M6 6l12 12",
	mic: "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3",
	// A globe with a plus at its top-right corner: a new chat without a workspace.
	plusGlobe:
		"M18.88 12.61A8 8 0 1 1 12.39 6.12M3 14h16M11 6a12.2 12.2 0 0 1 0 16M11 6a12.2 12.2 0 0 0 0 16M19 2v6M16 5h6",
	// Two stacked squares with a plus (Lucide "copy-plus"): a new chat in another tab.
	copyPlus:
		"M15 12v6M12 15h6M10 8h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2zM4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2",
	reply: "m9 17-5-5 5-5M20 18v-2a4 4 0 0 0-4-4H4",
	// A speech bubble with a question mark (Lucide "message-circle-question"): "Ask something" about a selection.
	askBubble: "M7.9 20A9 9 0 1 0 4 16.1L2 22ZM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
	zap: "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
	// A stopwatch: the scope checkpoint (how long MarIA Code has been working).
	timer: "M10 2h4M12 14l3-3M20 14a8 8 0 1 1-16 0 8 8 0 0 1 16 0z",
	// Stacked sheets (Lucide "layers"): the background tasks a chat left running.
	layers:
		"M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83zM2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
	// A circled "i" (Lucide "info"): help about what a control can do.
	info: "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0zM12 16v-4M12 8h.01",
	// A page with plus/minus lines (Lucide "file-diff"): a tool call's changes.
	fileDiff: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7zM14 2v4a2 2 0 0 0 2 2h4M9 10h6M12 7v6M9 17h6",
	// A box and a tick beside three lines (Lucide "list-todo"): omp's task list.
	listTodo:
		"M4 5h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3 17l2 2 4-4M13 6h8M13 12h8M13 18h8",
	// A folder (Lucide "folder"): the project a chat works in.
	folder:
		"M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z",
	// An envelope with a dot in its corner (Lucide "mail" with a badge): mark a chat unread.
	mailDot:
		"M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8M22 7l-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7M22 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
	// A speech bubble with a question mark (Lucide "message-circle-question"): omp asked the user.
	messageQuestion: "M7.9 20A9 9 0 1 0 4 16.1L2 22zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
	// An open book (Lucide "book-open"): the skills a chat can use.
	bookOpen:
		"M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z",
	// A padlock (Lucide "lock"): something fixed for the rest of the session.
	lock: "M7 11V7a5 5 0 0 1 10 0v4M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z",
	// An arrow into a tray (Lucide "download"): bring something in from disk.
	download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
	// Sparkles (Lucide "sparkles"): an improvement MarIA Code proposes for a skill.
	sparkles:
		"M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0zM20 3v4M22 5h-4M4 17v2M5 18H3",
	// The LiteLLM bullet train, single-colour light variant (selfh.st icons "litellm-light.svg",
	// CC BY 4.0, github.com/selfhst/icons): a model served through a LiteLLM gateway.
	litellm:
		"m511.9 384.6-.1 30.7v12.2H28.5l42.2-42.8 3.8.1v-.1h26.7l80-.1 55.6.2h190zM1.6 316.5c5.6 29.5 29.7 51.1 60 54.4 0-42.5 0-84.9.1-127.4V230c-1.4.7-2.7 1.4-4.1 2.1-9.9 5-20.1 10.2-29.2 16.3C5 263.9-4 286.8 1.6 316.5M327 121.7h-93.4c-7.6 0-15.2 0-22.8-.1h-7.7c-2.9 2.9-5.8 5.8-8.8 8.7l-6.7 6.6c-5.6 5.6-11.2 11.1-16.8 16.7-9.6 9.5-19.2 19.3-28.6 28.7l-1.2 1.2h79.8c13.6 0 27.2 0 40.8.1h4.8c6.7 0 13.5 0 20.2.1 3.2 0 4.9-.7 7.2-3 14.1-14.2 28.5-28.5 42.4-42.3l13.6-13.4 1.6-1.6c.6-.5 1.1-1.1 1.7-1.6zm-200.3 75.2h-.1L75 223v20.5c0 42.6 0 85.2-.1 127.8h16l87.6-.1 9.6-9.7c8.9-9 17.9-18 26.8-26.9 3.7-3.8 7.5-7.5 11.3-11.2 7.1-7.1 14.5-14.4 21.7-21.7 1.4-1.4 2.8-2.5 4.3-3.4 2.6-1.4 5.4-2.1 8.7-2.1 74.7.1 150.8.1 224.3 0H512V84.6h-42.2c-67 0-136.2 0-204.3.1-7.3 0-14.8 1.7-22.4 5-10.1 4.4-18.7 11.3-26.7 18.8 5.7 0 11.5.1 17.2.1h129.6c1.9 0 4.6 0 8.1 1.8l8.2 4.2-5.1 5.1-5.2 5.1-8.3 8.3c-5.2 5.1-10.3 10.2-15.5 15.3-13.8 13.7-28.1 27.8-42 41.9l-.9.9c-.3.3-.6.5-.8.8l-.1.1c-2.4 2.1-5 3.5-7.8 4.3h-.1c-.3.1-.6.2-1 .3h-.1c-.3.1-.6.1-.9.2h-.2c-.3.1-.6.1-.9.1h-.3c-.3 0-.5.1-.8.1h-3c-39.9-.1-80.5-.1-119.7-.1h-36.2c-1.2-.1-2.6-.1-3.9-.1m385.1 112.6H387.5c-42.2 0-84.6 0-126.7-.1h-.8c-1.1.1-1.7.5-2.7 1.4-7.2 7.4-14.6 14.7-21.8 21.9l-11.2 11.2c-8.9 9-17.9 17.9-26.8 26.9l-.3.3 39.2.1h275.4z",
	// The GNU Bash logo, black-and-white icon-only variant (Wikimedia Commons
	// "Bash_Logo_black_and_white_icon_only.svg"): a hexagon with `$_` on its face.
	bash: "M73.85,18.52l-28.64-17a10.79,10.79,0,0,0-11,0l-28.64,17A11.42,11.42,0,0,0,0,28.36v34a11.42,11.42,0,0,0,5.52,9.84l28.64,17a10.79,10.79,0,0,0,11,0l28.64-17a11.42,11.42,0,0,0,5.52-9.84v-34A11.42,11.42,0,0,0,73.85,18.52ZM51.67,71.61l0,2.44a0.9,0.9,0,0,1-.42.75l-1.45.83c-0.23.12-.42,0-0.42-0.32l0-2.4a4.71,4.71,0,0,1-3.3.32,0.44,0.44,0,0,1-.16-0.54l0.52-2.21A0.92,0.92,0,0,1,46.73,70a0.58,0.58,0,0,1,.14-0.1,0.29,0.29,0,0,1,.23,0,4,4,0,0,0,3-.38,4,4,0,0,0,2.24-3.43c0-1.24-.68-1.76-2.32-1.77-2.08,0-4-.4-4.05-3.47a8.89,8.89,0,0,1,3.36-6.8l0-2.47a0.89,0.89,0,0,1,.42-0.76l1.4-.89c0.23-.12.42,0,0.42,0.33l0,2.47a4.56,4.56,0,0,1,2.74-.33,0.44,0.44,0,0,1,.18.57L54,55.16a0.94,0.94,0,0,1-.25.44,0.58,0.58,0,0,1-.14.11,0.33,0.33,0,0,1-.21,0,3.63,3.63,0,0,0-2.64.43,3.32,3.32,0,0,0-2,2.94c0,1.12.59,1.46,2.57,1.5,2.65,0,3.79,1.2,3.82,3.86A9.48,9.48,0,0,1,51.67,71.61Zm15-4.11a0.57,0.57,0,0,1-.22.55l-7.24,4.4a0.21,0.21,0,0,1-.34-0.21V70.37a0.52,0.52,0,0,1,.33-0.46l7.13-4.27a0.21,0.21,0,0,1,.34.21V67.5Zm5-41.81L44.57,42.43c-3.38,2-5.87,4.19-5.87,8.26V84.07c0,2.44,1,4,2.5,4.48a8.77,8.77,0,0,1-1.5.15,8.87,8.87,0,0,1-4.52-1.25l-28.64-17A9.42,9.42,0,0,1,2,62.36v-34a9.42,9.42,0,0,1,4.54-8.1l28.64-17a8.83,8.83,0,0,1,9,0l28.64,17a9.36,9.36,0,0,1,4.4,6.55C76.29,24.79,74.15,24.23,71.66,25.69Z",
};

/** Icons drawn as filled shapes instead of strokes. */
const FILLED: Partial<Record<IconName, true>> = { stop: true, bash: true, litellm: true };
/** Icons drawn on their own canvas instead of Lucide's 24×24 grid. */
const VIEW_BOXES: Partial<Record<IconName, string>> = { bash: "0 0 79.37 90.71", litellm: "0 0 512 512" };

export function icon(name: IconName): SVGSVGElement {
	const svg = document.createElementNS(SVG_NS, "svg");
	const filled = FILLED[name] === true;
	const attrs: Record<string, string> = {
		class: `icon icon-${name}`,
		width: "16",
		height: "16",
		viewBox: VIEW_BOXES[name] ?? "0 0 24 24",
		fill: filled ? "currentColor" : "none",
		stroke: filled ? "none" : "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
		"aria-hidden": "true",
	};
	for (const [key, value] of Object.entries(attrs)) svg.setAttribute(key, value);
	const path = document.createElementNS(SVG_NS, "path");
	path.setAttribute("d", PATHS[name]);
	svg.append(path);
	return svg;
}
