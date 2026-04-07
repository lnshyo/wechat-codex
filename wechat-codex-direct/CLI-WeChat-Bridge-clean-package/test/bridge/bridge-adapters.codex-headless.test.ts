import { describe, expect, test } from "bun:test";

import { CodexPtyAdapter } from "../../src/bridge/bridge-adapters.codex.ts";

function createHeadlessPanelAdapter() {
  const adapter = new CodexPtyAdapter({
    kind: "codex",
    command: "codex",
    cwd: "C:/workspace",
    renderMode: "panel",
    headless: true,
  });

  const mutable = adapter as any;
  mutable.appServer = {};
  mutable.rpcSocket = {};
  mutable.nativeProcess = null;
  mutable.pendingApproval = null;
  mutable.pendingTurnStart = false;
  mutable.activeTurn = null;
  mutable.state.status = "idle";
  mutable.state.cwd = "C:/workspace";
  mutable.state.command = "codex";
  mutable.recoverStaleBusyStateIfNeeded = () => {};
  mutable.recoverStaleActiveTurnStateIfNeeded = () => {};
  mutable.clearInterruptTimer = () => {};
  mutable.rememberInjectedInput = () => {};
  mutable.clearPendingApprovalState = () => {};

  return mutable;
}

describe("CodexPtyAdapter headless panel mode", () => {
  test("restores the saved thread on startup in headless panel mode", async () => {
    const adapter = new CodexPtyAdapter({
      kind: "codex",
      command: "codex",
      cwd: "C:/workspace",
      renderMode: "panel",
      headless: true,
      initialSharedSessionId: "thread-bound",
    }) as any;

    let resumedThreadId: string | null = null;
    adapter.startAppServer = async () => {};
    adapter.connectRpcClient = async () => {
      adapter.appServer = {};
      adapter.rpcSocket = {};
    };
    adapter.sendRpcRequest = async (method: string, params: Record<string, unknown>) => {
      if (method === "thread/resume") {
        resumedThreadId = params.threadId as string;
        return { thread: { id: params.threadId } };
      }
      throw new Error(`unexpected method ${method}`);
    };
    adapter.afterStart = () => {};
    adapter.setStatus = (status: string) => {
      adapter.state.status = status;
    };

    await adapter.start();

    expect(resumedThreadId).toBe("thread-bound");
    expect(adapter.getState().sharedThreadId).toBe("thread-bound");
  });

  test("sendPanelTurn accepts headless panel transports without a native process", async () => {
    const adapter = createHeadlessPanelAdapter();
    let boundTurn: Record<string, unknown> | null = null;

    adapter.ensureThreadStarted = async () => "thread-1";
    adapter.sendRpcRequest = async (method: string) => {
      expect(method).toBe("turn/start");
      return { turn: { id: "turn-1" } };
    };
    adapter.bindActiveTurn = (turn: Record<string, unknown>) => {
      boundTurn = turn;
    };
    adapter.setStatus = (status: string) => {
      adapter.state.status = status;
    };

    await adapter.sendPanelTurn("hello from self-test");

    expect(boundTurn).toEqual({
      threadId: "thread-1",
      turnId: "turn-1",
      origin: "wechat",
    });
    expect(adapter.state.status).toBe("busy");
    expect(adapter.state.activeTurnOrigin).toBe("wechat");
  });

  test("interruptPanelTurn treats headless panel transports as running", async () => {
    const adapter = createHeadlessPanelAdapter();
    let interrupted = false;
    let fallbackArmed = false;

    adapter.activeTurn = {
      threadId: "thread-1",
      turnId: "turn-1",
      origin: "wechat",
    };
    adapter.state.status = "busy";
    adapter.requestActiveTurnInterrupt = async () => {
      interrupted = true;
    };
    adapter.armInterruptFallback = () => {
      fallbackArmed = true;
    };

    const result = await adapter.interruptPanelTurn();

    expect(result).toBe(true);
    expect(interrupted).toBe(true);
    expect(fallbackArmed).toBe(true);
  });
});
