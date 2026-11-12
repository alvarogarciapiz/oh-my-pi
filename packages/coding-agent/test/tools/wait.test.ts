import { afterEach, beforeEach, describe, expect, test, vi } from "bun:test";
import { type Agent, type AgentMessage, TOOL_INTERRUPT_ABORT_REASON } from "@oh-my-pi/pi-agent-core";
import { AsyncJobManager } from "@oh-my-pi/pi-coding-agent/async/job-manager";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { IrcBus } from "@oh-my-pi/pi-coding-agent/irc/bus";
import * as daemonClient from "@oh-my-pi/pi-coding-agent/launch/client";
import type { DaemonBrokerClient } from "@oh-my-pi/pi-coding-agent/launch/client";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { IrcBridge, type IrcBridgeHost } from "@oh-my-pi/pi-coding-agent/session/irc-bridge";
import type { CustomMessage } from "@oh-my-pi/pi-coding-agent/session/messages";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { WaitTool } from "@oh-my-pi/pi-coding-agent/tools/wait";
import type { IrcMessage } from "@oh-my-pi/pi-tui/tools/irc";

function session(manager?: AsyncJobManager, agentId = "Main", launch = false): ToolSession {
	return {
		cwd: process.cwd(),
		settings: Settings.isolated({ "launch.enabled": launch }),
		agentRegistry: AgentRegistry.global(),
		asyncJobManager: manager,
		getAgentId: () => agentId,
	} as unknown as ToolSession;
}

// Lets every pending continuation run, so the wait reaches its next block before the test acts.
async function flushMicrotasks(): Promise<void> {
	for (let i = 0; i < 100; i++) await Promise.resolve();
}

/** Whether `promise` is still pending once already-queued work has run. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
	let settled = false;
	const mark = () => {
		settled = true;
	};
	void promise.then(mark, mark);
	const checked = Promise.withResolvers<void>();
	setImmediate(checked.resolve);
	await checked.promise;
	return !settled;
}

describe("wait", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		IrcBus.resetGlobalForTests();
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		AgentRegistry.resetGlobalForTests();
		IrcBus.resetGlobalForTests();
	});

	test("a settling job is recovered once, suppressing its async duplicate", async () => {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const { promise, resolve } = Promise.withResolvers<string>();
		const id = manager.register("bash", "build", async () => promise, { ownerId: "Main" });
		const waiting = new WaitTool(session(manager)).execute("wait-1", {});
		resolve("build complete");
		const result = await waiting;
		expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed", resultText: "build complete" });
		expect(manager.isJobResultConsumed(id)).toBe(true);
		expect(manager.isDeliverySuppressed(id)).toBe(true);
	});

	test("errors for a subagent whose only running work is its parent's job on it", async () => {
		const registry = AgentRegistry.global();
		const streaming = { isStreaming: true } as never;
		registry.register({ id: "Main", displayName: "Main", kind: "main", session: streaming, status: "running" });
		registry.register({
			id: "Child",
			displayName: "Child",
			kind: "sub",
			parentId: "Main",
			session: streaming,
			status: "running",
		});
		// Subagents share the process job manager with their owner.
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const childRun = Promise.withResolvers<string>();
		manager.register("task", "Child", async () => childRun.promise, {
			id: "Child",
			agentId: "Child",
			ownerId: "Main",
		});
		const waiting = new WaitTool(session(manager, "Child")).execute("child-wait", {});
		await expect(waiting).rejects.toThrow("Nothing to wait for");
		childRun.resolve("done");
	});

	test("an interrupted wait leaves later job completion auto-deliverable", async () => {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const delivered: string[] = [];
		manager.registerDeliverySink("Main", (_id, text) => {
			delivered.push(text);
		});
		const { promise, resolve } = Promise.withResolvers<string>();
		manager.register("bash", "still running", async () => promise, { ownerId: "Main" });
		const controller = new AbortController();
		const waiting = new WaitTool(session(manager)).execute("interrupted", {}, controller.signal);
		controller.abort();
		await expect(waiting).rejects.toThrow("Operation aborted");
		resolve("finished afterward");
		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 500 });
		expect(delivered).toEqual(["finished afterward"]);
	});

	test("a message interrupt returns a non-error result and leaves the completion auto-deliverable", async () => {
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const delivered: string[] = [];
		manager.registerDeliverySink("Main", (_id, text) => {
			delivered.push(text);
		});
		const { promise, resolve } = Promise.withResolvers<string>();
		manager.register("bash", "still running", async () => promise, { ownerId: "Main" });
		const controller = new AbortController();
		const waiting = new WaitTool(session(manager)).execute("interrupted-by-message", {}, controller.signal);
		controller.abort(TOOL_INTERRUPT_ABORT_REASON);
		const result = await waiting;
		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: "Wait interrupted by message." }]);
		expect(result.details).toMatchObject({ op: "wait", interrupted: true });
		resolve("finished afterward");
		await manager.waitForAll();
		await manager.drainDeliveries({ timeoutMs: 500 });
		expect(delivered).toEqual(["finished afterward"]);
	});

	test("returns a settled job whose delivery has not reached the transcript yet", async () => {
		const manager = new AsyncJobManager({});
		// The owner's sink parks the result like a yield-queue receipt awaiting injection.
		const injected = Promise.withResolvers<void>();
		const sinkEntered = Promise.withResolvers<string>();
		manager.registerDeliverySink("Main", async (_id, text) => {
			sinkEntered.resolve(text);
			await injected.promise;
		});
		const id = manager.register("task", "EchoPeer", async () => "received=kestrel42", {
			ownerId: "Main",
			agentId: "EchoPeer",
		});
		expect(await sinkEntered.promise).toBe("received=kestrel42");

		const result = await new WaitTool(session(manager)).execute("wait-undelivered", {});
		expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed", resultText: "received=kestrel42" });
		expect(manager.isDeliverySuppressed(id)).toBe(true);
		injected.resolve();
	});

	test("returns an incoming peer message while the watched job remains live", async () => {
		const registry = AgentRegistry.global();
		registry.register({ id: "Main", displayName: "Main", kind: "main", session: null });
		registry.register({ id: "Peer", displayName: "Peer", kind: "sub", parentId: "Main", session: null });
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const { promise } = Promise.withResolvers<string>();
		const id = manager.register("bash", "unfinished", async () => promise, { ownerId: "Main" });
		const waiting = new WaitTool(session(manager)).execute("wait-3", {});
		await IrcBus.global().send({ from: "Peer", to: "Main", body: "the file is yours" });
		const result = await waiting;
		expect(result.details?.waited).toMatchObject({ from: "Peer", body: "the file is yours" });
		expect(manager.getJob(id)?.status).toBe("running");
		manager.cancel(id);
	});

	// Fake timers freeze the settle window: a wait that ends without the clock advancing added no delay.
	test("jobs finishing moments apart are reported by one wait", async () => {
		vi.useFakeTimers();
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const a = Promise.withResolvers<string>();
		const b = Promise.withResolvers<string>();
		const first = manager.register("bash", "a", async () => a.promise, { ownerId: "Main" });
		const second = manager.register("bash", "b", async () => b.promise, { ownerId: "Main" });
		const waiting = new WaitTool(session(manager)).execute("wait-1", {});
		a.resolve("a done");
		await flushMicrotasks();
		b.resolve("b done");
		const jobs = (await waiting).details?.jobs ?? [];
		expect(jobs.find(job => job.id === first)).toMatchObject({ status: "completed", resultText: "a done" });
		expect(jobs.find(job => job.id === second)).toMatchObject({ status: "completed", resultText: "b done" });
	});

	test("two jobs settling 300 ms apart return in one wait result", async () => {
		vi.useFakeTimers();
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const late = Promise.withResolvers<string>();
		const first = manager.register("bash", "a", async () => "a done", { ownerId: "Main" });
		const second = manager.register("bash", "b", async () => late.promise, { ownerId: "Main" });
		let settled = false;
		const waiting = new WaitTool(session(manager)).execute("wait-300", {}).finally(() => {
			settled = true;
		});
		await flushMicrotasks();
		vi.advanceTimersByTime(300);
		await flushMicrotasks();
		expect(settled).toBe(false);
		late.resolve("b done");
		const jobs = (await waiting).details?.jobs ?? [];
		expect(jobs.find(job => job.id === first)).toMatchObject({ status: "completed", resultText: "a done" });
		expect(jobs.find(job => job.id === second)).toMatchObject({ status: "completed", resultText: "b done" });
	});

	test("a job still running past the settle window does not hold the settled one back", async () => {
		vi.useFakeTimers();
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const slow = Promise.withResolvers<string>();
		const done = manager.register("bash", "a", async () => "a done", { ownerId: "Main" });
		const running = manager.register("bash", "b", async () => slow.promise, { ownerId: "Main" });
		let settled = false;
		const waiting = new WaitTool(session(manager)).execute("wait-1", {}).finally(() => {
			settled = true;
		});
		await flushMicrotasks();
		vi.advanceTimersByTime(1499);
		await flushMicrotasks();
		expect(settled).toBe(false);
		vi.advanceTimersByTime(1);
		const jobs = (await waiting).details?.jobs ?? [];
		slow.resolve("b done");
		expect(jobs.find(job => job.id === done)).toMatchObject({ status: "completed" });
		expect(jobs.find(job => job.id === running)).toMatchObject({ status: "running" });
	});

	test("a single job adds no settle delay", async () => {
		vi.useFakeTimers();
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const id = manager.register("bash", "a", async () => "a done", { ownerId: "Main" });
		const result = await new WaitTool(session(manager)).execute("wait-1", {});
		expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed" });
	});

	describe("a caller mid-turn", () => {
		/** `Main` streaming through a real IRC bridge, so what reaches it queues for its next step boundary. */
		function streamingMain(): IrcBridge {
			const bridge = new IrcBridge({
				agent: { steer: () => {} } as unknown as Agent,
				isDisposed: () => false,
				isStreaming: () => true,
				planModeEnabled: () => false,
				emitSessionEvent: async () => {},
				wakeForIrc: () => {},
			} as unknown as IrcBridgeHost);
			const registry = AgentRegistry.global();
			const session = {
				isStreaming: true,
				deliverIrcMessage: (msg: IrcMessage) => bridge.deliver(msg),
			};
			registry.register({
				id: "Main",
				displayName: "Main",
				kind: "main",
				status: "running",
				session: session as unknown as AgentSession,
			});
			for (const id of ["Peer", "Other"]) {
				registry.register({ id, displayName: id, kind: "sub", parentId: "Main", session: null });
			}
			return bridge;
		}

		const details = (records: AgentMessage[]) => records.map(record => (record as CustomMessage).details);

		test("a broadcast leaves a wait on its own job blocking, and injects after it", async () => {
			const bridge = streamingMain();
			const manager = new AsyncJobManager({ onJobComplete: () => {} });
			const build = Promise.withResolvers<string>();
			const id = manager.register("bash", "build", async () => build.promise, { ownerId: "Main" });
			const waiting = new WaitTool(session(manager)).execute("wait-chatter", {});
			await IrcBus.global().send({ from: "Peer", to: "Main", body: "editing auth.ts", broadcast: true });
			expect(await stillPending(waiting)).toBe(true);
			// Nor may it cut the interruptible wait short from the agent loop.
			expect(bridge.hasInterrupts()).toBe(false);
			build.resolve("built");
			const result = await waiting;
			expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed", resultText: "built" });
			expect(result.details?.waited).toBeUndefined();
			// It still reaches the caller, at its next step boundary.
			expect(details(bridge.drainPending())).toMatchObject([
				{ from: "Peer", message: "editing auth.ts", broadcast: true },
			]);
		});

		test("a direct message still ends the wait after a broadcast", async () => {
			const bridge = streamingMain();
			const manager = new AsyncJobManager({ onJobComplete: () => {} });
			const { promise } = Promise.withResolvers<string>();
			const id = manager.register("bash", "build", async () => promise, { ownerId: "Main" });
			const waiting = new WaitTool(session(manager)).execute("wait-direct", {});
			await IrcBus.global().send({ from: "Peer", to: "Main", body: "editing auth.ts", broadcast: true });
			await IrcBus.global().send({ from: "Other", to: "Main", body: "the file is yours" });
			const result = await waiting;
			expect(result.details?.waited).toMatchObject({ from: "Other", body: "the file is yours" });
			expect(details(bridge.drainPending())).toMatchObject([{ from: "Peer", broadcast: true }]);
			manager.cancel(id);
		});
	});

	test("a hung daemon broker does not fail the wait; the job result still arrives", async () => {
		const hungBroker = {
			request: async () => {
				throw new Error("Daemon list request timed out");
			},
			onCompletion: () => () => {},
		} as unknown as DaemonBrokerClient;
		vi.spyOn(daemonClient, "daemonClientForProject").mockResolvedValue(hungBroker);
		const manager = new AsyncJobManager({ onJobComplete: () => {} });
		const { promise, resolve } = Promise.withResolvers<string>();
		const id = manager.register("bash", "build", async () => promise, { ownerId: "Main" });
		const waiting = new WaitTool(session(manager, "Main", true)).execute("wait-hung-broker", {});
		resolve("build complete");
		const result = await waiting;
		expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed", resultText: "build complete" });
	});

	describe("an interrupt that aborts the service refresh", () => {
		beforeEach(() => {
			const broker = {
				request: async (_operation: unknown, signal?: AbortSignal) => {
					if (signal?.aborted) throw new Error("Daemon broker request aborted");
					return { op: "list", daemons: [] };
				},
				onCompletion: () => () => {},
			} as unknown as DaemonBrokerClient;
			vi.spyOn(daemonClient, "daemonClientForProject").mockResolvedValue(broker);
		});

		test("returns a settled job whose notice is still queued", async () => {
			const manager = new AsyncJobManager({});
			const injected = Promise.withResolvers<void>();
			const sinkEntered = Promise.withResolvers<void>();
			manager.registerDeliverySink("Main", async () => {
				sinkEntered.resolve();
				await injected.promise;
			});
			const id = manager.register("bash", "build", async () => "build complete", { ownerId: "Main" });
			await sinkEntered.promise;
			const controller = new AbortController();
			controller.abort(TOOL_INTERRUPT_ABORT_REASON);
			const result = await new WaitTool(session(manager, "Main", true)).execute(
				"interrupted-refresh-settled",
				{},
				controller.signal,
			);
			expect(result.details?.jobs?.[0]).toMatchObject({ id, status: "completed", resultText: "build complete" });
			injected.resolve();
		});

		test("returns a peer message that arrived and interrupted during the refresh", async () => {
			// Main's session inbox receives the message while the refresh is in flight.
			const inbox: IrcMessage[] = [];
			AgentRegistry.global().register({
				id: "Main",
				displayName: "Main",
				kind: "main",
				session: { drainPendingIrcInboxMessages: () => inbox.splice(0, 1) } as unknown as AgentSession,
			});
			const controller = new AbortController();
			const broker = {
				request: async () => {
					inbox.push({ id: "m1", ts: 0, from: "Peer", to: "Main", body: "the file is yours" });
					controller.abort(TOOL_INTERRUPT_ABORT_REASON);
					throw new Error("Daemon broker request aborted");
				},
				onCompletion: () => () => {},
			} as unknown as DaemonBrokerClient;
			vi.spyOn(daemonClient, "daemonClientForProject").mockResolvedValue(broker);
			const manager = new AsyncJobManager({ onJobComplete: () => {} });
			const id = manager.register("bash", "unfinished", async () => Promise.withResolvers<string>().promise, {
				ownerId: "Main",
			});
			const result = await new WaitTool(session(manager, "Main", true)).execute(
				"interrupted-refresh-message",
				{},
				controller.signal,
			);
			expect(result.details?.waited).toMatchObject({ from: "Peer", body: "the file is yours" });
			manager.cancel(id);
		});

		test("ends as an interrupted wait, as after the refresh, when only running jobs remain", async () => {
			const manager = new AsyncJobManager({ onJobComplete: () => {} });
			const id = manager.register("bash", "still running", async () => Promise.withResolvers<string>().promise, {
				ownerId: "Main",
			});
			const controller = new AbortController();
			controller.abort(TOOL_INTERRUPT_ABORT_REASON);
			const result = await new WaitTool(session(manager, "Main", true)).execute(
				"interrupted-refresh-running",
				{},
				controller.signal,
			);
			expect(result.isError).toBeUndefined();
			expect(result.details).toMatchObject({ op: "wait", jobs: [], interrupted: true });
			expect(manager.getJob(id)?.status).toBe("running");
			manager.cancel(id);
		});

		test("reports nothing to wait for, as after the refresh, when the caller has no work", async () => {
			const controller = new AbortController();
			controller.abort(TOOL_INTERRUPT_ABORT_REASON);
			const waiting = new WaitTool(session(new AsyncJobManager({}), "Main", true)).execute(
				"interrupted-refresh-idle",
				{},
				controller.signal,
			);
			await expect(waiting).rejects.toThrow("Nothing to wait for");
		});
	});
});
