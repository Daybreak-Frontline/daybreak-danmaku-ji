import QRCode from 'qrcode';
import { weapiRequest } from './cloud-provider.mjs';
import { extractCookies } from './http-cookies.mjs';

const UNIKEY = 'https://music.163.com/weapi/login/qrcode/unikey?csrf_token=';
const POLL = 'https://music.163.com/weapi/login/qrcode/client/login?csrf_token=';
const USER = 'https://music.163.com/weapi/w/nuser/account/get?csrf_token=';
const QR_HEADERS = { 'x-os': 'web', 'x-loginmethod': 'QrCode', 'x-channelsource': 'undefined' };

export async function cloudQrStart() {
  const json = await weapiRequest(UNIKEY, { type: 1, noCheckToken: true }, { headers: QR_HEADERS });
  const unikey = json?.unikey;
  if (!unikey) throw new Error(`网易云二维码生成失败: ${json?.message || 'no unikey'}`);
  const png = await QRCode.toBuffer(`https://music.163.com/login?codekey=${unikey}`, {
    type: 'png', width: 256, margin: 1, errorCorrectionLevel: 'M'
  });
  return { unikey, image: `data:image/png;base64,${png.toString('base64')}` };
}

export async function cloudQrPoll(unikey) {
  const res = await weapiRequest(POLL, { key: unikey, type: 1, noCheckToken: true }, { json: false, headers: QR_HEADERS });
  const json = await res.json().catch(() => ({}));
  const code = json?.code;
  if (code === 801) return { status: 'waiting' };
  if (code === 802) return { status: 'authorizing' };
  if (code === 800) return { status: 'expired', message: '网易云二维码已过期' };
  if (code !== 803) return { status: 'waiting' };
  const raw = extractCookies(res);
  const csrf = (raw.match(/__csrf=([^;]+)/) || [])[1] || '';
  const musicU = (raw.match(/MUSIC_U=([^;]+)/) || [])[1] || '';
  if (!musicU) return { status: 'failed', message: '登录成功但未取得 MUSIC_U' };
  const cookie = [`os=pc`, csrf ? `__csrf=${csrf}` : '', `MUSIC_U=${musicU}`].filter(Boolean).join('; ');
  const me = await weapiRequest(USER, {}, { cookie });
  return {
    status: 'success',
    cookie,
    uid: String(me?.profile?.userId || me?.account?.id || ''),
    name: me?.profile?.nickname || ''
  };
}
