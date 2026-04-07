import { describe, expect, test } from "bun:test";

import {
  buildCodexDesktopWindowsRefreshScript,
  formatCodexDesktopRouteSyncLogMessage,
  getCodexDesktopRouteSyncDisposition,
  normalizeCodexDesktopThreadName,
  pinThreadInCodexGlobalStateJson,
  resolveCodexDesktopExecutablePath,
  shouldRequestCodexDesktopRouteSync,
  selectCodexDesktopExecutablePathFromEntries,
} from "../../src/bridge/codex-desktop-sync.ts";

describe("codex desktop sync", () => {
  test("normalizes missing thread names to the bridge default", () => {
    expect(normalizeCodexDesktopThreadName()).toBe("WeChat Bridge");
    expect(normalizeCodexDesktopThreadName("ClawBot thread")).toBe("WeChat Bridge");
  });

  test("builds a Windows refresh script that navigates to the bound thread first", () => {
    const script = buildCodexDesktopWindowsRefreshScript(
      "019d4460-285a-7680-a4a1-dd0df8ff79c2",
    );

    expect(script).toContain("$threadId = '019d4460-285a-7680-a4a1-dd0df8ff79c2'");
    expect(script).toContain('Start-Process ("codex://threads/" + $threadId)');
    expect(script).not.toContain("AppActivate(");
    expect(script).not.toContain("SendKeys(");
    expect(script).not.toContain("WScript.Shell");
  });

  test("prefers launching the packaged Codex desktop executable when it is known", () => {
    const executablePath =
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.325.3894.0_x64__2p2nqsd0c76g0\\app\\Codex.exe";
    const script = buildCodexDesktopWindowsRefreshScript(
      "019d4460-285a-7680-a4a1-dd0df8ff79c2",
      executablePath,
    );

    expect(script).toContain(`$codexExe = '${executablePath}'`);
    expect(script).toContain("Start-Process -FilePath $codexExe -ArgumentList");
    expect(script).toContain("codex://threads/");
  });

  test("selects the newest WindowsApps Codex desktop executable", () => {
    const selectedPath = selectCodexDesktopExecutablePathFromEntries(
      [
        "OpenAI.Codex_26.325.3894.0_x64__2p2nqsd0c76g0",
        "OpenAI.Codex_26.326.1000.0_x64__2p2nqsd0c76g0",
        "Some.OtherApp_1.0.0.0_x64__abcdef",
      ],
      {
        windowsAppsDir: "C:\\Program Files\\WindowsApps",
        exists: (candidatePath) =>
          candidatePath.endsWith(
            "OpenAI.Codex_26.326.1000.0_x64__2p2nqsd0c76g0\\app\\Codex.exe",
          ),
      },
    );

    expect(selectedPath).toBe(
      "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.326.1000.0_x64__2p2nqsd0c76g0\\app\\Codex.exe",
    );
  });

  test("allows overriding the desktop executable path through env", () => {
    expect(
      resolveCodexDesktopExecutablePath({
        CODEX_DESKTOP_EXE: "D:\\Tools\\Codex\\Codex.exe",
      }),
    ).toBe("D:\\Tools\\Codex\\Codex.exe");
  });

  test("pins the target thread into Codex global state JSON", () => {
    const nextState = JSON.parse(
      pinThreadInCodexGlobalStateJson(
        JSON.stringify({
          "active-workspace-roots": ["C:\\Users\\jzy22\\Desktop\\AGTK_workdir"],
        }),
        "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
      ),
    );

    expect(nextState["pinned-thread-ids"]).toEqual(["019d4c71-ba4c-7ff2-ae10-46e6c88af819"]);
    expect(nextState["active-workspace-roots"]).toEqual(["C:\\Users\\jzy22\\Desktop\\AGTK_workdir"]);
  });

  test("moves an already known pinned thread to the front without duplicates", () => {
    const nextState = JSON.parse(
      pinThreadInCodexGlobalStateJson(
        JSON.stringify({
          "pinned-thread-ids": [
            "019d4460-285a-7680-a4a1-dd0df8ff79c2",
            "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
          ],
        }),
        "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
      ),
    );

    expect(nextState["pinned-thread-ids"]).toEqual([
      "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
      "019d4460-285a-7680-a4a1-dd0df8ff79c2",
    ]);
  });

  test("formats desktop route sync logs with the trigger reason", () => {
    expect(
      formatCodexDesktopRouteSyncLogMessage({
        threadId: "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
        codexDesktopExePath: "C:\\Program Files\\WindowsApps\\OpenAI.Codex\\app\\Codex.exe",
        triggerReason: "route_bound_command",
      }),
    ).toContain("reason=route_bound_command");
  });

  test("suppresses repeated route syncs to the same thread within the dedupe window", () => {
    expect(
      shouldRequestCodexDesktopRouteSync({
        threadId: "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
        nowMs: 9_000,
        lastRefreshAtMs: 0,
        lastThreadId: "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
      }),
    ).toBe(false);
  });

  test("reports whether a skipped route sync was throttled or deduped", () => {
    expect(
      getCodexDesktopRouteSyncDisposition({
        threadId: "thread-a",
        nowMs: 1_000,
        lastRefreshAtMs: 0,
        lastThreadId: "thread-b",
      }),
    ).toEqual({ shouldRequest: false, skipReason: "throttled" });

    expect(
      getCodexDesktopRouteSyncDisposition({
        threadId: "thread-a",
        nowMs: 9_000,
        lastRefreshAtMs: 0,
        lastThreadId: "thread-a",
      }),
    ).toEqual({ shouldRequest: false, skipReason: "same_thread_dedupe" });
  });

  test("still allows a different target thread once the base throttle has elapsed", () => {
    expect(
      shouldRequestCodexDesktopRouteSync({
        threadId: "019d4460-285a-7680-a4a1-dd0df8ff79c2",
        nowMs: 2_000,
        lastRefreshAtMs: 0,
        lastThreadId: "019d4c71-ba4c-7ff2-ae10-46e6c88af819",
      }),
    ).toBe(true);
  });
});
