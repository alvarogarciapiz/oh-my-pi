import { afterEach, describe, expect, it, vi } from "bun:test";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import type { Api, Context, Model, ModelSpec } from "@oh-my-pi/pi-ai";
import { clearCustomApis, registerCustomApi } from "@oh-my-pi/pi-ai";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import {
	buildEnhancePromptResult,
	cleanEnhanceOutput,
	extractProtectedTokens,
	missingProtectedTokens,
	parseEnhanceOutput,
	RpcEnhancePromptController,
} from "@oh-my-pi/pi-coding-agent/modes/rpc/rpc-enhance-prompt";
import { createAssistantMessage, createInMemoryAuthStorage } from "./helpers/agent-session-setup";

const MODEL = "driver-ia/enhance-model";

describe("parseEnhanceOutput", () => {
	it("reads the rewritten prompt, at most four changes and the ambiguities", () => {
		const parsed = parseEnhanceOutput(
			[
				"<prompt>",
				"Revisa `parseConfig` en src/config.ts y explica por qué falla.",
				"</prompt>",
				"<changes>",
				"- Ordena la petición",
				"- Corrige la ortografía",
				"* Precisa el verbo",
				"1. Une dos frases",
				"- Quinta",
				"</changes>",
				"<ambiguities>",
				"- No queda claro qué entorno falla",
				"</ambiguities>",
			].join("\n"),
		);

		expect(parsed).toEqual({
			kind: "prompt",
			prompt: "Revisa `parseConfig` en src/config.ts y explica por qué falla.",
			changes: ["Ordena la petición", "Corrige la ortografía", "Precisa el verbo", "Une dos frases"],
			ambiguities: ["No queda claro qué entorno falla"],
		});
	});

	it("reads <unchanged/> with optional ambiguities, and drops placeholder items", () => {
		expect(parseEnhanceOutput("<unchanged/>")).toEqual({ kind: "unchanged", ambiguities: [] });
		expect(parseEnhanceOutput("<unchanged />\n<ambiguities>\n- ¿Qué rama?\n</ambiguities>")).toEqual({
			kind: "unchanged",
			ambiguities: ["¿Qué rama?"],
		});
		expect(
			parseEnhanceOutput("<prompt>Hola</prompt><changes>- x</changes><ambiguities>- None</ambiguities>"),
		).toEqual({ kind: "prompt", prompt: "Hola", changes: ["x"], ambiguities: [] });
	});

	it("rejects output without the expected tags, or with an empty or unterminated prompt", () => {
		expect(parseEnhanceOutput("Claro, aquí tienes la respuesta a tu pregunta.").kind).toBe("invalid");
		expect(parseEnhanceOutput("").kind).toBe("invalid");
		expect(parseEnhanceOutput("<prompt>   </prompt>").kind).toBe("invalid");
		expect(parseEnhanceOutput("<prompt>sin cerrar").kind).toBe("invalid");
		expect(parseEnhanceOutput("<think>solo razonamiento sin cerrar").kind).toBe("invalid");
	});

	it("strips thinking envelopes, a fence wrapping the whole output and surrounding quotes", () => {
		const fenced =
			"<think>Let me see.</think>\n```xml\n<prompt>Arregla el test.</prompt>\n<changes>\n- Más directo\n</changes>\n```";
		expect(parseEnhanceOutput(fenced)).toEqual({
			kind: "prompt",
			prompt: "Arregla el test.",
			changes: ["Más directo"],
			ambiguities: [],
		});
		expect(cleanEnhanceOutput('"<unchanged/>"')).toBe("<unchanged/>");
		expect(cleanEnhanceOutput("<reasoning>x</reasoning>“<unchanged/>”")).toBe("<unchanged/>");
	});

	it("keeps a fence inside the prompt", () => {
		const parsed = parseEnhanceOutput("<prompt>Ejecuta:\n```sh\nbun test\n```\n</prompt>");
		expect(parsed).toEqual({
			kind: "prompt",
			prompt: "Ejecuta:\n```sh\nbun test\n```",
			changes: [],
			ambiguities: [],
		});
	});
});

describe("protected tokens", () => {
	it("extracts code, URLs, mentions, a leading slash command and path-like tokens", () => {
		const draft = [
			"/skill:review mira @src/app.ts y `fooBar()` en ./scripts/run.sh,",
			"según https://example.com/docs. Ver package.json y C:\\repo\\main.go.",
			"```ts",
			"const a = 1;",
			"```",
			"Esto y/o aquello, e.g. algo.",
		].join("\n");

		const tokens = extractProtectedTokens(draft);

		expect(tokens).toEqual(
			expect.arrayContaining([
				"/skill:review",
				"@src/app.ts",
				"`fooBar()`",
				"./scripts/run.sh",
				"https://example.com/docs",
				"package.json",
				"C:\\repo\\main.go",
				"```ts\nconst a = 1;\n```",
			]),
		);
		expect(tokens).not.toContain("y/o");
		expect(tokens).not.toContain("e.g");
	});

	it("reports a dropped @mention and an altered path", () => {
		const draft = "revisa @src/app.ts y luego packages/core/index.ts";
		expect(missingProtectedTokens(draft, "Revisa src/app.ts y luego packages/core/index.ts.")).toEqual([
			"@src/app.ts",
		]);
		expect(missingProtectedTokens(draft, "Revisa @src/app.ts y luego packages/core/main.ts.")).toEqual([
			"packages/core/index.ts",
		]);
		expect(missingProtectedTokens(draft, "Revisa @src/app.ts y, después, packages/core/index.ts.")).toEqual([]);
	});
});

describe("buildEnhancePromptResult", () => {
	const draft = "arregla el bug de @src/app.ts q falla con `npm test`";

	it("is improved when every literal survives", () => {
		const result = buildEnhancePromptResult(
			draft,
			"<prompt>Arregla el bug de @src/app.ts que hace fallar `npm test`.</prompt>\n<changes>\n- Corrige «q»\n</changes>\n<ambiguities>\n</ambiguities>",
			MODEL,
		);
		expect(result).toEqual({
			status: "improved",
			prompt: "Arregla el bug de @src/app.ts que hace fallar `npm test`.",
			changes: ["Corrige «q»"],
			ambiguities: [],
			lengthWarning: false,
			model: MODEL,
		});
	});

	it("is invalid when the proposal drops a mention or alters a path, and keeps the draft", () => {
		const dropped = buildEnhancePromptResult(
			draft,
			"<prompt>Arregla el bug de app.ts con `npm test`.</prompt>",
			MODEL,
		);
		expect(dropped.status).toBe("invalid");
		expect(dropped.prompt).toBe(draft);
		expect(dropped.invalidReason).toContain("@src/app.ts");

		const altered = buildEnhancePromptResult(
			"actualiza docs/rpc.md",
			"<prompt>Actualiza docs/RPC.md.</prompt>",
			MODEL,
		);
		expect(altered.status).toBe("invalid");
		expect(altered.invalidReason).toContain("docs/rpc.md");
	});

	it("is unchanged for <unchanged/> or an identical proposal, and invalid for garbage", () => {
		expect(buildEnhancePromptResult(draft, "<unchanged/>", MODEL)).toEqual({
			status: "unchanged",
			prompt: draft,
			changes: [],
			ambiguities: [],
			lengthWarning: false,
			model: MODEL,
		});
		expect(
			buildEnhancePromptResult(draft, `<prompt>\n${draft}\n</prompt><changes>- nada</changes>`, MODEL).status,
		).toBe("unchanged");
		const garbage = buildEnhancePromptResult(draft, "Para arreglarlo, cambia la línea 3.", MODEL);
		expect(garbage).toMatchObject({ status: "invalid", prompt: draft, changes: [], ambiguities: [] });
		expect(garbage.invalidReason).toBeString();
	});

	it("flags a proposal more than 2.5× the draft's length", () => {
		const result = buildEnhancePromptResult(
			"haz tests",
			"<prompt>Escribe tests unitarios para el módulo actual cubriendo los casos principales.</prompt>",
			MODEL,
		);
		expect(result.status).toBe("improved");
		expect(result.lengthWarning).toBe(true);
	});
});

const API = "test-enhance-prompt";

interface Request {
	model: string;
	context: Context;
	payload: unknown;
}

function modelAt(id: string): Model<Api> {
	return buildModel({
		id,
		name: id,
		api: API,
		provider: "driver-ia",
		baseUrl: "https://driver-ia.ub-banco-conversacional-pro.unicajasc.corp",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 32_768,
		maxTokens: 1024,
	} as ModelSpec<Api>) as Model<Api>;
}

function serve(output: string): Request[] {
	const requests: Request[] = [];
	registerCustomApi(API, (model, context, options) => {
		const stream = new AssistantMessageEventStream();
		void (async () => {
			const payload = await options?.onPayload?.({ model: model.id }, model);
			requests.push({ model: model.id, context, payload });
			const message = createAssistantMessage(output);
			stream.push({ type: "text_delta", contentIndex: 0, delta: output, partial: message });
			stream.push({ type: "done", reason: "stop", message });
		})();
		return stream;
	});
	return requests;
}

function setup(modelRoles: Record<string, string>, messages: AgentMessage[] = []) {
	const sessionModel = modelAt("session-model");
	const authStorage = createInMemoryAuthStorage();
	authStorage.keys.setRuntime("driver-ia", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, "/nonexistent/models.yml");
	vi.spyOn(modelRegistry, "getAvailable").mockReturnValue([
		sessionModel,
		modelAt("enhance-model"),
		modelAt("smol-model"),
	]);
	return new RpcEnhancePromptController({
		model: sessionModel,
		settings: Settings.isolated({ modelRoles }),
		modelRegistry,
		sessionId: "session-1",
		messages,
		sessionManager: { getCwd: () => "/nonexistent" },
	});
}

describe("enhance_prompt", () => {
	afterEach(() => {
		clearCustomApis();
		vi.restoreAllMocks();
	});

	it("rewrites on the enhance role without tools, with recent chat context, and asks LiteLLM not to log it", async () => {
		const requests = serve(
			"<prompt>Explica qué hace `debounce`.</prompt>\n<changes>\n- Pregunta más clara\n</changes>",
		);
		const controller = setup({ enhance: "driver-ia/enhance-model", smol: "driver-ia/smol-model" }, [
			{ role: "user", content: "¿Cómo va el buscador?", timestamp: 1 },
			createAssistantMessage("Usa debounce para el buscador."),
		]);

		const result = await controller.enhance({
			requestId: "r1",
			draft: "q hace `debounce`",
			context: { noWorkspace: true },
		});

		expect(result).toMatchObject({ status: "improved", prompt: "Explica qué hace `debounce`.", model: MODEL });
		const [request] = requests;
		expect(request?.model).toBe("enhance-model");
		expect(request?.payload).toEqual({ model: "enhance-model", "no-log": true });
		expect(request?.context.tools ?? []).toEqual([]);
		expect(request?.context.messages).toHaveLength(1);
		const turn = String(request?.context.messages[0]?.content);
		expect(turn).toContain("<draft>\nq hace `debounce`\n</draft>");
		expect(turn).toContain("¿Cómo va el buscador?");
		expect(turn).toContain("Usa debounce para el buscador.");
	});

	it("falls back to smol, then the session model, and refuses an enhance role that matches no model", async () => {
		const requests = serve("<unchanged/>");
		const request = { requestId: "r1", draft: "hola", context: { noWorkspace: true } };

		expect((await setup({ smol: "driver-ia/smol-model" }).enhance(request)).model).toBe("driver-ia/smol-model");
		expect((await setup({}).enhance(request)).model).toBe("driver-ia/session-model");
		expect(requests.map(entry => entry.model)).toEqual(["smol-model", "session-model"]);

		await expect(setup({ enhance: "driver-ia/missing" }).enhance(request)).rejects.toThrow(
			"modelRoles.enhance (driver-ia/missing) matches no available model",
		);
	});
});
