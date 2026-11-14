import { describe, expect, it } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { noLogPayload } from "../src/utils/litellm-no-log";

describe("requests on the driver-ia gateway", () => {
	const modelAt = (baseUrl: string) =>
		buildModel({
			id: "oss-coder-pro",
			name: "oss-coder-pro",
			api: "anthropic-messages",
			provider: "driver-ia",
			baseUrl,
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 32_000,
		});
	const body = { model: "oss-coder-pro", messages: [] };

	it("asks LiteLLM not to log them on any driver-ia environment", () => {
		for (const env of ["ub-banco-conversacional-pro", "ub-banco-conversacional-pre"]) {
			expect(noLogPayload(body, modelAt(`https://driver-ia.${env}.unicajasc.corp`))).toEqual({
				...body,
				"no-log": true,
			});
		}
	});

	it("leaves other hosts untouched", () => {
		for (const baseUrl of [
			"https://driver-ia.example.com/v1",
			"https://api.anthropic.com",
			"https://x.unicajasc.corp",
		]) {
			expect(noLogPayload(body, modelAt(baseUrl))).toBe(body);
		}
	});
});
