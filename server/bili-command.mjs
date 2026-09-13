import { DEFAULT_COMMAND_CONFIG, hasPermission } from './bili-permission.mjs';
import { SOURCE_LABELS, splitOrderKeyword } from './sources.mjs';
import { matchSongBlacklist } from './song-blacklist.mjs';
import { runHooks } from './command-hooks.mjs';

export { DEFAULT_COMMAND_CONFIG, hasPermission };

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, '').toLowerCase();
}

function pickSong(list, keyword) {
  const playable = list.filter(item => item.playable);
  const pool = playable.length ? playable : list;
  const kw = normalizeTitle(keyword);
  return pool.find(item => normalizeTitle(item.name) === kw)
    || pool.find(item => {
      const name = normalizeTitle(item.name);
      return name.includes(kw) || (kw && kw.includes(name));
    })
    || pool[0];
}

export function createCommandHandler({
  getConfig,
  getAccepting,
  setAccepting,
  getQueue,
  getCurrent,
  enqueue,
  top,
  remove,
  skip,
  search,
  lookup,
  log,
  isGiftRequestEnabled,
  getRequiredGift,
  getGiftRequestHint,
  isGiftRequestReady,
  hasGiftCredit,
  consumeGiftCredit,
  refundGiftCredit,
  isGiftSkipCreditEnabled,
  hasSkipCredit,
  consumeSkipCredit,
  isRoomOwner,
  isSongBlacklistEnabled,
  getSongBlacklist
}) {
  const userCooldowns = new Map();
  let lastOrderAt = 0;

  async function requestSong(user, rawKeyword, mode = 'normal') {
    const parsed = splitOrderKeyword(rawKeyword);
    const keyword = parsed.keyword;
    const platform = parsed.platform;
    const songId = parsed.songId;
    if (!keyword) {
      const message = `[拒绝] 缺少歌名`;
      log(message);
      runHooks('onOrderRejected', { user, reason: 'missing_keyword', message });
      return;
    }
    if (isSongBlacklistEnabled?.()) {
      const hit = matchSongBlacklist(keyword, getSongBlacklist?.() || []);
      if (hit) {
        const message = `[拒绝] 点歌黑名单：${keyword}（规则「${hit}」）`;
        log(message);
        runHooks('onOrderRejected', { user, reason: 'blacklist', keyword, message });
        return;
      }
    }
    const cfg = getConfig();
    const P = name => hasPermission(user, cfg[name], cfg.superUsers || []);
    if (mode === 'normal' && !P('orderPerm')) {
      const message = `[拒绝] ${user.name} 权限不足`;
      log(message);
      runHooks('onOrderRejected', { user, reason: 'permission', message });
      return;
    }
    const isSuper = (cfg.superUsers || []).includes(user.name) || Boolean(isRoomOwner?.(user.uid));
    const giftMode = Boolean(isGiftRequestEnabled?.());
    const requiredHint = getGiftRequestHint?.() || getRequiredGift?.()?.giftName || '指定礼物';
    let charged = false;
    if (giftMode && !isSuper && !String(user.uid || '').trim()) {
      log(`[拒绝] 无法确认观众身份，点歌资格只记在送礼人自己的账号上`);
      return;
    }
    if (giftMode && !isSuper) {
      if (!isGiftRequestReady?.()) {
        log(`[拒绝] 礼物点歌已开启，但尚未指定礼物或电池阈值`);
        return;
      }
      if (!hasGiftCredit?.(user.uid)) {
        log(`[拒绝] ${user.name} 请先赠送 ${requiredHint} 后再点歌`);
        return;
      }
      charged = Boolean(consumeGiftCredit?.(user.uid));
      if (!charged) {
        log(`[拒绝] ${user.name} 请先赠送 ${requiredHint} 后再点歌`);
        return;
      }
    }
    const refund = () => { if (charged) refundGiftCredit?.(user.uid); };
    if (!isSuper && getQueue().length >= cfg.playlistLimit) {
      refund();
      const message = `[拒绝] 队列已满（上限 ${cfg.playlistLimit} 首）`;
      log(message);
      runHooks('onOrderRejected', { user, reason: 'queue_full', message });
      return;
    }
    if (!isSuper && mode === 'normal' && !giftMode) {
      if (cfg.globalCooldownSec > 0 && lastOrderAt && Date.now() - lastOrderAt < cfg.globalCooldownSec * 1000) {
        const wait = Math.ceil((lastOrderAt + cfg.globalCooldownSec * 1000 - Date.now()) / 1000);
        log(`[拒绝] 全局冷却中，请 ${wait}s 后再点`);
        return;
      }
      const last = userCooldowns.get(user.uid) || 0;
      if (cfg.userCooldownSec > 0 && Date.now() - last < cfg.userCooldownSec * 1000) {
        log(`[拒绝] ${user.name} 冷却中`);
        return;
      }
    }
    let song = null;
    try {
      if (songId) {
        song = await lookup?.(platform, songId);
      } else {
        const sources = platform ? [platform] : undefined;
        let list = await search(keyword, sources);
        if (!platform && list.length) {
          const groups = [];
          for (const item of list) {
            const type = item.type || item.platform;
            if (!groups.length || groups[groups.length - 1].type !== type) groups.push({ type, list: [item] });
            else groups[groups.length - 1].list.push(item);
          }
          list = (groups.find(group => group.list.some(item => item.playable)) || groups[0]).list;
        }
        song = pickSong(list, keyword);
      }
    } catch (error) {
      refund();
      log(`[错误] ${songId ? '按 ID 查找' : '搜索'}失败: ${error.message}`, 'error');
      return;
    }
    if (!song) {
      refund();
      const message = `[失败] 未找到歌曲: ${songId ? `${platform ? (SOURCE_LABELS[platform] || platform) : '优先音源'} ID ${songId}` : keyword}${!songId && platform ? `（${SOURCE_LABELS[platform] || platform}）` : ''}`;
      log(message, 'error');
      runHooks('onOrderRejected', { user, reason: 'not_found', keyword, platform, songId, message });
      return;
    }
    if (isSongBlacklistEnabled?.()) {
      const foundHit = matchSongBlacklist([song.name, song.singer, song.artist].filter(Boolean).join(' '), getSongBlacklist?.() || []);
      if (foundHit) {
        refund();
        log(`[拒绝] 点歌黑名单：${song.name}（规则「${foundHit}」）`);
        return;
      }
    }
    song.requestedBy = user.name;
    song.requestedByUid = user.uid;
    song.origin = 'request';
    await enqueue(song, mode);
    userCooldowns.set(user.uid, Date.now());
    lastOrderAt = Date.now();
    const via = SOURCE_LABELS[song.type || song.platform] || song.type || '';
    log(`[入队] ${song.name} · ${user.name}${via ? ` · ${via}` : ''}${songId ? ` · ID ${songId}` : ''}`);
    runHooks('onOrderAccepted', { user, song, mode });
  }

  return {
    async handle(user) {
      const msg = String(user.msg || '').trim();
      if (!msg) return;
      const cfg = getConfig();
      const P = name => hasPermission(user, cfg[name], cfg.superUsers || []);

      if (msg === '开启点歌') {
        if (P('togglePerm')) { setAccepting(true); log(`[系统] ${user.name} 开启点歌`); }
        return;
      }
      if (msg === '关闭点歌') {
        if (P('togglePerm')) { setAccepting(false); log(`[系统] ${user.name} 关闭点歌`); }
        return;
      }
      if (!getAccepting()) return;

      if (msg.startsWith('立即点歌') || msg.startsWith('插队点歌') || msg.startsWith('置顶点歌')) {
        const mode = msg.startsWith('置顶') ? 'top' : 'playNow';
        const kw = msg.replace(/^(立即点歌|插队点歌|置顶点歌)/, '').trim();
        if (kw && (mode === 'top' ? P('topPerm') : P('forcePerm'))) await requestSong(user, kw, mode);
        return;
      }
      if (msg.startsWith('移除')) {
        if (P('forcePerm')) remove(msg.slice(2).trim(), user);
        return;
      }
      if (msg.startsWith('置顶') || msg.startsWith('优先')) {
        if (P('topPerm')) top(msg.replace(/^(置顶|优先)/, '').trim(), user);
        return;
      }
      if (msg === '切歌' || msg === '跳过') {
        const current = getCurrent?.();
        const can = P('skipPerm') || current?.requestedByUid === user.uid;
        if (can) {
          skip(user);
          return;
        }
        if (isGiftSkipCreditEnabled?.()) {
          if (!String(user.uid || '').trim()) {
            log(`[拒绝] 无法确认观众身份，切歌次数只记在送礼人自己的账号上`);
            return;
          }
          if (!hasSkipCredit?.(user.uid) || !consumeSkipCredit?.(user.uid)) {
            log(`[拒绝] ${user.name} 没有有效的切歌次数（请先送礼，注意次数会过期）`);
            return;
          }
          skip(user);
        }
        return;
      }
      const commands = cfg.command?.length ? cfg.command : ['点歌'];
      const hit = commands.find(key => key && msg.startsWith(key)) || (msg.startsWith('点歌') ? '点歌' : '');
      if (hit) {
        const kw = msg.slice(hit.length).trim();
        if (kw) await requestSong(user, kw, 'normal');
      }
    }
  };
}
