#!/usr/bin/env node
/* Glasswing Provider Dashboard — auto-sets custom providers into BOTH
   ~/.openclaw/openclaw.json (models.providers) AND
   ~/.openclaw/agents/main/agent/models.json (providers)
   Zero npm deps. Node 24.
*/
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8332;
const HOME = process.env.HOME || '/home/ubuntu';
const MAIN = path.join(HOME, '.openclaw/openclaw.json');
const AGENT = path.join(HOME, '.openclaw/agents/main/agent/models.json');
const LOGF = path.join(__dirname, 'dashboard.log');
const UA = 'glasswing-provider-dashboard/1.0';

const log = (level, msg) => {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}\n`;
  try { fs.appendFileSync(LOGF, line); } catch {}
  process.stdout.write(line);
};

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJson = (p, d) => {
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2) + '\n');
  fs.renameSync(tmp, p);
};
const backup = (p) => {
  try {
    const b = p + '.bak-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 15);
    fs.copyFileSync(p, b);
    return b;
  } catch { return null;
  }
};
const mask = (k) => (k && k.length > 12 ? k.slice(0, 8) + '…' + k.slice(-4) : '••••');

const getProviders = (p) => {
  const d = readJson(p);
  return (d.models && d.models.providers) || d.providers || null;
};

const providerView = (p, provs) => Object.entries(provs).map(([id, v]) => ({
  id,
  baseUrl: v.baseUrl || null,
  apiKey: v.apiKey ? mask(v.apiKey) : null,
  api: v.api || null,
  models: (v.models || []).map(m => ({
    id: m.id, ctx: m.contextWindow || null, maxTokens: m.maxTokens || null
  })),
}));

const sendJson = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
};

const readBody = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
  req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
});

const httpReq = (url, headers, body, timeoutMs) => new Promise((resolve) => {
  const u = new URL(url);
  const mod = u.protocol === 'https:' ? require('https') : require('http');
  const req = mod.request({
    hostname: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80),
    path: u.pathname + u.search, method: 'POST', headers,
  }, (res) => {
    let d = '';
    res.on('data', c => d += c);
    res.on('end', () => resolve({ status: res.statusCode, body: d }));
  });
  req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
  req.on('error', e => resolve({ status: 0, body: String(e.message || e) }));
  req.end(body);
});

const gwHealth = async () => {
  try {
    const r = await new Promise((resolve) => {
      const q = require('http').request({ hostname: '127.0.0.1', port: 18789, path: '/health', method: 'GET' }, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => resolve({ status: res.statusCode, body: d }));
      });
      q.setTimeout(4000, () => q.destroy(new Error('timeout')));
      q.on('error', e => resolve({ status: 0, body: String(e.message || e) }));
      q.end();
    });
    return r.status === 200 ? 'live' : 'HTTP ' + r.status;
  } catch (e) { return 'unreachable'; }
};

const { execFile } = require('child_process');
const gwRestart = () => new Promise((resolve) => {
  execFile('openclaw', ['gateway', 'restart'], { timeout: 30000 }, (err, so, se) =>
    resolve(err ? 'failed: ' + String(se || err.message).slice(0, 200) : 'ok'));
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  try {
    if (req.method === 'GET' && (u.pathname === '/' || u.pathname === '/index.html')) {
      const html = fs.readFileSync(path.join(__dirname, 'index.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(html);
    }
    if (req.method === 'GET' && u.pathname === '/api/status') {
      const mainProvs = getProviders(MAIN) || {};
      const agentProvs = getProviders(AGENT) || {};
      const mismatch = [];
      for (const id of new Set([...Object.keys(mainProvs), ...Object.keys(agentProvs)])) {
        const a = mainProvs[id] && mainProvs[id].apiKey;
        const b = agentProvs[id] && agentProvs[id].apiKey;
        if (a !== b) mismatch.push(id);
      }
      return sendJson(res, 200, {
        gateway: await gwHealth(),
        mainProviders: Object.keys(mainProvs),
        agentProviders: Object.keys(agentProvs),
        keyMismatch: mismatch,
      });
    }
    if (req.method === 'GET' && u.pathname === '/api/providers') {
      return sendJson(res, 200, {
        main: providerView(MAIN, getProviders(MAIN)),
        agent: providerView(AGENT, getProviders(AGENT)),
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/test') {
      const b = await readBody(req);
      const baseUrl = String(b.baseUrl || '').trim();
      const apiKey = String(b.apiKey || '').trim();
      const model = String(b.modelId || '').trim();
      const api = String(b.api || 'openai-completions').trim();
      if (!/^https?:\/\//.test(baseUrl)) return sendJson(res, 400, { ok: false, error: 'base URL must start with http(s)://' });
      if (!apiKey) return sendJson(res, 400, { ok: false, error: 'API key required' });
      if (!model) return sendJson(res, 400, { ok: false, error: 'model id required' });
      log('INFO', `test: ${baseUrl} model=${model} key=${mask(apiKey)}`);
      const url = baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      if (api === 'anthropic-messages') headers['x-api-key'] = apiKey;
      const body = JSON.stringify({
        model, max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }],
      });
      const t0 = Date.now();
      const r = await httpReq(url, headers, body, 25000);
      const ms = Date.now() - t0;
      log(r.status === 200 ? 'INFO' : 'ERROR', `test result: HTTP ${r.status} in ${ms}ms :: ${r.body.slice(0, 300)}`);
      return sendJson(res, 200, { ok: r.status === 200, status: r.status, ms, body: r.body.slice(0, 2000) });
    }
    if (req.method === 'POST' && u.pathname === '/api/add') {
      const b = await readBody(req);
      const id = String(b.id || '').trim();
      const baseUrl = String(b.baseUrl || '').trim();
      const apiKey = String(b.apiKey || '').trim();
      const modelId = String(b.modelId || '').trim();
      const api = String(b.api || 'openai-completions').trim();
      const ctx = parseInt(b.ctx, 10) || 200000;
      const maxTok = parseInt(b.maxTokens, 10) || 8192;
      const errors = [];
      if (!/^[a-z0-9][a-z0-9._-]{0,49}$/i.test(id)) errors.push('provider id: lowercase letters/digits/._- only, max 50');
      if (!/^https?:\/\//.test(baseUrl)) errors.push('base URL must start with http(s)://');
      if (!apiKey) errors.push('API key required');
      if (!modelId) errors.push('model id required');
      if (errors.length) { log('ERROR', 'add rejected: ' + errors.join('; ')); return sendJson(res, 400, { ok: false, errors }); }

      // pre-flight: live key/model test BEFORE touching config
      const testUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
      const testHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey };
      if (api === 'anthropic-messages') testHeaders['x-api-key'] = apiKey;
      const t0 = Date.now();
      const tr = await httpReq(testUrl, testHeaders, JSON.stringify({
        model: modelId, max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }],
      }), 60000);
      const testMs = Date.now() - t0;
      let testOk = tr.status === 200;
      if (testOk) { try { testOk = !!(JSON.parse(tr.body).choices || []).length; } catch { testOk = false; } }
      if (!testOk) {
        log('ERROR', `add aborted (test failed): ${baseUrl} model=${modelId} HTTP ${tr.status} in ${testMs}ms`);
        return sendJson(res, 400, { ok: false, errors: [`live test failed: HTTP ${tr.status} in ${testMs}ms — config untouched`, tr.body.slice(0, 300)] });
      }
      log('INFO', `add pre-test passed: ${baseUrl} model=${modelId} in ${testMs}ms`);

      const block = {
        baseUrl, apiKey,
        auth: 'api-key',
        api,
        timeoutSeconds: 300,
        models: [{
          id: modelId, name: modelId, input: ['text'],
          contextWindow: ctx, reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          maxTokens: maxTok, api,
        }],
      };
      const b1 = backup(MAIN);
      const b2 = backup(AGENT);
      const d1 = readJson(MAIN);
      const d2 = readJson(AGENT);
      const p1 = (d1.models && d1.models.providers) || (d1.models = {}, d1.models.providers = {});
      const p2 = (d2.providers) || (d2.providers = {});
      p1[id] = JSON.parse(JSON.stringify(block));
      p2[id] = JSON.parse(JSON.stringify(block));
      // wildcard allowlist — new models on this provider auto-allowed
      const wlKey = id + '/*';
      const ag = d1.agents || (d1.agents = {});
      const agDef = ag.defaults || (ag.defaults = {});
      const agModels = agDef.models || (agDef.models = {});
      const isNew = !(wlKey in agModels);
      agModels[wlKey] = {};
      writeJson(MAIN, d1);
      writeJson(AGENT, d2);
      log('INFO', `provider "${id}" written + allowlist "${wlKey}" ${isNew ? 'added' : 'kept'} (backups: ${b1}, ${b2})`);
      // nudge gateway hot-reload (config file watcher)
      try { fs.utimesSync(MAIN, new Date(), new Date()); } catch {}
      // restart gateway so allowlist/provider load immediately
      const rst = await gwRestart();
      await sleep(3000);
      const gw = await gwHealth();
      return sendJson(res, 200, {
        ok: true, gateway: gw, restart: rst, backups: [b1, b2],
        test: { ms: testMs },
        allowlist: wlKey,
        note: 'Tested live, written to both files, wildcard allowlist added, gateway restarted. /model ' + id + '/' + modelId + ' ready.',
      });
    }
    if (req.method === 'POST' && u.pathname === '/api/remove') {
      const b = await readBody(req);
      const id = String(b.id || '').trim();
      if (!id) return sendJson(res, 400, { ok: false, errors: ['id required'] });
      const b1 = backup(MAIN);
      const b2 = backup(AGENT);
      const d1 = readJson(MAIN);
      const d2 = readJson(AGENT);
      const p1 = (d1.models && d1.models.providers) || {};
      const p2 = d2.providers || {};
      const r1 = id in p1 ? (delete p1[id], true) : false;
      const r2 = id in p2 ? (delete p2[id], true) : false;
      if (!r1 && !r2) return sendJson(res, 404, { ok: false, errors: [`provider "${id}" not found in either file`] });
      // clean wildcard allowlist entry too
      let wlRemoved = false;
      if (d1.agents && d1.agents.defaults && d1.agents.defaults.models && (id + '/*') in d1.agents.defaults.models) {
        delete d1.agents.defaults.models[id + '/*'];
        wlRemoved = true;
      }
      writeJson(MAIN, d1);
      writeJson(AGENT, d2);
      log('INFO', `provider "${id}" removed (main=${r1}, agent=${r2}, allowlist=${wlRemoved})`);
      // restart gateway so removal takes effect
      const rst = await gwRestart();
      await sleep(3000);
      const gw = await gwHealth();
      return sendJson(res, 200, { ok: true, removed: { main: r1, agent: r2, allowlist: wlRemoved }, restart: rst, gateway: gw, backups: [b1, b2] });
    }
    if (req.method === 'GET' && u.pathname === '/api/log') {
      let lines = [];
      try { lines = fs.readFileSync(LOGF, 'utf8').trim().split('\n').slice(-120); } catch {}
      return sendJson(res, 200, { lines });
    }
    if (req.method === 'POST' && u.pathname === '/api/reload') {
      log('INFO', 'reload nudge requested');
      try { fs.utimesSync(MAIN, new Date(), new Date()); } catch {}
      await sleep(1500);
      const gw = await gwHealth();
      return sendJson(res, 200, { ok: true, gateway: gw });
    }
    return sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    log('ERROR', `handler ${req.method} ${u.pathname} failed: ${e.stack || e}`);
    return sendJson(res, 500, { ok: false, error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => log('INFO', `dashboard listening on 0.0.0.0:${PORT}`));