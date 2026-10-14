const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const config = require('../src/core/config');
const calls = { sdk: [], stream: [], https: [] };
const noop = () => {};
const logger = { info: noop, debug: noop, warn: noop, error: noop };
const unavailable = () => new Error('503 UNAVAILABLE');
const context = {
  module: { exports: {} }, process,
  setTimeout(callback, ms) { const timer = setTimeout(callback, ms); timer.unref(); return timer; },
  require(name) {
    if (name === '@google/genai') return { GoogleGenAI: class {
      constructor() { this.models = { generateContent: async request => { calls.sdk.push(request.model); throw unavailable(); } }; }
    } };
    if (name.includes('logger')) return { createServiceLogger: () => logger };
    if (name.includes('core/config')) return { get: key => config.get(key), getApiKey: () => 'test-key' };
    if (name.includes('prompt-loader')) return { promptLoader: {} };
    return require(name);
  },
};
vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/llm.service'), 'utf8'), context);
const service = context.module.exports;
service.delay = async () => {};
service.checkNetworkConnectivity = async () => ({ tests: [] });
service._streamRequestForModel = async (_request, model) => { calls.stream.push(model); throw unavailable(); };
service._executeAlternativeRequestForModel = async (_request, model) => { calls.https.push(model); throw unavailable(); };
(async () => {
  await assert.rejects(service.executeRequest({ contents: [] }));
  await assert.rejects(service.executeStreamingRequest({ contents: [] }, noop));
  await assert.rejects(service.executeAlternativeRequest({ contents: [] }));
  assert.equal((await service.testConnection()).success, false);
  for (const [path, models] of Object.entries(calls)) {
    assert(models.length > 0 && models.every(model => model === 'gemini-3.1-flash-lite'), path);
  }
  assert.equal(config.get('llm.gemini.fallbackEnabled'), false);
  console.log('PASS: SDK, streaming, HTTPS, and connection checks stay on Gemini 3.1 Flash Lite even after 503 failures');
})().catch(error => { console.error(error); process.exitCode = 1; });
