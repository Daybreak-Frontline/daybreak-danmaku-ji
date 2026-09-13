<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { usePlayStore } from '../../stores/play';
import { getLocalAudioElement } from '../../utils/http';
import { SortType } from '../../utils/type';
import ParticleStage from '../particle/ParticleStage.vue';

const props = withDefaults(
  defineProps<{
    controlsVisible?: boolean;
  }>(),
  {
    controlsVisible: true
  }
);

const play = usePlayStore();
const lyric = ref('');
const lyrics = ref<string[]>([]);
const audioElement = ref<HTMLAudioElement | null>(null);

function loadLyrics(lines: string[]) {
  lyrics.value = [...lines];
}

function updateLyricLine(_index: number, text: string) {
  lyric.value = text || '';
}

const current = computed(() => {
  if (!play.music.id) return null;
  return {
    id: `player-${play.music.type}-${play.music.id}`,
    music: play.music
  };
});

const snapshot = computed(() => ({
  room: { name: '播放器' },
  nickname: '',
  memberId: 'player',
  isAdmin: false,
  allowGuestQueue: false,
  state: {
    queue: [] as [],
    history: [] as [],
    randomPlayback: play.sortType === SortType.Random
  }
}));

const duration = computed(() => (play.music.length || 0) / 1000);
const position = computed(
  () => ((play.playStatus.progress || 0) / 1000) * duration.value
);

function togglePlay() {
  if (play.playStatus.playing) void play.pause();
  else void play.play();
}

function seek(seconds: number) {
  if (!duration.value) return;
  void play.changeProgress(
    Math.max(0, Math.min(1000, (seconds / duration.value) * 1000))
  );
}

function toggleRandom() {
  play.setSortType(
    play.sortType === SortType.Random ? SortType.Loop : SortType.Random
  );
}

function refreshAudioElement() {
  audioElement.value = getLocalAudioElement();
}

watch(
  () => `${play.music.type}:${play.music.id}`,
  refreshAudioElement
);

onMounted(() => {
  refreshAudioElement();
  play.subscribeLyric(loadLyrics);
  play.subscribeLyricLine(updateLyricLine);
});

onUnmounted(() => {
  play.subscribeLyric(loadLyrics, true);
  play.subscribeLyricLine(updateLyricLine, true);
});
</script>

<template>
  <div class="music-mode-particle">
    <ParticleStage
      :snapshot="snapshot"
      :current="current"
      :lyric="lyric"
      :lyrics-text="lyrics.join('\n')"
      :position="position"
      :duration="duration"
      :volume="play.playStatus.volume"
      :playing="play.playStatus.playing"
      :audio="audioElement"
      :controls-visible="props.controlsVisible"
      embedded
      :show-cards="false"
      @toggle-play="togglePlay"
      @resume="togglePlay"
      @next="play.next()"
      @toggle-random="toggleRandom"
      @seek="seek"
      @set-volume="play.changeVolume" />
  </div>
</template>

<style lang="less" scoped>
.music-mode-particle {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #05070c;
}
</style>
