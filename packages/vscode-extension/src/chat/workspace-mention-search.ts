/**
 * The composer's `@` search: files and folders of the workspace folders, with
 * the `@path` omp resolves from the folder it runs in. The index is built when
 * the popup opens and reused while the user types; a workspace too large for it
 * is searched again under the folder typed so far.
 */
import * as path from "node:path";
import * as vscode from "vscode";
import type { WorkspaceMention } from "../protocol";
import { formatWorkspaceMention, isExcludedPath, rankWorkspaceMentions, SEARCH_EXCLUDE } from "./workspace-mentions";

/** Files indexed per search; past this the result is marked `limited`. */
const MAX_INDEXED_FILES = 20_000;

export interface MentionSearchResult {
	entries: WorkspaceMention[];
	/** The workspace has more files than the index holds. */
	limited: boolean;
}

export class WorkspaceMentionSearch {
	/** The index for `cwd` (mentions are relative to it). */
	#index: { cwd: string; result: Promise<MentionSearchResult> } | undefined;

	/** Entries matching `query`, mentions relative to `cwd`; `fresh` rebuilds the index. */
	async search(query: string, fresh: boolean, cwd: string): Promise<MentionSearchResult> {
		if (fresh || !this.#index || this.#index.cwd !== cwd) {
			const result = buildIndex("", cwd);
			this.#index = { cwd, result };
			// A failed build must not stay cached for the next keystroke.
			result.catch(() => {
				if (this.#index?.result === result) this.#index = undefined;
			});
		}
		const index = await this.#index.result;
		let entries = index.entries;
		const slash = query.lastIndexOf("/");
		if (index.limited && slash >= 0) {
			entries = [...entries, ...(await buildIndex(query.slice(0, slash), cwd)).entries];
		}
		return { entries: rankWorkspaceMentions(entries, query), limited: index.limited };
	}
}

/** Files and folders under `scope` (relative to each workspace folder), with mentions relative to `cwd`. */
async function buildIndex(scope: string, cwd: string): Promise<MentionSearchResult> {
	const roots = vscode.workspace.workspaceFolders ?? [];
	const cleanScope = scope.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
	if (cleanScope.split("/").includes("..") || isExcludedPath(cleanScope)) return { entries: [], limited: false };
	const entries = new Map<string, WorkspaceMention>();
	let limited = false;
	for (const root of roots) {
		const rootPath = root.uri.fsPath;
		const base = vscode.Uri.joinPath(root.uri, cleanScope);
		const add = (uri: vscode.Uri, kind: WorkspaceMention["kind"]): void => {
			const relative = path.relative(rootPath, uri.fsPath).replace(/\\/g, "/");
			if (!relative || isExcludedPath(relative)) return;
			const mention = formatWorkspaceMention(path.relative(cwd, uri.fsPath).replace(/\\/g, "/"));
			if (!mention) return;
			entries.set(uri.toString(), {
				name: path.basename(uri.fsPath),
				path: roots.length > 1 ? `${root.name}/${relative}` : relative,
				kind,
				mention,
				openPath: uri.fsPath,
			});
		};
		const files = await vscode.workspace.findFiles(
			new vscode.RelativePattern(base, "**/*"),
			SEARCH_EXCLUDE,
			MAX_INDEXED_FILES + 1,
		);
		if (files.length > MAX_INDEXED_FILES) limited = true;
		for (const file of files.slice(0, MAX_INDEXED_FILES)) {
			add(file, "file");
			// Folders holding files are offered too, up to the workspace folder.
			let parent = path.dirname(file.fsPath);
			while (parent.startsWith(rootPath + path.sep)) {
				add(vscode.Uri.file(parent), "folder");
				parent = path.dirname(parent);
			}
		}
		// Empty folders right under the scope have no file to reveal them.
		let children: [string, vscode.FileType][];
		try {
			children = await vscode.workspace.fs.readDirectory(base);
		} catch (error) {
			// A typed scope need not exist in every workspace folder.
			if (error instanceof vscode.FileSystemError && error.code === "FileNotFound") continue;
			throw error;
		}
		for (const [name, type] of children) {
			if (type & vscode.FileType.Directory) add(vscode.Uri.joinPath(base, name), "folder");
		}
	}
	return { entries: [...entries.values()], limited };
}
