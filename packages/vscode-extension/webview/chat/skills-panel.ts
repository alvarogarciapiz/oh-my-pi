/**
 * Skills button in the composer, right of the context ring. The popup lists the
 * skills MarIA Code has in the shown session, grouped by where they come from
 * (project, user, others), each with its description, a button that puts its
 * `/skill:` token in the draft, and a link to its `SKILL.md`. Until the first
 * prompt each skill has a switch to leave it out of this session only, and new
 * skills can be imported from disk; after that the list is read-only. The host
 * re-sends the list (`skills`) whenever it changes.
 *
 * Skill self-improvement lives here too: while omp reviews the skills a task
 * relied on, the button shows a spinning ring; the changes it proposes are
 * counted on the button's badge and listed at the top of the popup, each with
 * omp's reason, its diff, and Approve / Reject (Discard once outdated).
 */
import type { ChatRequest, SessionSkill, SkillProposalSummary } from "../../src/protocol";
import { button, h } from "../dom";
import { icon } from "../icons";
import { setTooltip } from "../tooltip";
import { diffLineClass, truncatedPre } from "./tools";

type Post = (request: ChatRequest) => void;

/** Toggles within this pause go to the host as one change. */
const SAVE_DELAY_MS = 300;
/** From this many skills on, the popup offers a filter box. */
const FILTER_MIN_SKILLS = 6;
/** Characters past which a description no longer fits its two lines. */
const DESCRIPTION_CLAMP_CHARS = 110;

const SLASH_HELP =
	"Para usar una skill en tu mensaje, escribe / sin pegarlo a ningún carácter (al principio o después de un espacio) y elige la skill de la lista. Listo.";

/** Display names of the places omp discovers skills in (`source` is `<provider>:<level>`). */
const PROVIDER_LABELS: Record<string, string> = {
	native: "MarIA Code",
	custom: "Carpeta propia",
	claude: "Claude",
	"claude-plugins": "Plugin",
	"omp-plugins": "Plugin",
	agents: "Agents",
	codex: "Codex",
	github: "GitHub",
	opencode: "OpenCode",
	skillshare: "Registro",
};

type Group = "project" | "user" | "other" | "off";

const GROUP_TITLES: Record<Group, string> = {
	project: "Proyecto",
	user: "Usuario",
	other: "Otras fuentes",
	off: "Desactivadas en esta sesión",
};

const GROUP_ORDER: Group[] = ["project", "user", "other", "off"];

export class SkillsPanel {
	readonly element: HTMLElement;
	#trigger: HTMLButtonElement;
	#badge = h("span", { className: "skills-badge", hidden: true });
	#curationStatus = h(
		"div",
		{ className: "skills-curating", role: "status", hidden: true },
		h("span", { className: "skills-curating-spinner" }),
		h("span", null, "MarIA Code está revisando las skills que usó esta tarea para proponer mejoras…"),
	);
	#proposalsSection = h("section", { className: "skills-proposals", ariaLabel: "Mejoras propuestas", hidden: true });
	#popover = h("div", { className: "skills-popover", role: "dialog", ariaLabel: "Skills de la sesión", hidden: true });
	#summary = h("span", { className: "skills-summary" });
	#help = h("p", { className: "skills-help", hidden: true }, SLASH_HELP);
	#infoButton: HTMLButtonElement;
	#status = h("div", { className: "skills-status" });
	#filter = h("input", {
		className: "skills-filter",
		type: "search",
		placeholder: "Buscar skills…",
		ariaLabel: "Buscar skills",
		spellcheck: false,
	});
	#bulk = h("div", { className: "skills-bulk" });
	#toolbar = h("div", { className: "skills-toolbar" }, this.#filter, this.#bulk);
	#list = h("div", { className: "skills-list" });
	#footer = h("div", { className: "skills-footer" });
	#skills: SessionSkill[] = [];
	/** Names switched off, as last sent to (or reported by) the host. */
	#disabled = new Set<string>();
	#editable = false;
	#loaded = false;
	/** A switch change waits to be sent; host updates meanwhile keep the local switches. */
	#saveTimer: number | undefined;
	/** Changes omp proposes to skills after the shown session's tasks, awaiting a decision. */
	#proposals: SkillProposalSummary[] = [];
	/** omp is reviewing the skills the last task relied on. */
	#curating = false;
	/** Proposals whose diff is unfolded. */
	readonly #expanded = new Set<string>();
	/** Proposals with an approve/reject on its way, and which; the host re-sends the proposals once it is decided, failed or cancelled. */
	readonly #deciding = new Map<string, ChatRequest["type"]>();

	constructor(
		private readonly post: Post,
		/** Puts `text` at the composer's cursor. */
		private readonly insert: (text: string) => void,
	) {
		this.#trigger = h(
			"button",
			{ type: "button", className: "icon-button skills-toggle", ariaHasPopup: "dialog" },
			icon("bookOpen"),
			this.#badge,
		);
		this.#trigger.hidden = true;
		this.#trigger.addEventListener("click", () => (this.#popover.hidden ? this.#open() : this.#close()));

		this.#infoButton = h(
			"button",
			{ type: "button", className: "skills-info", ariaLabel: "Cómo usar una skill", ariaExpanded: "false" },
			icon("info"),
		);
		setTooltip(this.#infoButton, SLASH_HELP);
		this.#infoButton.addEventListener("click", () => {
			this.#help.hidden = !this.#help.hidden;
			this.#infoButton.ariaExpanded = String(!this.#help.hidden);
		});
		const close = button("×", "notice-close", () => this.#close());
		setTooltip(close, "Cerrar");
		this.#filter.addEventListener("input", () => this.#renderList());

		this.#popover.append(
			h(
				"div",
				{ className: "skills-header" },
				h("span", { className: "skills-mark" }, icon("bookOpen")),
				h(
					"div",
					{ className: "skills-heading" },
					h("span", { className: "skills-title" }, "Skills"),
					this.#summary,
				),
				this.#infoButton,
				close,
			),
			this.#help,
			this.#curationStatus,
			this.#proposalsSection,
			this.#status,
			this.#toolbar,
			this.#list,
			this.#footer,
		);
		this.element = h("div", { className: "skills" }, this.#trigger, this.#popover);
		this.element.addEventListener("keydown", event => {
			if (event.key === "Escape" && !this.#popover.hidden) {
				event.preventDefault();
				event.stopPropagation();
				this.#close();
				this.#trigger.focus();
			}
		});
		document.addEventListener("mousedown", event => {
			if (!this.#popover.hidden && !this.element.contains(event.target as Node)) this.#close();
		});
	}

	/** The host's `skills`: the button shows once omp reported them; an open popup re-renders. */
	setSkills(skills: SessionSkill[], editable: boolean): void {
		this.#skills = skills;
		this.#editable = editable;
		this.#loaded = true;
		if (!editable) this.#flush();
		// A change still waiting to be sent wins over the host's older view of the switches.
		if (this.#saveTimer === undefined) {
			this.#disabled = new Set(skills.filter(skill => !skill.enabled).map(skill => skill.name));
		}
		this.#update();
	}

	/** Whether omp is reviewing the shown session's skills (host `skillCuration`). */
	setCuration(status: "idle" | "running"): void {
		this.#curating = status === "running";
		this.#update();
	}

	/** The skill changes the shown session's tasks produced, awaiting a decision (host `skillProposals`). */
	setProposals(proposals: SkillProposalSummary[]): void {
		const arrived = proposals.some(proposal => !this.#proposals.some(known => known.id === proposal.id));
		this.#proposals = proposals;
		for (const id of this.#expanded) if (!proposals.some(proposal => proposal.id === id)) this.#expanded.delete(id);
		this.#deciding.clear();
		if (arrived) {
			// Restart the badge's arrival pulse so a new proposal catches the eye.
			this.#badge.classList.remove("arrived");
			void this.#badge.offsetWidth;
			this.#badge.classList.add("arrived");
		}
		this.#update();
	}

	#update(): void {
		const total = this.#skills.length;
		const off = this.#skills.filter(skill => this.#disabled.has(skill.name)).length;
		const pending = this.#proposals.length;
		this.#trigger.hidden = !this.#loaded && pending === 0 && !this.#curating;
		this.#trigger.classList.toggle("curating", this.#curating);
		this.#trigger.classList.toggle("has-proposals", pending > 0);
		// Proposals wait for the user; switched-off skills are only information.
		this.#badge.classList.toggle("proposals", pending > 0);
		this.#badge.hidden = pending === 0 && off === 0;
		this.#badge.textContent = String(pending > 0 ? pending : off);
		const counts =
			total === 0
				? "ninguna disponible"
				: off === 0
					? `${total} ${total === 1 ? "activa" : "activas"}`
					: `${total - off} de ${total} activas · ${off} ${off === 1 ? "desactivada" : "desactivadas"}`;
		const lines = [`Skills de esta sesión: ${counts}`];
		if (this.#curating) lines.push("Revisando las skills que usó la tarea…");
		if (pending > 0) {
			lines.push(
				`${pending} ${pending === 1 ? "mejora propuesta" : "mejoras propuestas"} para tus skills: pulsa para revisarlas`,
			);
		}
		setTooltip(this.#trigger, lines.join("\n"));
		this.#trigger.ariaLabel = lines.join(". ");
		if (!this.#popover.hidden) this.#render();
	}

	#open(): void {
		this.#popover.hidden = false;
		this.#trigger.ariaExpanded = "true";
		// A single proposal opens with its diff showing: it is what the user came for.
		if (this.#proposals.length === 1) this.#expanded.add(this.#proposals[0]!.id);
		this.#render();
		this.post({ type: "getSkills" });
	}

	#close(): void {
		this.#popover.hidden = true;
		this.#trigger.ariaExpanded = "false";
		this.#flush();
	}

	#render(): void {
		const total = this.#skills.length;
		const active = total - this.#skills.filter(skill => this.#disabled.has(skill.name)).length;
		this.#summary.textContent =
			total === 0 ? "Ninguna disponible" : `${active} de ${total} ${total === 1 ? "activa" : "activas"}`;
		this.#popover.classList.toggle("locked", !this.#editable);
		this.#curationStatus.hidden = !this.#curating;
		this.#renderProposals();
		// Pending proposals need the room more than the reminder that the session's skills are fixed.
		this.#status.hidden = !this.#editable && this.#proposals.length > 0;
		this.#status.replaceChildren(
			this.#editable
				? h(
						"div",
						{ className: "skills-banner editable" },
						h(
							"span",
							null,
							"Antes de tu primer mensaje puedes desmarcar las skills que no quieras en ",
							h("strong", null, "esta sesión"),
							". Las demás sesiones no cambian.",
						),
					)
				: h(
						"div",
						{ className: "skills-banner locked" },
						icon("lock"),
						h(
							"span",
							null,
							"La sesión ya ha empezado: sus skills quedan fijadas. Puedes consultarlas, pero ya no activarlas ni desactivarlas.",
						),
					),
		);

		this.#filter.hidden = total < FILTER_MIN_SKILLS;
		this.#bulk.replaceChildren();
		if (this.#editable && total > 1) {
			const enableAll = button("Activar todas", "skills-bulk-button", () => this.#setDisabled(new Set()));
			enableAll.disabled = this.#disabled.size === 0;
			const disableAll = button("Desactivar todas", "skills-bulk-button", () =>
				this.#setDisabled(new Set(this.#skills.map(skill => skill.name))),
			);
			disableAll.disabled = this.#disabled.size === total;
			this.#bulk.append(enableAll, disableAll);
		}
		this.#toolbar.hidden = this.#filter.hidden && this.#bulk.childElementCount === 0;

		this.#renderList();

		this.#footer.replaceChildren();
		if (this.#editable) {
			const importButton = h(
				"button",
				{ type: "button", className: "skills-import" },
				icon("download"),
				h("span", null, "Importar skills…"),
			);
			setTooltip(
				importButton,
				"Elige carpetas con un SKILL.md (o que contengan varias) y cópialas a este proyecto o a tu usuario.",
			);
			importButton.addEventListener("click", () => {
				this.#flush();
				this.post({ type: "importSkills" });
			});
			this.#footer.append(importButton);
		}
		this.#footer.hidden = this.#footer.childElementCount === 0;
	}

	#renderList(): void {
		const query = this.#filter.hidden ? "" : this.#filter.value.trim().toLowerCase();
		if (this.#skills.length === 0) {
			this.#list.replaceChildren(
				h(
					"p",
					{ className: "skills-empty" },
					this.#editable
						? "MarIA Code no encuentra skills para esta sesión. Importa una carpeta con un SKILL.md para empezar."
						: "Esta sesión no tiene skills.",
				),
			);
			return;
		}
		const matches = this.#skills.filter(
			skill => !query || skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
		);
		if (matches.length === 0) {
			this.#list.replaceChildren(h("p", { className: "skills-empty" }, `Ninguna skill coincide con «${query}».`));
			return;
		}
		const groups = new Map<Group, SessionSkill[]>();
		for (const skill of matches) {
			// Once locked, switched-off skills are listed apart: they are not part of the session.
			const group: Group = !this.#editable && this.#disabled.has(skill.name) ? "off" : groupOf(skill.source);
			const members = groups.get(group);
			if (members) members.push(skill);
			else groups.set(group, [skill]);
		}
		const sections: HTMLElement[] = [];
		for (const group of GROUP_ORDER) {
			const members = groups.get(group);
			if (!members) continue;
			sections.push(
				h(
					"div",
					{ className: `skills-group ${group}`, role: "group", ariaLabel: GROUP_TITLES[group] },
					h(
						"div",
						{ className: "skills-group-title" },
						h("span", null, GROUP_TITLES[group]),
						h("span", { className: "skills-group-count" }, String(members.length)),
					),
					...members.toSorted((a, b) => a.name.localeCompare(b.name)).map(skill => this.#row(skill)),
				),
			);
		}
		this.#list.replaceChildren(...sections);
	}

	#row(skill: SessionSkill): HTMLElement {
		const on = !this.#disabled.has(skill.name);
		const provider = skill.source.split(":")[0] ?? "";
		const name = h("button", { type: "button", className: "skill-name" }, skill.name);
		setTooltip(name, `Abrir ${skill.filePath}`);
		name.addEventListener("click", () => this.post({ type: "openFile", path: skill.filePath }));
		const head = h(
			"div",
			{ className: "skill-head" },
			name,
			h("span", { className: "skill-source" }, PROVIDER_LABELS[provider] ?? provider),
			!on ? h("span", { className: "skill-off" }, "Desactivada") : null,
			this.#proposalChip(skill.name),
		);
		const text = h(
			"div",
			{ className: "skill-text" },
			head,
			skill.description
				? h("p", { className: "skill-description" }, skill.description)
				: h("p", { className: "skill-description no-description" }, "Sin descripción."),
		);
		if (skill.description.length > DESCRIPTION_CLAMP_CHARS) {
			setTooltip(text.lastElementChild as HTMLElement, skill.description);
		}

		const row = h("div", { className: `skill-row${on ? "" : " off"}` });
		if (this.#editable) {
			const toggle = h("button", {
				type: "button",
				className: "skill-switch",
				role: "switch",
				ariaChecked: String(on),
				ariaLabel: `${on ? "Desactivar" : "Activar"} ${skill.name} en esta sesión`,
			});
			setTooltip(
				toggle,
				on ? "Activa en esta sesión: pulsa para desactivarla" : "Desactivada: pulsa para activarla",
			);
			toggle.addEventListener("click", () => {
				const next = new Set(this.#disabled);
				if (next.has(skill.name)) next.delete(skill.name);
				else next.add(skill.name);
				this.#setDisabled(next);
			});
			row.append(toggle);
		} else {
			const mark = h("span", { className: `skill-mark${on ? " on" : ""}` }, icon(on ? "check" : "lock"));
			setTooltip(mark, on ? "Activa en esta sesión" : "Desactivada en esta sesión");
			row.append(mark);
		}
		row.append(text);
		if (on) {
			const use = button("Usar", "skill-use", () => {
				this.insert(`/skill:${skill.name} `);
				this.#close();
			});
			setTooltip(use, `Añadir /skill:${skill.name} a tu mensaje`);
			row.append(use);
		}
		return row;
	}

	/** A chip on a skill's row when omp proposes changing it; clicking it unfolds the proposal at the top. */
	#proposalChip(skillName: string): HTMLElement | null {
		const proposals = this.#proposals.filter(proposal => proposal.skill === skillName);
		if (proposals.length === 0) return null;
		const chip = h(
			"button",
			{ type: "button", className: "skill-proposal-chip" },
			icon("sparkles"),
			proposals.length === 1 ? "Mejora propuesta" : `${proposals.length} mejoras propuestas`,
		);
		setTooltip(chip, "Ver la mejora que MarIA Code propone para esta skill");
		chip.addEventListener("click", () => {
			for (const proposal of proposals) this.#expanded.add(proposal.id);
			this.#renderProposals();
			this.#proposalsSection
				.querySelector<HTMLElement>(`[data-id="${CSS.escape(proposals[0]!.id)}"]`)
				?.scrollIntoView({ block: "nearest", behavior: "smooth" });
		});
		return chip;
	}

	/** The proposals awaiting a decision, newest first, above the skill list. */
	#renderProposals(): void {
		const count = this.#proposals.length;
		this.#proposalsSection.hidden = count === 0;
		if (count === 0) {
			this.#proposalsSection.replaceChildren();
			return;
		}
		this.#proposalsSection.replaceChildren(
			h(
				"div",
				{ className: "skills-proposals-head" },
				icon("sparkles"),
				h(
					"span",
					{ className: "skills-proposals-title" },
					count === 1 ? "MarIA Code propone mejorar una skill" : `MarIA Code propone ${count} mejoras`,
				),
			),
			h(
				"p",
				{ className: "skills-proposals-hint" },
				"Ha revisado las skills que usó en esta conversación. Nada cambia hasta que apruebes.",
			),
			...this.#proposals.map(proposal => this.#proposalCard(proposal)),
		);
	}

	#proposalCard(proposal: SkillProposalSummary): HTMLElement {
		const expanded = this.#expanded.has(proposal.id);
		const deciding = this.#deciding.get(proposal.id);
		/** A decision button; while one decision is on its way, every button waits and that one says so. */
		const decide = (label: string, busy: string, className: string, request: ChatRequest) => {
			const element = button(deciding === request.type ? busy : label, className, () => {
				this.#deciding.set(proposal.id, request.type);
				this.post(request);
				this.#renderProposals();
			});
			element.disabled = deciding !== undefined;
			return element;
		};
		const files = proposal.files.length > 0 ? ` (${proposal.files.join(", ")})` : "";
		const toggle = h(
			"button",
			{ type: "button", className: "skill-proposal-toggle", ariaExpanded: String(expanded) },
			icon(expanded ? "chevronDown" : "chevronRight"),
			expanded ? "Ocultar cambios" : `Ver cambios${files}`,
		);
		toggle.addEventListener("click", () => {
			if (this.#expanded.has(proposal.id)) this.#expanded.delete(proposal.id);
			else this.#expanded.add(proposal.id);
			this.#renderProposals();
		});
		const openDiff = button("Abrir en el editor", "skill-proposal-secondary", () =>
			this.post({ type: "openSkillProposalDiff", id: proposal.id }),
		);
		setTooltip(openDiff, "Ver los cambios en un editor de diferencias de VS Code");
		const reject: ChatRequest = { type: "rejectSkillProposal", id: proposal.id };
		const actions = proposal.stale
			? [decide("Descartar", "Descartando…", "skill-proposal-secondary", reject)]
			: [
					decide("Aprobar", "Aplicando…", "skill-proposal-approve", {
						type: "approveSkillProposal",
						id: proposal.id,
					}),
					decide("Rechazar", "Rechazando…", "skill-proposal-secondary", reject),
				];
		const reason = proposal.stale
			? `La skill ha cambiado después de esta propuesta, así que ya no se puede aplicar. ${proposal.reason}`
			: proposal.reason;
		return h(
			"article",
			{ className: `skill-proposal${proposal.stale ? " stale" : ""}`, dataset: { id: proposal.id } },
			h(
				"div",
				{ className: "skill-proposal-head" },
				h("span", { className: "skill-proposal-skill" }, proposal.skill),
				proposal.stale ? h("span", { className: "skill-off" }, "Desactualizada") : null,
			),
			proposal.summary ? h("p", { className: "skill-proposal-summary" }, proposal.summary) : null,
			reason ? h("p", { className: "skill-proposal-reason" }, reason) : null,
			toggle,
			expanded && proposal.diff ? truncatedPre(proposal.diff, "skill-proposal-diff", diffLineClass) : null,
			h("div", { className: "skill-proposal-actions" }, ...actions, openDiff),
		);
	}

	/** Show `disabled` at once and send it to the host after a short pause (several clicks become one change). */
	#setDisabled(disabled: Set<string>): void {
		this.#disabled = disabled;
		window.clearTimeout(this.#saveTimer);
		this.#saveTimer = window.setTimeout(() => this.#flush(), SAVE_DELAY_MS);
		this.#update();
	}

	/** Send a waiting switch change now. */
	#flush(): void {
		if (this.#saveTimer === undefined) return;
		window.clearTimeout(this.#saveTimer);
		this.#saveTimer = undefined;
		if (this.#editable) this.post({ type: "setDisabledSkills", names: [...this.#disabled] });
	}
}

/** Which group a skill's `<provider>:<level>` source falls in. */
function groupOf(source: string): Group {
	if (source.endsWith(":project")) return "project";
	if (source.endsWith(":user")) return "user";
	return "other";
}
