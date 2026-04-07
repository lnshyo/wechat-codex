import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WINDOWS_SERVICE_DISPLAY_NAME,
  WINDOWS_SERVICE_ID,
  buildWindowsServiceDefinition,
  getWindowsServiceArtifactPaths,
  isMatchingBridgeProcessCommand,
} from '../service.js';

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

test('buildWindowsServiceDefinition renders WinSW configuration for the bridge', () => {
  const definition = buildWindowsServiceDefinition({
    nodeExecutable: 'C:/Program Files/nodejs/node.exe',
    entryFile: 'E:/claude/CODEXclaw/dist/main.js',
    workingDirectory: 'E:/claude/CODEXclaw',
    logDirectory: 'C:/Users/lin_s/.wechat-codex/windows-service/logs',
    dataDirectory: 'C:/Users/lin_s/.wechat-codex',
    codexHome: 'C:/Users/lin_s/.codex',
    userProfile: 'C:/Users/lin_s',
    appData: 'C:/Users/lin_s/AppData/Roaming',
    localAppData: 'C:/Users/lin_s/AppData/Local',
    tempDirectory: 'C:/Users/lin_s/AppData/Local/Temp',
  });

  assert.match(definition.xml, new RegExp(`<id>${WINDOWS_SERVICE_ID}</id>`));
  assert.match(definition.xml, new RegExp(`<name>${WINDOWS_SERVICE_DISPLAY_NAME}</name>`));
  assert.match(definition.xml, /<executable>C:\/Program Files\/nodejs\/node\.exe<\/executable>/);
  assert.match(definition.xml, /&quot;E:\/claude\/CODEXclaw\/dist\/main\.js&quot; start/);
  assert.match(definition.xml, /<workingdirectory>E:\/claude\/CODEXclaw<\/workingdirectory>/);
  assert.match(definition.xml, /<logpath>C:\/Users\/lin_s\/\.wechat-codex\/windows-service\/logs<\/logpath>/);
  assert.match(definition.xml, /<env name="WCC_DATA_DIR" value="C:\/Users\/lin_s\/\.wechat-codex" \/>/);
  assert.match(definition.xml, /<env name="CODEX_HOME" value="C:\/Users\/lin_s\/\.codex" \/>/);
  assert.match(definition.xml, /<env name="USERPROFILE" value="C:\/Users\/lin_s" \/>/);
  assert.match(definition.xml, /<env name="HOME" value="C:\/Users\/lin_s" \/>/);
  assert.match(
    definition.xml,
    /<env name="APPDATA" value="C:\/Users\/lin_s\/AppData\/Roaming" \/>/,
  );
  assert.match(
    definition.xml,
    /<env name="LOCALAPPDATA" value="C:\/Users\/lin_s\/AppData\/Local" \/>/,
  );
  assert.match(
    definition.xml,
    /<env name="TEMP" value="C:\/Users\/lin_s\/AppData\/Local\/Temp" \/>/,
  );
  assert.match(
    definition.xml,
    /<env name="TMP" value="C:\/Users\/lin_s\/AppData\/Local\/Temp" \/>/,
  );
  assert.match(definition.xml, /<onfailure action="restart" delay="10 sec" \/>/);
});

test('getWindowsServiceArtifactPaths derives a stable wrapper layout', () => {
  const paths = getWindowsServiceArtifactPaths('C:/Users/lin_s/.wechat-codex');

  assert.equal(normalizePath(paths.homeDir), 'C:/Users/lin_s/.wechat-codex/windows-service');
  assert.equal(
    normalizePath(paths.wrapperBasePath),
    'C:/Users/lin_s/.wechat-codex/windows-service/wechat-codex-service',
  );
  assert.equal(
    normalizePath(paths.wrapperExePath),
    'C:/Users/lin_s/.wechat-codex/windows-service/wechat-codex-service.exe',
  );
  assert.equal(
    normalizePath(paths.wrapperXmlPath),
    'C:/Users/lin_s/.wechat-codex/windows-service/wechat-codex-service.xml',
  );
  assert.equal(normalizePath(paths.logDir), 'C:/Users/lin_s/.wechat-codex/windows-service/logs');
});

test('isMatchingBridgeProcessCommand matches the current bridge start command', () => {
  assert.equal(
    isMatchingBridgeProcessCommand(
      'E:\\nodejs\\node.exe E:\\claude\\CODEXclaw\\dist\\main.js start',
      'E:/claude/CODEXclaw/dist/main.js',
    ),
    true,
  );
});

test('isMatchingBridgeProcessCommand ignores unrelated node commands', () => {
  assert.equal(
    isMatchingBridgeProcessCommand(
      'E:\\nodejs\\node.exe E:\\claude\\CODEXclaw\\dist\\main.js service status',
      'E:/claude/CODEXclaw/dist/main.js',
    ),
    false,
  );
  assert.equal(
    isMatchingBridgeProcessCommand(
      'E:\\nodejs\\node.exe E:\\other\\project\\dist\\main.js start',
      'E:/claude/CODEXclaw/dist/main.js',
    ),
    false,
  );
});
