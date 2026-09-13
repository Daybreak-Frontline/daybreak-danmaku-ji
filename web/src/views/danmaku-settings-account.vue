<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus/es/components/message/index';
import { usePlayStore } from '../stores/play';
import {
  biliAccountStatus,
  biliConnect,
  biliDisconnect,
  biliLoginPoll,
  biliLoginStart,
  biliLogout,
  cloudAccountStatus,
  cloudLoginPoll,
  cloudLoginStart,
  cloudLogout,
  danmakuConfig,
  danmakuConfigSave,
  miguAccountStatus,
  miguLoginPoll,
  miguLoginStart,
  miguLogout,
  qqAccountStatus,
  qqLoginPoll,
  qqLoginStart,
  qqLogout
} from '../utils/api/danmaku-qq';

const route = useRoute();
const play = usePlayStore();
const tab = computed(() => String(route.meta.settingTab || 'accounts'));
const biliRoom = ref('');
const autoConnect = ref(false);
const rememberLogin = ref(true);
const biliLogin = ref(false);
const biliUid = ref('');
const biliQr = ref('');
const biliLoginState = ref('未登录');
const biliBusy = ref(false);
let biliSession = '';
let biliPollTimer: number | null = null;
const qqLogin = ref(false);
const qqUin = ref('');
const qqQr = ref('');
const qqLoginState = ref('未登录');
let qqSession = '';
let qqPollTimer: number | null = null;
const cloudLogin = ref(false);
const cloudUid = ref('');
const cloudName = ref('');
const cloudQr = ref('');
const cloudLoginState = ref('未登录');
let cloudSession = '';
let cloudPollTimer: number | null = null;
const miguLogin = ref(false);
const miguUid = ref('');
const miguName = ref('');
const miguQr = ref('');
const miguLoginState = ref('未登录');
let miguSession = '';
let miguPollTimer: number | null = null;
const conn = computed(() => play.danmakuConnection);
const connLabel = computed(() => {
  const s = conn.value?.state || 'idle';
  if (s === 'connected') return '已连接';
  if (s === 'connecting' || s === 'connecting_room' || s === 'authenticating' || s === 'reconnecting') return '连接中';
  if (s === 'degraded') return '降级';
  if (s === 'failed') return '失败';
  return biliLogin.value ? '已登录未连接' : '未登录';
});
function stopQqPoll() { if (qqPollTimer != null) window.clearTimeout(qqPollTimer); qqPollTimer = null; }
function stopCloudPoll() { if (cloudPollTimer != null) window.clearTimeout(cloudPollTimer); cloudPollTimer = null; }
function stopMiguPoll() { if (miguPollTimer != null) window.clearTimeout(miguPollTimer); miguPollTimer = null; }
function stopBiliPoll() { if (biliPollTimer != null) window.clearTimeout(biliPollTimer); biliPollTimer = null; }
function loginLabel(loggedIn: boolean, name: string, uid: string) {
  if (!loggedIn) return '未登录';
  const who = name || uid;
  return who ? `已登录 · ${who}` : '已登录';
}
async function saveBiliOptions() {
  await danmakuConfigSave({
    autoConnect: autoConnect.value,
    biliRoom: biliRoom.value
  });
  play.danmakuBiliRoom = biliRoom.value;
  ElMessage.success('连接设置已保存');
}
async function pollQq() {
  if (!qqSession) return;
  try {
    const result = await qqLoginPoll(qqSession);
    if (result.loggedIn) { qqLogin.value = true; qqUin.value = result.uin || ''; qqLoginState.value = `已登录${qqUin.value ? ` · ${qqUin.value}` : ''}${result.musicLogin === false ? ' · 未完成音乐登录，VIP 可能无法播' : ''}`; qqQr.value = ''; stopQqPoll(); ElMessage.success('QQ音乐登录成功'); return; }
    qqLoginState.value = result.status === 'authorizing' ? '已扫码，请在手机确认' : result.status === 'expired' ? '二维码已过期' : '等待扫码';
    if (result.status !== 'expired' && result.status !== 'failed') qqPollTimer = window.setTimeout(pollQq, 1500);
  } catch (error) { qqLoginState.value = error instanceof Error ? error.message : '登录轮询失败'; stopQqPoll(); }
}
async function startQqLogin() {
  stopQqPoll(); qqLoginState.value = '正在生成二维码';
  try { const result = await qqLoginStart(); qqSession = result.sessionId; qqQr.value = result.image; qqLoginState.value = '等待扫码'; qqPollTimer = window.setTimeout(pollQq, 1500); }
  catch (error) { qqLoginState.value = error instanceof Error ? error.message : '二维码生成失败'; }
}
async function logoutQq() { stopQqPoll(); qqSession = ''; await qqLogout(); qqLogin.value = false; qqUin.value = ''; qqQr.value = ''; qqLoginState.value = '未登录'; ElMessage.success('QQ音乐已退出登录'); }
async function pollCloud() {
  if (!cloudSession) return;
  try {
    const result = await cloudLoginPoll(cloudSession);
    if (result.loggedIn) {
      cloudLogin.value = true;
      cloudUid.value = result.uid || '';
      cloudName.value = result.name || '';
      cloudLoginState.value = loginLabel(true, cloudName.value, cloudUid.value);
      cloudQr.value = '';
      stopCloudPoll();
      ElMessage.success('网易云登录成功');
      return;
    }
    cloudLoginState.value = result.status === 'authorizing' ? '已扫码，请在手机确认' : result.status === 'expired' ? '二维码已过期' : '等待扫码';
    if (result.status !== 'expired' && result.status !== 'failed') cloudPollTimer = window.setTimeout(pollCloud, 1500);
  } catch (error) { cloudLoginState.value = error instanceof Error ? error.message : '登录轮询失败'; stopCloudPoll(); }
}
async function startCloudLogin() {
  stopCloudPoll(); cloudLoginState.value = '正在生成二维码';
  try { const result = await cloudLoginStart(); cloudSession = result.sessionId; cloudQr.value = result.image; cloudLoginState.value = '等待扫码'; cloudPollTimer = window.setTimeout(pollCloud, 1500); }
  catch (error) { cloudLoginState.value = error instanceof Error ? error.message : '二维码生成失败'; }
}
async function logoutCloud() { stopCloudPoll(); cloudSession = ''; await cloudLogout(); cloudLogin.value = false; cloudUid.value = ''; cloudName.value = ''; cloudQr.value = ''; cloudLoginState.value = '未登录'; ElMessage.success('网易云已退出登录'); }
async function pollMigu() {
  if (!miguSession) return;
  try {
    const result = await miguLoginPoll(miguSession);
    if (result.loggedIn) {
      miguLogin.value = true;
      miguUid.value = result.uid || '';
      miguName.value = result.name || '';
      miguLoginState.value = loginLabel(true, miguName.value, miguUid.value);
      miguQr.value = '';
      stopMiguPoll();
      ElMessage.success('咪咕登录成功');
      return;
    }
    miguLoginState.value = result.status === 'authorizing' ? '已扫码，请在手机确认' : result.status === 'expired' ? '二维码已过期' : '等待扫码';
    if (result.status !== 'expired' && result.status !== 'failed') miguPollTimer = window.setTimeout(pollMigu, 1500);
  } catch (error) { miguLoginState.value = error instanceof Error ? error.message : '登录轮询失败'; stopMiguPoll(); }
}
async function startMiguLogin() {
  stopMiguPoll(); miguLoginState.value = '正在生成二维码';
  try { const result = await miguLoginStart(); miguSession = result.sessionId; miguQr.value = result.image; miguLoginState.value = '等待扫码'; miguPollTimer = window.setTimeout(pollMigu, 1500); }
  catch (error) { miguLoginState.value = error instanceof Error ? error.message : '二维码生成失败'; }
}
async function logoutMigu() { stopMiguPoll(); miguSession = ''; await miguLogout(); miguLogin.value = false; miguUid.value = ''; miguName.value = ''; miguQr.value = ''; miguLoginState.value = '未登录'; ElMessage.success('咪咕已退出登录'); }
async function pollBili() {
  if (!biliSession) return;
  try {
    const result = await biliLoginPoll(biliSession);
    if (result.loggedIn) {
      biliLogin.value = true;
      biliUid.value = result.uid || '';
      biliLoginState.value = `已登录${biliUid.value ? ` · ${biliUid.value}` : ''}`;
      biliQr.value = '';
      stopBiliPoll();
      ElMessage.success('B站登录成功');
      return;
    }
    biliLoginState.value = result.status === 'authorizing' ? '已扫码，请在手机确认' : result.status === 'expired' ? '二维码已过期' : '等待扫码';
    if (result.status !== 'expired' && result.status !== 'failed') biliPollTimer = window.setTimeout(pollBili, 1500);
  } catch (error) { biliLoginState.value = error instanceof Error ? error.message : '登录轮询失败'; stopBiliPoll(); }
}
async function startBiliLogin() {
  stopBiliPoll(); biliLoginState.value = '正在生成二维码';
  try {
    const result = await biliLoginStart();
    biliSession = result.sessionId;
    biliQr.value = result.image;
    biliLoginState.value = '等待扫码';
    biliPollTimer = window.setTimeout(pollBili, 1500);
  } catch (error) { biliLoginState.value = error instanceof Error ? error.message : '二维码生成失败'; }
}
async function logoutBili() {
  stopBiliPoll();
  biliSession = '';
  await biliLogout();
  biliLogin.value = false;
  biliUid.value = '';
  biliQr.value = '';
  biliLoginState.value = '未登录';
  ElMessage.success('B站已退出登录');
}
async function connectRoom() {
  if (!biliLogin.value) { ElMessage.error('请先扫码登录 B站，匿名弹幕不可用'); return; }
  if (!biliRoom.value.trim()) { ElMessage.error('请输入直播间号或直播间链接'); return; }
  biliBusy.value = true;
  try {
    const result = await biliConnect(biliRoom.value.trim());
    if (result.ok) ElMessage.success('正在连接弹幕');
    else ElMessage.error(result.error || '连接失败');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '连接失败');
  } finally { biliBusy.value = false; }
}
async function disconnectRoom() {
  biliBusy.value = true;
  try { await biliDisconnect(); ElMessage.success('已断开弹幕'); }
  catch (error) { ElMessage.error(error instanceof Error ? error.message : '断开失败'); }
  finally { biliBusy.value = false; }
}
onMounted(async () => {
  try {
    const qq = await qqAccountStatus();
    qqLogin.value = qq.loggedIn;
    qqUin.value = qq.uin || '';
    qqLoginState.value = qq.loggedIn ? `已登录 · ${qq.uin}${qq.musicLogin === false ? ' · 未完成音乐登录，VIP 可能无法播' : ''}` : '未登录';
  } catch {}
  try {
    const cloud = await cloudAccountStatus();
    cloudLogin.value = cloud.loggedIn;
    cloudUid.value = cloud.uid || '';
    cloudName.value = cloud.name || '';
    cloudLoginState.value = loginLabel(cloud.loggedIn, cloud.name || '', cloud.uid || '');
  } catch {}
  try {
    const migu = await miguAccountStatus();
    miguLogin.value = migu.loggedIn;
    miguUid.value = migu.uid || '';
    miguName.value = migu.name || '';
    miguLoginState.value = loginLabel(migu.loggedIn, migu.name || '', migu.uid || '');
  } catch {}
  try {
    const bili = await biliAccountStatus();
    biliLogin.value = bili.loggedIn;
    biliUid.value = bili.uid || '';
    biliLoginState.value = bili.loggedIn ? `已登录 · ${bili.uid}` : '未登录';
    if (bili.connection) play.danmakuConnection = bili.connection;
  } catch {}
  try {
    const cfg = await danmakuConfig();
    if (typeof cfg.biliRoom === 'string') {
      biliRoom.value = cfg.biliRoom;
      play.danmakuBiliRoom = cfg.biliRoom;
    }
    if (typeof cfg.autoConnect === 'boolean') autoConnect.value = cfg.autoConnect;
  } catch {}
});
onUnmounted(() => {
  stopQqPoll(); stopCloudPoll(); stopMiguPoll(); stopBiliPoll();
});
</script>

<template>
  <div class="settings-grid">
    <section v-if="tab === 'accounts'" class="setting-card setting-wide">
      <div class="card-heading"><div><h2>B站弹幕连接</h2><p>必须扫码登录后才能连直播间。</p></div><span class="status-tag" :class="{ connected: conn.state === 'connected' }">{{ connLabel }}</span></div>
      <div v-if="biliQr" class="qq-login-area">
        <img :src="biliQr" alt="B站登录二维码" />
        <div>
          <strong>请使用哔哩哔哩 App 扫码登录</strong>
          <p>{{ biliLoginState }}<br />二维码约 180 秒有效，登录态只保存在本机。</p>
          <el-button plain size="small" @click="startBiliLogin">刷新二维码</el-button>
        </div>
      </div>
      <div v-else class="form-row">
        <el-button v-if="!biliLogin" type="primary" @click="startBiliLogin">B站扫码登录</el-button>
        <el-button v-else plain @click="logoutBili">退出登录 {{ biliUid }}</el-button>
      </div>
      <div class="form-row" style="margin-top:12px">
        <el-input v-model="biliRoom" placeholder="输入直播间号或直播间链接" />
        <el-button type="primary" :disabled="!biliLogin || biliBusy" :loading="biliBusy" @click="connectRoom">连接弹幕</el-button>
        <el-button plain :disabled="biliBusy" @click="disconnectRoom">断开</el-button>
      </div>
      <p v-if="conn.detail" class="setting-tip" style="margin-top:12px">{{ conn.detail }}</p>
      <div class="setting-line"><div><strong>记住登录状态</strong><span>仅保存在本机数据库中</span></div><el-switch v-model="rememberLogin" /></div>
      <div class="setting-line"><div><strong>启动时自动连接</strong><span>登录后自动连接上次直播间</span></div><el-switch v-model="autoConnect" @change="saveBiliOptions" /></div>
    </section>
    <div v-if="tab === 'accounts'" class="settings-account-grid">
      <section class="setting-card">
        <div class="card-heading"><div><h2>QQ音乐</h2><p>登录后按账号权限取 VIP 地址。</p></div><span class="status-tag" :class="{ connected: qqLogin }">{{ qqLogin ? '已登录' : qqLoginState }}</span></div>
        <div v-if="qqQr" class="qq-login-area"><img :src="qqQr" alt="QQ音乐登录二维码" /><div><strong>请用 QQ 扫码</strong><p>{{ qqLoginState }}</p><el-button plain size="small" @click="startQqLogin">刷新二维码</el-button></div></div>
        <div v-else class="form-row"><el-button v-if="!qqLogin" type="primary" @click="startQqLogin">扫码登录</el-button><el-button v-else plain @click="logoutQq">退出 {{ qqUin }}</el-button></div>
      </section>
      <section class="setting-card">
        <div class="card-heading"><div><h2>网易云</h2><p>登录后按账号权限取 VIP 地址。</p></div><span class="status-tag" :class="{ connected: cloudLogin }">{{ cloudLogin ? '已登录' : cloudLoginState }}</span></div>
        <div v-if="cloudQr" class="qq-login-area"><img :src="cloudQr" alt="网易云登录二维码" /><div><strong>请用网易云 App 扫码</strong><p>{{ cloudLoginState }}</p><el-button plain size="small" @click="startCloudLogin">刷新二维码</el-button></div></div>
        <div v-else class="form-row"><el-button v-if="!cloudLogin" type="primary" @click="startCloudLogin">扫码登录</el-button><el-button v-else plain @click="logoutCloud">退出 {{ cloudName || cloudUid }}</el-button></div>
      </section>
      <section class="setting-card">
        <div class="card-heading"><div><h2>咪咕</h2><p>登录后按账号权限取 VIP 地址。</p></div><span class="status-tag" :class="{ connected: miguLogin }">{{ miguLogin ? '已登录' : miguLoginState }}</span></div>
        <div v-if="miguQr" class="qq-login-area"><img :src="miguQr" alt="咪咕登录二维码" /><div><strong>请用咪咕 App 扫码</strong><p>{{ miguLoginState }}</p><el-button plain size="small" @click="startMiguLogin">刷新二维码</el-button></div></div>
        <div v-else class="form-row"><el-button v-if="!miguLogin" type="primary" @click="startMiguLogin">扫码登录</el-button><el-button v-else plain @click="logoutMigu">退出 {{ miguName || miguUid }}</el-button></div>
      </section>
    </div>
  </div>
</template>
