import { afterEach, describe, expect, it, vi } from "bun:test";
import type { Api, Context, Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { RpcAskSelectionController } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-ask-selection";
import type { RpcAskSelectionDeltaFrame } from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-types";
import { createAssistantMessage, createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const API = "test-ask-selection";

interface Request {
	model: string;
	context: Context;
	payload: unknown;
}

function modelAt(id: string, baseUrl: string): Model<Api> {
	return buildModel({
		id,
		name: id,
		api: API,
		provider: "driver-ia",
		baseUrl,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_768,
		maxTokens: 1024,
	} as ModelSpec<Api>) as Model<Api>;
}

/** Answers every request with `chunks` and records what the provider would have sent. */
function serve(chunks: string[]): Request[] {
	const requests: Request[] = [];
	registerCustomApi(API, (model, context, options) => {
		const stream = new AssistantMessageEventStream();
		void (async () => {
			const payload = await options?.onPayload?.({ model: model.id }, model);
			requests.push({ model: model.id, context, payload });
			const message = createAssistantMessage(chunks.join(""));
			for (const delta of chunks) stream.push({ type: "text_delta", contentIndex: 0, delta, partial: message });
			stream.push({ type: "done", reason: "stop", message });
		})();
		return stream;
	});
	return requests;
}

function setup(modelRoles: Record<string, string>) {
	const sessionModel = modelAt("session-model", "https://driver-ia.ub-banco-conversacional-pro.unicajasc.corp");
	const askModel = modelAt("ask-model", "https://driver-ia.ub-banco-conversacional-pro.unicajasc.corp");
	const authStorage = createInMemoryAuthStorage();
	authStorage.keys.setRuntime("driver-ia", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, "/nonexistent/models.yml");
	vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([sessionModel, askModel]);
	const frames: RpcAskSelectionDeltaFrame[] = [];
	const controller = new RpcAskSelectionController(
		{
			model: sessionModel,
			thinkingLevel: undefined,
			settings: Settings.isolated({ modelRoles }),
			modelRegistry,
			sessionId: "session-1",
		},
		frame => frames.push(frame),
	);
	return { controller, frames };
}

describe("ask_selection", () => {
	afterEach(() => {
		clearCustomApis();
		vi.restoreAllMocks();
	});

	it("answers on the ask role with the excerpt and earlier turns, streams the text, and asks LiteLLM not to log it", async () => {
		const requests = serve(["Es una ", "función."]);
		const { controller, frames } = setup({ ask: "driver-ia/ask-model" });

		const result = await controller.ask({
			askId: "q2",
			selection: "debounce(fn, 200)",
			answer: "Usa debounce(fn, 200) para el buscador.",
			question: "¿Y qué devuelve?",
			history: [{ question: "¿Qué es esto?", answer: "Un helper de lodash." }],
		});

		expect(result).toEqual({ answer: "Es una función.", model: "driver-ia/ask-model" });
		expect(frames).toEqual([
			{ type: "ask_selection_delta", askId: "q2", delta: "Es una " },
			{ type: "ask_selection_delta", askId: "q2", delta: "función." },
		]);
		const [request] = requests;
		expect(request?.model).toBe("ask-model");
		expect(request?.payload).toEqual({ model: "ask-model", "no-log": true });
		const system = request?.context.systemPrompt?.join("\n") ?? "";
		expect(system).toContain("debounce(fn, 200)");
		expect(system).toContain("Usa debounce(fn, 200) para el buscador.");
		expect(request?.context.messages.map(message => message.role)).toEqual(["user", "assistant", "user"]);
		expect(request?.context.messages.at(-1)?.content).toBe("¿Y qué devuelve?");
	});

	it("falls back to the session model when the role is unset, and refuses a role that matches no model", async () => {
		const requests = serve(["ok"]);
		const request = { askId: "q1", selection: "x", question: "¿Qué es esto?" };

		expect((await setup({}).controller.ask(request)).model).toBe("driver-ia/session-model");
		expect(requests.map(entry => entry.model)).toEqual(["session-model"]);

		await expect(setup({ ask: "driver-ia/missing" }).controller.ask(request)).rejects.toThrow(
			"modelRoles.ask (driver-ia/missing) matches no available model",
		);
		expect(requests).toHaveLength(1);
	});
});
