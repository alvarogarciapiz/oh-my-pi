/**
 * LiteLLM's per-request `"no-log": true` for Unicaja's gateway: requests that
 * must stay out of its logs and spend records (skill curation, "Ask something").
 */
import type { Model } from "@oh-my-pi/pi-ai";

/** Whether `baseUrl` is Unicaja's LiteLLM gateway (`driver-ia.<env>.unicajasc.corp`). */
export function isDriverIaGateway(baseUrl: string | undefined): boolean {
	const host = baseUrl ? URL.parse(baseUrl)?.hostname.toLowerCase() : undefined;
	return host !== undefined && host.startsWith("driver-ia.") && host.endsWith(".unicajasc.corp");
}

/**
 * The request body for `model`: on the driver-ia gateway it carries LiteLLM's
 * `"no-log": true`, which skips every logging callback for the request, the proxy's
 * `LiteLLM_SpendLogs` row included (unless the gateway sets `global_disable_no_log_param`).
 */
export function noLogPayload(payload: unknown, model: Model | undefined): unknown {
	if (!isDriverIaGateway(model?.baseUrl) || typeof payload !== "object" || payload === null) return payload;
	return { ...payload, "no-log": true };
}
