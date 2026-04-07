#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readCodexPanelEndpoint } from "../companion/codex-panel-link.ts";
import { getWorkspaceChannelPaths } from "../wechat/channel-config.ts";
import { lockBoundSession, normalizeBridgeRoutingState } from "./bridge-routing.ts";
import { touchCodexDesktopThread } from "./codex-desktop-sync.ts";
import type { BridgeState } from "./bridge-types.ts";

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(MODULE_DIR, "..", "..");

export type BindCurrentCodexCliOptions = {
  workspaceCwd: string;
  restartBridge: boolean;
  scriptsDir: string;
};

export function resolveCurrentCodexPanelThreadId(
  endpoint:
    | {
        sharedThreadId?: string;
        sharedSessionId?: string;
      }
    | null
    | undefined,
): string | null {
  const candidate =
    typeof endpoint?.sharedThreadId === "string"
      ? endpoint.sharedThreadId
      : typeof endpoint?.sharedSessionId === "string"
        ? endpoint.sharedSessionId
        : "";
  const normalized = candidate.trim();
  return normalized || null;
}

export function applyBoundThreadToBridgeStateSnapshot(
  state: Partial<BridgeState>,
  threadId: string,
): Partial<BridgeState> {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    throw new Error("Missing Codex thread id to bind.");
  }

  const routingState = lockBoundSession(
    normalizeBridgeRoutingState({
      sharedSessionId: normalizedThreadId,
      boundSessionId: state.boundSessionId ?? state.boundThreadId,
      routeMode: state.routeMode,
      independentOnce: state.routeIndependentOnce,
    }),
    normalizedThreadId,
  );

  return {
    ...state,
    sharedSessionId: normalizedThreadId,
    sharedThreadId: normalizedThreadId,
    boundSessionId: routingState.boundSessionId,
    boundThreadId: routingState.boundSessionId,
    routeMode: routingState.routeMode,
    routeIndependentOnce: routingState.independentOnce,
  };
}

export function parseBindCurrentCodexCliArgs(
  argv: string[],
  options: { repoRoot?: string } = {},
): BindCurrentCodexCliOptions {
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  let workspaceCwd = path.resolve(repoRoot, "..", "..");
  let restartBridge = true;
  let scriptsDir = path.join(repoRoot, "scripts", "windows");

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        [
          "Usage: wechat-codex-bind [--cwd <workspace>] [--no-restart] [--scripts-dir <path>]",
          "",
          "Binds the currently visible Codex panel thread as the WeChat main thread for this workspace.",
          "",
        ].join("\n"),
      );
      process.exit(0);
    }

    if (arg === "--cwd") {
      if (!next) {
        throw new Error("--cwd requires a value");
      }
      workspaceCwd = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--scripts-dir") {
      if (!next) {
        throw new Error("--scripts-dir requires a value");
      }
      scriptsDir = path.resolve(next);
      index += 1;
      continue;
    }

    if (arg === "--no-restart") {
      restartBridge = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    workspaceCwd,
    restartBridge,
    scriptsDir,
  };
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

async function runProcess(
  filePath: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(filePath, args, {
      cwd,
      env: process.env,
      stdio: "inherit",
      windowsHide: true,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${path.basename(filePath)} exited with signal ${signal}.`));
        return;
      }
      if ((code ?? 0) !== 0) {
        reject(new Error(`${path.basename(filePath)} exited with code ${code ?? 0}.`));
        return;
      }
      resolve();
    });
  });
}

async function restartManagedBridge(scriptsDir: string, workspaceCwd: string): Promise<void> {
  if (process.platform !== "win32") {
    throw new Error("Automatic Codex bridge restart is currently only supported on Windows.");
  }

  const stopScript = path.join(scriptsDir, "stop-codex-wechat-silent.ps1");
  const startScript = path.join(scriptsDir, "start-codex-wechat-silent.ps1");
  if (!fs.existsSync(stopScript) || !fs.existsSync(startScript)) {
    throw new Error(`Missing Windows restart scripts under ${scriptsDir}.`);
  }

  await runProcess(
    "powershell.exe",
    ["-ExecutionPolicy", "Bypass", "-File", stopScript],
    workspaceCwd,
  );
  await runProcess(
    "powershell.exe",
    ["-ExecutionPolicy", "Bypass", "-File", startScript],
    workspaceCwd,
  );
}

async function main(): Promise<void> {
  const options = parseBindCurrentCodexCliArgs(process.argv.slice(2));
  const endpoint = readCodexPanelEndpoint(options.workspaceCwd);
  const currentThreadId = resolveCurrentCodexPanelThreadId(endpoint);
  if (!currentThreadId) {
    throw new Error(
      `No current Codex panel thread was found for ${options.workspaceCwd}. Start "wechat-codex" in the target workspace first.`,
    );
  }

  const { stateFile } = getWorkspaceChannelPaths(options.workspaceCwd);
  const currentState = readJsonFile<Partial<BridgeState>>(stateFile);
  if (!currentState) {
    throw new Error(`Bridge state file was not found for ${options.workspaceCwd}: ${stateFile}`);
  }

  const nextState = applyBoundThreadToBridgeStateSnapshot(currentState, currentThreadId);
  writeJsonFile(stateFile, nextState);
  touchCodexDesktopThread(currentThreadId, undefined, {
    triggerReason: "manual_bind_current_thread",
  });

  if (options.restartBridge) {
    await restartManagedBridge(options.scriptsDir, options.workspaceCwd);
  }

  process.stdout.write(
    `Bound current Codex thread to WeChat: ${currentThreadId}${options.restartBridge ? " (bridge restarted)" : ""}\n`,
  );
}

const isDirectRun = Boolean((import.meta as ImportMeta & { main?: boolean }).main);
if (isDirectRun) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
