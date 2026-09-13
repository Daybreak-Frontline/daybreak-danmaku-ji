import { extractCookies } from './http-cookies.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36';
const H = { 'User-Agent': UA, Referer: 'https://xui.ptlogin2.qq.com/' };

function hash33(text) {
  let n = 0;
  for (const c of text) n += (n << 5) + c.charCodeAt(0);
  return n & 0x7fffffff;
}

function cookies(res) {
  return extractCookies(res);
}

function mergeCookies(...parts) {
  const map = new Map();
  for (const part of parts) {
    for (const item of String(part || '').split(';')) {
      const s = item.trim();
      const eq = s.indexOf('=');
      if (eq <= 0) continue;
      map.set(s.slice(0, eq), s);
    }
  }
  return [...map.values()].join('; ');
}

function cookieValue(cookie, name) {
  const m = String(cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`, 'i'));
  return m ? m[1] : '';
}

function gtk(pSkey) {
  let hash = 5381;
  for (let i = 0; i < pSkey.length; i++) hash += (hash << 5) + pSkey.charCodeAt(i);
  return hash & 0x7fffffff;
}

export function hasQqMusicKey(cookie) {
  return /(?:^|;\s*)(qm_keyst|qqmusic_key)=/i.test(String(cookie || ''));
}

export function uinFromCookie(cookie) {
  return cookieValue(cookie, 'uin') || cookieValue(cookie, 'wxuin') || cookieValue(cookie, 'luin');
}

export async function exchangeMusicCookie(graphCookie, extraCookie = '') {
  const pSkey = cookieValue(graphCookie, 'p_skey');
  if (!pSkey) return { cookie: '', message: '缺少 p_skey，无法换取 QQ 音乐登录' };
  const body = new URLSearchParams({
    response_type: 'code',
    client_id: '100497308',
    redirect_uri: 'https://y.qq.com/portal/wx_redirect.html?login_type=1&surl=https://y.qq.com/',
    scope: 'all',
    state: 'state',
    switch: '',
    from_ptlogin: '1',
    src: '1',
    update_auth: '1',
    openapi: '80901010_1030',
    g_tk: String(gtk(pSkey)),
    auth_time: String(Date.now()),
    ui: 'DFEC5395-9E69-4D3E-96A6-300BB770874D'
  });
  const auth = await fetch('https://graph.qq.com/oauth2.0/authorize', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://graph.qq.com/',
      Cookie: graphCookie,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body,
    redirect: 'manual'
  });
  const loc = auth.headers.get('location') || auth.headers.get('Location') || '';
  const code = (loc.match(/[?&]code=([^&]+)/) || [])[1] || '';
  if (!code) return { cookie: '', message: 'QQ 授权未返回 code，请重新扫码' };
  const music = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      Referer: 'https://y.qq.com/',
      Cookie: mergeCookies(extraCookie, graphCookie),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      comm: { g_tk: 5381, platform: 'yqq', ct: 24, cv: 0 },
      req: { module: 'QQConnectLogin.LoginServer', method: 'QQLogin', param: { code } }
    })
  });
  const musicCookie = mergeCookies(extraCookie, graphCookie, cookies(music));
  if (!hasQqMusicKey(musicCookie)) return { cookie: '', message: 'QQ 音乐未返回播放密钥，请重新扫码' };
  return { cookie: musicCookie, uin: uinFromCookie(musicCookie) };
}

export async function upgradeQqMusicCookie(cookie) {
  if (hasQqMusicKey(cookie)) return { cookie, uin: uinFromCookie(cookie) };
  return exchangeMusicCookie(cookie, cookie);
}

export async function qqQrStart() {
  const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&daid=383&pt_3rd_aid=100497308&t=${Date.now()}`;
  const res = await fetch(url, { headers: H });
  if (!res.ok) throw new Error(`QQ二维码 HTTP ${res.status}`);
  const qrsig = (cookies(res).match(/(?:^|; )qrsig=([^;]+)/) || [])[1] || '';
  if (!qrsig) throw new Error('QQ二维码未返回 qrsig');
  const png = Buffer.from(await res.arrayBuffer());
  return { qrsig, image: `data:image/png;base64,${png.toString('base64')}` };
}

export async function qqQrPoll(qrsig) {
  const url = `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${encodeURIComponent('https://graph.qq.com/oauth2.0/login_jump')}&ptqrtoken=${hash33(qrsig)}&ptredirect=0&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=22080914&js_type=1&login_sig=&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308`;
  const res = await fetch(url, { headers: { ...H, Cookie: `qrsig=${qrsig}` } });
  const text = await res.text();
  const match = /ptuiCB\('([0-9]+)','[^']*','([^']*)'/.exec(text);
  const code = Number(match?.[1] || 99);
  if (code === 66) return { status: 'waiting' };
  if (code === 67) return { status: 'authorizing' };
  if (code === 68) return { status: 'expired' };
  if (code !== 0 || !match?.[2]) return { status: 'failed', message: `QQ登录返回码 ${code}` };
  const jump = await fetch(match[2], { headers: { ...H, Cookie: `qrsig=${qrsig}` }, redirect: 'manual' });
  const graphCookie = mergeCookies(cookies(res), cookies(jump));
  if (!graphCookie) return { status: 'failed', message: 'QQ登录成功但未取得登录 Cookie' };
  const exchanged = await exchangeMusicCookie(graphCookie, graphCookie);
  if (!exchanged.cookie) return { status: 'failed', message: exchanged.message || 'QQ 音乐登录握手失败' };
  return { status: 'success', cookie: exchanged.cookie, uin: exchanged.uin || uinFromCookie(graphCookie) };
}
