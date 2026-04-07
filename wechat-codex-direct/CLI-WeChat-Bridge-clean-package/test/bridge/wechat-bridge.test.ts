import { describe, expect, test } from "bun:test";

import {
  formatUserFacingInboundError,
  formatWechatSendFailureLogEntry,
  formatUserFacingBridgeFatalError,
  parseCliArgs,
  shouldForwardBridgeEventToWechat,
  shouldWatchParentProcess,
} from "../../src/bridge/wechat-bridge.ts";

describe("wechat-bridge cli helpers", () => {
  test("parseCliArgs keeps persistent lifecycle by default", () => {
    const options = parseCliArgs(["--adapter", "codex"]);

    expect(options.lifecycle).toBe("persistent");
  });

  test("parseCliArgs accepts --lifecycle companion_bound", () => {
    const options = parseCliArgs([
      "--adapter",
      "codex",
      "--lifecycle",
      "companion_bound",
    ]);

    expect(options.lifecycle).toBe("companion_bound");
  });

  test("parseCliArgs accepts --detached for background services", () => {
    const options = parseCliArgs(["--adapter", "codex", "--detached"]);

    expect(options.detached).toBe(true);
    expect(options.lifecycle).toBe("persistent");
  });

  test("shouldWatchParentProcess watches attached terminal bridges", () => {
    expect(
      shouldWatchParentProcess({
        startupParentPid: 123,
        attachedToTerminal: true,
        lifecycle: "persistent",
        detached: false,
      }),
    ).toBe(true);
  });

  test("shouldWatchParentProcess watches detached companion-bound bridges", () => {
    expect(
      shouldWatchParentProcess({
        startupParentPid: 123,
        attachedToTerminal: false,
        lifecycle: "companion_bound",
        detached: false,
      }),
    ).toBe(true);
  });

  test("shouldWatchParentProcess ignores detached persistent bridges", () => {
    expect(
      shouldWatchParentProcess({
        startupParentPid: 123,
        attachedToTerminal: false,
        lifecycle: "persistent",
        detached: false,
      }),
    ).toBe(false);
  });

  test("shouldWatchParentProcess ignores detached services even when attached", () => {
    expect(
      shouldWatchParentProcess({
        startupParentPid: 123,
        attachedToTerminal: true,
        lifecycle: "persistent",
        detached: true,
      }),
    ).toBe(false);
  });

  test("formatUserFacingBridgeFatalError trims verbose app-server log details", () => {
    expect(
      formatUserFacingBridgeFatalError(
        "codex app-server websocket closed unexpectedly. Recent app-server log: codex app-server (WebSockets) listening on: ws://127.0.0.1:12345 readyz: http://127.0.0.1:12345/readyz",
      ),
    ).toBe("桥接错误：codex app-server websocket closed unexpectedly.");
  });

  test("formatWechatSendFailureLogEntry includes the failed context and recipient", () => {
    expect(
      formatWechatSendFailureLogEntry({
        context: "thread_switched",
        recipientId: "owner@im.wechat",
        error: new Error("HTTP 503: upstream unavailable"),
      }),
    ).toBe(
      "wechat_send_failed: context=thread_switched recipient=owner@im.wechat error=Error: HTTP 503: upstream unavailable",
    );
  });

  test("formats opencode companion disconnects as a cleaner user-facing message", () => {
    expect(
      formatUserFacingInboundError({
        adapter: "opencode",
        cwd: "C:\\Users\\unlin",
        errorText:
          'opencode companion is not connected. Run "wechat-opencode" in a second terminal for this directory.',
        isUserFacingShellRejection: false,
      }),
    ).toBe(
      '当前桥接工作区的 OpenCode companion 未连接：\nC:\\Users\\unlin\n请在该目录运行 "wechat-opencode" 重新连接当前本地终端；如果要切换项目，请先运行 "wechat-bridge-opencode"，再在目标项目中运行 "wechat-opencode"。',
    );
  });

  test("keeps generic inbound bridge errors for other adapters", () => {
    expect(
      formatUserFacingInboundError({
        adapter: "codex",
        errorText: "codex app-server websocket closed unexpectedly.",
        isUserFacingShellRejection: false,
      }),
    ).toBe("桥接错误：codex app-server websocket closed unexpectedly.");
  });

  test("suppresses noisy OpenCode bridge events from WeChat replies", () => {
    expect(shouldForwardBridgeEventToWechat("opencode", "stdout")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("opencode", "stderr")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("opencode", "notice")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("opencode", "mirrored_user_input")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("opencode", "session_switched")).toBe(true);
    expect(shouldForwardBridgeEventToWechat("opencode", "thread_switched")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("opencode", "final_reply")).toBe(true);
    expect(shouldForwardBridgeEventToWechat("opencode", "approval_required")).toBe(true);
    expect(shouldForwardBridgeEventToWechat("opencode", "fatal_error")).toBe(true);
  });

  test("suppresses noisy Codex bridge events so each WeChat turn stays in one reply", () => {
    expect(shouldForwardBridgeEventToWechat("codex", "stdout")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("codex", "stderr")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("codex", "notice")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("codex", "session_switched")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("codex", "thread_switched")).toBe(false);
    expect(shouldForwardBridgeEventToWechat("codex", "mirrored_user_input")).toBe(true);
    expect(shouldForwardBridgeEventToWechat("codex", "final_reply")).toBe(true);
  });

  test("keeps claude and shell adapters forwarding bridge events", () => {
    expect(shouldForwardBridgeEventToWechat("claude", "notice")).toBe(true);
    expect(shouldForwardBridgeEventToWechat("shell", "stderr")).toBe(true);
  });
});
