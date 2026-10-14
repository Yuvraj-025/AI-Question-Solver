const assert = require('node:assert/strict');

(async () => {
  const targets = await (await fetch('http://127.0.0.1:9233/json/list')).json();
  const socket = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const requests = new Map();
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (requests.has(message.id)) {
      requests.get(message.id)(message);
      requests.delete(message.id);
    }
  });
  async function evaluate(expression) {
    const id = ++nextId;
    const result = new Promise(resolve => requests.set(id, resolve));
    socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: {
      expression, awaitPromise: true, returnByValue: true,
    } }));
    const message = await result;
    if (message.error || message.result.exceptionDetails) throw new Error(JSON.stringify(message.error || message.result.exceptionDetails));
    return message.result.result.value;
  }
  const code = 'A compact explanation.\n\n```cpp\n' + Array.from({ length: 45 }, (_, i) => `// code line ${i + 1}`).join('\n') + '\n```';
  const layoutExpression = `({
    shortcutOnly: document.body.classList.contains('shortcut-only'),
    codeFits: document.querySelector('.code-panel .panel-content').scrollHeight <= document.querySelector('.code-panel .panel-content').clientHeight + 1,
    codeHeight: document.querySelector('.code-panel .panel-content').scrollHeight,
    availableHeight: document.querySelector('.code-panel .panel-content').clientHeight,
    fontSize: getComputedStyle(document.querySelector('.code-content code')).fontSize,
    seeThrough: getComputedStyle(document.querySelector('.main-container')).backgroundColor.startsWith('rgba('),
    buttonsHidden: getComputedStyle(document.querySelector('.window-controls')).display === 'none'
  })`;
  const result = await evaluate(`(async () => {
    const manager = process.mainModule.require('./src/managers/window.manager');
    const electron = process.mainModule.require('electron');
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    for (let attempt = 0; attempt < 100 && !manager.getWindow('main')?.isVisible(); attempt++) await delay(100);
    const startupVisible = manager.getWindow('main').isVisible();
    manager.setShortcutOnlyMode(false);
    await delay(500);
    const main = manager.getWindow('main');
    const settings = await main.webContents.executeJavaScript("window.electronAPI.getSettings().then(s => ({ skill: s.activeSkill, language: s.codingLanguage }))");
    await main.webContents.executeJavaScript("document.querySelector('.protected-select-trigger').click(); void 0;");
    await delay(200);
    const [x, y] = main.getPosition();
    for (let i = 1; i <= 12; i++) {
      manager.moveMainWindowTo(x + i * 7, y + i * 9);
      await delay(20);
    }
    const actualPosition = main.getPosition();
    const image = await main.webContents.capturePage();
    const size = image.getSize();
    const alpha = image.getBitmap()[((size.height - 3) * size.width + 3) * 4 + 3];
    const mainBackground = main.getBackgroundColor();
    manager.setShortcutOnlyMode(true);
    manager.dismissOverlay();
    manager.showLLMLoading();
    manager.showLLMResponse(${JSON.stringify(code)});
    await delay(800);
    const answer = manager.getWindow('llmResponse');
    const layout = await answer.webContents.executeJavaScript(${JSON.stringify(layoutExpression)});
    const handle = answer.getNativeWindowHandle().readBigUInt64LE().toString();
    const shortcuts = ['CommandOrControl+Shift+S', 'CommandOrControl+Shift+Q'].map(key => electron.globalShortcut.isRegistered(key));
    const answerVisible = answer.isVisible();
    manager.dismissOverlay();
    manager.showLLMResponse('This late response must stay dismissed.');
    return { startupVisible, settings, mainBackground, blankAlpha: alpha,
      expectedPosition: [x + 84, y + 108], actualPosition,
      layout, nativeAnswerHandle: handle, shortcuts, answerVisible,
      answerResizable: answer.isResizable(), dismissedStaysHidden: !answer.isVisible(),
      toolbarVisible: main.isVisible() };
  })()`);
  console.log(JSON.stringify(result, null, 2));
  assert(result.startupVisible && result.toolbarVisible);
  assert.equal(result.settings.skill, 'dsa');
  assert.equal(result.blankAlpha, 0);
  assert.deepEqual(result.actualPosition, result.expectedPosition);
  assert(result.layout.shortcutOnly && result.layout.codeFits && result.layout.seeThrough && result.layout.buttonsHidden);
  assert(result.shortcuts.every(Boolean) && result.answerVisible && !result.answerResizable && result.dismissedStaysHidden);
  console.log('PASS: the running packaged app has no blue backing area after movement, fits code, and dismisses the answer');
  const fixtureHtml = '<html><body style="background:white;color:black;font:20px sans-serif;padding:24px"><h2>LeetCode 877: Stone Game</h2><p>Alice and Bob take turns choosing the leftmost or rightmost pile of stones. Alice starts. Both play optimally.</p><p>There are an even number of piles. Each pile is positive, and the total number of stones is odd. Return whether Alice wins.</p><p>Provide the complete C++ Solution class with bool stoneGame(vector&lt;int&gt;&amp; piles).</p></body></html>';
  const generated = await evaluate(`(async () => {
    const electron = process.mainModule.require('electron');
    const manager = process.mainModule.require('./src/managers/window.manager');
    const service = process.mainModule.require('./src/services/llm.service');
    const fixture = new electron.BrowserWindow({ show: false, width: 900, height: 420, webPreferences: { backgroundThrottling: false } });
    fixture.setContentProtection(true);
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(fixtureHtml)}));
    fixture.showInactive();
    await new Promise(resolve => setTimeout(resolve, 250));
    const image = (await fixture.webContents.capturePage()).toPNG();
    fixture.destroy();
    const settings = await manager.getWindow('main').webContents.executeJavaScript("window.electronAPI.getSettings().then(s => ({ skill: s.activeSkill, language: s.codingLanguage }))");
    const answer = await service.processImageWithSkillStream(image, 'image/png', settings.skill, [], settings.language);
    return { hasCode: answer.response.includes('stoneGame') && answer.response.includes('class Solution') && answer.response.includes('\\u0060\\u0060\\u0060'), language: settings.language, skill: settings.skill };
  })()`);
  assert(generated.hasCode && generated.skill === 'dsa');
  console.log('PASS: a real Gemini screenshot request returned complete Stone Game code in ' + generated.language);
  const languagePersistence = await evaluate(`(async () => {
    const main = process.mainModule.require('./src/managers/window.manager').getWindow('main');
    const result = await main.webContents.executeJavaScript("(async () => { const previous = (await window.electronAPI.getSettings()).codingLanguage; await window.electronAPI.saveSettings({ codingLanguage: 'python' }); const changed = (await window.electronAPI.getSettings()).codingLanguage; await window.electronAPI.saveSettings({ codingLanguage: previous }); return { previous, changed }; })()");
    return { changed: result.changed, restored: process.env.CODING_LANGUAGE === result.previous };
  })()`);
  assert(languagePersistence.changed === 'python' && languagePersistence.restored);
  console.log('PASS: language selection updates and persists while keeping the previous choice');
  socket.close();
})().catch(error => { console.error(error); process.exit(1); });
