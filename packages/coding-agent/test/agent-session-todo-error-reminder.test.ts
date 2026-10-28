/**
 * A failed `todo` call queues a hidden reminder for the next prompt. That
 * reminder rides with the next deliberate prompt; it is not queued work, so the
 * session must report settled once the turn ends.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { TextContent, ToolCall } from "@oh-my-pi/pi-ai";
import { createMockModel, type MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { isRpcSessionSettled } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-session-settle";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { convertToLlm } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TodoTool } from "@oh-my-pi/pi-coding-agent/tools";
import { TempDir } from "@oh-my-pi/pi-utils";

const REMINDER_MARKER = "todo failed, so todo progress is not visible to the user.";

function todoCall(id: string, args: Record<string, unknown>): MockResponse {
	const call: ToolCall = { type: "toolCall", id, name: "todo", arguments: args };
	return { content: [call] };
}

describe("AgentSession todo-error reminder", () => {
	let tempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let session: AgentSession | undefined;

	beforeAll(async () => {
		tempDir = TempDir.createSync("@pi-todo-error-reminder-");
		authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
		authStorage.keys.setRuntime("anthropic", "anthropic-test-key");
		modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	});

	afterAll(() => {
		authStorage.close();
		tempDir.removeSync();
	});

	afterEach(async () => {
		if (session) {
			await session.dispose();
			session = undefined;
		}
	});

	it("settles after a terminal todo error and delivers the reminder with the next prompt", async () => {
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled test model to exist");
		const mock = createMockModel({
			responses: [
				todoCall("todo-fail", { op: "append", items: ["Add tests"] }),
				{ content: ["Gave up"] },
				{ content: ["Next answer"] },
			],
		});
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"retry.enabled": false,
			"todo.reminders": false,
			"tools.xdev": false,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		const todo = new TodoTool({
			cwd: tempDir.path(),
			hasUI: false,
			getSessionFile: () => null,
			getSessionSpawns: () => "*",
			settings,
			getTodoPhases: () => session?.getTodoPhases() ?? [],
			setTodoPhases: phases => {
				session?.setTodoPhases(phases);
			},
		});
		const agent = new Agent({
			getApiKey: agentModel => `${agentModel.provider}-test-key`,
			initialState: { model, systemPrompt: ["Test"], tools: [todo], messages: [] },
			streamFn: (streamModel, context, options) => mock.stream(streamModel, context, options),
			convertToLlm,
		});
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings, modelRegistry });
		session.setTodoPhases([
			{ name: "Build", tasks: [{ content: "Write code", status: "in_progress" }] },
			{ name: "Ship", tasks: [{ content: "Release", status: "pending" }] },
		]);

		await session.prompt("Plan more work");
		await session.waitForIdle();

		expect(mock.calls.length).toBe(2);
		expect(session.queuedMessageCount).toBe(0);
		expect(isRpcSessionSettled(session)).toBe(true);

		await session.prompt("Next request");
		await session.waitForIdle();

		const lastCall = mock.calls.at(-1);
		if (!lastCall) throw new Error("Expected the mock model to be called");
		const reminders = lastCall.context.messages.flatMap(message => {
			if (message.role !== "developer") return [];
			const content = message.content;
			if (typeof content === "string") return content.includes(REMINDER_MARKER) ? [content] : [];
			return content
				.filter((part): part is TextContent => part.type === "text" && part.text.includes(REMINDER_MARKER))
				.map(part => part.text);
		});
		expect(reminders).toHaveLength(1);
	});
});
