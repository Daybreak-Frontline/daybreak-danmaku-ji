<script setup lang="ts">
import { ref, onMounted, watch, Ref, onUnmounted, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useDebounceFn } from '@vueuse/core';
import * as api from '../utils/api/api';
import { usePlayStore } from '../stores/play';
import { Music, MusicType, Playlist } from '../utils/type';
import MusicList from '../components/MusicList.vue';
import AnimalPage from '../components/AnimalPage.vue';
import { LogoImage } from '../utils/logo';
import { ElMessage } from 'element-plus/es/components/message/index';
import { danmakuPlaylistDetail } from '../utils/api/danmaku-qq';
import DailyImage from '../assets/images/calendar.png';
import { useSettingStore } from '../stores/setting';
const { currentRoute, replace } = useRouter();
const play = usePlayStore();
const setting = useSettingStore();
const total = ref(0);
const musicList: Ref<Music[]> = ref([] as Music[]);
const playlistInfo: Ref<Playlist | null> = ref({} as Playlist);
const loading = ref(false);
const loadingMore = ref(false);
const playAllButton = ref();
const scrollBar = ref();
const playlistInfoShow = ref(false);
const affixShow = ref(false);
const unWatch = watch(currentRoute, () => searchMusic(true));
const pageKeys = ['album', 'playlist', 'lover', 'recent', 'created'];
const hideFavoriteKeys = ['lover', 'created', 'playlist'];
const isCurrentIdle = computed(() => {
  const selected = play.danmakuIdlePlaylist;
  const info = playlistInfo.value;
  return Boolean(selected && info && String(selected.id) === String(info.id) && selected.source === info.type);
});
let loadToken = 0;
let morePromise: Promise<void> | null = null;
async function searchMusic(clear: boolean = true) {
  const routerKey = currentRoute.value.meta.key?.toString() || '';
  if (!pageKeys.includes(routerKey)) return false;
  const localShow = Boolean(currentRoute.value.meta.localShow);
  const musicType: MusicType = currentRoute.value.params.type as any;
  setting.currentMusicTypeShow = false;
  const playlistId: string = currentRoute.value.params.id?.toString() ?? '';
  if (!localShow && !playlistId) {
    replace('/');
    return;
  }
  if (!clear) {
    if (morePromise) return morePromise;
    if (loading.value) return;
  }
  const token = ++loadToken;
  var result: {
    total: number;
    list: Music[];
    playlist: Playlist | null;
  };
  if (clear) {
    musicList.value = [];
    playlistInfo.value = null;
    loading.value = true;
    loadingMore.value = false;
  } else {
    loadingMore.value = true;
  }
  playlistInfoShow.value = routerKey !== 'recent';
  const run = async () => {
    try {
      switch (currentRoute.value.meta.key) {
        case 'album':
          result = await api.albumDetail(
            musicType,
            playlistId,
            musicList.value.length
          );
          break;
        case 'playlist':
          try {
            result = await danmakuPlaylistDetail(
              musicType,
              playlistId,
              musicList.value.length
            );
          } catch (error: any) {
            ElMessage.error(error?.message || '读取歌单失败');
            result = { total: 0, list: [], playlist: null };
          }
          break;
        case 'lover':
          result = {
            list: play.myLoves,
            total: play.myLoves.length,
            playlist: {
              id: 'lover',
              name: '我喜爱的音乐',
              image:
                play.myLoves.length > 0
                  ? play.myLoves[0].largeImage ||
                    play.myLoves[0].mediumImage ||
                    play.myLoves[0].image
                  : '',
              type: 'lover' as any
            }
          };
          break;
        case 'recent':
          result = {
            list: play.musicHistory,
            total: play.musicHistory.length,
            playlist: {
              id: 'recent',
              name: '最近播放',
              type: 'recent' as any,
              image: ''
            }
          };
          break;
        case 'created':
          const playlist = play.myPlaylists.find(item => item.id == playlistId);
          result = {
            list: playlist?.musicList || [],
            total: (playlist?.musicList && playlist?.musicList.length) || 0,
            playlist: playlist || null
          };
          break;

        default:
          replace('/');
          return;
      }
      if (token !== loadToken) return;
      if (!result) return;
      total.value = result.total;
      if (clear) musicList.value = result.list;
      else result.list.forEach(m => musicList.value.push(m));
      if (result.playlist) playlistInfo.value = result.playlist;
    } finally {
      if (token === loadToken) {
        loading.value = false;
        loadingMore.value = false;
      }
    }
  };
  if (!clear) {
    const task = run().finally(() => {
      if (morePromise === task) morePromise = null;
    });
    morePromise = task;
    await task;
  } else {
    morePromise = null;
    await run();
  }
  if (token === loadToken && clear && total.value > musicList.value.length) {
    searchMusic(false);
  }
}
function addMyFavorite() {
  if (playlistInfo.value) {
    play.addMyFavorite(
      [playlistInfo.value],
      play.myFavorite[playlistInfo.value.type + playlistInfo.value.id]
    );
  } else {
    play.beforeAddMyPlaylistsMusic(musicList.value);
  }
}
async function loadAll() {
  if (morePromise) await morePromise;
  for (let i = 0; i < 40 && total.value > musicList.value.length; i++) {
    const before = musicList.value.length;
    await searchMusic(false);
    if (musicList.value.length <= before) break;
  }
}
async function playAll() {
  await loadAll();
  if (!musicList.value.length) {
    ElMessage.warning('歌单是空的');
    return;
  }
  await play.playLibraryPlaylist(musicList.value);
}
async function setAsIdlePlaylist() {
  await loadAll();
  if (!playlistInfo.value || !musicList.value.length) {
    ElMessage.warning('歌单是空的');
    return;
  }
  const type = currentRoute.value.params.type as MusicType;
  await play.setIdlePlaylist(
    {
      source: type,
      id: String(playlistInfo.value.id),
      name: playlistInfo.value.name || '',
      image: playlistInfo.value.image || ''
    },
    musicList.value
  );
  const requestBusy =
    play.activeListKind === 'request' &&
    play.musicList.length > 0 &&
    play.playStatus.playing;
  if (requestBusy) {
    ElMessage.success(`已设为闲时歌单：${playlistInfo.value.name}（点播结束后将播放）`);
    return;
  }
  ElMessage.success(`已设为闲时歌单：${playlistInfo.value.name}`);
  await play.playLibraryPlaylist(musicList.value);
}
function onObserve(
  entries: IntersectionObserverEntry[],
  _observer: IntersectionObserver
) {
  if (entries && entries[0]) affixShow.value = !entries[0].isIntersecting;
}
const onScroll = useDebounceFn((e: any) => {
  const wrap = scrollBar.value?.wrapRef as HTMLElement | undefined;
  if (!wrap || loading.value || loadingMore.value) return;
  if (total.value <= musicList.value.length) return;
  if (e.scrollTop + wrap.clientHeight > wrap.scrollHeight - 120) {
    searchMusic(false);
  }
}, 120);
onMounted(() => {
  searchMusic();
  if (playAllButton.value && playAllButton.value.ref) {
    const observer = new IntersectionObserver(onObserve, {
      threshold: 0
    });
    observer.observe(playAllButton.value.ref);
  }
});
onUnmounted(unWatch);
</script>

<template>
  <AnimalPage>
    <div
      class="music-playlist"
      :class="
        playlistInfo && playlistInfoShow ? 'music-playlist-info-show' : ''
      ">
      <el-scrollbar ref="scrollBar" @scroll="onScroll">
        <div class="music-playlist-header">
          <img
            class="music-playlist-header-image"
            v-if="playlistInfoShow && playlistInfo"
            :src="
              playlistInfo?.image ||
              playlistInfo?.musicList?.[0]?.largeImage ||
              playlistInfo?.musicList?.[0]?.mediumImage ||
              playlistInfo?.musicList?.[0]?.image ||
              LogoImage
            " />

          <div
            v-if="playlistInfo?.daily"
            class="music-playlist-header-image-daily">
            <img :src="DailyImage" />
            <span
              v-if="playlistInfo?.daily"
              :style="'color: ' + playlistInfo?.dailyColor"
              >{{ new Date().getDate() }}</span
            >
          </div>
          <el-skeleton
            animated
            :loading="loading && !playlistInfo"
            class="music-playlist-header-image">
            <template #template>
              <el-skeleton-item variant="image" />
            </template>
          </el-skeleton>
          <div class="music-playlist-header-info">
            <div v-if="playlistInfoShow" v-show="playlistInfo">
              <div class="music-playlist-header-info-name text-overflow-1">
                {{ playlistInfo?.name || '' }}
              </div>
              <el-scrollbar class="music-playlist-header-info-desc">
                <div
                  v-html="playlistInfo?.description || ''"
                  :title="
                    playlistInfo?.description?.replace(/<br \/>/g, '\n') || ''
                  "></div>
              </el-scrollbar>
            </div>
            <el-skeleton animated :loading="loading && !playlistInfo" :row="4"> </el-skeleton>
            <div>
              <el-button-group>
                <el-button
                  type="primary"
                  ref="playAllButton"
                  :loading="loading"
                  :disabled="loading || musicList.length === 0"
                  @click="playAll">
                  <span class="music-icon">播</span>
                  播放
                </el-button>
                <el-button
                  type="primary"
                  :loading="loading"
                  :disabled="loading || musicList.length === 0"
                  @click="setAsIdlePlaylist"
                  title="点播队列空时播放这份歌单">
                  {{ isCurrentIdle ? '已是闲时歌单' : '设为闲时歌单' }}
                </el-button>
              </el-button-group>
              <el-button
                v-if="
                  !hideFavoriteKeys.includes(
                    currentRoute.meta?.key?.toString() || ''
                  )
                "
                type="info"
                @click="addMyFavorite">
                <span class="music-icon">{{
                  playlistInfo &&
                  play.myFavorite[playlistInfo.type + playlistInfo.id]
                    ? '藏'
                    : '收'
                }}</span>
                {{
                  playlistInfo &&
                  play.myFavorite[playlistInfo.type + playlistInfo.id]
                    ? '已'
                    : ''
                }}收藏
              </el-button>
            </div>
          </div>
        </div>
        <MusicList :loading="loading && musicList.length === 0" :list="musicList" list-kind="library" />
        <div
          v-if="total > musicList.length"
          class="load-more"
          :class="{ 'is-loading': loadingMore }"
          @click="searchMusic(false)"></div>
      </el-scrollbar>
      <div
        class="music-playlist-header-affix"
        :class="affixShow ? 'music-playlist-header-affix-show' : ''">
        <div class="music-playlist-header-info">
          <div class="music-playlist-header-info-name text-overflow-1">
            {{ playlistInfo?.name || '' }}
          </div>
          <div>
            <el-button-group>
              <el-button
                type="primary"
                :loading="loading"
                :disabled="loading || musicList.length === 0"
                @click="playAll">
                <span class="music-icon">播</span>
                播放
              </el-button>
              <el-button
                type="primary"
                :loading="loading"
                :disabled="loading || musicList.length === 0"
                @click="setAsIdlePlaylist"
                title="点播队列空时播放这份歌单">
                {{ isCurrentIdle ? '已是闲时歌单' : '设为闲时歌单' }}
              </el-button>
            </el-button-group>
            <el-button
              v-if="
                !hideFavoriteKeys.includes(
                  currentRoute.meta?.key?.toString() || ''
                )
              "
              type="info"
              @click="addMyFavorite">
              <span class="music-icon">{{
                playlistInfo &&
                play.myFavorite[playlistInfo.type + playlistInfo.id]
                  ? '藏'
                  : '收'
              }}</span>
              {{
                playlistInfo &&
                play.myFavorite[playlistInfo.type + playlistInfo.id]
                  ? '已'
                  : ''
              }}收藏
            </el-button>
          </div>
        </div>
      </div>
    </div>
  </AnimalPage>
</template>

<style lang="less" scoped>
.music-playlist {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  position: relative;
  &-header {
    display: flex;
    align-items: center;
    &-affix {
      position: absolute;
      top: -50px;
      left: 0;
      width: 100%;
      background: var(--music-affix-background);
      z-index: -1;
      opacity: 0;
      transition-duration: 0.8s;
      transition-property: opacity top;
      .music-playlist-header-info {
        margin-left: 0;
        height: unset !important;
        padding: 0 var(--music-page-padding-horizontal) 10px
          var(--music-page-padding-horizontal);
      }
      &-show {
        top: 0;
        z-index: 0;
        opacity: 1;
        backdrop-filter: blur(2px);
      }
    }
    & > div {
      display: flex;
    }
    padding: 0 var(--music-page-padding-horizontal);

    &-image {
      width: 200px;
      height: 200px;
      border-radius: var(--music-border-radius);
      box-shadow: 0px 0px 8px 0px #9a94945c;
      .el-skeleton__image {
        width: 100%;
        height: 100%;
        border-radius: 22px;
      }
      &-daily {
        width: 100px;
        height: 100px;
        position: absolute;
        left: calc(var(--music-page-padding-horizontal) + 50px);
        top: 50px;
        & > img {
          height: 100%;
          width: 100%;
        }
        & > span {
          font-size: 30px;
          font-weight: bold;
          text-align: center;
          position: absolute;
          left: 50%;
          top: 50%;
          margin-top: 10px;
          transform: translate(-50%, -50%);
        }
      }
    }

    &-info {
      align-items: flex-start;
      flex-direction: column;
      justify-content: space-between;
      margin-left: 20px;
      flex: 1;
      min-width: 0;
      & > div {
        width: 100%;
      }
      &-name {
        font-size: 24px;
        font-weight: bold;
        width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      &-desc {
        height: 100px;
        margin-top: 10px;
      }
      button {
        height: 45px;
      }
      .el-button-group {
        button {
          height: 41px;
        }
      }
    }
  }
  &-title {
    font-weight: bold;
    font-size: 22px;
  }
  &-subtitle {
    margin-left: 10px;
    color: var(--el-text-color-placeholder);
    font-size: 13px;
  }
  & > .el-scrollbar {
    margin-top: 5px;
    padding: 0 calc(var(--music-page-padding-horizontal) - 10px);
    flex: 1;
    min-height: 0;
    height: auto !important;
    :deep(.el-scrollbar__wrap) {
      max-height: 100%;
    }
    :deep(.el-scrollbar__view) {
      height: auto;
      min-height: 100%;
      padding-bottom: 16px;
    }
  }
}
.load-more.is-loading::after {
  content: '加载中...';
}
.music-playlist.music-playlist-info-show {
  .music-playlist-header {
    height: 220px;
    &-info {
      height: 200px;
    }
  }
  & > .el-scrollbar {
    margin-top: 5px;
    height: auto !important;
    padding: 0 calc(var(--music-page-padding-horizontal) - 10px);
  }
}
@media (max-width: 800px) {
  .music-playlist {
    & > .el-scrollbar {
      padding: 0 !important;
    }
  }
}
@media (max-width: 800px) and (orientation: portrait) {
  .music-playlist {
    &-header {
      flex-direction: column;
      align-items: flex-start;
      height: unset !important;
      &-image {
        height: unset;
        width: 100%;
        max-height: 200px;
        max-width: 200px;
      }
      &-info {
        width: 100%;
        height: unset;
        margin-left: 0;
        &-desc {
          display: none;
        }
      }
    }
  }
}
</style>
