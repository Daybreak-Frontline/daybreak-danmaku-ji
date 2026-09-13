export function normalizeSongBlacklist(list) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(list) ? list : []) {
    const source = String(item || '').trim();
    if (!source || seen.has(source)) continue;
    seen.add(source);
    out.push(source);
  }
  return out.slice(0, 500);
}

export function isSingleBlacklistChar(value) {
  return [...String(value || '').trim()].length === 1;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function compileSongBlacklist(list) {
  return normalizeSongBlacklist(list).map(source => {
    try {
      return { source, re: new RegExp(source, 'iu') };
    } catch {
      return { source, re: new RegExp(escapeRegExp(source), 'iu') };
    }
  });
}

export function matchSongBlacklist(text, list) {
  const hay = String(text || '');
  if (!hay) return '';
  for (const item of compileSongBlacklist(list)) {
    try {
      if (item.re.test(hay)) return item.source;
    } catch {}
  }
  return '';
}
