<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';
import { SETTING_ITEMS } from '../utils/settings-nav';
</script>

<template>
  <div class="danmaku-settings-page">
    <div class="page-heading">
      <div>
        <div class="eyebrow">SETTINGS</div>
        <h1>设置</h1>
      </div>
    </div>
    <div class="settings-layout">
      <nav class="settings-nav" aria-label="设置分类">
        <RouterLink
          v-for="item in SETTING_ITEMS"
          :key="item.id"
          class="settings-nav-item"
          :to="item.path">
          <strong>{{ item.name }}</strong>
        </RouterLink>
      </nav>
      <div class="settings-main">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style lang="less">
.danmaku-settings-page { max-width: 1180px; margin: 0 auto; padding: 42px 38px 120px; }
.danmaku-settings-page .page-heading { margin-bottom: 22px; }
.danmaku-settings-page .eyebrow { color: var(--music-primary-color); font-size: 12px; letter-spacing: .14em; margin-bottom: 8px; }
.danmaku-settings-page h1 { font-size: 34px; margin: 0 0 7px; }
.danmaku-settings-page .page-heading p,
.danmaku-settings-page .card-heading p { margin: 0; color: var(--el-text-color-placeholder); font-size: 13px; }
.danmaku-settings-page .settings-layout { display: grid; grid-template-columns: 232px minmax(0, 1fr); gap: 22px; align-items: start; }
.danmaku-settings-page .settings-nav { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 8px; }
.danmaku-settings-page .settings-nav-label { padding: 0 10px 7px; color: var(--el-text-color-placeholder); font-size: 11px; letter-spacing: .12em; }
.danmaku-settings-page .settings-nav-item { display: flex; align-items: center; padding: 10px 12px; border-radius: 10px; text-decoration: none; color: inherit; border: 1px solid transparent; }
.danmaku-settings-page .settings-nav-item strong { font-size: 14px; font-weight: 600; }
.danmaku-settings-page .settings-nav-item:hover { background: var(--music-button-background-hover); }
.danmaku-settings-page .settings-nav-item.router-link-active { background: var(--music-button-primary-background); border-color: transparent; color: #fff; -webkit-text-fill-color: #fff; }
.danmaku-settings-page .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.danmaku-settings-page .setting-card { min-width: 0; padding: 24px; border-radius: 12px; background: var(--music-sub-background); border: 1px solid var(--music-side-divider-color); }
.danmaku-settings-page .setting-wide { grid-column: 1 / -1; }
.danmaku-settings-page .settings-account-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; grid-column: 1 / -1; }
.danmaku-settings-page .settings-account-grid .qq-login-area { flex-direction: column; align-items: flex-start; }
.danmaku-settings-page .settings-account-grid .qq-login-area img { width: 140px; height: 140px; }
.danmaku-settings-page .card-heading { display: flex; justify-content: space-between; align-items: start; gap: 15px; margin-bottom: 20px; }
.danmaku-settings-page h2 { margin: 0 0 4px; font-size: 18px; }
.danmaku-settings-page .status-tag { border: 1px solid var(--music-side-divider-color); border-radius: 99px; padding: 3px 9px; font-size: 12px; color: var(--el-text-color-placeholder); white-space: nowrap; }
.danmaku-settings-page .status-tag.connected { color: var(--music-primary-color); border-color: var(--music-primary-color); }
.danmaku-settings-page .qq-login-area { display:flex; align-items:center; gap:20px; padding:16px; border:1px solid var(--music-side-divider-color); border-radius:10px; background:var(--music-button-background-hover); }
.danmaku-settings-page .qq-login-area img { width:180px; height:180px; image-rendering:auto; background:#fff; padding:8px; border-radius:8px; }
.danmaku-settings-page .qq-login-area strong { font-size:16px; }
.danmaku-settings-page .qq-login-area p { margin:7px 0 14px; color:var(--el-text-color-placeholder); font-size:12px; line-height:1.8; }
.danmaku-settings-page .form-row { display: flex; gap: 10px; align-items: center; }
.danmaku-settings-page .form-row > * { min-width: 0; }
.danmaku-settings-page .mode-row { display: flex; flex-wrap: wrap; gap: 8px; }
.danmaku-settings-page .mode-chip { appearance: none; border: 1px solid var(--music-side-divider-color); background: var(--music-button-background-hover); color: inherit; border-radius: 8px; padding: 7px 14px; cursor: pointer; font-size: 13px; line-height: 1.3; }
.danmaku-settings-page .mode-chip.active { background: var(--music-button-primary-background); border-color: transparent; color: #fff; -webkit-text-fill-color: #fff; }
.danmaku-settings-page label { display: block; font-size: 12px; color: var(--el-text-color-placeholder); margin: 15px 0 6px; }
.danmaku-settings-page .full { width: 100%; }
.danmaku-settings-page .setting-line { display: flex; justify-content: space-between; align-items: center; padding-top: 16px; margin-top: 16px; border-top: 1px solid var(--music-side-divider-color); }
.danmaku-settings-page .setting-line div { display: flex; flex-direction: column; gap: 2px; }
.danmaku-settings-page .setting-line span { font-size: 12px; color: var(--el-text-color-placeholder); }
.danmaku-settings-page .source-row { cursor: grab; }
.danmaku-settings-page .source-row:active { cursor: grabbing; }
.danmaku-settings-page .setting-line.source-row .source-main { display: flex; flex-direction: row; align-items: center; gap: 10px; min-width: 0; }
.danmaku-settings-page .source-handle { flex: none; width: 14px; letter-spacing: -2px; color: var(--el-text-color-placeholder); font-size: 14px; line-height: 1; }
.danmaku-settings-page .gift-sync { color: var(--el-text-color-placeholder); font-size: 12px; white-space: nowrap; }
.danmaku-settings-page .gift-selected { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--music-button-background-hover); }
.danmaku-settings-page .gift-fold { width: 100%; margin-top: 12px; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-radius: 10px; border: 1px solid var(--music-side-divider-color); background: var(--music-button-background-hover); color: inherit; cursor: pointer; font-size: 13px; line-height: 1.3; text-align: left; }
.danmaku-settings-page .gift-fold-meta { margin-left: auto; color: var(--el-text-color-placeholder); font-size: 12px; }
.danmaku-settings-page .gift-fold-arrow { width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 6px solid currentColor; opacity: .45; transition: transform .15s ease; flex: none; }
.danmaku-settings-page .gift-fold:not(:has(.gift-fold-meta)) .gift-fold-arrow { margin-left: auto; }
.danmaku-settings-page .gift-fold.open .gift-fold-arrow { transform: rotate(180deg); }
.danmaku-settings-page .gift-fold-body { margin-top: 12px; }
.danmaku-settings-page .gift-selected img { width: 42px; height: 42px; object-fit: contain; border-radius: 8px; background: #fff; }
.danmaku-settings-page .gift-selected strong { display: block; font-size: 14px; }
.danmaku-settings-page .gift-selected span { color: var(--el-text-color-placeholder); font-size: 12px; }
.danmaku-settings-page .gift-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; margin-top: 14px; max-height: 420px; overflow: auto; padding-right: 4px; }
.danmaku-settings-page .gift-card { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 8px; border-radius: 10px; border: 1px solid var(--music-side-divider-color); background: var(--music-button-background-hover); cursor: pointer; color: inherit; text-align: center; }
.danmaku-settings-page .gift-card img { width: 48px; height: 48px; object-fit: contain; }
.danmaku-settings-page .gift-card strong { font-size: 12px; font-weight: 500; line-height: 1.3; }
.danmaku-settings-page .gift-card span { font-size: 11px; color: var(--el-text-color-placeholder); }
.danmaku-settings-page .gift-card.selected { border-color: var(--music-primary-color); box-shadow: 0 0 0 1px var(--music-primary-color) inset; }
.danmaku-settings-page .blacklist-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
.danmaku-settings-page .blacklist-tag { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 8px 5px 10px; border-radius: 99px; background: var(--music-button-background-hover); border: 1px solid var(--music-side-divider-color); font-size: 12px; }
.danmaku-settings-page .blacklist-tag button { flex: none; width: 18px; height: 18px; border: 0; border-radius: 50%; background: transparent; color: var(--el-text-color-placeholder); cursor: pointer; line-height: 1; }
.danmaku-settings-page .blacklist-tag button:hover { color: var(--el-color-danger); }
.danmaku-settings-page .setting-tip { margin-top: 16px; padding: 10px 12px; border-radius: 7px; background: var(--music-button-background-hover); color: var(--el-text-color-placeholder); font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
.danmaku-settings-page .lyric-color-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.danmaku-settings-page .lyric-color-chip { width: 26px; height: 26px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; }
.danmaku-settings-page .lyric-color-chip.active { box-shadow: 0 0 0 2px var(--music-primary-color); }
.danmaku-settings-page .lyric-color-split { width: 1px; height: 16px; background: var(--music-side-divider-color); margin: 0 2px; }
.danmaku-settings-page .lyric-color-pick { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 4px; border-radius: 99px; border: 1px solid var(--music-side-divider-color); color: var(--el-text-color-regular); font-size: 12px; cursor: pointer; user-select: none; }
.danmaku-settings-page .lyric-color-pick .el-color-picker,
.danmaku-settings-page .lyric-color-pick .el-color-picker__trigger { width: 18px; height: 18px; padding: 0; border: 0; border-radius: 50%; }
.danmaku-settings-page .lyric-color-pick .el-color-picker__color { border-radius: 50%; border: 0; }
.danmaku-settings-page .lyric-color-pick .el-color-picker__icon,
.danmaku-settings-page .lyric-color-pick .el-color-picker__empty,
.danmaku-settings-page .lyric-color-pick .el-icon { display: none !important; }
.danmaku-settings-page .lyric-preview { margin-top: 16px; padding: 18px 16px; border-radius: 10px; background: rgba(0,0,0,.35); text-align: center; }
.danmaku-settings-page .tip-icon { flex: none; margin-top: 1px; color: var(--el-text-color-placeholder); opacity: .85; }
.danmaku-settings-page .idle-selected { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 12px; border-radius: 10px; background: var(--music-button-background-hover); }
.danmaku-settings-page .idle-selected img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; background: var(--music-button-background-hover); }
.danmaku-settings-page .idle-selected strong { display: block; font-size: 14px; }
.danmaku-settings-page .idle-selected span { color: var(--el-text-color-placeholder); font-size: 12px; }
@media(max-width:900px) {
  .danmaku-settings-page .settings-layout { grid-template-columns: 1fr; }
  .danmaku-settings-page .settings-nav { position: static; flex-direction: row; flex-wrap: wrap; gap: 8px 18px; }
  .danmaku-settings-page .settings-nav-group { min-width: 160px; flex: 1; }
  .danmaku-settings-page .settings-account-grid { grid-template-columns: 1fr; }
}
@media(max-width:700px) {
  .danmaku-settings-page { padding: 24px 14px 100px; }
  .danmaku-settings-page .settings-grid { grid-template-columns: 1fr; }
  .danmaku-settings-page .setting-wide { grid-column: auto; }
  .danmaku-settings-page .form-row { flex-wrap: wrap; }
  .danmaku-settings-page .form-row > .el-input,
  .danmaku-settings-page .form-row > .el-select { width: 100%; }
}
</style>
