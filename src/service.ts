import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

import { getRunningLockedPid } from './daemon-lock.js';
import { DAEMON_LOCK_PATH, DATA_DIR, LOG_DIR, SERVICE_PID_PATH } from './constants.js';
import { logger } from './logger.js';

interface ServicePidFile {
  pid: number;
  startedAt: string;
}

interface ListedProcess {
  pid: number;
  commandLine?: string;
}

export interface BridgeServiceStatus {
  running: boolean;
  pid?: number;
  startedAt?: string;
  installed?: boolean;
  mode: 'windows-service' | 'background' | 'none';
}

export const WINDOWS_SERVICE_ID = 'wechat-codex';
export const WINDOWS_SERVICE_DISPLAY_NAME = 'wechat-codex';
const WINDOWS_SERVICE_WRAPPER_BASENAME = 'wechat-codex-service';
const WINDOWS_SERVICE_DESCRIPTION = 'Direct personal WeChat bridge to the local logged-in Codex CLI.';
const WINSW_VERSION = 'v2.12.0';
const WINSW_DOWNLOAD_URL = `https://github.com/winsw/winsw/releases/download/${WINSW_VERSION}/WinSW-x64.exe`;

interface WindowsServiceArtifacts {
  homeDir: string;
  wrapperBasePath: string;
  wrapperExePath: string;
  wrapperXmlPath: string;
  logDir: string;
}

interface WindowsServiceDefinitionOptions {
  nodeExecutable: string;
  entryFile: string;
  workingDirectory: string;
  logDirectory: string;
  dataDirectory: string;
  codexHome: string;
  userProfile: string;
  appData: string;
  localAppData: string;
  tempDirectory: string;
}

function ensureServiceDirs(): void {
  mkdirSync(dirname(SERVICE_PID_PATH), { recursive: true });
  mkdirSync(LOG_DIR, { recursive: true });
}

function readPidFile(): ServicePidFile | null {
  try {
    return JSON.parse(readFileSync(SERVICE_PID_PATH, 'utf8')) as ServicePidFile;
  } catch {
    return null;
  }
}

function writePidFile(pid: number): void {
  ensureServiceDirs();
  writeFileSync(
    SERVICE_PID_PATH,
    JSON.stringify({ pid, startedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

function removePidFile(): void {
  try {
    rmSync(SERVICE_PID_PATH, { force: true });
  } catch {
    // Ignore cleanup failures.
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopProcess(pid: number): boolean {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
      stdio: 'ignore',
    });
    return result.status === 0;
  }

  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function getStdoutLogPath(): string {
  return join(LOG_DIR, 'service.stdout.log');
}

function getStderrLogPath(): string {
  return join(LOG_DIR, 'service.stderr.log');
}

function tailLines(input: string, count: number): string {
  return input.split(/\r?\n/).filter(Boolean).slice(-count).join('\n');
}

function normalizeCommandPath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

export function isMatchingBridgeProcessCommand(
  commandLine: string | undefined,
  entryFile: string,
): boolean {
  if (!commandLine) {
    return false;
  }

  const normalizedCommand = normalizeCommandPath(commandLine);
  const normalizedEntry = normalizeCommandPath(entryFile);
  return normalizedCommand.includes(normalizedEntry) && /\sstart(?:\s|$)/.test(normalizedCommand);
}

function listCandidateBridgeProcesses(): ListedProcess[] {
  if (process.platform === 'win32') {
    const script = [
      "$rows = Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\"",
      '| Select-Object ProcessId, CommandLine',
      '| ConvertTo-Json -Compress',
    ].join(' ');
    const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0 || !result.stdout.trim()) {
      return [];
    }

    const parsed = JSON.parse(result.stdout) as
      | { ProcessId: number; CommandLine?: string }
      | Array<{ ProcessId: number; CommandLine?: string }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((row) => ({ pid: row.ProcessId, commandLine: row.CommandLine }));
  }

  const result = spawnSync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce<ListedProcess[]>((rows, line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) {
        return rows;
      }

      rows.push({
        pid: Number(match[1]),
        commandLine: match[2],
      });
      return rows;
    }, []);
}

function findExistingBridgeProcess(entryFile: string): ListedProcess | undefined {
  return listCandidateBridgeProcesses().find((processInfo) =>
    processInfo.pid !== process.pid &&
    isMatchingBridgeProcessCommand(processInfo.commandLine, entryFile) &&
    isProcessRunning(processInfo.pid),
  );
}

function getBackgroundProcessStatus(entryFile?: string): BridgeServiceStatus {
  const lockedPid = getRunningLockedPid(DAEMON_LOCK_PATH, isProcessRunning);
  if (lockedPid) {
    const pidFile = readPidFile();
    if (!pidFile || pidFile.pid !== lockedPid) {
      writePidFile(lockedPid);
    }

    return {
      running: true,
      pid: lockedPid,
      startedAt: pidFile?.pid === lockedPid ? pidFile.startedAt : undefined,
      mode: 'background',
    };
  }

  const pidFile = readPidFile();
  if (!pidFile) {
    if (entryFile) {
      const existing = findExistingBridgeProcess(entryFile);
      if (existing) {
        writePidFile(existing.pid);
        return {
          running: true,
          pid: existing.pid,
          mode: 'background',
        };
      }
    }
    return { running: false, mode: 'none' };
  }

  if (!isProcessRunning(pidFile.pid)) {
    removePidFile();
    if (entryFile) {
      const existing = findExistingBridgeProcess(entryFile);
      if (existing) {
        writePidFile(existing.pid);
        return {
          running: true,
          pid: existing.pid,
          mode: 'background',
        };
      }
    }
    return { running: false, mode: 'none' };
  }

  return {
    running: true,
    pid: pidFile.pid,
    startedAt: pidFile.startedAt,
    mode: 'background',
  };
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function runSc(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('sc', args, {
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function queryWindowsService(): BridgeServiceStatus {
  if (process.platform !== 'win32') {
    return { running: false, mode: 'none' };
  }

  const result = runSc(['queryex', WINDOWS_SERVICE_ID]);
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.status !== 0 || /FAILED 1060/i.test(output)) {
    return { running: false, installed: false, mode: 'none' };
  }

  const running = /STATE\s*:\s*\d+\s+RUNNING/i.test(output);
  const pidMatch = output.match(/PID\s*:\s*(\d+)/i);

  return {
    running,
    pid: pidMatch ? Number(pidMatch[1]) : undefined,
    installed: true,
    mode: 'windows-service',
  };
}

function runWinSWCommand(
  wrapperExePath: string,
  command: 'install' | 'uninstall' | 'start' | 'stop',
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(wrapperExePath, [command], {
    encoding: 'utf8',
    windowsHide: true,
  });

  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function resolveServiceEnvironmentPaths(): {
  codexHome: string;
  userProfile: string;
  appData: string;
  localAppData: string;
  tempDirectory: string;
} {
  const userProfile = process.env.USERPROFILE || process.env.HOME || '';
  const appData = process.env.APPDATA || join(userProfile, 'AppData', 'Roaming');
  const localAppData = process.env.LOCALAPPDATA || join(userProfile, 'AppData', 'Local');
  const tempDirectory =
    process.env.TEMP || process.env.TMP || join(localAppData, 'Temp');

  return {
    codexHome: process.env.CODEX_HOME || join(userProfile, '.codex'),
    userProfile,
    appData,
    localAppData,
    tempDirectory,
  };
}

async function downloadFile(url: string, destination: string): Promise<void> {
  if (process.platform === 'win32') {
    const command = [
      "$ProgressPreference='SilentlyContinue'",
      `$url='${url.replaceAll("'", "''")}'`,
      `$dest='${destination.replaceAll("'", "''")}'`,
      'Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest -TimeoutSec 60',
    ].join('; ');
    const result = spawnSync('powershell', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      windowsHide: true,
    });

    if (result.status !== 0) {
      throw new Error(`${result.stdout || ''}\n${result.stderr || ''}`.trim() || 'Download failed.');
    }

    return;
  }

  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destination, buffer);
}

async function ensureWindowsServiceArtifacts(entryFile: string): Promise<WindowsServiceArtifacts> {
  const artifacts = getWindowsServiceArtifactPaths();
  mkdirSync(artifacts.homeDir, { recursive: true });
  mkdirSync(artifacts.logDir, { recursive: true });

  if (!existsSync(artifacts.wrapperExePath)) {
    await downloadFile(WINSW_DOWNLOAD_URL, artifacts.wrapperExePath);
  }

  const definition = buildWindowsServiceDefinition({
    nodeExecutable: process.execPath,
    entryFile,
    workingDirectory: process.cwd(),
    logDirectory: artifacts.logDir,
    dataDirectory: DATA_DIR,
    ...resolveServiceEnvironmentPaths(),
  });

  writeFileSync(artifacts.wrapperXmlPath, definition.xml, 'utf8');
  return artifacts;
}

function extractCommandOutput(result: { status: number | null; stdout: string; stderr: string }): string {
  return `${result.stdout}\n${result.stderr}`.trim();
}

export function getWindowsServiceArtifactPaths(dataDir = DATA_DIR): WindowsServiceArtifacts {
  const homeDir = join(dataDir, 'windows-service');
  const wrapperBasePath = join(homeDir, WINDOWS_SERVICE_WRAPPER_BASENAME);

  return {
    homeDir,
    wrapperBasePath,
    wrapperExePath: `${wrapperBasePath}.exe`,
    wrapperXmlPath: `${wrapperBasePath}.xml`,
    logDir: join(homeDir, 'logs'),
  };
}

export function buildWindowsServiceDefinition(options: WindowsServiceDefinitionOptions): { xml: string } {
  const xml = [
    '<service>',
    `  <id>${xmlEscape(WINDOWS_SERVICE_ID)}</id>`,
    `  <name>${xmlEscape(WINDOWS_SERVICE_DISPLAY_NAME)}</name>`,
    `  <description>${xmlEscape(WINDOWS_SERVICE_DESCRIPTION)}</description>`,
    `  <executable>${xmlEscape(options.nodeExecutable)}</executable>`,
    `  <arguments>&quot;${xmlEscape(options.entryFile)}&quot; start</arguments>`,
    `  <workingdirectory>${xmlEscape(options.workingDirectory)}</workingdirectory>`,
    `  <logpath>${xmlEscape(options.logDirectory)}</logpath>`,
    `  <env name="WCC_DATA_DIR" value="${xmlEscape(options.dataDirectory)}" />`,
    `  <env name="CODEX_HOME" value="${xmlEscape(options.codexHome)}" />`,
    `  <env name="USERPROFILE" value="${xmlEscape(options.userProfile)}" />`,
    `  <env name="HOME" value="${xmlEscape(options.userProfile)}" />`,
    `  <env name="APPDATA" value="${xmlEscape(options.appData)}" />`,
    `  <env name="LOCALAPPDATA" value="${xmlEscape(options.localAppData)}" />`,
    `  <env name="TEMP" value="${xmlEscape(options.tempDirectory)}" />`,
    `  <env name="TMP" value="${xmlEscape(options.tempDirectory)}" />`,
    '  <log mode="roll" />',
    '  <startmode>Automatic</startmode>',
    '  <stoptimeout>15 sec</stoptimeout>',
    '  <onfailure action="restart" delay="10 sec" />',
    '</service>',
    '',
  ].join('\n');

  return { xml };
}

export function getServiceStatus(): BridgeServiceStatus {
  const windowsStatus = queryWindowsService();
  if (windowsStatus.installed) {
    return windowsStatus;
  }

  return getBackgroundProcessStatus();
}

export async function installWindowsService(entryFile: string): Promise<string> {
  if (process.platform !== 'win32') {
    return 'Windows Service install is only supported on Windows.';
  }

  if (!existsSync(entryFile)) {
    return `Build output not found: ${entryFile}. Run npm run build first.`;
  }

  const backgroundStatus = getBackgroundProcessStatus();
  if (backgroundStatus.running && backgroundStatus.pid) {
    stopProcess(backgroundStatus.pid);
    removePidFile();
  }

  const artifacts = await ensureWindowsServiceArtifacts(entryFile);
  const existing = queryWindowsService();
  if (existing.installed) {
    return `Windows service already installed: ${WINDOWS_SERVICE_ID}`;
  }

  const result = runWinSWCommand(artifacts.wrapperExePath, 'install');
  if (result.status !== 0) {
    const output = extractCommandOutput(result);
    throw new Error(output || 'Windows service install failed.');
  }

  logger.info('Windows service installed', { serviceId: WINDOWS_SERVICE_ID });
  return `Windows service installed: ${WINDOWS_SERVICE_ID}`;
}

export function uninstallWindowsService(): string {
  if (process.platform !== 'win32') {
    return 'Windows Service uninstall is only supported on Windows.';
  }

  const artifacts = getWindowsServiceArtifactPaths();
  const status = queryWindowsService();
  if (!status.installed) {
    if (existsSync(artifacts.homeDir)) {
      rmSync(artifacts.homeDir, { recursive: true, force: true });
    }
    return `Windows service is not installed: ${WINDOWS_SERVICE_ID}`;
  }

  void stopBackgroundService();

  if (status.running && existsSync(artifacts.wrapperExePath)) {
    runWinSWCommand(artifacts.wrapperExePath, 'stop');
  }

  const result = runWinSWCommand(artifacts.wrapperExePath, 'uninstall');
  if (result.status !== 0) {
    const output = extractCommandOutput(result);
    throw new Error(output || 'Windows service uninstall failed.');
  }

  rmSync(artifacts.homeDir, { recursive: true, force: true });
  logger.info('Windows service uninstalled', { serviceId: WINDOWS_SERVICE_ID });
  return `Windows service removed: ${WINDOWS_SERVICE_ID}`;
}

export function startBackgroundService(entryFile: string): string {
  const windowsStatus = queryWindowsService();
  if (windowsStatus.installed) {
    const artifacts = getWindowsServiceArtifactPaths();
    const result = runWinSWCommand(artifacts.wrapperExePath, 'start');
    if (result.status !== 0) {
      const output = extractCommandOutput(result);
      throw new Error(output || 'Windows service start failed.');
    }

    const refreshed = queryWindowsService();
    return refreshed.running
      ? `Windows service is running. PID: ${refreshed.pid ?? 'unknown'}`
      : `Windows service start requested: ${WINDOWS_SERVICE_ID}`;
  }

  const status = getBackgroundProcessStatus(entryFile);
  if (status.running) {
    return `Service is already running. PID: ${status.pid}`;
  }

  const existing = findExistingBridgeProcess(entryFile);
  if (existing) {
    writePidFile(existing.pid);
    return `Service is already running. PID: ${existing.pid}`;
  }

  ensureServiceDirs();

  const stdoutFd = openSync(getStdoutLogPath(), 'a');
  const stderrFd = openSync(getStderrLogPath(), 'a');

  const child = spawn(process.execPath, [entryFile, 'start'], {
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
  });
  child.unref();

  writePidFile(child.pid ?? 0);
  logger.info('Background service started', { pid: child.pid });
  return `Service started. PID: ${child.pid}`;
}

export function stopBackgroundService(): string {
  const windowsStatus = queryWindowsService();
  if (windowsStatus.installed) {
    if (!windowsStatus.running) {
      return `Windows service is not running: ${WINDOWS_SERVICE_ID}`;
    }

    const artifacts = getWindowsServiceArtifactPaths();
    const result = runWinSWCommand(artifacts.wrapperExePath, 'stop');
    if (result.status !== 0) {
      const output = extractCommandOutput(result);
      throw new Error(output || 'Windows service stop failed.');
    }

    logger.info('Windows service stopped', { serviceId: WINDOWS_SERVICE_ID });
    return `Windows service stopped: ${WINDOWS_SERVICE_ID}`;
  }

  const pidFile = readPidFile();
  if (!pidFile) {
    return 'Service is not running.';
  }

  if (!isProcessRunning(pidFile.pid)) {
    removePidFile();
    return 'Service is not running.';
  }

  const stopped = stopProcess(pidFile.pid);
  if (!stopped) {
    return `Failed to stop service. PID: ${pidFile.pid}`;
  }

  removePidFile();
  logger.info('Background service stopped', { pid: pidFile.pid });
  return `Service stopped. PID: ${pidFile.pid}`;
}

export function restartBackgroundService(entryFile: string): string {
  const stopText = stopBackgroundService();
  const startText = startBackgroundService(entryFile);
  return `${stopText}\n${startText}`;
}

export function readServiceLogs(): string {
  const files = [getStdoutLogPath(), getStderrLogPath()];
  const windowsLogDir = getWindowsServiceArtifactPaths().logDir;

  if (existsSync(windowsLogDir)) {
    files.push(
      join(windowsLogDir, `${WINDOWS_SERVICE_WRAPPER_BASENAME}.out.log`),
      join(windowsLogDir, `${WINDOWS_SERVICE_WRAPPER_BASENAME}.err.log`),
      join(windowsLogDir, `${WINDOWS_SERVICE_WRAPPER_BASENAME}.wrapper.log`),
    );
  }

  const existingFiles = files.filter((file) => existsSync(file));
  if (existingFiles.length === 0) {
    return 'No service logs found.';
  }

  return existingFiles
    .map((file) => `== ${file} ==\n${tailLines(readFileSync(file, 'utf8'), 80) || '(empty)'}`)
    .join('\n\n');
}
