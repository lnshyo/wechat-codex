import { describe, expect, test } from "bun:test";

import {
  shouldTrackPinnedCodexThread,
  shouldDeferRpcTurnCompletionToSessionLog,
  shouldSuppressCodexTransportFatalError,
  shouldTreatCodexNativeExitAsExpected,
} from "../../src/bridge/bridge-adapters.codex.ts";
import { shouldRecoverCodexWechatTurnAfterFinalReplyBeforeNextInput } from "../../src/bridge/bridge-adapters.shared.ts";

describe("codex exit handling", () => {
  test("ignores local thread follow signals that drift away from a pinned codex thread", () => {
    expect(
      shouldTrackPinnedCodexThread({
        pinnedThreadId: "thread-bound",
        candidateThreadId: "thread-local",
      }),
    ).toBe(false);
  });

  test("keeps tracking local signals on the pinned codex thread", () => {
    expect(
      shouldTrackPinnedCodexThread({
        pinnedThreadId: "thread-bound",
        candidateThreadId: "thread-bound",
      }),
    ).toBe(true);
  });

  test("treats a clean native panel exit as expected", () => {
    expect(
      shouldTreatCodexNativeExitAsExpected({
        renderMode: "panel",
        shuttingDown: false,
        exitCode: 0,
      }),
    ).toBe(true);
  });

  test("keeps embedded codex exit code 0 as unexpected", () => {
    expect(
      shouldTreatCodexNativeExitAsExpected({
        renderMode: "embedded",
        shuttingDown: false,
        exitCode: 0,
      }),
    ).toBe(false);
  });

  test("suppresses transport fatal errors while a clean panel exit is in progress", () => {
    expect(
      shouldSuppressCodexTransportFatalError({
        transportShuttingDown: false,
        shuttingDown: false,
        cleanPanelExitInProgress: true,
      }),
    ).toBe(true);
  });

  test("defers native local completion without final text to session log fallback", () => {
    expect(
      shouldDeferRpcTurnCompletionToSessionLog({
        renderMode: "panel",
        turnOrigin: "local",
        status: "completed",
        finalText: null,
      }),
    ).toBe(true);
  });

  test("does not defer native local completion once final text is available", () => {
    expect(
      shouldDeferRpcTurnCompletionToSessionLog({
        renderMode: "panel",
        turnOrigin: "local",
        status: "completed",
        finalText: "同步测试回复",
      }),
    ).toBe(false);
  });

  test("does not defer wechat-owned completion without final text", () => {
    expect(
      shouldDeferRpcTurnCompletionToSessionLog({
        renderMode: "panel",
        turnOrigin: "wechat",
        status: "completed",
        finalText: null,
      }),
    ).toBe(false);
  });

  test("allows the next wechat message to recover a stale wechat turn after the final reply is ready", () => {
    expect(
      shouldRecoverCodexWechatTurnAfterFinalReplyBeforeNextInput({
        activeTurnOrigin: "wechat",
        pendingTurnStart: false,
        hasPendingApproval: false,
        hasFinalOutput: true,
        hasCompletedTurn: false,
      }),
    ).toBe(true);
  });

  test("does not recover before the previous wechat turn has any final output", () => {
    expect(
      shouldRecoverCodexWechatTurnAfterFinalReplyBeforeNextInput({
        activeTurnOrigin: "wechat",
        pendingTurnStart: false,
        hasPendingApproval: false,
        hasFinalOutput: false,
        hasCompletedTurn: false,
      }),
    ).toBe(false);
  });

  test("does not recover an active local turn before the next wechat message", () => {
    expect(
      shouldRecoverCodexWechatTurnAfterFinalReplyBeforeNextInput({
        activeTurnOrigin: "local",
        pendingTurnStart: false,
        hasPendingApproval: false,
        hasFinalOutput: true,
        hasCompletedTurn: false,
      }),
    ).toBe(false);
  });
});
