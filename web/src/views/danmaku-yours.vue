<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useDebounceFn } from '@vueuse/core';
import { Search } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus/es/components/message/index';
import PlaylistEle from '../components/Playlist.vue';
import AnimalPage from '../components/AnimalPage.vue';
import { musicTypeInfoAll } from '../utils/platform';
import { MusicType, Playlist } from '../utils/type';
import { danmakuMe, danmakuPlaylists, type DanmakuAccount } from '../utils/api/danmaku-qq';
import { usePlayStore } from '../stores/play';

const { currentRoute, replace, push } = useRouter();
const play = usePlayStore();
const playlist = ref<Playlist[]>([]);
const searchKey = ref('');
const loading = ref(false);
const accountsLoading = ref(false);
const accounts = ref<DanmakuAccount[]>(play.danmakuAccounts.slice());
const scrollBar = ref();
const unWatch = watch(currentRoute, () => getPlaylist(true));
const onScroll = useDebounceFn(checkScrollBottom, 200);
let total = 0;
let loadToken = 0;
let accountsLoaded = false;
let fillingForSearch = false;

function playlistText(name?: string) {
  return String(name || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
    .toLowerCase();
}

const searchKeyword = computed(() => searchKey.value.trim().toLowerCase());
const visiblePlaylists = computed(() => {
  const key = searchKeyword.value;
  if (!key) return playlist.value;
  return playlist.value.filter(item => playlistText(item.name).includes(key));
});

const currentType = computed(() => (currentRoute.value.params.type?.toString() || '') as MusicType);
const loggedAccounts = computed(() => accounts.value.filter(item => item.loggedIn));
const idleLabel = computed(() => {
  const selected = play.danmakuIdlePlaylist;
  if (!play.danmakuIdlePlaylistEnabled) return '闲时歌单未开启';
  if (!selected?.name) return '已开启，尚未选择歌单';
  return `闲时：${selected.name}`;
});

function accountOf(type: string) {
  return accounts.value.find(item => item.source === type);
}

async function loadAccounts() {
  if (accountsLoaded) return;
  accountsLoading.value = !accounts.value.length;
  try {
    const data = await danmakuMe();
    accounts.value = data.accounts || [];
    play.danmakuAccounts = accounts.value;
    play.applyDanmakuIdleConfig(data);
    accountsLoaded = true;
  } catch (error: any) {
    ElMessage.error(error?.message || '读取账号失败');
  } finally {
    accountsLoading.value = false;
  }
}

function shouldRedirect() {
  const type = currentType.value;
  const logged = loggedAccounts.value;
  if (!logged.length) return false;
  if (!logged.some(item => item.source === type)) {
    replace('/yours/' + logged[0].source);
    return true;
  }
  return false;
}

async function getPlaylist(clear = true) {
  const type = currentType.value;
  const token = ++loadToken;
  if (clear) {
    searchKey.value = '';
    loading.value = true;
    playlist.value = [];
    const listTask = type
      ? danmakuPlaylists(type, 0).catch((error: any) => ({ total: 0, list: [] as Playlist[], error }))
      : Promise.resolve(null);
    await loadAccounts();
    if (token !== loadToken) return;
    if (shouldRedirect()) {
      loading.value = false;
      return;
    }
    if (!accountOf(type)?.loggedIn) {
      total = 0;
      loading.value = false;
      return;
    }
    const result = await listTask;
    if (token !== loadToken) return;
    if (result && 'error' in result && result.error) {
      ElMessage.error(result.error?.message || '读取歌单失败');
    }
    total = result?.total || 0;
    playlist.value = result?.list || [];
    loading.value = false;
    return;
  }
  if (loading.value || !type || !accountOf(type)?.loggedIn) return;
  loading.value = true;
  try {
    const result = await danmakuPlaylists(type, playlist.value.length);
    if (token !== loadToken) return;
    total = result.total;
    result.list.forEach(item => playlist.value.push(item));
  } catch (error: any) {
    ElMessage.error(error?.message || '读取歌单失败');
  } finally {
    if (token === loadToken) loading.value = false;
  }
}

function checkScrollBottom(e: any) {
  if (
    total > playlist.value.length &&
    !loading.value &&
    e.scrollTop + scrollBar.value.wrapRef.offsetHeight >
      scrollBar.value.wrapRef.children[0].children[0].offsetHeight - 50
  ) {
    getPlaylist(false);
  }
}

function changeType(type: MusicType) {
  if (type === currentType.value) return;
  searchKey.value = '';
  push('/yours/' + type);
}

async function loadRemainingForSearch() {
  if (fillingForSearch || !searchKeyword.value) return;
  fillingForSearch = true;
  try {
    while (searchKeyword.value && total > playlist.value.length) {
      const before = playlist.value.length;
      await getPlaylist(false);
      if (playlist.value.length <= before) break;
    }
  } finally {
    fillingForSearch = false;
  }
}

watch(searchKeyword, () => {
  if (searchKeyword.value) loadRemainingForSearch();
});

onMounted(() => getPlaylist(true));
onUnmounted(unWatch);
</script>

<template>
  <AnimalPage>
    <el-scrollbar ref="scrollBar" class="music-recommend" @scroll="onScroll">
      <div class="yours-toolbar">
        <div class="music-setting-account">
          <div v-for="info in musicTypeInfoAll" :key="info.type">
            <img :src="info.image" :title="info.name" />
            <img
              v-if="accountOf(info.type)?.image"
              :src="accountOf(info.type)?.image"
              :alt="accountOf(info.type)?.name || info.name" />
            <span
              v-if="accountOf(info.type)?.loggedIn"
              :class="{ active: currentType === info.type }"
              @click="changeType(info.type)">
              {{ accountOf(info.type)?.name || info.name }}
            </span>
            <span v-else @click="push('/setting/accounts')">去登录 {{ info.name }}</span>
          </div>
        </div>
        <div class="yours-toolbar-row">
          <div class="yours-idle-hint">{{ idleLabel }}</div>
          <el-input
            v-if="loggedAccounts.length"
            v-model="searchKey"
            class="yours-search"
            placeholder="搜索歌单"
            clearable>
            <template #prefix>
              <el-icon><Search /></el-icon>
            </template>
          </el-input>
        </div>
      </div>
      <div v-if="!accountsLoading && !loggedAccounts.length" class="yours-empty">
        <p>登录音乐平台后即可查看「我喜欢」和个人歌单，并设为闲时播放。</p>
        <el-button type="primary" @click="push('/setting/accounts')">去账号与直播</el-button>
      </div>
      <div
        v-else-if="searchKeyword && !visiblePlaylists.length && !loading"
        class="yours-empty">
        <p>没有找到匹配「{{ searchKey.trim() }}」的歌单</p>
      </div>
      <PlaylistEle v-else :loading="loading && !visiblePlaylists.length" :list="visiblePlaylists" />
    </el-scrollbar>
  </AnimalPage>
</template>

<style lang="less" scoped>
.music-recommend {
  height: 100%;
  padding: 0 var(--music-page-padding-horizontal);
  @media (max-width: 800px) {
    padding: 0 10px;
  }
}
.yours-toolbar {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 16px;
}
.yours-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.yours-idle-hint {
  color: var(--el-text-color-placeholder);
  font-size: 12px;
  min-width: 0;
  flex: 1;
}
.yours-search {
  width: min(280px, 100%);
  :deep(.el-input__wrapper) {
    box-shadow: none;
    background: var(--music-search-background);
    border: 1px solid var(--music-side-divider-color);
  }
}
.yours-empty {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 14px;
  padding: 24px 4px;
  color: var(--el-text-color-regular);
}
.music-setting-account {
  & > div + div {
    margin-top: 5px;
  }
  & > div {
    width: 100%;
    height: 34px;
    display: flex;
    align-items: center;
    & > img {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      margin-left: 2px;
      box-shadow: 2px 2px 5px rgba(0, 0, 0, 0.1);
      object-fit: cover;
    }
    span {
      cursor: pointer;
      margin-left: 10px;
      color: var(--music-primary-color);
      &:hover {
        text-decoration: underline;
      }
      &.active {
        font-weight: 600;
      }
    }
  }
}
</style>
