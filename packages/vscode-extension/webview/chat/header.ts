/**
 * Top bar: π mark, session title (renamable in place), a "No workspace" badge
 * on chats without a workspace, and New chat / New chat without workspace /
 * New chat in another tab (a menu choosing the project or no workspace) /
 * History / Settings icon buttons. History carries a blinking green badge
 * counting the sessions that finished unseen. Skill self-improvement (review
 * in progress, proposals) lives on the composer's skills button.
 */
import type { ChatRequest, SessionActivity, SessionState, SessionStats } from "../../src/protocol";
import { h, iconButton } from "../dom";
import { icon } from "../icons";
import { setTooltip } from "../tooltip";

type Post = (request: ChatRequest) => void;

export class Header {
	readonly element: HTMLElement;
	/** The MarIA Code mark at the start of the bar, where the empty chat's logo lands on the first prompt. */
	readonly brand = h("span", { className: "brand", ariaHidden: "true" });
	#title = h("div", { className: "session-title" }, "New chat");
	#rename: HTMLButtonElement;
	#input = h("input", { type: "text", className: "title-input", ariaLabel: "Session name", hidden: true });
	#sessionTitle = "New chat";
	#history: HTMLButtonElement;
	#historyBadge = h("span", { className: "history-badge", hidden: true, ariaHidden: "true" });
	#back: HTMLButtonElement;
	#historyOpen = false;
	/** A session is open (omp answered `get_state`), so it can be renamed. */
	#hasSession = false;
	#noWorkspace = h(
		"span",
		{
			className: "no-workspace-badge",
			hidden: true,
			dataset: { tooltip: "A chat without a workspace: MarIA Code runs in its own folder, not in this project" },
		},
		icon("globe"),
		"No workspace",
	);
	#newTabButton: HTMLButtonElement;
	#newTabItems: HTMLButtonElement[];
	#newTabMenu: HTMLElement;
	#newTabAnchor: HTMLElement;

	constructor(
		private readonly post: Post,
		onHistory: () => void,
	) {
		this.#history = iconButton("history", "History", onHistory);
		this.#history.append(this.#historyBadge);
		this.#back = iconButton("back", "Back to chat", onHistory);
		this.#back.hidden = true;
		this.#rename = iconButton("pencil", "Rename chat", () => this.#startRename());
		this.#rename.classList.add("title-rename");
		this.#title.addEventListener("dblclick", () => this.#startRename());
		this.#newTabButton = iconButton("copyPlus", "New chat in another tab", () => {
			if (this.#newTabMenu.hidden) this.#openNewTabMenu();
			else this.#closeNewTabMenu();
		});
		this.#newTabButton.ariaHasPopup = "menu";
		this.#newTabButton.ariaExpanded = "false";
		this.#newTabItems = [
			this.#newTabItem("folder", "Nuevo chat en el proyecto", false),
			this.#newTabItem("globe", "Nuevo chat sin workspace", true),
		];
		this.#newTabMenu = h(
			"div",
			{ className: "new-tab-menu", role: "menu", ariaLabel: "New chat in another tab", hidden: true },
			...this.#newTabItems,
		);
		this.#newTabMenu.addEventListener("keydown", event => {
			if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
			event.preventDefault();
			const current = this.#newTabItems.indexOf(document.activeElement as HTMLButtonElement);
			const step = event.key === "ArrowDown" ? 1 : -1;
			const next = (current + step + this.#newTabItems.length) % this.#newTabItems.length;
			this.#newTabItems[next]?.focus();
		});
		this.#newTabAnchor = h("div", { className: "new-tab-anchor" }, this.#newTabButton, this.#newTabMenu);
		document.addEventListener("keydown", event => {
			if (event.key !== "Escape" || this.#newTabMenu.hidden) return;
			this.#closeNewTabMenu();
			this.#newTabButton.focus();
		});
		document.addEventListener("mousedown", event => {
			const target = event.target as Node | null;
			if (target && !this.#newTabMenu.hidden && !this.#newTabAnchor.contains(target)) this.#closeNewTabMenu();
		});
		this.#input.addEventListener("keydown", event => {
			if (event.isComposing) return;
			if (event.key === "Enter") {
				event.preventDefault();
				this.#finishRename(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				this.#finishRename(false);
			}
		});
		this.#input.addEventListener("blur", () => this.#finishRename(true));
		this.element = h(
			"header",
			{ className: "header" },
			this.brand,
			this.#title,
			this.#input,
			this.#rename,
			this.#noWorkspace,
			h(
				"div",
				{ className: "header-actions" },
				iconButton("plus", "New chat", () => post({ type: "newSession" })),
				iconButton("plusGlobe", "New chat without workspace (general tasks, not this project)", () =>
					post({ type: "newSession", noWorkspace: true }),
				),
				this.#newTabAnchor,
				this.#history,
				this.#back,
				iconButton("settings", "Settings", () => post({ type: "openSettings" })),
			),
		);
		this.#render();
	}

	setState(
		state: SessionState,
		_stats: SessionStats | undefined,
		title: string | undefined,
		noWorkspace: boolean,
	): void {
		this.#hasSession = true;
		this.#sessionTitle = title || state.sessionName || "New chat";
		this.#noWorkspace.dataset.on = String(noWorkspace);
		this.#render();
	}

	#newTabItem(iconName: "folder" | "globe", label: string, noWorkspace: boolean): HTMLButtonElement {
		const item = h("button", { type: "button", className: "new-tab-item", role: "menuitem" }, icon(iconName), label);
		item.addEventListener("click", () => {
			this.#closeNewTabMenu();
			this.post({ type: "newSessionInTab", noWorkspace });
		});
		return item;
	}

	#openNewTabMenu(): void {
		this.#newTabMenu.hidden = false;
		this.#newTabButton.ariaExpanded = "true";
		this.#newTabItems[0]?.focus();
	}

	#closeNewTabMenu(): void {
		this.#newTabMenu.hidden = true;
		this.#newTabButton.ariaExpanded = "false";
	}

	/** While the history panel is open the bar reads "History" and offers Back instead of History. */
	setHistoryMode(open: boolean): void {
		this.#historyOpen = open;
		this.#history.hidden = open;
		this.#back.hidden = !open;
		if (open) this.#finishRename(false);
		this.#render();
	}

	/** Sessions finished while unseen are counted on a blinking badge on History (host `sessionActivity` update). */
	setActivity(activity: Record<string, SessionActivity>): void {
		const finished = Object.values(activity).filter(state => state === "done").length;
		this.#historyBadge.hidden = finished === 0;
		this.#historyBadge.textContent = finished > 9 ? "9+" : String(finished);
		const label =
			finished === 0
				? "History"
				: `History — ${finished} chat${finished === 1 ? "" : "s"} finished while you were away`;
		this.#history.ariaLabel = label;
		setTooltip(this.#history, label);
	}

	#canRename(): boolean {
		return this.#hasSession && !this.#historyOpen;
	}

	#startRename(): void {
		if (!this.#canRename() || !this.#input.hidden) return;
		this.#input.value = this.#sessionTitle === "New chat" ? "" : this.#sessionTitle;
		this.#input.placeholder = "Name this chat";
		this.#input.hidden = false;
		this.#title.hidden = true;
		this.#rename.hidden = true;
		this.#input.focus();
		this.#input.select();
	}

	/** Enter or leaving the field renames (an empty or unchanged name does nothing); Escape cancels. */
	#finishRename(save: boolean): void {
		if (this.#input.hidden) return;
		this.#input.hidden = true;
		const name = this.#input.value.trim();
		if (save && name && name !== this.#sessionTitle) {
			// Shown at once; omp's refreshed state follows.
			this.#sessionTitle = name;
			this.post({ type: "renameSession", name });
		}
		this.#render();
	}

	#render(): void {
		const text = this.#historyOpen ? "History" : this.#sessionTitle;
		this.#title.textContent = text;
		this.#title.hidden = !this.#input.hidden;
		this.#rename.hidden = !this.#canRename() || !this.#input.hidden;
		this.#noWorkspace.hidden = this.#noWorkspace.dataset.on !== "true" || this.#historyOpen || !this.#input.hidden;
		setTooltip(this.#title, this.#canRename() ? `${text}\nDouble-click to rename` : text);
	}
}
