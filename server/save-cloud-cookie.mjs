import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weapiRequest } from './cloud-provider.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.MUSICHE_DATA || path.join(ROOT, '..', 'data');
const cookie = String(process.env.MUSICHE_CLOUD_COOKIE || '').trim();
if (!cookie || !/MUSIC_U=/.test(cookie)) {
  console.error('缺少 MUSICHE_CLOUD_COOKIE（需要含 MUSIC_U）');
  process.exit(1);
}

const SESSION_KEY = crypto.createHash('sha256').update(process.env.MUSICHE_SESSION_SECRET || 'musiche-danmaku-local-secret').digest();
function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${data.toString('base64')}`;
}

const normalized = cookie.includes('os=') ? cookie : `os=pc; ${cookie}`;
const me = await weapiRequest('https://music.163.com/weapi/w/nuser/account/get?csrf_token=', {}, { cookie: normalized });
const uid = String(me?.profile?.userId || me?.account?.id || '');
const name = me?.profile?.nickname || '';
if (!uid && !me?.account) {
  console.error('Cookie 未能换到网易云账号资料');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'musiche-danmaku.sqlite'));
const now = Date.now();
db.prepare('INSERT INTO cloud_accounts(id,uid,name,cookie_ciphertext,remember_login,created_at,updated_at) VALUES(1,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET uid=excluded.uid,name=excluded.name,cookie_ciphertext=excluded.cookie_ciphertext,remember_login=excluded.remember_login,updated_at=excluded.updated_at')
  .run(uid, name, encryptSecret(normalized), 1, now, now);
console.log(JSON.stringify({ ok: true, loggedIn: true, uid: uid ? `${uid.slice(0, 2)}****` : '', name }));
