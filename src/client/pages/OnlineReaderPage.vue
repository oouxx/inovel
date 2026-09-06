<script setup lang="ts">
// 在线流式阅读器:漫画(图片) / 音频(播放器) / 文字(预览)
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { OnlineChapter, OnlineChapterMedia, OnlineLibraryBook } from '@shared/types';
import { ArrowLeft, List, ChevronLeft, ChevronRight, Play, Pause, RefreshCw, AlertTriangle, Headphones, Image as ImageIcon } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const id = Number(route.params.id);

const book = ref<OnlineLibraryBook | null>(null);
const chapters = ref<OnlineChapter[]>([]);
const current = ref(Number(route.params.chapterIndex) || 0);
const loading = ref(true);
const media = ref<OnlineChapterMedia | null>(null);
const mediaLoading = ref(false);
const mediaError = ref('');
const textContent = ref('');
const tocOpen = ref(false);

const kind = ref<'image' | 'audio' | 'text'>('text');

async function init() {
  try {
    const r = await api.onlineLibraryBook(id);
    book.value = r.book;
    chapters.value = r.chapters;
    kind.value = book.value.sourceType === 2 ? 'image' : book.value.sourceType === 1 ? 'audio' : 'text';
    const saved = await api.onlineProgress(id).then((x) => x.progress).catch(() => null);
    const routeIdx = Number(route.params.chapterIndex) || 0;
    current.value = routeIdx > 0 ? routeIdx : saved?.chapter_index ?? 0;
    if (kind.value === 'audio' && saved?.position) pendingSeek = saved.position;
    await loadChapter();
  } catch (e: any) {
    mediaError.value = e?.message || '加载失败';
  } finally {
    loading.value = false;
  }
}

const curChapter = ref<OnlineChapter | null>(null);

async function loadChapter() {
  const ch = chapters.value[current.value];
  curChapter.value = ch ?? null;
  media.value = null;
  mediaError.value = '';
  textContent.value = '';
  if (!ch?.url) return;
  mediaLoading.value = true;
  try {
    if (kind.value === 'text') {
      const r = await api.onlineContent(book.value!.sourceUrl, ch.url, ch.title);
      const imgs = r.images ?? [];
      if (imgs.length) {
        // 书源被标成文字源但正文实为图片(漫画):自动切换为图片流渲染
        kind.value = 'image';
        media.value = { kind: 'image', items: imgs };
        await nextTick(() => window.scrollTo(0, 0));
      } else {
        textContent.value = r.content;
      }
    } else {
      media.value = await api.onlineMedia(book.value!.sourceUrl, ch.url, ch.title, book.value!.name, book.value!.author);
      if (media.value.kind === 'text' && kind.value === 'image') {
        // 源并非漫画,本章返回的是文字:回退文字渲染
        kind.value = 'text';
        textContent.value = media.value.items.join('\n');
        media.value = null;
      } else if (kind.value === 'image') {
        await nextTick(() => window.scrollTo(0, 0));
      }
    }
  } catch (e: any) {
    mediaError.value = e?.message || '加载失败';
  } finally {
    mediaLoading.value = false;
  }
}

async function retry() {
  mediaError.value = '';
  await loadChapter();
}

function go(delta: number) {
  const next = current.value + delta;
  if (next < 0 || next >= chapters.value.length) return;
  current.value = next;
  router.replace(`/reader/online/${id}/${next}`);
}

// ---- 漫画:滚动进度 ----
function onScroll() {
  if (kind.value !== 'image') return;
  const el = document.documentElement;
  const frac = el.scrollHeight <= window.innerHeight ? 1 : el.scrollTop / (el.scrollHeight - el.clientHeight);
  saveThrottled(frac);
}
let lastSave = 0;
function saveThrottled(pos: number) {
  const now = Date.now();
  if (now - lastSave < 3000) return;
  lastSave = now;
  api.saveOnlineProgress(id, current.value, Math.min(1, Math.max(0, pos))).catch(() => undefined);
}

// ---- 音频:播放器 ----
const audioEl = ref<HTMLAudioElement | null>(null);
const playing = ref(false);
const audioTime = ref(0);
const audioDuration = ref(0);
let pendingSeek = 0;
let saveTimer: any = null;

function togglePlay() {
  const a = audioEl.value;
  if (!a) return;
  a.paused ? a.play().catch(() => undefined) : a.pause();
}
function seekBy(delta: number) {
  const a = audioEl.value;
  if (!a || !Number.isFinite(a.duration)) return;
  a.currentTime = Math.min(a.duration, Math.max(0, a.currentTime + delta));
}
function onTimeUpdate() {
  const a = audioEl.value;
  if (!a) return;
  audioTime.value = a.currentTime;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    api.saveOnlineProgress(id, current.value, a.currentTime).catch(() => undefined);
  }, 4000);
}
function onLoadedMeta() {
  const a = audioEl.value;
  if (!a) return;
  audioDuration.value = Number.isFinite(a.duration) ? a.duration : 0;
  if (pendingSeek > 0) {
    a.currentTime = pendingSeek;
    pendingSeek = 0;
  }
  a.play().catch(() => undefined);
}
function onEnded() {
  playing.value = false;
  if (current.value < chapters.value.length - 1) {
    go(1);
  }
}

function fmt(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${m}:${String(ss).padStart(2, '0')}`;
}

onMounted(() => {
  init();
  window.addEventListener('scroll', onScroll, { passive: true });
});
onUnmounted(() => {
  window.removeEventListener('scroll', onScroll);
  if (saveTimer) clearTimeout(saveTimer);
  // 离开时保存音频进度
  const a = audioEl.value;
  if (a && kind.value === 'audio' && a.currentTime > 0) {
    api.saveOnlineProgress(id, current.value, a.currentTime).catch(() => undefined);
  }
});

watch(current, () => {
  if (kind.value !== 'audio') loadChapter();
  else loadChapter();
});

const audioSrc = computed(() => {
  if (kind.value !== 'audio' || !media.value?.items.length || !book.value || !curChapter.value) return '';
  return api.onlineAudioUrl(media.value.items[0], book.value.sourceUrl, curChapter.value.url);
});
</script>

<template>
  <div class="min-h-screen">
    <!-- 顶栏 -->
    <header class="sticky top-0 z-20 flex items-center gap-3 px-4 py-3 app-bg/80 backdrop-blur border-b" style="border-color: var(--border)">
      <button class="btn !px-3" @click="router.push('/online')"><ArrowLeft class="w-4 h-4" /></button>
      <div class="min-w-0 flex-1">
        <div class="font-medium truncate text-sm">{{ book?.name || '加载中…' }}</div>
        <div class="text-xs text-dim truncate">
          <component :is="kind === 'audio' ? Headphones : ImageIcon" class="w-3 h-3 inline -mt-0.5" />
          {{ curChapter?.title || '' }}
        </div>
      </div>
      <button class="btn !px-3" @click="tocOpen = true"><List class="w-4 h-4" /></button>
    </header>

    <div v-if="loading" class="text-center text-dim text-sm py-24">加载中…</div>
    <div v-else-if="mediaError && !media" class="text-center py-20 px-6">
      <AlertTriangle class="w-8 h-8 mx-auto text-red-500 mb-3" />
      <p class="text-sm mb-4">{{ mediaError }}</p>
      <button class="btn btn-primary" @click="retry"><RefreshCw class="w-4 h-4" /> 重试</button>
    </div>

    <!-- 漫画:图片流 -->
    <main v-else-if="kind === 'image'" class="mx-auto max-w-3xl px-2 pb-24">
      <div v-if="mediaLoading" class="text-center text-dim text-sm py-16">章节加载中…</div>
      <template v-else>
        <div v-for="(u, i) in media?.items ?? []" :key="u" class="mb-1">
          <img
            :src="api.onlineImgUrl(u, book!.sourceUrl, curChapter?.url ?? '')"
            class="w-full block bg-black/5"
            loading="lazy"
            @error="($event.target as HTMLImageElement).style.opacity = '0.3'"
          />
        </div>
        <div v-if="!media?.items.length" class="text-center text-dim text-sm py-16">本章没有解析到图片</div>
      </template>
      <!-- 章节切换 -->
      <div class="flex gap-3 justify-center py-8">
        <button class="btn" :disabled="current === 0" @click="go(-1)"><ChevronLeft class="w-4 h-4" /> 上一章</button>
        <span class="btn !cursor-default text-dim">{{ current + 1 }} / {{ chapters.filter((c) => c.url).length }}</span>
        <button class="btn btn-primary" :disabled="current >= chapters.length - 1" @click="go(1)">下一章 <ChevronRight class="w-4 h-4" /></button>
      </div>
    </main>

    <!-- 音频:播放器 -->
    <main v-else-if="kind === 'audio'" class="mx-auto max-w-lg px-5 py-10 pb-40">
      <div class="panel rounded-3xl p-8 text-center">
        <div
          class="w-28 h-28 mx-auto rounded-2xl flex items-center justify-center text-white mb-5"
          style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
        >
          <Headphones class="w-10 h-10" />
        </div>
        <h2 class="font-semibold text-lg leading-snug">{{ curChapter?.title }}</h2>
        <p class="text-xs text-dim mt-1">{{ book?.name }} · {{ book?.author }}</p>

        <audio
          ref="audioEl"
          :src="audioSrc"
          preload="metadata"
          class="hidden"
          @loadedmetadata="onLoadedMeta"
          @timeupdate="onTimeUpdate"
          @play="playing = true"
          @pause="playing = false"
          @ended="onEnded"
        ></audio>

        <div class="mt-6 flex items-center gap-2 text-xs text-dim">
          <span>{{ fmt(audioTime) }}</span>
          <input
            type="range"
            min="0"
            :max="audioDuration || 100"
            step="0.5"
            :value="audioTime"
            class="flex-1 accent-current"
            @input="((audioEl as HTMLAudioElement).currentTime = Number(($event.target as HTMLInputElement).value))"
          />
          <span>{{ fmt(audioDuration) }}</span>
        </div>

        <div class="mt-6 flex items-center justify-center gap-6">
          <button class="btn !px-3" :disabled="current === 0" @click="go(-1)"><ChevronLeft class="w-4 h-4" /></button>
          <button class="btn !px-3 text-xs" @click="seekBy(-15)">-15s</button>
          <button class="btn btn-primary !px-6 !py-3" @click="togglePlay">
            <Pause v-if="playing" class="w-5 h-5" />
            <Play class="w-5 h-5" v-else />
          </button>
          <button class="btn !px-3 text-xs" @click="seekBy(15)">+15s</button>
          <button class="btn !px-3" :disabled="current >= chapters.length - 1" @click="go(1)"><ChevronRight class="w-4 h-4" /></button>
        </div>
        <p class="text-xs text-dim mt-5">{{ current + 1 }} / {{ chapters.filter((c) => c.url).length }} 章 · 播放进度自动保存</p>
      </div>
    </main>

    <!-- 文字源兜底 -->
    <main v-else class="mx-auto max-w-3xl px-5 pb-24">
      <pre class="whitespace-pre-wrap text-sm leading-relaxed" style="font-family: inherit">{{ textContent }}</pre>
      <div class="flex gap-3 justify-center py-8">
        <button class="btn" :disabled="current === 0" @click="go(-1)">上一章</button>
        <button class="btn btn-primary" :disabled="current >= chapters.length - 1" @click="go(1)">下一章</button>
      </div>
    </main>

    <!-- 目录抽屉 -->
    <teleport to="body">
      <div
        v-if="tocOpen"
        class="fixed inset-0 z-40 flex justify-end"
        style="background: rgba(0,0,0,.45)"
        @click.self="tocOpen = false"
      >
        <div class="w-72 max-w-[80vw] h-full app-bg overflow-y-auto p-4">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-sm font-medium">目录({{ chapters.filter((c) => c.url).length }})</h3>
            <button class="btn !px-2" @click="tocOpen = false">✕</button>
          </div>
          <ul class="text-sm divide-y" style="border-color: var(--border)">
            <li v-for="(c, i) in chapters" :key="i">
              <button
                v-if="c.url"
                class="w-full text-left py-2.5 truncate"
                :class="i === current ? 'accent font-medium' : ''"
                @click="current = i; tocOpen = false"
              >
                {{ c.title }}
              </button>
              <div v-else class="py-2.5 text-dim truncate">{{ c.title }}</div>
            </li>
          </ul>
        </div>
      </div>
    </teleport>
  </div>
</template>