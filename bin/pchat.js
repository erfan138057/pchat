#!/usr/bin/env node
'use strict';

const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { createApp, DEFAULT_MODEL } = require('../src/server');
const store = require('../src/store');

function usage() {
  console.log(`pchat - Persian web chat for OpenCode

Usage:
  pchat [options]

Options:
  --port <number>   Port to listen on (default: 5178)
  --host <addr>     Address to bind (default: 127.0.0.1)
  --dir <path>      Working directory for OpenCode (default: current folder)
  --model <id>      Default model, e.g. opencode/deepseek-v4.1-flash-free
  --no-open         Do not open the browser automatically
  -h, --help        Show this help
`);
}

function parseArgs(argv) {
  const opts = { port: 5178, host: '127.0.0.1', dir: process.cwd(), model: '', open: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case '--port': opts.port = Number(next()); break;
      case '--host': opts.host = next(); break;
      case '--dir': opts.dir = path.resolve(next()); break;
      case '--model': opts.model = next(); break;
      case '--no-open': opts.open = false; break;
      case '-h':
      case '--help':
        usage();
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${arg}`);
        usage();
        process.exit(1);
    }
  }
  return opts;
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    /* the printed URL is enough */
  }
}

function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const saved = store.readSettings();
  const model = opts.model || saved.model || DEFAULT_MODEL;
  const auto = saved.auto !== false;

  const app = createApp({ cwd: opts.dir, model, auto });

  let port = opts.port;
  let bound = null;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      bound = await listen(app.server, opts.host, port);
      break;
    } catch (err) {
      if (err && err.code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      console.error('Failed to start:', err.message);
      process.exit(1);
    }
  }
  if (!bound) {
    console.error('No free port found around', opts.port);
    process.exit(1);
  }

  const url = `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${bound}`;

  console.log('');
  console.log('  pchat 1.0  |  Persian web chat for OpenCode');
  console.log('  ------------------------------------------');
  console.log('  URL:      ' + url);
  console.log('  Folder:   ' + opts.dir);
  console.log('  Model:    ' + model);
  console.log('  Data:     ' + store.DATA_DIR);
  if (!app.exe) {
    console.log('');
    console.log('  WARNING: opencode executable not found.');
    console.log('  Install it or set PCHAT_OPENCODE to the full path of opencode.exe');
  }
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  if (opts.open) openBrowser(url);

  const shutdown = () => {
    console.log('\nStopping pchat...');
    app.server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('pchat failed:', err && err.message ? err.message : err);
  process.exit(1);
});
