'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = require('./store');
const oc = require('./opencode');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const DEFAULT_MODEL = 'opencode/deepseek-v4.1-flash-free';

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid json'));
      }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function createApp({ cwd, model, auto }) {
  const exe = oc.resolveOpencode();
  const running = new Map(); // local session id -> child
  let modelsCache = null;
  let modelsAt = 0;

  async function getModels() {
    if (modelsCache && Date.now() - modelsAt < 5 * 60 * 1000) return modelsCache;
    try {
      const list = await oc.listModels(exe);
      modelsCache = list;
      modelsAt = Date.now();
      return list;
    } catch {
      return modelsCache || [];
    }
  }

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[1] === 'config' && req.method === 'GET') {
      const settings = store.readSettings();
      const models = await getModels();
      return json(res, 200, {
        cwd,
        model: model || settings.model || DEFAULT_MODEL,
        auto: typeof auto === 'boolean' ? auto : settings.auto !== false,
        models,
        defaultModel: DEFAULT_MODEL,
        opencode: exe || null,
        version: '1.0.0',
      });
    }

    if (parts[1] === 'models' && req.method === 'GET') {
      return json(res, 200, { models: await getModels() });
    }

    if (parts[1] === 'settings' && req.method === 'POST') {
      const body = await readBody(req);
      const patch = {};
      if (typeof body.model === 'string') patch.model = body.model;
      if (typeof body.auto === 'boolean') patch.auto = body.auto;
      return json(res, 200, store.writeSettings(patch));
    }

    if (parts[1] === 'sessions') {
      if (parts.length === 2 && req.method === 'GET') {
        return json(res, 200, { sessions: store.listSessions() });
      }
      if (parts.length === 2 && req.method === 'POST') {
        const body = await readBody(req);
        return json(res, 200, { session: store.createSession({ title: body.title, model: body.model }) });
      }

      const id = parts[2];
      if (parts.length === 3 && req.method === 'GET') {
        const session = store.readSession(id);
        if (!session) return json(res, 404, { error: 'گفتگو پیدا نشد' });
        return json(res, 200, { session });
      }
      if (parts.length === 3 && req.method === 'PATCH') {
        const body = await readBody(req);
        const session = store.readSession(id);
        if (!session) return json(res, 404, { error: 'گفتگو پیدا نشد' });
        if (typeof body.title === 'string' && body.title.trim()) session.title = body.title.trim().slice(0, 120);
        store.writeSession(session);
        return json(res, 200, { session });
      }
      if (parts.length === 3 && req.method === 'DELETE') {
        const run = running.get(id);
        if (run) {
          run.aborted = true;
          try { run.child.kill(); } catch { /* ignore */ }
          running.delete(id);
        }
        return json(res, 200, { ok: store.deleteSession(id) });
      }
    }

    if (parts[1] === 'abort' && req.method === 'POST') {
      const body = await readBody(req);
      const run = running.get(body.sessionId);
      if (run) {
        run.aborted = true;
        try { run.child.kill(); } catch { /* ignore */ }
        return json(res, 200, { ok: true });
      }
      return json(res, 200, { ok: false });
    }

    if (parts[1] === 'chat' && req.method === 'POST') {
      if (!exe) {
        return json(res, 500, {
          error: 'OpenCode پیدا نشد. مطمئن شوید opencode نصب و در PATH است، یا PCHAT_OPENCODE را تنظیم کنید.',
        });
      }
      return streamChat(req, res);
    }

    return json(res, 404, { error: 'not found' });
  }

  async function streamChat(req, res) {
    const body = await readBody(req);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return json(res, 400, { error: 'متن پیام خالی است' });

    const useModel = typeof body.model === 'string' && body.model ? body.model : (model || store.readSettings().model || DEFAULT_MODEL);
    const useAuto = typeof body.auto === 'boolean' ? body.auto : store.readSettings().auto !== false;

    let session = body.sessionId ? store.readSession(body.sessionId) : null;
    const isNew = !session;
    if (!session) session = store.createSession({ title: store.deriveTitle(message), model: useModel });

    // stop an earlier run for this session, if any
    const previous = running.get(session.id);
    if (previous) {
      previous.aborted = true;
      try { previous.child.kill(); } catch { /* ignore */ }
      running.delete(session.id);
    }

    const userMessage = { id: 'm_' + Date.now().toString(36), role: 'user', text: message, ts: Date.now() };
    session.messages.push(userMessage);
    if (session.title === store.DEFAULT_TITLE) session.title = store.deriveTitle(message);
    session.model = useModel;
    store.touch(session);

    res.writeHead(200, {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (obj) => {
      if (res.writableEnded) return;
      res.write(JSON.stringify(obj) + '\n');
    };

    send({ type: 'session', session: { id: session.id, title: session.title, ocSessionId: session.ocSessionId }, isNew, userMessage });

    const partTexts = new Map();
    const tools = new Map();
    const errors = [];
    let assistantText = '';
    let stepInfo = null;
    let sawAnyText = false;
    let ended = false;

    const buildText = () => {
      const chunks = [];
      for (const [, text] of partTexts) {
        if (text && text.trim()) chunks.push(text);
      }
      return chunks.join('\n\n').trim();
    };

    const run = { child: null, aborted: false };
    running.set(session.id, run);

    const finalize = (extra = {}) => {
      if (ended) return;
      ended = true;
      running.delete(session.id);
      assistantText = buildText() || assistantText;
      const toolList = [...tools.values()];
      const aborted = !!run.aborted || !!extra.aborted;
      const assistant = {
        id: 'm_' + Date.now().toString(36) + '_a',
        role: 'assistant',
        text: assistantText,
        tools: toolList,
        ts: Date.now(),
        cost: stepInfo && stepInfo.cost ? stepInfo.cost : 0,
        tokens: stepInfo && stepInfo.tokens ? stepInfo.tokens : null,
      };
      if (aborted) assistant.aborted = true;
      if (extra.error && !aborted) assistant.error = extra.error;
      session.messages.push(assistant);
      if (stepInfo && stepInfo.model) session.lastModel = stepInfo.model;
      store.touch(session);
      send({ type: 'saved', message: assistant, session: { id: session.id, title: session.title } });
      send({ type: 'done', aborted, cost: assistant.cost, tokens: assistant.tokens, error: assistant.error || null });
      if (!res.writableEnded) res.end();
    };

    res.on('close', () => {
      if (!ended) {
        run.aborted = true;
        if (run.child) {
          try { run.child.kill(); } catch { /* ignore */ }
        }
        finalize({ aborted: true });
      }
    });

    running.set(session.id, run);
    run.child = oc.runChat(
      {
        exe,
        cwd,
        message,
        model: useModel,
        sessionId: session.ocSessionId,
        auto: useAuto,
      },
      (evt) => {
        switch (evt.type) {
          case 'session': {
            if (!session.ocSessionId) {
              session.ocSessionId = evt.sessionID;
              store.writeSession(session);
              send({ type: 'session-id', ocSessionId: evt.sessionID });
            }
            break;
          }
          case 'text': {
            sawAnyText = true;
            partTexts.set(evt.partId || 'default', evt.text);
            send({ type: 'text', text: buildText(), partId: evt.partId });
            break;
          }
          case 'tool': {
            const prev = tools.get(evt.id) || {};
            const next = { ...prev, tool: evt.tool, status: evt.status, detail: evt.detail || prev.detail || '' };
            tools.set(evt.id, next);
            send({ type: 'tool', id: evt.id, tool: next.tool, status: next.status, detail: next.detail });
            break;
          }
          case 'step': {
            if (evt.phase === 'end') stepInfo = evt;
            break;
          }
          case 'error': {
            errors.push(evt.message);
            send({ type: 'error', code: evt.code, message: evt.message });
            break;
          }
          case 'exit': {
            if (run.aborted) {
              finalize({ aborted: true });
              break;
            }
            const failed = errors.length > 0 || (evt.code !== 0 && !sawAnyText);
            if (evt.code !== 0 && !sawAnyText && errors.length === 0 && evt.stderr) {
              const hint = evt.stderr.split(/\r?\n/).filter(Boolean).slice(-6).join('\n');
              if (hint) send({ type: 'log', message: hint });
            }
            finalize(failed ? { error: errors[errors.length - 1] || 'اجرای OpenCode با خطا تمام شد' } : {});
            break;
          }
          default:
            break;
        }
      }
    );

    if (run.child) {
      running.set(session.id, run);
    } else {
      // runChat never started; make sure the response is closed
      finalize({ error: 'اجرای OpenCode ممکن نشد' });
    }
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      handleApi(req, res, url).catch((err) => {
        if (!res.headersSent) json(res, 500, { error: err.message || 'internal error' });
        else res.end();
      });
      return;
    }
    serveStatic(req, res, decodeURIComponent(url.pathname));
  });

  server.on('close', () => {
    for (const run of running.values()) {
      run.aborted = true;
      try { if (run.child) run.child.kill(); } catch { /* ignore */ }
    }
    running.clear();
  });

  return { server, exe, getModels };
}

module.exports = { createApp, DEFAULT_MODEL };
