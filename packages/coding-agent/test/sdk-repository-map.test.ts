import { afterEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import * as compaction from "@oh-my-pi/pi-agent-core/compaction";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createAgentSession } from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import { createInMemoryAuthStorage } from "./helpers/agent-session-setup";

function repositoryMap(prompt: readonly string[]): string {
	const match = prompt.join("\n").match(/<repository-map>[\s\S]*?<\/repository-map>/u);
	if (!match) throw new Error("Expected the repository map in the provider's system prompt");
	return match[0];
}

describe("session-start repository map", () => {
	afterEach(() => vi.restoreAllMocks());

	async function withSession(codingGuidance: boolean, run: (session: AgentSession, cwd: string) => Promise<void>) {
		using temp = TempDir.createSync("@omp-sdk-repository-map-");
		const cwd = temp.join("project");
		await Bun.write(path.join(cwd, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
		await Bun.write(path.join(cwd, "src", "original.ts"), "export const original = true;");
		const authStorage = createInMemoryAuthStorage();
		authStorage.keys.setRuntime("openai", "test-key");
		let session: AgentSession | undefined;
		try {
			({ session } = await createAgentSession({
				cwd,
				agentDir: temp.join("agent"),
				authStorage,
				modelRegistry: new ModelRegistry(authStorage, temp.join("models.yml")),
				model: getBundledModel("openai", "gpt-4o-mini"),
				sessionManager: SessionManager.inMemory(cwd),
				settings: Settings.isolated({
					codingGuidance,
					"compaction.enabled": false,
					"compaction.methodOrder": ["handoff", "soft"],
					"compaction.keepRecentTokens": 1,
					"compaction.autoContinue": false,
					"provider.appendOnlyContext": "on",
				}),
				toolNames: [],
				disableExtensionDiscovery: true,
				skills: [],
				contextFiles: [],
				rules: [],
				promptTemplates: [],
				slashCommands: [],
				enableMCP: false,
				enableLsp: false,
				skipPythonPreflight: true,
			}));
			await run(session, cwd);
		} finally {
			try {
				await session?.dispose();
			} finally {
				authStorage.close();
			}
		}
	}

	it("keeps the initial map in model requests after compaction and refreshes it only for a new conversation", async () => {
		await withSession(true, async (session, cwd) => {
			const initialMap = repositoryMap(session.systemPrompt);
			expect(initialMap).toContain("original.ts");
			const model = createMockModel({ handler: { content: ["Recorded the implementation state."] } });
			session.agent.streamFn = model.stream;
			await session.prompt("Inspect the implementation.");
			await session.prompt("Keep the regression and continue.");
			const livePrompt = model.calls.at(-1)!.context.systemPrompt!;
			expect(repositoryMap(livePrompt)).toBe(initialMap);

			await Bun.write(path.join(cwd, "src", "added-later.ts"), "export const later = true;");
			await session.refreshBaseSystemPrompt();
			expect(repositoryMap(session.systemPrompt)).toBe(initialMap);
			const handoff = vi.spyOn(compaction, "generateHandoffFromContext").mockResolvedValue("Preserved task state.");
			await session.compact();
			expect(handoff.mock.calls[0]![0].systemPrompt).toEqual(livePrompt);
			await session.prompt("Continue from the summary.");
			expect(model.calls.at(-1)!.context.systemPrompt).toEqual(livePrompt);

			expect(await session.newSession()).toBe(true);
			expect(repositoryMap(session.systemPrompt)).toContain("added-later.ts");
		});
	});

	it("omits the repository map when coding guidance is disabled", async () => {
		await withSession(false, async session => {
			const model = createMockModel({ handler: { content: ["General conversation."] } });
			session.agent.streamFn = model.stream;
			await session.prompt("Explain the task.");
			expect(model.calls[0]!.context.systemPrompt?.join("\n")).not.toContain("original.ts");
			expect(model.calls[0]!.context.systemPrompt?.join("\n")).not.toContain("<repository-map>");
		});
	});
});
