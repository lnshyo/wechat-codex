import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), ".codex");
const CODEX_GLOBAL_STATE_PATH = join(CODEX_HOME, ".codex-global-state.json");
const SESSION_INDEX_PATH = join(CODEX_HOME, "session_index.jsonl");
const DEFAULT_THREAD_NAME = "WeChat Bridge";
const DESKTOP_REFRESH_THROTTLE_MS = 1_500;
const SAME_THREAD_ROUTE_SYNC_DEDUPE_MS = 10_000;
const WINDOWS_APPS_DIR =
  process.env.CODEX_DESKTOP_WINDOWS_APPS_DIR?.trim() ||
  join(process.env.ProgramW6432 || process.env.ProgramFiles || "C:\\Program Files", "WindowsApps");
const CODEX_WINDOWS_PACKAGE_PATTERN = /^OpenAI\.Codex_(\d+(?:\.\d+)*)_/i;

let lastDesktopRefreshAt = 0;
let lastDesktopRefreshThreadId: string | null = null;

type CodexDesktopRouteSyncSkipReason = "throttled" | "same_thread_dedupe";

type SessionIndexEntry = {
  id: string;
  thread_name: string;
  updated_at: string;
};

type CodexGlobalState = Record<string, unknown>;

export function normalizeCodexDesktopThreadName(value?: string): string {
  if (!value || value.includes("ClawBot")) {
    return DEFAULT_THREAD_NAME;
  }

  return value;
}

export function shouldRequestCodexDesktopRouteSync(params: {
  threadId: string;
  nowMs: number;
  lastRefreshAtMs: number;
  lastThreadId?: string | null;
}): boolean {
  return getCodexDesktopRouteSyncDisposition(params).shouldRequest;
}

export function getCodexDesktopRouteSyncDisposition(params: {
  threadId: string;
  nowMs: number;
  lastRefreshAtMs: number;
  lastThreadId?: string | null;
}): {
  shouldRequest: boolean;
  skipReason?: CodexDesktopRouteSyncSkipReason;
} {
  if (params.nowMs - params.lastRefreshAtMs < DESKTOP_REFRESH_THROTTLE_MS) {
    return {
      shouldRequest: false,
      skipReason: "throttled",
    };
  }

  if (
    params.lastThreadId === params.threadId &&
    params.nowMs - params.lastRefreshAtMs < SAME_THREAD_ROUTE_SYNC_DEDUPE_MS
  ) {
    return {
      shouldRequest: false,
      skipReason: "same_thread_dedupe",
    };
  }

  return { shouldRequest: true };
}

function log(message: string): void {
  process.stderr.write(`[codex-desktop-sync] ${message}\n`);
}

export function formatCodexDesktopRouteSyncLogMessage(params: {
  threadId: string;
  codexDesktopExePath?: string;
  triggerReason?: string;
  skipReason?: CodexDesktopRouteSyncSkipReason;
}): string {
  const trimmedTriggerReason = params.triggerReason?.trim();
  const triggerSuffix = trimmedTriggerReason ? ` reason=${trimmedTriggerReason}` : "";

  if (params.skipReason) {
    return `Skipping Codex desktop route sync${triggerSuffix} -> ${params.threadId} (${params.skipReason})`;
  }

  const via = params.codexDesktopExePath || "codex:// protocol";
  return `Requesting Codex desktop route sync via ${via} -> ${params.threadId}${triggerSuffix}`;
}

function resolveLatestStateDbPath(): string | undefined {
  try {
    const candidates = readdirSync(CODEX_HOME)
      .filter((name) => /^state_\d+\.sqlite$/i.test(name))
      .map((name) => {
        const fullPath = join(CODEX_HOME, name);
        return {
          fullPath,
          mtimeMs: statSync(fullPath).mtimeMs,
        };
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs);

    return candidates[0]?.fullPath;
  } catch {
    return undefined;
  }
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function parseCodexPackageVersion(entryName: string): number[] | null {
  const match = entryName.match(CODEX_WINDOWS_PACKAGE_PATTERN);
  if (!match) {
    return null;
  }

  const version = match[1]
    .split(".")
    .map((segment) => Number.parseInt(segment, 10));

  return version.every((segment) => Number.isFinite(segment)) ? version : null;
}

function compareVersionArrays(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

export function selectCodexDesktopExecutablePathFromEntries(
  entryNames: string[],
  options: {
    windowsAppsDir?: string;
    exists?: (path: string) => boolean;
  } = {},
): string | undefined {
  const windowsAppsDir = options.windowsAppsDir || WINDOWS_APPS_DIR;
  const exists = options.exists || existsSync;

  const candidates = entryNames
    .map((entryName) => {
      const version = parseCodexPackageVersion(entryName);
      if (!version) {
        return null;
      }

      const executablePath = join(windowsAppsDir, entryName, "app", "Codex.exe");
      if (!exists(executablePath)) {
        return null;
      }

      return {
        executablePath,
        version,
      };
    })
    .filter((candidate): candidate is { executablePath: string; version: number[] } => candidate !== null)
    .sort((left, right) => compareVersionArrays(right.version, left.version));

  return candidates[0]?.executablePath;
}

export function resolveCodexDesktopExecutablePath(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const override = env.CODEX_DESKTOP_EXE?.trim();
  if (override) {
    return override;
  }

  if (process.platform !== "win32") {
    return undefined;
  }

  const liveProcessPath = resolveCodexDesktopExecutablePathFromRunningProcess();
  if (liveProcessPath) {
    return liveProcessPath;
  }

  try {
    return selectCodexDesktopExecutablePathFromEntries(readdirSync(WINDOWS_APPS_DIR));
  } catch (error) {
    const fallback = resolveCodexDesktopExecutablePathViaPowerShell(WINDOWS_APPS_DIR);
    if (!fallback && error instanceof Error) {
      log(`Unable to enumerate WindowsApps directly: ${error.message}`);
    }
    return fallback;
  }
}

function resolveCodexDesktopExecutablePathFromRunningProcess(): string | undefined {
  const script = [
    "Get-Process Codex -ErrorAction SilentlyContinue |",
    "Where-Object { $_.Path -like '*\\WindowsApps\\OpenAI.Codex_*\\app\\Codex.exe' } |",
    "Select-Object -First 1 -ExpandProperty Path",
  ].join(" ");

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
  });

  if (result.status !== 0) {
    return undefined;
  }

  const output = result.stdout?.toString().trim();
  return output || undefined;
}

function resolveCodexDesktopExecutablePathViaPowerShell(windowsAppsDir: string): string | undefined {
  if (process.platform !== "win32") {
    return undefined;
  }

  const escapedWindowsAppsDir = escapePowerShellSingleQuoted(windowsAppsDir);
  const script = [
    `$root = '${escapedWindowsAppsDir}'`,
    "Get-ChildItem -LiteralPath $root -Directory -Filter 'OpenAI.Codex_*' |",
    "ForEach-Object {",
    "  if ($_.Name -match '^OpenAI\\.Codex_(\\d+(?:\\.\\d+)*)_') {",
    "    [PSCustomObject]@{",
    "      Path = Join-Path $_.FullName 'app\\Codex.exe'",
    "      Version = [version]$Matches[1]",
    "    }",
    "  }",
    "} |",
    "Where-Object { Test-Path -LiteralPath $_.Path } |",
    "Sort-Object -Property Version -Descending |",
    "Select-Object -First 1 -ExpandProperty Path",
  ].join("; ");

  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    windowsHide: true,
  });

  if (result.status !== 0) {
    return undefined;
  }

  const output = result.stdout?.toString().trim();
  return output || undefined;
}

function touchThreadStateSqlite(threadId: string): void {
  const dbPath = resolveLatestStateDbPath();
  if (!dbPath) {
    return;
  }

  const result = spawnSync(
    "python",
    [
      "-c",
      [
        "import sqlite3, sys",
        "db_path, thread_id, updated_at = sys.argv[1], sys.argv[2], int(sys.argv[3])",
        "conn = sqlite3.connect(db_path)",
        "cur = conn.cursor()",
        "cur.execute(\"update threads set updated_at=?, has_user_event=1 where id=?\", (updated_at, thread_id))",
        "conn.commit()",
        "conn.close()",
      ].join("; "),
      dbPath,
      threadId,
      String(Math.floor(Date.now() / 1000)),
    ],
    {
      windowsHide: true,
    },
  );

  if (result.status !== 0) {
    log(
      `Failed to touch Codex desktop sqlite for ${threadId}: ${
        result.stderr?.toString().trim() ||
        result.stdout?.toString().trim() ||
        `exit ${result.status}`
      }`,
    );
  }
}

export function pinThreadInCodexGlobalStateJson(rawState: string, threadId: string): string {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return rawState;
  }

  const parsed = JSON.parse(rawState) as CodexGlobalState;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error("Codex global state must be a JSON object");
  }

  const existingPinnedThreadIds = Array.isArray(parsed["pinned-thread-ids"])
    ? parsed["pinned-thread-ids"].filter((value): value is string => typeof value === "string")
    : [];
  const nextPinnedThreadIds = [
    normalizedThreadId,
    ...existingPinnedThreadIds.filter((value) => value !== normalizedThreadId),
  ];

  parsed["pinned-thread-ids"] = nextPinnedThreadIds;
  return JSON.stringify(parsed);
}

function pinThreadInCodexGlobalState(threadId: string): void {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) {
    return;
  }

  try {
    const currentRawState = existsSync(CODEX_GLOBAL_STATE_PATH)
      ? readFileSync(CODEX_GLOBAL_STATE_PATH, "utf8")
      : "{}";
    const nextRawState = pinThreadInCodexGlobalStateJson(currentRawState, normalizedThreadId);
    if (nextRawState !== currentRawState) {
      writeFileSync(CODEX_GLOBAL_STATE_PATH, nextRawState, "utf8");
    }
  } catch (error) {
    log(
      `Failed to pin Codex desktop thread in global state for ${normalizedThreadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export function buildCodexDesktopWindowsRefreshScript(
  threadId: string,
  codexDesktopExePath?: string,
): string {
  const escapedThreadId = escapePowerShellSingleQuoted(threadId);
  const escapedExePath = codexDesktopExePath ? escapePowerShellSingleQuoted(codexDesktopExePath) : null;

  return [
    `$threadId = '${escapedThreadId}'`,
    ...(escapedExePath
      ? [
          `$codexExe = '${escapedExePath}'`,
          "if (Test-Path $codexExe) { Start-Process -FilePath $codexExe -ArgumentList (\"codex://threads/\" + $threadId) } else { Start-Process (\"codex://threads/\" + $threadId) }",
        ]
      : ["Start-Process (\"codex://threads/\" + $threadId)"]),
  ].join("; ");
}

function refreshCodexDesktopUi(
  threadId: string,
  options: {
    triggerReason?: string;
  } = {},
): void {
  if (process.platform !== "win32") {
    return;
  }

  const now = Date.now();
  const disposition = getCodexDesktopRouteSyncDisposition({
    threadId,
    nowMs: now,
    lastRefreshAtMs: lastDesktopRefreshAt,
    lastThreadId: lastDesktopRefreshThreadId,
  });
  if (!disposition.shouldRequest) {
    log(
      formatCodexDesktopRouteSyncLogMessage({
        threadId,
        triggerReason: options.triggerReason,
        skipReason: disposition.skipReason,
      }),
    );
    return;
  }

  lastDesktopRefreshAt = now;
  lastDesktopRefreshThreadId = threadId;

  const codexDesktopExePath = resolveCodexDesktopExecutablePath();
  log(
    formatCodexDesktopRouteSyncLogMessage({
      threadId,
      codexDesktopExePath,
      triggerReason: options.triggerReason,
    }),
  );

  const script = buildCodexDesktopWindowsRefreshScript(threadId, codexDesktopExePath);
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");

  const result = spawnSync("powershell", ["-NoProfile", "-EncodedCommand", encodedScript], {
    windowsHide: true,
  });

  if (result.status !== 0) {
    log(
      `Failed to refresh Codex desktop UI: ${
        result.stderr?.toString().trim() ||
        result.stdout?.toString().trim() ||
        `exit ${result.status}`
      }`,
    );
  }
}

export function touchCodexDesktopThread(
  threadId?: string | null,
  threadName?: string,
  options: {
    triggerReason?: string;
  } = {},
): void {
  const normalizedThreadId = typeof threadId === "string" ? threadId.trim() : "";
  if (!normalizedThreadId) {
    return;
  }

  try {
    const entry: SessionIndexEntry = {
      id: normalizedThreadId,
      thread_name: normalizeCodexDesktopThreadName(threadName),
      updated_at: new Date().toISOString(),
    };

    appendFileSync(SESSION_INDEX_PATH, `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    log(
      `Failed to append Codex session index for ${normalizedThreadId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  touchThreadStateSqlite(normalizedThreadId);
  pinThreadInCodexGlobalState(normalizedThreadId);
  refreshCodexDesktopUi(normalizedThreadId, {
    triggerReason: options.triggerReason,
  });
}
