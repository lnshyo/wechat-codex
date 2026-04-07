import { describe, expect, test } from "bun:test";

import type { BridgeAdapter, BridgeAdapterState } from "../../src/bridge/bridge-types.ts";
import {
  bindCurrentCodexThread,
  getCodexDesktopThreadToTouch,
  getCodexPinnedSessionIdForRoute,
  handleInboundMessage,
  restoreBoundCodexRouteAfterTemporaryTurn,
  wireAdapterEvents,
} from "../../src/bridge/wechat-bridge.ts";

function createAdapter(overrides: Partial<BridgeAdapter> & { state?: Partial<BridgeAdapterState> } = {}) {
  const state: BridgeAdapterState = {
    kind: "codex",
    status: "idle",
    cwd: "C:\\workspace",
    command: "codex",
    sharedSessionId: "thread-bound",
    sharedThreadId: "thread-bound",
    ...overrides.state,
  };

  const adapter: BridgeAdapter = {
    setEventSink() {},
    async start() {},
    async sendInput() {},
    async listResumeSessions() {
      return [];
    },
    async resumeSession() {},
    async interrupt() {
      return false;
    },
    async reset() {},
    async resolveApproval() {
      return false;
    },
    async dispose() {},
    getState() {
      return state;
    },
    ...overrides,
  };

  return { adapter, state };
}

function createOutputBatcher() {
  return {
    async flushNow() {},
    clear() {},
    getRecentSummary() {
      return "(no output)";
    },
  };
}

describe("wechat bridge routing commands", () => {
  test("chooses the bound codex thread for desktop refresh in bound mode", () => {
    expect(
      getCodexDesktopThreadToTouch({
        adapterKind: "codex",
        bridgeState: {
          adapter: "codex",
          routeMode: "bound",
          boundSessionId: "thread-bound",
          sharedSessionId: "thread-local",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-local",
        } as never,
      }),
    ).toBe("thread-bound");
  });

  test("skips codex desktop refresh for temporary independent threads", () => {
    expect(
      getCodexDesktopThreadToTouch({
        adapterKind: "codex",
        bridgeState: {
          adapter: "codex",
          routeMode: "independent",
          boundSessionId: "thread-bound",
          sharedSessionId: "thread-temp",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-temp",
        } as never,
      }),
    ).toBeNull();
  });

  test("retargets codex desktop refresh to the bound thread when local drift switches elsewhere", () => {
    expect(
      getCodexDesktopThreadToTouch({
        adapterKind: "codex",
        bridgeState: {
          adapter: "codex",
          routeMode: "bound",
          boundSessionId: "thread-bound",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
        } as never,
        candidateThreadId: "thread-temp",
      }),
    ).toBe("thread-bound");
  });

  test("pins the bound codex thread while bound mode is active", () => {
    expect(
      getCodexPinnedSessionIdForRoute({
        bridgeState: {
          adapter: "codex",
          routeMode: "bound",
          boundSessionId: "thread-bound",
          sharedSessionId: "thread-temp",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-temp",
        } as never,
      }),
    ).toBe("thread-bound");
  });

  test("does not pin a temporary codex thread before the first /2 turn starts", () => {
    expect(
      getCodexPinnedSessionIdForRoute({
        bridgeState: {
          adapter: "codex",
          routeMode: "independent",
          routeIndependentOnce: true,
          sharedSessionId: "thread-bound",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-bound",
        } as never,
      }),
    ).toBeNull();
  });

  test("pins the active temporary codex thread after /2 switches away from the bound thread", () => {
    expect(
      getCodexPinnedSessionIdForRoute({
        bridgeState: {
          adapter: "codex",
          routeMode: "independent",
          routeIndependentOnce: false,
          sharedSessionId: "thread-temp",
          boundSessionId: "thread-bound",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-temp",
        } as never,
      }),
    ).toBe("thread-temp");
  });

  test("prefers the live adapter temp thread over stale persisted state in independent mode", () => {
    expect(
      getCodexPinnedSessionIdForRoute({
        bridgeState: {
          adapter: "codex",
          routeMode: "independent",
          routeIndependentOnce: false,
          sharedSessionId: "thread-bound",
          boundSessionId: "thread-bound",
        } as never,
        adapterState: {
          kind: "codex",
          status: "idle",
          cwd: "C:\\workspace",
          command: "codex",
          sharedSessionId: "thread-temp",
        } as never,
      }),
    ).toBe("thread-temp");
  });

  test("handles /new by arming a temporary independent route", async () => {
    const sent: string[] = [];
    const pinned: Array<string | null> = [];
    let switched = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      switchRouteToIndependent: () => {
        switched = true;
        state.routeMode = "independent";
        state.routeIndependentOnce = true;
      },
    };
    const { adapter } = createAdapter();
    adapter.setPinnedSession = async (sessionId) => {
      pinned.push(sessionId);
    };

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "/new" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).toBeNull();
    expect(switched).toBe(true);
    expect(pinned).toEqual([null]);
    expect(sent[0]).toContain("临时 Codex 线程");
    expect(sent[0]).toContain("/1");
  });

  test("handles /2 as an alias for a temporary independent route", async () => {
    const sent: string[] = [];
    let switched = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      switchRouteToIndependent: () => {
        switched = true;
        state.routeMode = "independent";
        state.routeIndependentOnce = true;
      },
    };
    const { adapter } = createAdapter();

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "/2" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).toBeNull();
    expect(switched).toBe(true);
    expect(sent[0]).toContain("临时 Codex 线程");
    expect(sent[0]).toContain("/1");
  });

  test("pins the current /2 thread after the thread switch event arrives and mirrors the switch to wechat", async () => {
    const pinned: Array<string | null> = [];
    const sharedSessions: string[] = [];
    const sent: string[] = [];
    let sink: ((event: any) => void) | null = null;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      setSharedSessionId(sessionId: string) {
        sharedSessions.push(sessionId);
        state.sharedSessionId = sessionId;
        state.sharedThreadId = sessionId;
      },
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
      setEventSink(listener) {
        sink = listener;
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {} as never,
      stateStore: stateStore as never,
      getActiveTask: () => null,
      clearActiveTask() {},
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      queueWechatAttachmentAction: async () => {},
      outputBatcher: {
        async flushNow() {},
        push() {},
        clear() {},
        getRecentSummary() {
          return "(no output)";
        },
      } as never,
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
    });

    sink?.({
      type: "thread_switched",
      threadId: "thread-temp",
      source: "wechat",
      reason: "wechat_resume",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sharedSessions).toEqual(["thread-temp"]);
    expect(pinned).toEqual(["thread-temp"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("thread-temp");
  });

  test("auto-confirms codex approvals instead of forwarding approval prompts to WeChat", async () => {
    const sent: string[] = [];
    let sink: ((event: any) => void) | null = null;
    let confirmedCount = 0;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {
        state.pendingConfirmation = null;
      },
      setPendingConfirmation(pending: unknown) {
        state.pendingConfirmation = pending;
      },
    };
    const { adapter } = createAdapter({
      setEventSink(listener) {
        sink = listener;
      },
      async resolveApproval(action: "confirm" | "deny") {
        if (action === "confirm") {
          confirmedCount += 1;
          return true;
        }
        return false;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {} as never,
      stateStore: stateStore as never,
      getActiveTask: () => null,
      clearActiveTask() {},
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      queueWechatAttachmentAction: async () => undefined as never,
      outputBatcher: {
        async flushNow() {},
        push() {},
        clear() {},
        getRecentSummary() {
          return "(no output)";
        },
      } as never,
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
    });

    sink?.({
      type: "approval_required",
      request: {
        source: "cli",
        summary: "Codex needs approval before running a command.",
        commandPreview: "Get-Date",
        code: "ABC123",
        createdAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(confirmedCount).toBe(1);
    expect(sent).toEqual([]);
    expect(state.pendingConfirmation).toBeNull();
  });

  test("handles bare 01 as a bridge-level smoke test without forwarding into Codex", async () => {
    const sent: string[] = [];
    const sentInputs: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: {
        source: "cli",
        summary: "old approval",
        commandPreview: "old approval",
        code: "ABC123",
        createdAt: new Date().toISOString(),
      },
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        status: "awaiting_approval",
        activeTurnOrigin: "wechat",
      },
      async sendInput(text: string) {
        sentInputs.push(text);
      },
    } as never);

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "01" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).toBeNull();
    expect(sentInputs).toEqual([]);
    expect(sent).toEqual(["收到。测试探针：`01-ACK`"]);
  });

  test("handles /bound by resuming the bound session when the active thread drifted", async () => {
    const sent: string[] = [];
    const resumed: string[] = [];
    const pinned: Array<string | null> = [];
    let switched = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      switchRouteToBound: () => {
        switched = true;
        state.routeMode = "bound";
        state.routeIndependentOnce = false;
      },
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
      async resumeSession(sessionId: string) {
        resumed.push(sessionId);
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
    });

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "/bound" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
      touchDesktopThread: () => {},
    });

    expect(activeTask).toBeNull();
    expect(switched).toBe(true);
    expect(resumed).toEqual(["thread-bound"]);
    expect(pinned).toEqual(["thread-bound"]);
    expect(sent[0]).toContain("主线程");
  });

  test("handles /1 as an alias for returning to the bound session", async () => {
    const sent: string[] = [];
    const resumed: string[] = [];
    let switched = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      switchRouteToBound: () => {
        switched = true;
        state.routeMode = "bound";
        state.routeIndependentOnce = false;
      },
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
      async resumeSession(sessionId: string) {
        resumed.push(sessionId);
      },
    });

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "/1" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
      touchDesktopThread: () => {},
    });

    expect(activeTask).toBeNull();
    expect(switched).toBe(true);
    expect(resumed).toEqual(["thread-bound"]);
    expect(sent[0]).toContain("主线程");
  });

  test("sends the next inbound message through a fresh codex session and stays in independent mode", async () => {
    const sentInputs: Array<{ text: string; options?: unknown }> = [];
    const pinned: Array<string | null> = [];
    let disarmed = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      completeIndependentOnce: () => {
        disarmed = true;
        state.routeIndependentOnce = false;
      },
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
      async sendInput(text: string, options?: unknown) {
        sentInputs.push({ text, options });
      },
    } as never);

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "summarize the current task" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async () => {},
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).not.toBeNull();
    expect(sentInputs).toHaveLength(1);
    expect(sentInputs[0]?.options).toEqual({ freshSession: true });
    expect(disarmed).toBe(true);
    expect(pinned).toEqual([null, "thread-temp"]);
    expect(state.routeMode).toBe("independent");
    expect(state.routeIndependentOnce).toBe(false);
  });

  test("lets codex attempt stale busy recovery before rejecting a wechat message", async () => {
    const sent: string[] = [];
    const sentInputs: Array<{ text: string; options?: unknown }> = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        status: "busy",
        activeTurnOrigin: "wechat",
        sharedSessionId: "thread-bound",
        sharedThreadId: "thread-bound",
      },
      async sendInput(text: string, options?: unknown) {
        sentInputs.push({ text, options });
      },
    } as never);

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "你好 你是什么大模型" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).not.toBeNull();
    expect(sentInputs).toHaveLength(1);
    expect(sent).toEqual([]);
  });

  test("keeps the local busy warning for an active local codex turn", async () => {
    const sent: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        status: "busy",
        activeTurnOrigin: "local",
        sharedSessionId: "thread-bound",
        sharedThreadId: "thread-bound",
      },
      async sendInput() {
        throw new Error("sendInput should not be called for a real local busy turn");
      },
    } as never);

    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: "你好 你是什么大模型" } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      outputBatcher: createOutputBatcher() as never,
    });

    expect(activeTask).toBeNull();
    expect(sent).toEqual([
      "Codex 当前正在处理本地终端里的任务，请等待完成或发送 /stop。",
    ]);
  });

  test("returns to the bound codex thread before forwarding a normal wechat message", async () => {
    const sentInputs: Array<{ text: string; options?: unknown }> = [];
    const resumed: string[] = [];
    const pinned: Array<string | null> = [];
    const touched: string[] = [];
    let savedSessionId: string | undefined;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-local-drift",
      sharedThreadId: "thread-local-drift",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      setSharedSessionId: (sessionId: string) => {
        savedSessionId = sessionId;
        state.sharedSessionId = sessionId;
        state.sharedThreadId = sessionId;
      },
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-local-drift",
        sharedThreadId: "thread-local-drift",
      },
      async resumeSession(sessionId: string) {
        resumed.push(sessionId);
        state.sharedSessionId = sessionId;
        state.sharedThreadId = sessionId;
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
      async sendInput(text: string, options?: unknown) {
        sentInputs.push({ text, options });
      },
    } as never);

    const wechatText = "wechat-semantic-token-7319";
    const activeTask = await handleInboundMessage({
      message: { senderId: "owner@wechat", text: wechatText } as never,
      options: { adapter: "codex" } as never,
      stateStore: stateStore as never,
      adapter,
      queueWechatMessage: async () => {},
      outputBatcher: createOutputBatcher() as never,
      touchDesktopThread: (threadId) => {
        if (threadId) {
          touched.push(threadId);
        }
      },
    });

    expect(activeTask).not.toBeNull();
    expect(pinned).toEqual(["thread-bound"]);
    expect(resumed).toEqual(["thread-bound"]);
    expect(savedSessionId).toBe("thread-bound");
    expect(sentInputs).toHaveLength(1);
    expect(sentInputs[0]?.text).toContain(wechatText);
    expect(sentInputs[0]?.text).toContain("[User request]");
    expect(sentInputs[0]?.options).toBeUndefined();
    expect(touched).toEqual(["thread-bound"]);
  });

  test("keeps the independent codex route active after the first temporary task completes", async () => {
    let completed = false;
    const pinned: Array<string | null> = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      completeIndependentOnce: () => {
        completed = true;
        state.routeIndependentOnce = false;
      },
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
    });

    await restoreBoundCodexRouteAfterTemporaryTurn({
      activeTask: {
        startedAt: Date.now(),
        inputPreview: "summarize",
      },
      adapter,
      stateStore: stateStore as never,
      queueWechatMessage: async () => {},
      senderId: "owner@wechat",
    });

    expect(completed).toBe(true);
    expect(pinned).toEqual(["thread-temp"]);
    expect(state.routeMode).toBe("independent");
    expect(state.routeIndependentOnce).toBe(false);
    expect(state.sharedSessionId).toBe("thread-temp");
  });

  test("disarms the first temporary-turn flag even when no bound codex thread exists", async () => {
    let completed = false;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      completeIndependentOnce: () => {
        completed = true;
        state.routeIndependentOnce = false;
      },
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-temp",
        sharedThreadId: "thread-temp",
      },
    });

    await restoreBoundCodexRouteAfterTemporaryTurn({
      activeTask: {
        startedAt: Date.now(),
        inputPreview: "summarize",
      },
      adapter,
      stateStore: stateStore as never,
      queueWechatMessage: async () => {},
      senderId: "owner@wechat",
    });

    expect(completed).toBe(true);
    expect(state.routeMode).toBe("independent");
    expect(state.routeIndependentOnce).toBe(false);
  });

  test("locks the current codex thread as the bound thread", async () => {
    const sent: string[] = [];
    const pinned: Array<string | null> = [];
    const touched: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-temp",
      sharedThreadId: "thread-temp",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    let switched = false;
    let savedSessionId: string | undefined;
    const stateStore = {
      getState: () => state,
      switchRouteToBound: () => {
        switched = true;
        state.routeMode = "bound";
        state.routeIndependentOnce = false;
      },
      lockBoundSession: (sessionId: string) => {
        savedSessionId = sessionId;
        state.sharedSessionId = sessionId;
        state.sharedThreadId = sessionId;
        state.boundSessionId = sessionId;
        state.boundThreadId = sessionId;
      },
      appendLog() {},
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-local",
        sharedThreadId: "thread-local",
      },
      async setPinnedSession(sessionId: string | null) {
        pinned.push(sessionId);
      },
    });

    const boundSessionId = await bindCurrentCodexThread({
      adapter,
      stateStore: stateStore as never,
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      senderId: "owner@wechat",
      touchDesktopThread: (threadId) => {
        if (threadId) {
          touched.push(threadId);
        }
      },
    });

    expect(boundSessionId).toBe("thread-local");
    expect(switched).toBe(true);
    expect(pinned).toEqual(["thread-local"]);
    expect(savedSessionId).toBe("thread-local");
    expect(touched).toEqual(["thread-local"]);
    expect(sent[0]).toContain("已把当前 Codex 线程绑定为主线程");
  });

  test("does not retrigger codex desktop route sync after a final reply arrives", async () => {
    let sink: ((event: any) => void) | null = null;
    const touched: string[] = [];
    const sent: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
    };
    const { adapter } = createAdapter({
      setEventSink(nextSink) {
        sink = nextSink;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
      touchDesktopThread: (threadId) => {
        if (threadId) {
          touched.push(threadId);
        }
      },
    });

    sink?.({
      type: "final_reply",
      text: "SYNC-DESKTOP",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toEqual(["SYNC-DESKTOP"]);
    expect(touched).toEqual([]);
  });

  test("mirrors ordinary local codex inputs back to wechat", async () => {
    let sink: ((event: any) => void) | null = null;
    const sent: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
    };
    const { adapter } = createAdapter({
      setEventSink(nextSink) {
        sink = nextSink;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
      touchDesktopThread() {},
    });

    sink?.({
      type: "mirrored_user_input",
      text: "这是桌面端本地输入",
      origin: "local",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Codex");
  });

  test("interrupts a local bind command turn and suppresses its accidental final reply", async () => {
    let sink: ((event: any) => void) | null = null;
    const sent: string[] = [];
    const touched: string[] = [];
    let interruptCount = 0;
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-old",
      sharedThreadId: "thread-old",
      boundSessionId: "thread-old",
      boundThreadId: "thread-old",
      routeMode: "independent" as const,
      routeIndependentOnce: true,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
      switchRouteToBound() {
        state.routeMode = "bound";
        state.routeIndependentOnce = false;
      },
      lockBoundSession(sessionId: string) {
        state.sharedSessionId = sessionId;
        state.sharedThreadId = sessionId;
        state.boundSessionId = sessionId;
        state.boundThreadId = sessionId;
      },
    };
    const { adapter } = createAdapter({
      state: {
        sharedSessionId: "thread-local-bind",
        sharedThreadId: "thread-local-bind",
      },
      setEventSink(nextSink) {
        sink = nextSink;
      },
      async interrupt() {
        interruptCount += 1;
        return true;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
      touchDesktopThread: (threadId) => {
        if (threadId) {
          touched.push(threadId);
        }
      },
    });

    sink?.({
      type: "mirrored_user_input",
      text: "\u7ed1\u5b9a\u5fae\u4fe1",
      origin: "local",
      turnId: "turn-bind-command",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    sink?.({
      type: "final_reply",
      text: "this accidental reply should stay local only",
      turnId: "turn-bind-command",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(interruptCount).toBe(1);
    expect(state.routeMode).toBe("bound");
    expect(state.boundSessionId).toBe("thread-local-bind");
    expect(touched).toEqual(["thread-local-bind"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("Codex");
    expect(sent[0]).not.toContain("accidental reply");
  });

  test("suppresses duplicate final replies that were already forwarded for the same codex turn", async () => {
    let sink: ((event: any) => void) | null = null;
    const sent: string[] = [];
    const remembered: Array<{ context: string; turnId: string }> = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
      hasForwardedTurnEvent: (context: string, turnId: string) =>
        context === "final_reply" && turnId === "turn-duplicate",
      rememberForwardedTurnEvent: (context: string, turnId: string) => {
        remembered.push({ context, turnId });
      },
    };
    const { adapter } = createAdapter({
      setEventSink(nextSink) {
        sink = nextSink;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
      touchDesktopThread() {},
    });

    sink?.({
      type: "final_reply",
      text: "old duplicate final reply",
      turnId: "turn-duplicate",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toEqual([]);
    expect(remembered).toEqual([]);
  });

  test("suppresses duplicate mirrored local inputs that were already forwarded for the same codex turn", async () => {
    let sink: ((event: any) => void) | null = null;
    const sent: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
      hasForwardedTurnEvent: (context: string, turnId: string) =>
        context === "mirrored_user_input" && turnId === "turn-duplicate-input",
    };
    const { adapter } = createAdapter({
      setEventSink(nextSink) {
        sink = nextSink;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
      touchDesktopThread() {},
    });

    sink?.({
      type: "mirrored_user_input",
      text: "old duplicate local input",
      turnId: "turn-duplicate-input",
      origin: "local",
      timestamp: new Date().toISOString(),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sent).toEqual([]);
  });

  test("suppresses replayed local input for an old wechat-owned codex turn", async () => {
    let sink: ((event: any) => void) | null = null;
    const sent: string[] = [];
    const state: any = {
      instanceId: "bridge-1",
      adapter: "codex" as const,
      command: "codex",
      cwd: "C:\\workspace",
      bridgeStartedAtMs: Date.now(),
      authorizedUserId: "owner@wechat",
      ignoredBacklogCount: 0,
      sharedSessionId: "thread-bound",
      sharedThreadId: "thread-bound",
      boundSessionId: "thread-bound",
      boundThreadId: "thread-bound",
      routeMode: "bound" as const,
      routeIndependentOnce: false,
      pendingConfirmation: null,
    };
    const stateStore = {
      getState: () => state,
      appendLog() {},
      clearPendingConfirmation() {},
      hasForwardedTurnEvent: (context: string, turnId: string) =>
        context === "final_reply" && turnId === "turn-wechat-owned",
    };
    const { adapter } = createAdapter({
      setEventSink(nextSink) {
        sink = nextSink;
      },
    });

    wireAdapterEvents({
      adapter,
      options: { adapter: "codex" } as never,
      transport: {
        sendImage: async () => undefined,
        sendFile: async () => undefined,
        sendVoice: async () => undefined,
        sendVideo: async () => undefined,
      } as never,
      stateStore: stateStore as never,
      outputBatcher: createOutputBatcher() as never,
      queueWechatAttachmentAction: async (action) => await action(),
      queueWechatMessage: async (_senderId, text) => {
        sent.push(text);
      },
      getActiveTask: () => null,
      clearActiveTask() {},
      updateLastOutputAt() {},
      syncSharedSessionState() {},
      requestShutdown() {},
    });

    sink?.({
      type: "mirrored_user_input",
      text: "01",
      timestamp: new Date().toISOString(),
      origin: "local",
      turnId: "turn-wechat-owned",
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(sent).toEqual([]);
  });
});
