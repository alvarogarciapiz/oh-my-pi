import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { getActiveSkills } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { handleRpcGetSkills } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { removeSyncWithRetries } from "@oh-my-pi/pi-utils";
import { cleanupTempHome } from "./helpers/temp-home-cleanup";

function writeSkill(root: string, name: string): void {
	const dir = path.join(root, ".omp", "skills", name);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(
		path.join(dir, "SKILL.md"),
		`---\nname: ${name}\ndescription: The ${name} skill.\n---\n# ${name}\n`,
	);
}

describe("session-scoped skill disabling", () => {
	let tempDir: string;
	let tempHomeDir = "";
	let originalHome: string | undefined;
	let sharedDir: string;
	let sharedAuthStorage: AuthStorage;
	let sharedModelRegistry: ModelRegistry;
	const sessions: AgentSession[] = [];

	beforeAll(async () => {
		sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-skills-shared-"));
		sharedAuthStorage = await AuthStorage.create(path.join(sharedDir, "auth.db"));
		sharedModelRegistry = new ModelRegistry(sharedAuthStorage, path.join(sharedDir, "models.yml"));
	});

	afterAll(() => {
		sharedAuthStorage.close();
		removeSyncWithRetries(sharedDir);
	});

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-skills-"));
		originalHome = process.env.HOME;
		tempHomeDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-session-skills-home-"));
		process.env.HOME = tempHomeDir;
		writeSkill(tempDir, "alpha");
		writeSkill(tempDir, "beta");
	});

	afterEach(async () => {
		for (const session of sessions.splice(0)) await session.dispose();
		cleanupTempHome(() => ({ tempDir, tempHomeDir, originalHome }))();
	});

	async function createSession(sessionManager = SessionManager.inMemory(tempDir)): Promise<AgentSession> {
		const { session } = await createAgentSession({
			cwd: tempDir,
			agentDir: tempDir,
			sessionManager,
			modelRegistry: sharedModelRegistry,
			settings: Settings.isolated({
				"skills.enabled": true,
				"skills.enableCodexUser": false,
				"skills.enableClaudeUser": false,
				"skills.enableClaudeProject": false,
				"skills.enablePiUser": false,
				"skills.enablePiProject": true,
			}),
		});
		sessions.push(session);
		return session;
	}

	const names = (skills: readonly { name: string }[]) => skills.map(skill => skill.name).sort();

	it("drops a switched-off skill from the prompt, skill:// resolution and the listing before the first prompt", async () => {
		const session = await createSession();
		expect(session.agent.state.systemPrompt.join("\n")).toContain("- beta:");

		await session.setSessionDisabledSkills(["beta", "not-a-skill"]);

		expect(names(session.skills)).toEqual(["alpha"]);
		expect(names(getActiveSkills())).toEqual(["alpha"]);
		const prompt = session.agent.state.systemPrompt.join("\n");
		expect(prompt).toContain("- alpha:");
		expect(prompt).not.toContain("- beta:");
		expect(handleRpcGetSkills(session)).toMatchObject({
			editable: true,
			skills: expect.arrayContaining([
				expect.objectContaining({ name: "alpha", enabled: true }),
				expect.objectContaining({ name: "beta", enabled: false }),
			]),
		});

		await session.setSessionDisabledSkills([]);
		expect(names(session.skills)).toEqual(["alpha", "beta"]);
		expect(session.agent.state.systemPrompt.join("\n")).toContain("- beta:");
	});

	it("refuses changes once the session has a message", async () => {
		const session = await createSession();
		session.agent.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });

		await expect(session.setSessionDisabledSkills(["beta"])).rejects.toThrow("before the first prompt");
		expect(names(session.skills)).toEqual(["alpha", "beta"]);
		expect(handleRpcGetSkills(session).editable).toBe(false);
	});

	it("keeps the choice for a resumed session and clears it for a new one", async () => {
		const sessionManager = SessionManager.inMemory(tempDir);
		const first = await createSession(sessionManager);
		await first.setSessionDisabledSkills(["beta"]);

		const resumed = await createSession(sessionManager);
		expect(names(resumed.skills)).toEqual(["alpha"]);
		expect(resumed.agent.state.systemPrompt.join("\n")).not.toContain("- beta:");

		await resumed.newSession();
		expect(names(resumed.skills)).toEqual(["alpha", "beta"]);
		expect(resumed.agent.state.systemPrompt.join("\n")).toContain("- beta:");
	});
});
