'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const DATA_DIR = process.env.PCHAT_DATA_DIR || path.join(os.homedir(), '.pchat');
const SESSION_DIR = path.join(DATA_DIR, 'sessions');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

const DEFAULT_TITLE = 'گفتگوی جدید';

function ensureDirs() {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

function id(prefix) {
  return prefix + crypto.randomBytes(9).toString('hex');
}

function fileFor(sessionId) {
  return path.join(SESSION_DIR, `${sessionId}.json`);
}

function readSession(sessionId) {
  try {
    const raw = fs.readFileSync(fileFor(sessionId), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeSession(session) {
  ensureDirs();
  const tmp = fileFor(session.id) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8');
  fs.renameSync(tmp, fileFor(session.id));
  return session;
}

function listSessions() {
  ensureDirs();
  const items = [];
  for (const name of fs.readdirSync(SESSION_DIR)) {
    if (!name.endsWith('.json')) continue;
    try {
      const session = JSON.parse(fs.readFileSync(path.join(SESSION_DIR, name), 'utf8'));
      if (!session || !session.id) continue;
      items.push({
        id: session.id,
        title: session.title || DEFAULT_TITLE,
        createdAt: session.createdAt || 0,
        updatedAt: session.updatedAt || 0,
        model: session.model || '',
        messageCount: Array.isArray(session.messages) ? session.messages.length : 0,
      });
    } catch {
      /* skip a corrupt file */
    }
  }
  return items.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function createSession({ title, model } = {}) {
  const now = Date.now();
  const session = {
    id: id('chat_'),
    ocSessionId: null,
    title: (title && String(title).trim()) || DEFAULT_TITLE,
    createdAt: now,
    updatedAt: now,
    model: model || '',
    messages: [],
  };
  return writeSession(session);
}

function touch(session) {
  session.updatedAt = Date.now();
  return writeSession(session);
}

function deleteSession(sessionId) {
  try {
    fs.unlinkSync(fileFor(sessionId));
    return true;
  } catch {
    return false;
  }
}

function deriveTitle(text) {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/[`*_#>]/g, '')
    .trim();
  if (!clean) return DEFAULT_TITLE;
  const graphemes = Array.from(clean);
  return graphemes.length > 48 ? graphemes.slice(0, 48).join('') + '…' : clean;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(patch) {
  ensureDirs();
  const next = { ...readSettings(), ...patch };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

module.exports = {
  DATA_DIR,
  DEFAULT_TITLE,
  ensureDirs,
  listSessions,
  readSession,
  writeSession,
  createSession,
  touch,
  deleteSession,
  deriveTitle,
  readSettings,
  writeSettings,
};
