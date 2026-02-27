#!/usr/bin/env node

const express = require('express');
const path = require('node:path');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'data', 'site');
const IMAGES_DIR = path.join(DATA_DIR, 'images');
const REPORT_PATH = path.join(DATA_DIR, 'crawl-report.json');
const ACTIVITY_LOG_PATH = path.join(DATA_DIR, 'activity.log');
const PORT = Number(process.env.API_PORT || 6065);

const app = express();
app.use(express.json({ limit: '1mb' }));

const state = {
  running: false,
  pid: null,
  startedAt: null,
  endedAt: null,
  exitCode: null,
  lastError: null,
  command: null,
  payload: null
};

function exists(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function addArg(args, key, value) {
  if (!exists(value)) {
    return;
  }
  args.push(`--${key}`, String(value));
}

function buildCrawlerArgs(payload = {}) {
  const args = ['src/crawler.js'];
  const mode = payload.mode || 'site';

  addArg(args, 'mode', mode);
  addArg(args, 'url', payload.url);
  addArg(args, 'query', payload.query);
  addArg(args, 'depth', payload.depth);
  addArg(args, 'min-width', payload.minWidth);
  addArg(args, 'q', payload.quality);
  addArg(args, 'cookie', payload.cookie);
  addArg(args, 'same-origin', payload.sameOrigin);
  addArg(args, 'max-images', payload.maxImages);
  addArg(args, 'max-scrolls', payload.maxScrolls);
  addArg(args, 'headful', payload.headful);

  return args;
}

async function ensureDataPaths() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
}

async function safeReadJson(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readTail(filePath, maxLines) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } catch {
    return [];
  }
}

async function listImages() {
  await ensureDataPaths();
  const entries = await fs.readdir(IMAGES_DIR, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const fullPath = path.join(IMAGES_DIR, entry.name);
    const stat = await fs.stat(fullPath);
    files.push({
      name: entry.name,
      url: `/images/${encodeURIComponent(entry.name)}`,
      sizeBytes: stat.size,
      mtime: stat.mtime.toISOString()
    });
  }

  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  return files;
}

function safeImageName(raw) {
  if (!exists(raw)) {
    return null;
  }
  const trimmed = String(raw).trim();
  const normalized = path.basename(trimmed);
  if (!normalized || normalized === '.' || normalized === '..') {
    return null;
  }
  if (normalized !== trimmed) {
    return null;
  }
  return normalized;
}

async function deleteImageByName(rawName) {
  const name = safeImageName(rawName);
  if (!name) {
    return { ok: false, name: rawName, error: 'Nome file non valido' };
  }

  const fullPath = path.join(IMAGES_DIR, name);
  try {
    await fs.unlink(fullPath);
    return { ok: true, name };
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return { ok: false, name, error: 'File non trovato' };
    }
    return { ok: false, name, error: err.message };
  }
}

function parseLogLine(line) {
  const match = line.match(/^\[([^\]]+)\]\s+(.*)$/);
  if (!match) {
    return { timestamp: null, message: line };
  }

  const timestamp = Date.parse(match[1]);
  return {
    timestamp: Number.isFinite(timestamp) ? timestamp : null,
    message: match[2]
  };
}

async function buildProgress() {
  if (!state.startedAt) {
    return null;
  }

  const startedAtMs = Date.parse(state.startedAt);
  const endedAtMs = state.endedAt ? Date.parse(state.endedAt) : null;
  const nowMs = endedAtMs || Date.now();
  const elapsedSec = Number.isFinite(startedAtMs) ? Math.max(0, Math.round((nowMs - startedAtMs) / 1000)) : null;

  const payload = state.payload || {};
  const mode = payload.mode || 'site';
  const logs = await readTail(ACTIVITY_LOG_PATH, 4000);

  let saved = 0;
  let skipped = 0;
  let failed = 0;
  let collected = 0;
  let collectedTotal = 0;

  for (const line of logs) {
    const parsed = parseLogLine(line);
    if (parsed.timestamp && Number.isFinite(startedAtMs) && parsed.timestamp < startedAtMs - 1000) {
      continue;
    }

    if (parsed.message.startsWith('IMG saved')) {
      saved += 1;
    } else if (parsed.message.startsWith('IMG skipped_small')) {
      skipped += 1;
    } else if (parsed.message.startsWith('IMG failed_non_image_or_status') || parsed.message.startsWith('IMG error')) {
      failed += 1;
    }

    const scrollMatch = parsed.message.match(/PINTEREST scroll=\d+\s+collected=(\d+)/);
    if (scrollMatch) {
      collected = Math.max(collected, Number(scrollMatch[1]));
    }

    const totalMatch = parsed.message.match(/PINTEREST collected_total=(\d+)/);
    if (totalMatch) {
      collectedTotal = Math.max(collectedTotal, Number(totalMatch[1]));
    }
  }

  const processed = saved + skipped + failed;
  let target = 0;

  if (mode === 'pinterest') {
    target = Number(payload.maxImages || 0);
    if (collectedTotal > 0) {
      target = collectedTotal;
    } else if (collected > 0) {
      target = Math.max(target, collected);
    }
  }

  const percent = target > 0 ? Math.min(100, Math.round((processed / target) * 100)) : null;
  let etaSec = null;

  if (state.running && target > 0 && processed > 0 && elapsedSec !== null && processed < target) {
    etaSec = Math.round((elapsedSec / processed) * (target - processed));
  }

  if (!state.running && percent !== null) {
    etaSec = 0;
  }

  return {
    mode,
    processed,
    saved,
    skipped,
    failed,
    collected,
    target: target > 0 ? target : null,
    percent,
    elapsedSec,
    etaSec
  };
}

function startCrawler(payload) {
  const args = buildCrawlerArgs(payload);
  const child = spawn(process.execPath, args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  state.running = true;
  state.pid = child.pid;
  state.startedAt = new Date().toISOString();
  state.endedAt = null;
  state.exitCode = null;
  state.lastError = null;
  state.command = [process.execPath, ...args].join(' ');
  state.payload = payload;

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[crawler:${child.pid}] ${chunk}`);
  });

  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[crawler:${child.pid}] ${chunk}`);
  });

  child.on('error', (err) => {
    state.lastError = err.message;
  });

  child.on('close', (code) => {
    state.running = false;
    state.pid = null;
    state.endedAt = new Date().toISOString();
    state.exitCode = code;
  });
}

app.use('/images', express.static(IMAGES_DIR, { maxAge: '5m' }));

app.get('/api/health', async (_, res) => {
  await ensureDataPaths();
  res.json({ ok: true, port: PORT, dataDir: DATA_DIR });
});

app.get('/api/crawl/status', async (_, res) => {
  const progress = await buildProgress();
  res.json({ ...state, progress });
});

app.post('/api/crawl/start', async (req, res) => {
  await ensureDataPaths();

  if (state.running) {
    res.status(409).json({ ok: false, error: 'Crawler gia in esecuzione', state: { ...state } });
    return;
  }

  const payload = req.body || {};
  startCrawler(payload);
  res.json({ ok: true, state: { ...state } });
});

app.get('/api/report', async (_, res) => {
  const report = await safeReadJson(REPORT_PATH);
  res.json({ report });
});

app.get('/api/logs', async (req, res) => {
  const lines = Number(req.query.lines || 200);
  const safeLines = Number.isFinite(lines) ? Math.max(1, Math.min(2000, lines)) : 200;
  const logs = await readTail(ACTIVITY_LOG_PATH, safeLines);
  res.json({ logs });
});

app.get('/api/images', async (_, res) => {
  const images = await listImages();
  res.json({ images });
});

app.delete('/api/images/:name', async (req, res) => {
  const decoded = decodeURIComponent(req.params.name || '');
  const result = await deleteImageByName(decoded);
  if (!result.ok) {
    res.status(400).json(result);
    return;
  }
  res.json(result);
});

app.post('/api/images/delete-batch', async (req, res) => {
  const names = Array.isArray(req.body?.names) ? req.body.names : [];
  if (names.length === 0) {
    res.status(400).json({ ok: false, error: 'Lista immagini vuota' });
    return;
  }

  const unique = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))];
  if (unique.length === 0) {
    res.status(400).json({ ok: false, error: 'Nomi immagini non validi' });
    return;
  }
  const results = [];
  for (const name of unique) {
    // Sequential delete to keep filesystem operations simple and predictable.
    // eslint-disable-next-line no-await-in-loop
    results.push(await deleteImageByName(name));
  }

  const deleted = results.filter((item) => item.ok).length;
  const failed = results.length - deleted;
  res.json({
    ok: failed === 0,
    deleted,
    failed,
    results
  });
});

app.listen(PORT, () => {
  console.log(`API server attivo su http://localhost:${PORT}`);
});
