/** Chat content helpers: image data URLs and clickable file references. */
import type { ChatRequest } from "../../src/protocol";
import { h } from "../dom";

/** `data:` URL for a base64 image block. */
export function imageSrc(image: { data: string; mimeType: string }): string {
	return `data:${image.mimeType};base64,${image.data}`;
}

/** A file reference parsed from `path`, `path:12`, `path:12-30`, or `path#L12`. */
export interface FileRef {
	path: string;
	line?: number;
}

export function parseFileRef(raw: string): FileRef {
	let text = raw.trim();
	if (text.startsWith("file://")) text = decodeURIComponent(text.slice("file://".length));
	const hash = /#L(\d+)(?:-L?\d+)?$/.exec(text);
	if (hash) return { path: text.slice(0, hash.index), line: Number(hash[1]) };
	const colon = /:(\d+)(?:[-:]\d+)?$/.exec(text);
	if (colon) return { path: text.slice(0, colon.index), line: Number(colon[1]) };
	return { path: text };
}

/** Clickable path; the transcript's delegated click handler turns `data-file` into `openFile`. */
export function fileLink(path: string, label = path): HTMLAnchorElement {
	return h("a", { className: "file-link", dataset: { file: path, tooltip: `Open ${path}` }, tabIndex: 0 }, label);
}

/** Image thumbnail in the transcript; the transcript's delegated click handler opens it in the lightbox. */
export function thumbnail(image: { data: string; mimeType: string }): HTMLImageElement {
	return h("img", {
		className: "thumb",
		src: imageSrc(image),
		alt: "Image",
		tabIndex: 0,
		dataset: { tooltip: "Preview image" },
	});
}

/**
 * A click in rendered markdown: a code block's copy button copies its code, file
 * references open in the editor, web links in the browser. False when the click
 * hit none of them.
 */
export function handleMarkdownClick(event: MouseEvent, target: Element, post: (request: ChatRequest) => void): boolean {
	const copy = target.closest<HTMLButtonElement>(".copy-btn");
	if (copy) {
		const code = copy.closest(".code-block")?.querySelector("code")?.textContent ?? "";
		void navigator.clipboard.writeText(code).then(() => {
			copy.classList.add("copied");
			setTimeout(() => copy.classList.remove("copied"), 1200);
		});
		return true;
	}
	const file = target.closest<HTMLElement>("[data-file]");
	if (file) {
		event.preventDefault();
		post({ type: "openFile", ...parseFileRef(file.dataset.file!) });
		return true;
	}
	const link = target.closest<HTMLElement>("[data-href]");
	if (!link) return false;
	event.preventDefault();
	const href = link.dataset.href!;
	if (/^https?:\/\//i.test(href)) post({ type: "openExternal", url: href });
	else if (!/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("file:") || href.startsWith("local://")) {
		if (!href.startsWith("#")) post({ type: "openFile", ...parseFileRef(href) });
	}
	return true;
}
