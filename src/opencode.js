'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

/**
 * Locate the OpenCode executable. Prefers the real .exe (no shell quoting
 * problems, and Persian text is passed as a proper argv element).
 */
function resolveOpencode() {
  const fromEnv = process.env.PCHAT_OPENCODE;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const appdata = process.env.APPDATA || '';
  const candidates = [
    path.join(appdata, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
    path.join(appdata, 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode'),
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'opencode', 'opencode.exe'),
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, 'opencode' + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* keep looking */
      }
    }
  }
  return null;
}

/** Run `opencode models` and return the list of ids. */
function listModels(exe, { timeout = 45000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!exe) return reject(new Error('opencode executable was not found'));
    const child = spawn(exe, ['models'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const models = out
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[\w.@-]+\/[\w.@#:/+-]+$/.test(line));
      if (models.length) return resolve([...new Set(models)]);
      reject(new Error(err.trim() || `opencode models exited with code ${code}`));
    });
  });
}

function summarizeTool(part) {
  const input = (part.state && part.state.input) || {};
  const pick = (...keys) => {
    for (const key of keys) {
      if (typeof input[key] === 'string' && input[key].trim()) return input[key].trim();
    }
    return '';
  };
  switch (part.tool) {
    case 'read':
    case 'write':
    case 'edit':
    case 'patch':
      return pick('path', 'filePath', 'file');
    case 'shell':
    case 'bash':
      return pick('command', 'cmd');
    case 'list':
    case 'glob':
    case 'grep':
      return pick('path', 'pattern', 'query');
    case 'webfetch':
      return pick('url');
    case 'websearch':
      return pick('query');
    default:
      return pick('path', 'query', 'url', 'command', 'name');
  }
}

function safeJson(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Spawn one chat turn. Returns the child process.
 * `onEvent` receives normalized events:
 *   {type:'session', sessionID}
 *   {type:'text', partId, text}
 *   {type:'tool', id, tool, status, detail}
 *   {type:'step', phase, reason, cost, tokens}
 *   {type:'error', code, message}
 *   {type:'exit', code, stderr}
 */
function runChat(opts, onEvent) {
  const { exe, cwd, message, model, sessionId, auto } = opts;

  const args = ['run', '--format', 'json'];
  if (model) args.push('-m', model);
  if (sessionId) args.push('-s', sessionId);
  if (auto) args.push('--auto');
  args.push('--', message);

  const child = spawn(exe, args, {
    cwd: cwd || process.cwd(),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });

  let buffer = '';
  let stderr = '';
  let sawSession = false;
  let finished = false;

  const handleLine = (raw) => {
    const line = raw.trim();
    if (!line) return;
    const evt = safeJson(line);
    if (!evt) {
      onEvent({ type: 'log', message: line.slice(0, 2000) });
      return;
    }

    if (!sawSession && evt.sessionID) {
      sawSession = true;
      onEvent({ type: 'session', sessionID: evt.sessionID });
    }

    switch (evt.type) {
      case 'text': {
        const part = evt.part || {};
        if (part.type === 'text' && typeof part.text === 'string') {
          onEvent({ type: 'text', partId: part.id, text: part.text });
        } else if (part.type === 'reasoning') {
          onEvent({ type: 'reasoning', partId: part.id, text: part.text || '' });
        }
        break;
      }
      case 'tool_use':
      case 'tool': {
        const part = evt.part || {};
        onEvent({
          type: 'tool',
          id: part.id || part.partID,
          tool: part.tool || 'tool',
          status: (part.state && part.state.status) || 'running',
          detail: summarizeTool(part),
        });
        break;
      }
      case 'step_finish': {
        const part = evt.part || {};
        onEvent({
          type: 'step',
          phase: 'end',
          reason: part.reason || '',
          cost: part.cost || 0,
          tokens: part.tokens || null,
        });
        break;
      }
      case 'error': {
        const err = evt.error || {};
        onEvent({
          type: 'error',
          code: err.type || 'error',
          message: err.message || (typeof err === 'string' ? err : 'Unknown error'),
        });
        break;
      }
      default:
        break;
    }
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      handleLine(line);
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 30000) stderr = stderr.slice(-30000);
  });

  const finish = (code) => {
    if (finished) return;
    finished = true;
    if (buffer.trim()) handleLine(buffer);
    onEvent({ type: 'exit', code, stderr });
  };

  child.on('error', (err) => onEvent({ type: 'error', code: 'spawn', message: err.message }));
  child.on('close', (code) => finish(code));
  child.on('exit', (code) => finish(code));

  return child;
}

module.exports = { resolveOpencode, listModels, runChat };
