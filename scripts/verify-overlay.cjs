const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { app, BrowserWindow, ipcMain } = require('electron');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function verifyMovement() {
  const fakeDisplay = { id: 1, workArea: { x: 0, y: 0, width: 1200, height: 800 } };
  let cursor = { x: 100, y: 100 };
  const context = { module: { exports: {} }, setTimeout, setInterval, clearInterval,
    process, console, require(name) {
      if (name === 'electron') return { screen: {
        getPrimaryDisplay: () => fakeDisplay, getDisplayMatching: () => fakeDisplay,
        getCursorScreenPoint: () => cursor,
      } };
      if (name.includes('logger')) return { createServiceLogger: () => ({ debug() {}, info() {}, warn() {}, error() {} }) };
      if (name.includes('config')) return { get() {} };
      return require(name);
    } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'src/managers/window.manager.js'), 'utf8'), context);
  const manager = context.module.exports;
  manager.shortcutOnlyMode = false;
  manager.bindWindows = true;
  const fakeWindow = (x, y, width, height) => ({
    position: [x, y], size: [width, height],
    getPosition() { return this.position; }, getSize() { return this.size; },
    setPosition(x, y) { this.position = [x, y]; },
    getBounds() { return { x: this.position[0], y: this.position[1], width: this.size[0], height: this.size[1] }; },
    isDestroyed() { return false; },
  });
  const toolbar = fakeWindow(300, 20, 520, 42);
  const answer = fakeWindow(300, 72, 840, 1400);
  manager.windows.set('main', toolbar);
  manager.windows.set('llmResponse', answer);
  manager.positionBoundWindows();
  manager.moveBoundWindows(30, 350);
  assert.equal(toolbar.position[1], 370, 'A tall answer must not pin the toolbar to the top');
  const chosen = [...toolbar.position];
  toolbar.size[1] = 210;
  manager.positionBoundWindows();
  assert.deepEqual(toolbar.position, chosen, 'Opening a dropdown preserves toolbar position');
  toolbar.size[1] = 42;
  manager.positionBoundWindows();
  assert.deepEqual(toolbar.position, chosen, 'Closing a dropdown preserves toolbar position');
  manager.moveBoundWindows(0, -1000);
  assert.equal(toolbar.position[1], -630, 'Free placement must not snap to a display edge');
  manager.moveBoundWindows(0, 2000);
  assert.equal(toolbar.position[1], 1370);
  const dragOrigin = [...toolbar.position];
  manager.beginMainWindowDrag();
  cursor = { x: 135, y: 185 };
  manager.updateMainWindowDrag();
  manager.updateMainWindowDrag();
  assert.deepEqual(toolbar.position, [dragOrigin[0] + 35, dragOrigin[1] + 85], 'Repeated pointer updates must not accumulate movement');
  manager.endMainWindowDrag();
  manager.trackActiveScreen();
  assert.deepEqual(toolbar.position, [dragOrigin[0] + 35, dragOrigin[1] + 85]);
  console.log('PASS: absolute desktop-pointer dragging, no edge snapping or monitor recentering');
}

app.whenReady().then(async () => {
  verifyMovement();
  let window;
  const moves = [];
  const saved = [];
  const settings = { codingLanguage: 'cpp', activeSkill: 'dsa', stealthEnabled: true, shortcutOnlyMode: false };
  const handlers = {
    'get-settings': () => settings,
    'get-window-stats': () => ({ isInteractive: true }),
    'get-speech-availability': () => ({ available: false }),
    'save-settings': (_event, data) => { saved.push(data); return { success: true }; },
    'resize-window': (_event, data) => { window.setContentSize(data.width, data.height); return { success: true }; },
    'move-window': (_event, data) => { moves.push(data); return { success: true }; },
    'begin-window-drag': () => { moves.push('begin'); },
    'update-window-drag': () => { moves.push('update'); },
    'end-window-drag': () => { moves.push('end'); },
    'resize-llm-window-for-content': (_event, data) => { window.setSize(1200, Math.min(720, data.height)); return { success: true }; },
    'get-first-run-status': () => ({ geminiConfigured: true, needsOnboarding: false }),
    'detect-whisper': () => ({ installed: false }),
  };
  Object.entries(handlers).forEach(([name, handler]) => ipcMain.handle(name, handler));
  window = new BrowserWindow({ show: false, width: 520, height: 42, frame: false, transparent: true, backgroundColor: '#00000000', resizable: false,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true } });
  window.setContentProtection(true);
  if (process.platform === 'win32') {
    const handle = window.getNativeWindowHandle().readBigUInt64LE();
    const command = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class OverlayAffinity { [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity); }'; [uint32]$affinity = 0; [OverlayAffinity]::GetWindowDisplayAffinity([IntPtr]::new([int64]${handle}), [ref]$affinity) | Out-Null; Write-Output $affinity`;
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    const affinity = require('node:child_process').execFileSync(powershell, ['-NoProfile', '-Command', command], { windowsHide: true }).toString().trim();
    assert.equal(affinity, '17', 'The window must use Windows exclusion from capture');
    console.log('PASS: Windows capture exclusion flag is set');
  }
  await window.loadFile(path.join(root, 'index.html'));
  await delay(500);
  const initial = await window.webContents.executeJavaScript(`({
    nativeHidden: getComputedStyle(document.getElementById('codingLanguage')).display === 'none',
    cursors: [...document.querySelectorAll('.command-item, button, select, span')].every(el => getComputedStyle(el).cursor === 'default'),
    titles: document.querySelectorAll('[title]').length,
    fits: document.querySelector('.command-tab').getBoundingClientRect().width <= innerWidth,
    initialLanguage: document.querySelector('.protected-select-trigger').textContent
  })`);
  assert.deepEqual(initial, { nativeHidden: true, cursors: true, titles: 0, fits: true, initialLanguage: 'C++' });
  const position = window.getPosition();
  await window.webContents.executeJavaScript(`document.querySelector('.protected-select-trigger').click()`);
  await delay(250);
  const open = await window.webContents.executeJavaScript(`({
    inside: document.querySelector('.protected-select-menu').parentElement === document.body,
    visible: !document.querySelector('.protected-select-menu').hidden,
    fits: document.querySelector('.protected-select-menu').getBoundingClientRect().bottom <= innerHeight,
    options: document.querySelectorAll('.protected-select-option').length
  })`);
  assert.deepEqual(open, { inside: true, visible: true, fits: true, options: 5 });
  const image = await window.webContents.capturePage();
  const bitmap = image.getBitmap();
  const size = image.getSize();
  assert.equal(bitmap[((size.height - 3) * size.width + 3) * 4 + 3], 0, 'Unused area below the toolbar must stay transparent');
  console.log('PASS: expanded toolbar has no opaque blue backdrop');
  assert.deepEqual(window.getPosition(), position);
  await window.webContents.executeJavaScript(`document.querySelectorAll('.protected-select-option')[2].click()`);
  await delay(200);
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('codingLanguage').value`), 'python');
  assert(saved.some(value => value.codingLanguage === 'python'));
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.protected-select-menu').hidden`), true);
  await window.webContents.executeJavaScript(`document.getElementById('codingLanguage').value = 'java'`);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('.protected-select-trigger').textContent`), 'Java');
  await window.webContents.executeJavaScript(`
    // Hidden test windows do not receive compositor frames.
    window.requestAnimationFrame = callback => setTimeout(callback, 0);
    window.cancelAnimationFrame = clearTimeout;
    const grip = document.getElementById('toolbarDragHandle');
    grip.setPointerCapture = () => {};
    grip.dispatchEvent(new PointerEvent('pointerdown', { button: 0, screenX: 100, screenY: 100 }));
    grip.dispatchEvent(new PointerEvent('pointermove', { screenX: 135, screenY: 185 }));
    document.getElementById('infoButton').dispatchEvent(new MouseEvent('mouseenter'));
  `);
  await delay(50);
  await window.webContents.executeJavaScript(`document.getElementById('toolbarDragHandle').dispatchEvent(new PointerEvent('pointerup'))`);
  await delay(50);
  assert(moves.includes('begin') && moves.includes('update') && moves.includes('end'));
  assert.equal(await window.webContents.executeJavaScript(`document.getElementById('shortcutsPopover').classList.contains('is-open')`), false);
  console.log('PASS: protected in-window language list, selection persistence, arrow cursor, no hover text, drag handle');

  await window.loadFile(path.join(root, 'settings.html'));
  await delay(300);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('select:not(.protected-native-select)').length`), 0);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[title], img:not([alt=""])').length`), 0);
  await window.webContents.executeJavaScript(`document.getElementById('codingLanguage').previousElementSibling.click()`);
  assert.equal(await window.webContents.executeJavaScript(`!document.getElementById('codingLanguage-options').hidden`), true);
  console.log('PASS: settings dropdowns also remain inside their protected window');
  settings.shortcutOnlyMode = true;
  await window.loadFile(path.join(root, 'llm-response.html'));
  await delay(200);
  await window.webContents.executeJavaScript(`window.requestAnimationFrame = callback => setTimeout(callback, 0); window.cancelAnimationFrame = clearTimeout; void 0;`);
  window.webContents.send('display-llm-response', { content: 'A compact answer.\n\n```cpp\n' + Array.from({ length: 45 }, (_, i) => `// code line ${i + 1}`).join('\n') + '\n```' });
  await delay(500);
  const answerLayout = await window.webContents.executeJavaScript(`({
    shortcutOnly: document.body.classList.contains('shortcut-only'),
    closeHidden: getComputedStyle(document.querySelector('.window-controls')).display === 'none',
    codeFits: document.querySelector('.code-panel .panel-content').scrollHeight <= document.querySelector('.code-panel .panel-content').clientHeight + 1,
    fontSize: parseFloat(getComputedStyle(document.querySelector('.code-content code')).fontSize)
  })`);
  assert(answerLayout.shortcutOnly && answerLayout.closeHidden && answerLayout.codeFits && answerLayout.fontSize >= 10, JSON.stringify(answerLayout));
  assert.equal(window.isResizable(), false);
  console.log('PASS: shortcut-only answer fits 45 code lines without scrolling or resize borders');
  window.destroy();
  app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
