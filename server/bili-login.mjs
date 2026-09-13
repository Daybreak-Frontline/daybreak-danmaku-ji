import QRCode from 'qrcode';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.4896.127 Safari/537.36';
const BILI_HEADER = { 'User-Agent': UA, Referer: 'https://www.bilibili.com' };
const GENERATE = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const POLL = key => `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`;

function extractSetCookie(res) {
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

export async function biliQrStart() {
  const res = await fetch(GENERATE, { headers: BILI_HEADER });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`B站二维码 HTTP ${res.status}，已停止登录流程`);
    err.halt = true;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) throw new Error(`B站二维码 HTTP ${res.status}`);
  const json = await res.json();
  const url = json?.data?.url;
  const qrcodeKey = json?.data?.qrcode_key;
  if (!url || !qrcodeKey) throw new Error(`二维码生成失败: ${json?.message || 'no url'}`);
  const png = await QRCode.toBuffer(url, { type: 'png', width: 256, margin: 1, errorCorrectionLevel: 'M' });
  return { qrcodeKey, url, image: `data:image/png;base64,${png.toString('base64')}` };
}

export async function biliQrPoll(qrcodeKey) {
  const res = await fetch(POLL(qrcodeKey), { headers: BILI_HEADER });
  if (res.status === 403 || res.status === 429) {
    const err = new Error(`B站登录轮询 HTTP ${res.status}，已停止登录流程`);
    err.halt = true;
    err.status = res.status;
    throw err;
  }
  if (!res.ok) throw new Error(`B站登录轮询 HTTP ${res.status}`);
  const json = await res.json().catch(() => ({ data: {} }));
  const code = json?.data?.code;
  if (code === 86101) return { status: 'waiting' };
  if (code === 86090) return { status: 'authorizing' };
  if (code === 86038) return { status: 'expired', message: 'B站二维码已过期' };
  if (code !== 0) return { status: 'waiting' };
  const cookie = extractSetCookie(res);
  if (!cookie) return { status: 'authorizing', message: '已确认，等待 Cookie' };
  const uid = String((cookie.match(/DedeUserID=(\d+)/) || [])[1] || json?.data?.mid || '');
  if (!/SESSDATA=/.test(cookie)) return { status: 'failed', message: '登录成功但未取得 SESSDATA' };
  return { status: 'success', cookie, uid };
}
