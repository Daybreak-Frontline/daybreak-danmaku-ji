import fs from 'node:fs';
import path from 'node:path';

const FILE_RE = /^(\d{4}-\d{2}-\d{2})\.log$/;
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const MIN_MB = 1;
const MAX_MB = 512;
const DEFAULT_DAYS = 14;
const DEFAULT_MB = 32;

function clampDays(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.round(n)));
}

function clampMb(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MB;
  return Math.max(MIN_MB, Math.min(MAX_MB, Math.round(n)));
}

export function todayStamp(at = Date.now()) {
  const d = new Date(at);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function createFileLog(dataDir) {
  const logDir = path.join(dataDir, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  let retentionDays = DEFAULT_DAYS;
  let maxBytes = DEFAULT_MB * 1024 * 1024;

  function filePath(stamp) {
    return path.join(logDir, `${stamp}.log`);
  }

  function listFiles() {
    if (!fs.existsSync(logDir)) return [];
    return fs.readdirSync(logDir).flatMap(name => {
      const match = name.match(FILE_RE);
      if (!match) return [];
      const full = path.join(logDir, name);
      try {
        return [{ date: match[1], bytes: fs.statSync(full).size, path: full }];
      } catch {
        return [];
      }
    }).sort((a, b) => a.date.localeCompare(b.date));
  }

  function readDate(stamp) {
    const full = filePath(stamp);
    if (!fs.existsSync(full)) return [];
    const items = [];
    for (const line of fs.readFileSync(full, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { items.push(JSON.parse(line)); } catch {}
    }
    return items;
  }

  function trimOldestLines(full, needDropBytes) {
    const raw = fs.readFileSync(full, 'utf8');
    const lines = raw.split('\n');
    let dropped = 0;
    let index = 0;
    while (index < lines.length && dropped < needDropBytes) {
      dropped += Buffer.byteLength(`${lines[index]}\n`);
      index += 1;
    }
    fs.writeFileSync(full, lines.slice(index).join('\n'));
  }

  function prune() {
    const cutoff = todayStamp(Date.now() - retentionDays * 86400000);
    for (const file of listFiles()) {
      if (file.date < cutoff) {
        try { fs.unlinkSync(file.path); } catch {}
      }
    }
    let files = listFiles();
    let total = files.reduce((sum, file) => sum + file.bytes, 0);
    while (files.length && total > maxBytes) {
      const oldest = files[0];
      if (files.length === 1) {
        trimOldestLines(oldest.path, total - maxBytes);
        break;
      }
      try { fs.unlinkSync(oldest.path); } catch {}
      total -= oldest.bytes;
      files.shift();
    }
  }

  function append(item) {
    const stamp = todayStamp(item.at);
    fs.appendFileSync(filePath(stamp), `${JSON.stringify(item)}\n`);
    prune();
  }

  function settings() {
    const files = listFiles();
    return {
      retentionDays,
      maxMb: Math.round(maxBytes / (1024 * 1024)),
      usedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      files: files.map(file => ({ date: file.date, bytes: file.bytes }))
    };
  }

  function setLimits({ retentionDays: days, maxMb } = {}) {
    if (days != null) retentionDays = clampDays(days);
    if (maxMb != null) maxBytes = clampMb(maxMb) * 1024 * 1024;
    prune();
    return settings();
  }

  return { append, readDate, listFiles, setLimits, settings, todayStamp, prune };
}
