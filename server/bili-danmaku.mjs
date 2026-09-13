import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { WebSocket as WSClient } from 'ws';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const ROOM_INIT_URL = 'https://api.live.bilibili.com/room/v1/Room/get_info';
const DANMU_CONF_URL = 'https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo';
const SPEI_URL = 'https://api.bilibili.com/x/frontend/finger/spi';
const NAV_URL = 'https://api.bilibili.com/x/web-interface/nav';
const DEFAULT_DANMAKU_SERVERS = [
  { host: 'broadcastlv.chat.bilibili.com', port: 2243, wss_port: 443, ws_port: 2244 }
];
const WBI_INDEX = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13];

class WbiSigner {
  constructor() { this._key = ''; }
  get needRefresh() { return this._key === ''; }
  async refresh(cookie = '') {
    if (!this.needRefresh) return;
    const res = await fetch(NAV_URL, { headers: { 'User-Agent': UA, ...(cookie ? { Cookie: cookie } : {}) } });
    if (res.status === 403 || res.status === 429) {
      const err = new Error(`B站 WBI HTTP ${res.status}`);
      err.halt = true;
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const img = json?.data?.wbi_img;
    if (!img) return;
    const imgKey = img.img_url.split('/').pop().split('.')[0];
    const subKey = img.sub_url.split('/').pop().split('.')[0];
    const shuffled = imgKey + subKey;
    this._key = WBI_INDEX.map(i => (i < shuffled.length ? shuffled[i] : '')).join('');
  }
  sign(params) {
    if (!this._key) return params;
    const wts = String(Math.floor(Date.now() / 1000));
    const toSign = { ...params, wts };
    const entries = Object.entries(toSign)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => [k, String(v).replace(/[!'()*]/g, '')]);
    const str = new URLSearchParams(entries).toString() + this._key;
    const wrid = crypto.createHash('md5').update(str).digest('hex');
    return { ...params, wts, w_rid: wrid };
  }
}

function packet(body, operation, ver = 1) {
  let payload;
  if (typeof body === 'object') payload = Buffer.from(JSON.stringify(body), 'utf8');
  else if (typeof body === 'string') payload = Buffer.from(body, 'utf8');
  else payload = body;
  const buf = Buffer.allocUnsafe(16 + payload.length);
  buf.writeInt32BE(buf.length, 0);
  buf.writeInt16BE(16, 4);
  buf.writeInt16BE(ver, 6);
  buf.writeInt32BE(operation, 8);
  buf.writeInt32BE(1, 12);
  payload.copy(buf, 16);
  return buf;
}

export function extractRoomId(input) {
  const s = String(input ?? '').trim();
  if (!s) return NaN;
  const m1 = s.match(/live\.bilibili\.com\/(\d+)/);
  if (m1) return Number(m1[1]);
  if (/^\d+$/.test(s)) return Number(s);
  return NaN;
}

function connectWs(url) {
  const raw = new WSClient(url, {
    headers: { 'User-Agent': UA },
    perMessageDeflate: false
  });
  const ws = new EventEmitter();
  ws.readyState = 0;
  raw.on('open', () => { ws.readyState = 1; ws.emit('open'); });
  raw.on('message', data => { ws.emit('message', Buffer.isBuffer(data) ? data : Buffer.from(data)); });
  raw.on('error', err => { ws.emit('error', err); });
  raw.on('close', (code, reason) => { ws.readyState = 0; ws.emit('close', code, reason ? reason.toString() : ''); });
  ws.send = (payload, { binary = true } = {}) => {
    if (typeof payload === 'string') { raw.send(payload); return; }
    raw.send(payload, { binary });
  };
  ws.close = () => { try { raw.close(); } catch {} };
  ws.terminate = () => { try { raw.terminate(); } catch {} };
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', e => reject(e));
  });
}

export class DanmakuClient extends EventEmitter {
  constructor() {
    super();
    this.cookie = '';
    this.uid = 0;
    this.ws = null;
    this.roomId = 0;
    this.ownerUid = 0;
    this.parentAreaId = 0;
    this.areaId = 0;
    this.token = '';
    this.hostList = [];
    this.tokenError = '';
    this.wbi = new WbiSigner();
    this._hb = null;
    this._stopped = true;
    this._reconnects = 0;
    this._needInitRoom = false;
    this._state = 'idle';
    this._lastPacketAt = 0;
    this._connSince = 0;
    this._retryCount = 0;
    this._watchdog = null;
    this._connCount = 0;
    this._authOk = false;
    this._gotServerPacket = false;
  }

  get state() { return this._state; }
  get lastPacketAt() { return this._lastPacketAt; }
  get retryCount() { return this._retryCount; }

  _setState(s, meta = {}) {
    this._state = s;
    this.emit('status', s, {
      room: this.roomId,
      since: this._connSince || 0,
      lastPacketAt: this._lastPacketAt || 0,
      retryCount: this._retryCount,
      detail: meta.detail || ''
    });
  }

  _startWatchdog() {
    this._stopWatchdog();
    this._watchdog = setInterval(() => {
      if (this._state !== 'connected' && this._state !== 'degraded') return;
      const idle = Date.now() - this._lastPacketAt;
      if (idle > 15000 && this._state !== 'degraded') {
        this._setState('degraded', { detail: `最近收包 ${Math.round(idle / 1000)}s 前，服务端无响应` });
      } else if (idle > 30000) {
        if (this.ws) { try { this.ws.terminate(); } catch {} }
      }
    }, 5000);
  }
  _stopWatchdog() { if (this._watchdog) { clearInterval(this._watchdog); this._watchdog = null; } }

  _touchPacket() {
    this._lastPacketAt = Date.now();
    this._gotServerPacket = true;
    if (this._authOk && this._gotServerPacket && (this._state === 'authenticating' || this._state === 'degraded')) {
      this._setState('connected', { detail: '鉴权成功，已收到服务端包' });
    } else if (this._state === 'degraded') {
      this._setState('connected');
    }
  }

  setCredential(cookie, uid) {
    this.cookie = cookie || '';
    this.uid = Number(uid) || 0;
  }

  _findCookie(name) {
    const m = this.cookie.match(new RegExp(`${name}=([^;]+)`));
    return m ? m[1] : '';
  }

  async _ensureBuvid() {
    if (this._findCookie('buvid3') && this._findCookie('buvid4')) return;
    const res = await fetch(SPEI_URL, { headers: { 'User-Agent': UA, Referer: 'https://www.bilibili.com' } });
    if (res.status === 403 || res.status === 429) {
      const err = new Error(`B站 buvid HTTP ${res.status}`);
      err.halt = true;
      err.status = res.status;
      throw err;
    }
    const json = await res.json();
    const b3 = json?.data?.b_3;
    const b4 = json?.data?.b_4;
    if (b3 && !this._findCookie('buvid3')) this.cookie = `buvid3=${b3}; ${this.cookie}`;
    if (b4 && !this._findCookie('buvid4')) this.cookie = `buvid4=${b4}; ${this.cookie}`;
  }

  async initRoom() {
    const short = extractRoomId(this._roomInput);
    if (!Number.isFinite(short) || short <= 0) throw new Error(`无法识别房间号: ${String(this._roomInput).slice(0, 40)}`);
    if (!this.cookie || !/SESSDATA=/.test(this.cookie)) throw new Error('未扫码登录 B站，拒绝连接弹幕（匿名弹幕不恢复）');
    await this._ensureBuvid();

    const initRes = await fetch(`${ROOM_INIT_URL}?room_id=${short}`, {
      headers: { 'User-Agent': UA, Referer: `https://live.bilibili.com/${short}`, Cookie: this.cookie }
    });
    if (initRes.status === 403 || initRes.status === 429) {
      const err = new Error(`B站房间信息 HTTP ${initRes.status}`);
      err.halt = true;
      err.status = initRes.status;
      throw err;
    }
    const init = await initRes.json();
    if (init.code !== 0) throw new Error(`房间初始化失败: ${init.message || init.msg || init.code} (${short})`);
    this.roomId = init.data.room_id || short;
    this.ownerUid = init.data.uid || 0;
    this.parentAreaId = init.data.parent_area_id || 0;
    this.areaId = init.data.area_id || 0;

    if (this.wbi.needRefresh) await this.wbi.refresh(this.cookie);
    if (!this.wbi._key) throw new Error('WBI key 获取失败，拒绝无签名连接');
    const params = this.wbi.sign({ id: this.roomId, type: 0 });
    const dsRes = await fetch(`${DANMU_CONF_URL}?${new URLSearchParams(params)}`, {
      headers: { 'User-Agent': UA, Referer: `https://live.bilibili.com/${short}`, Cookie: this.cookie }
    });
    if (dsRes.status === 403 || dsRes.status === 429) {
      const err = new Error(`B站弹幕配置 HTTP ${dsRes.status}`);
      err.halt = true;
      err.status = dsRes.status;
      throw err;
    }
    const ds = await dsRes.json();
    if (ds.code !== 0) throw new Error(`获取弹幕配置失败: ${ds.message || ds.code}`);
    this.hostList = ds.data.host_list?.length ? ds.data.host_list : DEFAULT_DANMAKU_SERVERS;
    this.token = ds.data.token || '';
    if (!this.token) throw new Error('获取弹幕凭证失败(token 为空)');
  }

  _wsUrl() {
    const h = this.hostList[this._connCount % this.hostList.length] || DEFAULT_DANMAKU_SERVERS[0];
    const port = h.wss_port && h.wss_port !== 443 ? `:${h.wss_port}` : '';
    return `wss://${h.host}${port}/sub`;
  }

  _authBody() {
    const auth = {
      uid: this.uid,
      roomid: this.roomId,
      protover: 3,
      platform: 'web',
      type: 2,
      buvid: this._findCookie('buvid3') || ''
    };
    if (this.token) auth.key = this.token;
    return auth;
  }

  async connect(input) {
    if (!this.cookie || !/SESSDATA=/.test(this.cookie)) {
      this._setState('failed', { detail: '未扫码登录 B站，拒绝连接弹幕（匿名弹幕不恢复）' });
      return false;
    }
    this._roomInput = input;
    this._stopped = false;
    this._retryCount = 0;
    this._reconnects = 0;
    this._authOk = false;
    this._gotServerPacket = false;
    if (this.cookie.includes('SESSDATA') && !this.uid) {
      try {
        const nav = await (await fetch(NAV_URL, { headers: { 'User-Agent': UA, Cookie: this.cookie } })).json();
        if (nav.code === 0 && nav.data.isLogin) this.uid = nav.data.mid || 0;
        else {
          this._setState('failed', { detail: '登录态无效，请重新扫码' });
          return false;
        }
      } catch {}
    }
    this._setState('connecting_room', { detail: '解析直播间…' });
    try { await this.initRoom(); }
    catch (e) {
      this._setState('failed', { detail: e.message });
      return false;
    }
    this._connCount = 0;
    const connected = new Promise(resolve => {
      const t = setTimeout(() => { this.removeListener('status', on); resolve(this._state === 'connected'); }, 12000);
      const on = s => {
        if (s === 'connected') { clearTimeout(t); this.removeListener('status', on); resolve(true); }
        else if (s === 'failed') { clearTimeout(t); this.removeListener('status', on); resolve(false); }
      };
      this.on('status', on);
    });
    await this._openAndListen(true);
    return connected;
  }

  async _openAndListen(first = false) {
    if (this._stopped) return;
    if (!first) this._setState('reconnecting', { detail: `重连第 ${this._reconnects} 次` });
    if (this._needInitRoom || !this.token) {
      try { await this.initRoom(); this._needInitRoom = false; }
      catch (e) {
        if (e.halt) { this._setState('failed', { detail: e.message }); return; }
        this._extendFail(`初始化失败: ${e.message}`);
        return;
      }
    }
    this._setState('connecting', { detail: '建立 wss…' });
    this._authOk = false;
    this._gotServerPacket = false;
    let ws;
    try { ws = await connectWs(this._wsUrl()); }
    catch (e) { this._extendFail(`wss 连接失败: ${e.message}`); return; }
    this.ws = ws;
    this._setState('authenticating', { detail: '等待鉴权…' });
    ws.send(packet(this._authBody(), 7));
    this._hb = setInterval(() => {
      if (this.ws && this.ws.readyState === 1) this.ws.send(packet({}, 2));
    }, 30000);
    this._startWatchdog();
    ws.on('message', buf => { this._onFrame(buf); });
    ws.on('error', e => {
      if (this._state === 'connected' || this._state === 'degraded') {
        this._setState('degraded', { detail: `连接错误: ${(e && e.message) || 'ws error'}` });
      }
    });
    ws.on('close', (code, reason) => {
      clearInterval(this._hb);
      this._stopWatchdog();
      this.ws = null;
      if (this._stopped) return;
      this._extendFail(`连接关闭 code=${code}${reason ? ` reason=${reason}` : ''}`);
    });
  }

  _extendFail(detail) {
    if (this._stopped) { this._state = 'idle'; return; }
    this._retryCount++;
    this._reconnects++;
    this._connCount++;
    const max = 6;
    if (this._retryCount >= max) {
      this._setState('failed', { detail: `${detail}（已重试 ${max} 次）` });
      return;
    }
    this._setState('reconnecting', { detail });
    const delay = Math.min(30000, 1000 * Math.pow(2, this._retryCount)) + Math.random() * 1000;
    this._retryTimer = setTimeout(() => { if (!this._stopped) this._openAndListen(false); }, delay);
  }

  async disconnect() {
    this._stopped = true;
    clearInterval(this._hb);
    this._stopWatchdog();
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    if (this.ws) { try { this.ws.terminate(); } catch {} this.ws = null; }
    this._authOk = false;
    this._gotServerPacket = false;
    this._setState('idle', { detail: '已断开' });
  }

  _onFrame(buf) {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
    let off = 0;
    while (off + 16 <= b.length) {
      const total = b.readInt32BE(off);
      if (total <= 0 || off + total > b.length) break;
      const ver = b.readInt16BE(off + 6);
      const op = b.readInt32BE(off + 8);
      const payload = b.subarray(off + 16, off + total);
      if (op === 5) {
        this._touchPacket();
        try {
          if (ver === 3) this._onFrame(zlib.brotliDecompressSync(payload));
          else if (ver === 2) this._onFrame(zlib.inflateSync(payload));
          else if (payload.length) this._handleCommand(payload);
        } catch {}
      } else if (op === 8) {
        this._touchPacket();
        try {
          const j = JSON.parse(payload.toString('utf8'));
          if (j.code !== 0) {
            this._needInitRoom = true;
            this._extendFail(`鉴权被拒 code=${j.code} ${j.message || ''}`);
          } else {
            this._authOk = true;
            this._connSince = Date.now();
            this._lastPacketAt = Date.now();
            this._retryCount = 0;
            if (this._gotServerPacket) this._setState('connected', { detail: '鉴权成功，已收到服务端包' });
            if (this.ws && this.ws.readyState === 1) this.ws.send(packet({}, 2));
          }
        } catch {}
      } else if (op === 3) {
        this._touchPacket();
      }
      off += total;
    }
  }

  _handleCommand(buf) {
    try {
      const doc = JSON.parse(buf.toString('utf8'));
      const cmd = doc.cmd || '';
      if (cmd.startsWith('DANMU_MSG')) this.emit('danmaku', this._parseDanmaku(doc));
      else if (cmd.includes('SEND_GIFT')) this.emit('gift', doc);
    } catch {}
  }

  _parseDanmaku(doc) {
    const info = doc.info || [];
    const ub = info[2] || [];
    return {
      msg: (info[1] || '').trim(),
      uid: String(ub[0] ?? ''),
      name: ub[1] || '',
      isManager: String(ub[2]) === '1',
      guardType: info.length > 7 ? Number(info[7] || 0) : 0,
      medalLevel: (info[3] && info[3][0]) || 0,
      medalName: (info[3] && info[3][1]) || ''
    };
  }
}
