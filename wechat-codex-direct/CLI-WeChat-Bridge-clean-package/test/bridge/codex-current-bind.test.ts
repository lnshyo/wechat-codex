import path from "node:path";

import { describe, expect, test } from "bun:test";

import {
  applyBoundThreadToBridgeStateSnapshot,
  parseBindCurrentCodexCliArgs,
  resolveCurrentCodexPanelThreadId,
} from "../../src/bridge/codex-current-bind.ts";

describe("codex current bind helpers", () => {
  test("resolves the current codex panel thread id from the endpoint payload", () => {
    expect(
      resolveCurrentCodexPanelThreadId({
        sharedThreadId: "  thread-current  ",
      }),
    ).toBe("thread-current");

    expect(
      resolveCurrentCodexPanelThreadId({
        sharedSessionId: "thread-fallback",
      }),
    ).toBe("thread-fallback");

    expect(resolveCurrentCodexPanelThreadId({})).toBeNull();
  });

  test("applies the current thread as the bound codex route snapshot", () => {
    const nextState = applyBoundThreadToBridgeStateSnapshot(
      {
        instanceId: "bridge-1",
        adapter: "codex",
        command: "codex",
        cwd: "C:\\workspace",
        authorizedUserId: "owner@wechat",
        bridgeStartedAtMs: 1,
        ignoredBacklogCount: 0,
        sharedSessionId: "thread-old",
        sharedThreadId: "thread-old",
        boundSessionId: "thread-old",
        boundThreadId: "thread-old",
        routeMode: "independent",
        routeIndependentOnce: true,
        lastActivityAt: "2026-04-02T00:00:00.000Z",
      },
      "thread-current",
    );

    expect(nextState.sharedSessionId).toBe("thread-current");
    expect(nextState.sharedThreadId).toBe("thread-current");
    expect(nextState.boundSessionId).toBe("thread-current");
    expect(nextState.boundThreadId).toBe("thread-current");
    expect(nextState.routeMode).toBe("bound");
    expect(nextState.routeIndependentOnce).toBe(false);
    expect(nextState.lastActivityAt).toBe("2026-04-02T00:00:00.000Z");
  });

  test("defaults the bind command workspace to the repo's parent workspace root", () => {
    const repoRoot = "C:\\Users\\jzy22\\Desktop\\AGTK_workdir\\external\\CLI-WeChat-Bridge";
    const parsed = parseBindCurrentCodexCliArgs([], { repoRoot });

    expect(parsed.workspaceCwd).toBe(
      path.resolve(repoRoot, "..", ".."),
    );
    expect(parsed.restartBridge).toBe(true);
    expect(parsed.scriptsDir).toBe(path.join(repoRoot, "scripts", "windows"));
  });
});
