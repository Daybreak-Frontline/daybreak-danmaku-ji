import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw
} from 'vue-router';
import DanmakuPlayer from '../views/danmaku-player.vue';
import DanmakuHistory from '../views/danmaku-history.vue';
import DanmakuLogs from '../views/danmaku-logs.vue';
import DanmakuSettings from '../views/danmaku-settings.vue';
import DanmakuSettingsRequest from '../views/danmaku-settings-request.vue';
import DanmakuSettingsAccount from '../views/danmaku-settings-account.vue';
import DanmakuSettingsGeneral from '../views/danmaku-settings-general.vue';
import DanmakuSearch from '../views/danmaku-search.vue';
import DanmakuOverlay from '../views/danmaku-overlay.vue';
import DanmakuLyricOverlay from '../views/danmaku-lyric-overlay.vue';
import DanmakuYours from '../views/danmaku-yours.vue';
import PlaylistPage from '../views/playlist.vue';

const routers: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/player'
  },
  {
    path: '/player',
    name: '播放',
    meta: { key: 'player', icon: '播', show: true, danmaku: true },
    component: DanmakuPlayer
  },
  {
    path: '/history',
    name: '播放历史',
    meta: { key: 'history', icon: 'clock', show: true, localShow: true, danmaku: true },
    component: DanmakuHistory
  },
  {
    path: '/logs',
    name: '日志信息',
    meta: { key: 'logs', icon: 'log', show: true, danmaku: true },
    component: DanmakuLogs
  },
  {
    path: '/setting',
    name: '设置',
    meta: { key: 'setting', icon: '设', show: true, danmaku: true },
    component: DanmakuSettings,
    redirect: '/setting/accounts',
    children: [
      {
        path: 'accounts',
        name: '账号与直播',
        meta: { key: 'setting', settingTab: 'accounts', danmaku: true },
        component: DanmakuSettingsAccount
      },
      {
        path: 'live',
        redirect: '/setting/accounts'
      },
      {
        path: 'account',
        redirect: '/setting/accounts'
      },
      {
        path: 'order',
        name: '点歌',
        meta: { key: 'setting', settingTab: 'order', danmaku: true },
        component: DanmakuSettingsRequest
      },
      {
        path: 'sources',
        redirect: '/setting/order'
      },
      {
        path: 'blacklist',
        redirect: '/setting/order'
      },
      {
        path: 'gifts',
        redirect: '/setting/order'
      },
      {
        path: 'request',
        redirect: '/setting/order'
      },
      {
        path: 'display',
        name: '播放与显示',
        meta: { key: 'setting', settingTab: 'display', danmaku: true },
        component: DanmakuSettingsRequest
      },
      {
        path: 'play',
        redirect: '/setting/display'
      },
      {
        path: 'lyric',
        redirect: '/setting/display'
      },
      {
        path: 'overlay',
        redirect: '/setting/display'
      },
      {
        path: 'general',
        name: '设置外观',
        meta: { key: 'setting', settingTab: 'general', danmaku: true },
        component: DanmakuSettingsGeneral
      }
    ]
  },
  {
    path: '/overlay',
    redirect: '/overlay/sidebar'
  },
  {
    path: '/overlay/lyric',
    name: '桌面歌词',
    meta: { key: 'overlay', overlay: true, show: false },
    component: DanmakuLyricOverlay
  },
  {
    path: '/overlay/:format',
    name: '捕获窗',
    meta: { key: 'overlay', overlay: true, show: false },
    component: DanmakuOverlay
  },
  {
    path: '/yours',
    redirect: '/yours/qq'
  },
  {
    path: '/yours/:type',
    name: '我的歌单',
    meta: { key: 'yours', show: true, danmaku: true },
    component: DanmakuYours
  },
  {
    path: '/playlist/:type/:id',
    name: '歌单',
    meta: { key: 'playlist', show: false, danmaku: true },
    component: PlaylistPage
  },
  {
    path: '/search/:type/:searchType/:keywords',
    name: '搜索',
    meta: { key: 'search', show: false },
    component: DanmakuSearch
  },
  {
    path: '/:catchAll(.*)',
    redirect: '/player'
  }
];

const router = createRouter({
  history: createWebHistory(
    `${import.meta.env.BASE_URL != '/' ? import.meta.env.BASE_URL : ''}` || undefined
  ),
  routes: routers
});

export default router;
