import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { registerRpcPromptMaterialization } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-mode";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session-events";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getConfigRootDir, setAgentDir } from "@oh-my-pi/pi-utils";

describe("registerRpcPromptMaterialization", () => {
	let root: string;
	const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

	beforeEach(async () => {
		root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-rpc-prompt-materialization-"));
		setAgentDir(path.join(root, "agent"));
	});

	afterEach(async () => {
		if (originalAgentDir) setAgentDir(originalAgentDir);
		else {
			setAgentDir(path.join(getConfigRootDir(), "agent"));
			delete process.env.PI_CODING_AGENT_DIR;
		}
		await fs.rm(root, { recursive: true, force: true });
	});

	// Hosts list sessions from their files: without this a chat whose model is still
	// thinking on its first reply is missing from their history.
	it("writes a fresh session with its prompt to disk before any assistant reply", async () => {
		const cwd = path.join(root, "project");
		await fs.mkdir(cwd, { recursive: true });
		const manager = SessionManager.create(cwd);
		let listener: ((event: AgentSessionEvent) => void) | undefined;
		const session: Pick<AgentSession, "subscribe" | "sessionManager"> = {
			sessionManager: manager,
			subscribe: fn => {
				listener = fn;
				return () => {};
			},
		};
		try {
			registerRpcPromptMaterialization(session);
			const sessionFile = manager.getSessionFile();
			if (!sessionFile) throw new Error("expected an allocated session file");
			const message = {
				role: "user" as const,
				content: [{ type: "text" as const, text: "first prompt" }],
				attribution: "user" as const,
				timestamp: Date.now(),
			};
			manager.appendMessage(message);
			await manager.flush();
			expect(await Bun.file(sessionFile).exists()).toBe(false);

			listener?.({ type: "message_end", message });
			await manager.flush();
			expect(await Bun.file(sessionFile).text()).toContain("first prompt");
		} finally {
			await manager.close();
		}
	});
});
