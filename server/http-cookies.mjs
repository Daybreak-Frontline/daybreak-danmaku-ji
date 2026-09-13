export function extractCookies(res) {
  const lines = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie') || ''];
  const skip = new Set(['HttpOnly', 'Secure', 'SameSite', 'Path', 'Domain', 'Expires', 'Max-Age']);
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const first = String(line).split(';')[0].trim();
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const key = first.slice(0, eq);
    if (skip.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(first);
  }
  return out.join('; ');
}
