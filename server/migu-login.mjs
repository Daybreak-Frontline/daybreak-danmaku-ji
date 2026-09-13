import QRCode from 'qrcode';
import { HaltedError } from './qq-provider.mjs';
import { extractCookies } from './http-cookies.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36';
const START = 'https://passport.migu.cn/api/qrcWeb/qrcLogin?sourceID=220001';
const POLL = 'https://passport.migu.cn/api/qrcWeb/qrcquery';
const USER = 'https://app.c.nf.migu.cn/pc/user/h5/queryUserInfo/v1.0';

function assertNotHalted(res) {
  if (res.status === 403 || res.status === 429) {
    const err = new HaltedError(`咪咕登录 HTTP ${res.status}，已停止登录流程`, res.status);
    throw err;
  }
}

async function toQrImage(url) {
  if (!url) throw new Error('咪咕二维码为空');
  if (String(url).startsWith('data:image')) return url;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf[0] === 0x89 || buf[0] === 0xff) return `data:image/png;base64,${buf.toString('base64')}`;
    }
  } catch {}
  const png = await QRCode.toBuffer(url, { type: 'png', width: 256, margin: 1, errorCorrectionLevel: 'M' });
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function miguQrStart() {
  const res = await fetch(START, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': UA },
    body: 'isAsync=true&sourceid=220001'
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`咪咕二维码 HTTP ${res.status}`);
  const json = await res.json();
  const sessionId = json?.result?.qrc_sessionid;
  const qrcUrl = json?.result?.qrcUrl;
  if (!sessionId || !qrcUrl) throw new Error(`咪咕二维码生成失败: ${json?.message || 'no session'}`);
  return { sessionId, image: await toQrImage(qrcUrl) };
}

export async function miguQrPoll(sessionId) {
  const res = await fetch(POLL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'User-Agent': UA },
    body: `isAsync=true&sourceid=220001&qrc_sessionid=${encodeURIComponent(sessionId)}`
  });
  assertNotHalted(res);
  if (!res.ok) throw new Error(`咪咕登录轮询 HTTP ${res.status}`);
  const json = await res.json().catch(() => ({}));
  if (json?.status === 4074) return { status: 'waiting' };
  if (!(json?.status === 2000 && json?.result?.token)) {
    if (json?.status === 4073 || json?.status === 4072) return { status: 'expired', message: '咪咕二维码已过期' };
    return { status: 'waiting' };
  }
  const firstCookie = extractCookies(res);
  const jump = await fetch(`${json.result.redirectURL}?token=${encodeURIComponent(json.result.token)}`, {
    headers: { 'User-Agent': UA, Cookie: firstCookie },
    redirect: 'manual'
  });
  assertNotHalted(jump);
  const cookie = [firstCookie, extractCookies(jump)].filter(Boolean).join('; ');
  if (!cookie) return { status: 'failed', message: '登录成功但未取得 Cookie' };
  const me = await fetch(USER, { headers: { 'User-Agent': UA, Cookie: cookie } });
  assertNotHalted(me);
  const profile = await me.json().catch(() => ({}));
  const uid = String(profile?.userInfoItem?.userId || '');
  const name = profile?.userInfoItem?.nickName || '';
  if (!uid) return { status: 'failed', message: '登录成功但未取得用户信息' };
  return { status: 'success', cookie, uid, name };
}
