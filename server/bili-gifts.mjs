const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const GIFT_URLS = [
  room => `https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/roomGiftList?platform=pc&room_id=${room.roomId}&area_parent_id=${room.parentAreaId || ''}&area_id=${room.areaId || ''}`,
  room => `https://api.live.bilibili.com/xlive/web-room/v1/giftPanel/giftConfig?platform=pc&room_id=${room.roomId}`,
  () => 'https://api.live.bilibili.com/gift/v4/Live/giftConfig?platform=pc'
];

function asGift(item) {
  if (!item || typeof item !== 'object') return null;
  const id = Number(item.id ?? item.gift_id ?? item.giftId);
  const name = String(item.name ?? item.gift_name ?? item.giftName ?? '').trim();
  if (!Number.isFinite(id) || id <= 0 || !name) return null;
  const price = Number(item.price ?? item.gift_price ?? 0) || 0;
  const coinType = String(item.coin_type || item.coinType || 'gold').toLowerCase();
  const batteries = coinType === 'silver' ? 0 : Math.max(0, Math.round(price / 100));
  return {
    id,
    name,
    icon: String(item.img_basic || item.gif || item.img_dynamic || item.icon || item.img || ''),
    price,
    coinType,
    batteries
  };
}

function collectGifts(node, out, depth = 0) {
  if (!node || depth > 6) return;
  if (Array.isArray(node)) {
    for (const item of node) {
      const gift = asGift(item);
      if (gift) out.set(gift.id, gift);
      else collectGifts(item, out, depth + 1);
    }
    return;
  }
  if (typeof node !== 'object') return;
  const self = asGift(node);
  if (self) out.set(self.id, self);
  for (const value of Object.values(node)) {
    if (value && typeof value === 'object') collectGifts(value, out, depth + 1);
  }
}

export function normalizeGiftList(payload) {
  const out = new Map();
  collectGifts(payload?.data ?? payload, out);
  return [...out.values()].sort((a, b) => {
    if (Boolean(b.batteries) !== Boolean(a.batteries)) return b.batteries ? 1 : -1;
    if (b.batteries !== a.batteries) return b.batteries - a.batteries;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export async function fetchBiliGifts({ cookie = '', roomId = 0, parentAreaId = 0, areaId = 0 } = {}) {
  const room = { roomId: Number(roomId) || 0, parentAreaId: Number(parentAreaId) || 0, areaId: Number(areaId) || 0 };
  const headers = {
    'User-Agent': UA,
    Referer: room.roomId ? `https://live.bilibili.com/${room.roomId}` : 'https://live.bilibili.com/',
    ...(cookie ? { Cookie: cookie } : {})
  };
  let lastError = '未获取到礼物列表';
  for (const build of GIFT_URLS) {
    const url = build(room);
    if (url.includes('room_id=0') && url.includes('roomGiftList')) continue;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        lastError = `B站礼物接口 HTTP ${res.status}`;
        continue;
      }
      const payload = await res.json();
      if (payload.code !== 0 && payload.code != null) {
        lastError = payload.message || payload.msg || `礼物接口 ${payload.code}`;
        continue;
      }
      const list = normalizeGiftList(payload);
      if (list.length) return list;
    } catch (error) {
      lastError = error?.message || String(error);
    }
  }
  throw new Error(lastError);
}

function viewerUidOf(data = {}) {
  return String(
    data.uid
    ?? data.sender_uinfo?.uid
    ?? data.sender_uinfo?.base?.uid
    ?? data.uinfo?.uid
    ?? data.sender?.uid
    ?? ''
  ).trim();
}

export function parseDanmakuGift(doc) {
  const cmd = String(doc?.cmd || '');
  const data = doc?.data || {};
  let gift = null;
  if (cmd.startsWith('SEND_GIFT_V2')) {
    const inner = data.data || data;
    if (inner.giftId || inner.gift_id || inner.giftName || inner.gift_name) {
      gift = normalizeLiveGift(inner, inner.tid || data.tid);
    } else if (inner.pb || data.pb) {
      gift = decodeGiftProtobuf(inner.pb || data.pb);
    }
  } else if (cmd.startsWith('SEND_GIFT')) {
    gift = normalizeLiveGift(data, data.tid);
  }
  if (gift && !gift.uid) gift.uid = viewerUidOf(data);
  if (gift && !gift.name) gift.name = String(data.uname || data.sender_uinfo?.base?.name || '');
  return gift;
}

function normalizeLiveGift(data, tid) {
  const giftId = Number(data.giftId ?? data.gift_id ?? 0);
  const giftName = String(data.giftName ?? data.gift_name ?? '').trim();
  if (!giftId && !giftName) return null;
  const num = Math.max(1, Number(data.num ?? data.gift_num ?? 1) || 1);
  const coinType = String(data.coin_type || data.coinType || 'gold').toLowerCase();
  const unitPrice = Number(data.price ?? data.gift_price ?? data.discount_price ?? 0) || 0;
  const totalCoin = Number(data.total_coin ?? data.combo_total_coin ?? 0) || 0;
  const goldTotal = coinType === 'silver' ? 0 : (totalCoin || unitPrice * num);
  return {
    giftId,
    giftName,
    num,
    uid: viewerUidOf(data),
    name: String(data.uname ?? data.sender_uinfo?.base?.name ?? data.sender?.uname ?? data.name ?? ''),
    tid: String(tid || data.tid || ''),
    coinType,
    price: unitPrice,
    batteries: coinType === 'silver' ? 0 : Math.max(0, Math.round(goldTotal / 100))
  };
}

function readVarint(buf, start) {
  let value = 0n;
  let shift = 0n;
  let i = start;
  while (i < buf.length) {
    const byte = buf[i++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return { value, next: i };
}

function decodeGiftProtobuf(raw) {
  const buf = Buffer.from(String(raw), 'base64');
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const key = readVarint(buf, i);
    i = key.next;
    const field = Number(key.value >> 3n);
    const wire = Number(key.value & 7n);
    if (wire === 0) {
      const v = readVarint(buf, i);
      i = v.next;
      if (field === 1) out.giftId = Number(v.value);
      if (field === 3) out.num = Number(v.value);
    } else if (wire === 2) {
      const len = readVarint(buf, i);
      i = len.next;
      const size = Number(len.value);
      const slice = buf.subarray(i, i + size);
      i += size;
      if (field === 2) out.giftName = slice.toString('utf8');
      if (field === 8) out.coinType = slice.toString('utf8');
    } else if (wire === 1) i += 8;
    else if (wire === 5) i += 4;
    else break;
  }
  return normalizeLiveGift(out, '');
}

export function giftMatchesRequired(gift, required) {
  if (!gift || !required) return false;
  if (required.giftId && Number(gift.giftId) === Number(required.giftId)) return true;
  if (required.giftName && gift.giftName && required.giftName === gift.giftName) return true;
  return false;
}

export function normalizeQualifyMode(value) {
  return String(value || '') === 'threshold' ? 'threshold' : 'specific';
}

export function normalizeSkipAction(value) {
  return String(value || '') === 'credit' ? 'credit' : 'instant';
}

export function normalizeCountMode(value) {
  return String(value || '') === 'accumulate' ? 'accumulate' : 'once';
}

export function normalizeThreshold(value) {
  const n = Math.floor(Number(value) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 99999);
}

export function normalizeExpireSec(value) {
  const n = Math.floor(Number(value) || 0);
  if (!Number.isFinite(n)) return 300;
  return Math.max(10, Math.min(n, 86400));
}

export function giftBatteries(gift) {
  if (!gift) return 0;
  const coinType = String(gift.coinType || 'gold').toLowerCase();
  if (coinType === 'silver') return 0;
  const listed = Number(gift.batteries);
  if (Number.isFinite(listed) && listed > 0) return Math.round(listed);
  const price = Number(gift.price || gift.giftPrice || 0) || 0;
  const num = Math.max(1, Number(gift.num || 1) || 1);
  return Math.max(0, Math.round((price * num) / 100));
}

export function giftQualifies(gift, { mode, required, threshold } = {}) {
  if (!gift) return false;
  if (normalizeQualifyMode(mode) === 'threshold') {
    const need = normalizeThreshold(threshold);
    return need > 0 && giftBatteries(gift) >= need;
  }
  return giftMatchesRequired(gift, required);
}

export function qualifyConfigured(mode, required, threshold) {
  if (normalizeQualifyMode(mode) === 'threshold') return normalizeThreshold(threshold) > 0;
  return Boolean(required?.giftId || required?.giftName);
}

export function requestCreditGrant(gift, { mode, required, threshold, countMode } = {}) {
  if (!giftQualifies(gift, { mode, required, threshold })) return 0;
  if (normalizeQualifyMode(mode) === 'threshold') {
    const need = normalizeThreshold(threshold);
    if (need <= 0) return 0;
    if (normalizeCountMode(countMode) === 'accumulate') return Math.max(1, Math.floor(giftBatteries(gift) / need));
    return 1;
  }
  return Math.max(1, Number(gift.num || 1) || 1);
}

export function qualifyHint({ mode, required, threshold } = {}) {
  if (normalizeQualifyMode(mode) === 'threshold') {
    const need = normalizeThreshold(threshold);
    return need > 0 ? `满 ${need} 电池` : '尚未设定电池阈值';
  }
  return required?.giftName ? `「${required.giftName}」` : '指定礼物';
}

export function emptyGiftRequest() {
  return { giftId: 0, giftName: '', giftIcon: '', giftPrice: 0, coinType: 'gold', batteries: 0 };
}

export function giftFromCatalogItem(item) {
  return normalizeGiftRequest({
    giftId: item.id,
    giftName: item.name,
    giftIcon: item.icon,
    giftPrice: item.price,
    coinType: item.coinType,
    batteries: item.batteries
  });
}

export function reconcileGiftRequest(current, list) {
  const selected = normalizeGiftRequest(current);
  if (!selected.giftId && !selected.giftName) return { gift: selected, changed: false, missing: false };
  const catalog = Array.isArray(list) ? list : [];
  const byId = catalog.find(item => Number(item.id) === Number(selected.giftId));
  if (byId) {
    const next = giftFromCatalogItem(byId);
    const changed = next.giftId !== selected.giftId
      || next.giftName !== selected.giftName
      || next.giftIcon !== selected.giftIcon
      || next.giftPrice !== selected.giftPrice;
    return { gift: next, changed, missing: false };
  }
  const byName = catalog.find(item => item.name && item.name === selected.giftName);
  if (byName) return { gift: giftFromCatalogItem(byName), changed: true, missing: false };
  return { gift: selected, changed: false, missing: true };
}

export function normalizeGiftRequest(input) {
  const empty = emptyGiftRequest();
  if (!input || typeof input !== 'object') return empty;
  const giftId = Number(input.giftId || input.id || 0) || 0;
  const giftName = String(input.giftName || input.name || '').trim();
  const giftPrice = Number(input.giftPrice || input.price || 0) || 0;
  const coinType = String(input.coinType || 'gold').toLowerCase();
  return {
    giftId,
    giftName,
    giftIcon: String(input.giftIcon || input.icon || ''),
    giftPrice,
    coinType,
    batteries: Number(input.batteries) || (coinType === 'silver' ? 0 : Math.max(0, Math.round(giftPrice / 100)))
  };
}
