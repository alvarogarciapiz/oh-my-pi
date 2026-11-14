/**
 * Import skills from disk: the user picks folders, each a skill (a folder with
 * a `SKILL.md`) or a collection of them (skill folders one level down), and
 * chooses where they go: the project's `.omp/skills` or the user's
 * `<agentDir>/skills`, both folders omp discovers skills in. Folders are copied
 * as they are; omp reads them on its next skill discovery.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";

/** A skill folder found among the picked folders, with the folder name it gets at the destination. */
interface SkillSource {
	dir: string;
	name: string;
}

const SKILL_FILE = "SKILL.md";

/**
 * Ask for skill folders and a destination, then copy them there. Resolves to the
 * names of the skills copied (empty when the user cancelled or nothing was found).
 * `projectDir` is the workspace omp runs in; undefined for chats without a workspace,
 * which import into the user's skills only.
 */
export async function importSkills(projectDir: string | undefined, agentDir: string): Promise<string[]> {
	const picked = await vscode.window.showOpenDialog({
		title: "Importar skills: elige una carpeta con un SKILL.md (o una carpeta que contenga varias)",
		openLabel: "Importar",
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: true,
	});
	if (!picked?.length) return [];
	const sources = (await Promise.all(picked.map(uri => findSkills(uri.fsPath)))).flat();
	if (sources.length === 0) {
		void vscode.window.showWarningMessage(
			`Ninguna de las carpetas elegidas contiene un ${SKILL_FILE} (ni en sus subcarpetas directas).`,
		);
		return [];
	}

	const userRoot = path.join(agentDir, "skills");
	let root = userRoot;
	if (projectDir) {
		const choice = await vscode.window.showQuickPick(
			[
				{
					label: "$(folder) Este proyecto",
					description: path.join(".omp", "skills"),
					detail: "Solo en este repositorio; puedes versionarlas junto al código.",
					root: path.join(projectDir, ".omp", "skills"),
				},
				{
					label: "$(account) Mi usuario",
					description: userRoot,
					detail: "En todos tus proyectos y chats.",
					root: userRoot,
				},
			],
			{
				title: `Importar ${sources.length === 1 ? `la skill ${sources[0]!.name}` : `${sources.length} skills`}`,
				placeHolder: "¿Dónde quieres guardarlas?",
			},
		);
		if (!choice) return [];
		root = choice.root;
	}

	const imported: string[] = [];
	for (const source of sources) {
		const target = path.join(root, source.name);
		if (path.resolve(target) === path.resolve(source.dir)) continue;
		if (await exists(target)) {
			const replace = await vscode.window.showWarningMessage(
				`Ya existe una skill «${source.name}» en ${root}. ¿Quieres reemplazarla?`,
				{ modal: true },
				"Reemplazar",
			);
			if (replace !== "Reemplazar") continue;
			await fs.rm(target, { recursive: true, force: true });
		}
		await fs.cp(source.dir, target, { recursive: true, errorOnExist: true });
		imported.push(source.name);
	}
	return imported;
}

/** `dir` itself when it holds a `SKILL.md`, else its direct subfolders that do. */
async function findSkills(dir: string): Promise<SkillSource[]> {
	const own = await skillSource(dir);
	if (own) return [own];
	const entries = await fs.readdir(dir, { withFileTypes: true });
	const found = await Promise.all(
		entries.filter(entry => entry.isDirectory()).map(entry => skillSource(path.join(dir, entry.name))),
	);
	return found.filter(source => source !== undefined);
}

/**
 * The skill in `dir`, or undefined when it has no `SKILL.md`. It keeps the name
 * its frontmatter declares (the name omp lists it by) when that is a plain
 * folder name, else the folder's own name.
 */
async function skillSource(dir: string): Promise<SkillSource | undefined> {
	let text: string;
	try {
		text = await fs.readFile(path.join(dir, SKILL_FILE), "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
	const declared = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(frontmatter)?.[1]?.trim();
	const name =
		declared && /^[\p{L}\p{N}._-]+$/u.test(declared) && !/^\.+$/.test(declared) ? declared : path.basename(dir);
	return { dir, name };
}

async function exists(file: string): Promise<boolean> {
	try {
		await fs.stat(file);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
		throw error;
	}
}
