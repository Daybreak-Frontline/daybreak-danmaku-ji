export interface SettingNavItem {
  id: string;
  path: string;
  name: string;
}

export const SETTING_ITEMS: SettingNavItem[] = [
  { id: 'accounts', path: '/setting/accounts', name: '账号与直播' },
  { id: 'order', path: '/setting/order', name: '点歌' },
  { id: 'display', path: '/setting/display', name: '播放与显示' },
  { id: 'general', path: '/setting/general', name: '通用' }
];
