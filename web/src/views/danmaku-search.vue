<script setup lang="ts">
import { ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage } from 'element-plus/es/components/message/index';
import MusicList from '../components/MusicList.vue';
import { search } from '../utils/api/danmaku-qq';
import type { Music } from '../utils/type';

const route = useRoute();
const keyword = ref(decodeURIComponent(String(route.params.keywords || '')));
const loading = ref(false);
const results = ref<Music[]>([]);
const searched = ref(false);

async function runSearch() {
  const q = keyword.value.trim();
  if (!q) return;
  loading.value = true; searched.value = true;
  try {
    const data = await search(q, 0);
    results.value = data.list;
    if (!results.value.length) ElMessage.info('没有找到匹配歌曲');
  } catch (error) {
    results.value = [];
    ElMessage.error(error instanceof Error ? error.message : '搜索失败');
  } finally { loading.value = false; }
}
watch(() => String(route.params.keywords || ''), value => {
  keyword.value = decodeURIComponent(value);
  runSearch();
}, { immediate: true });
</script>

<template>
  <div class="danmaku-search-page">
    <div class="page-heading"><div><div class="eyebrow">MUSIC SEARCH</div><h1>搜索结果</h1><p>在已开启的音源中搜索。粘贴 BV 号会直接定位 B站音频，不会当成歌曲 ID。</p></div></div>
    <div class="search-query">“{{ keyword }}” <span v-if="searched">· {{ results.length }} 首结果</span></div>
    <MusicList v-if="results.length || loading" :list="results" :loading="loading" :search="true" :add-to-list-on-double-click="false" />
    <div v-if="results.length" class="search-overlay-hint">搜索结果支持右键菜单，也可以加入播放列表。</div>
    <el-empty v-else-if="searched && !loading" description="没有找到歌曲" />
  </div>
</template>

<style lang="less" scoped>
.danmaku-search-page { max-width: 1100px; margin: 0 auto; padding: 42px 38px 120px; } .page-heading { display:flex; align-items:end; justify-content:space-between; gap:20px; margin-bottom:24px; } .eyebrow { color:var(--music-primary-color); font-size:12px; letter-spacing:.14em; } h1 { margin:10px 0 7px; font-size:34px; } p { margin:0; color:var(--el-text-color-placeholder); font-size:13px; } .search-query { margin-bottom:16px; color:var(--el-text-color-placeholder); font-size:16px; } .search-query span { font-size:13px; } .search-overlay-hint { margin-top:18px; color:var(--el-text-color-placeholder); font-size:12px; } @media(max-width:650px){.danmaku-search-page{padding:24px 14px 100px}.page-heading{align-items:start;flex-direction:column}}
</style>
