<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { Book, ChapterMeta, ReadingProgress } from '@shared/types';
import { useSettingsStore } from '@/stores/settings';
import AIPanel from '@/components/AIPanel.vue';
import ReaderSettingsPanel from '@/components/ReaderSettingsPanel.vue';
import TocDrawer from '@/components/TocDrawer.vue';
import {
  ArrowLeft, ListTree, Sparkles, Settings2, ChevronLeft, ChevronRight, Loader2, Sparkle,
  BookmarkPlus, CheckCircle2,
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const settings = useSettingsStore();

const bookId = computed(() => Number(route.params.bookId));
const chapterIndex = computed(() => Number(route.params.chapterIndex));

// ---------- 数据 ----------
const book = ref<Book | null>(null);
const chapters = ref<ChapterMeta[]>([]);
const title = ref('');
const paragraphs = ref<string[]>([]);
const loading = ref(true);
const loadError = ref('');

// ---------- UI 状态 ----------
const uiVisible = ref(true);
const showSettings = ref(false);
const showToc = ref(false);
const showAI = ref(false);

// ---------- 分页状态 ----------
const viewport = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const page = ref(0);
const pageCount = ref(1);
const animating = ref(false);
const viewportH = ref(0);
const viewportW = ref(0);
const GAP = 56;
const pendingProgress = ref<number | null>(null); // 分页完成后要恢复的进度(0~1)

let saveTimer: any = null;
let hideUiTimer: any = null;
let resizeObserver: ResizeObserver | null = null;

// ---------- 加载章节 ----------
async function loadChapter(resetProgress: boolean) {
  loading.value = true;
  loadError.value = '';
  try {
    if (!book.value || book.value.id !== bookId.value) {
      book.value = await api.getBook(bookId.value);
    }
    const meta = chapters.value.find((c) => c.chapter_index === chapterIndex.value);
    if (!chapters.value.length) chapters.value = await api.getChapters(bookId.value);
    const m = chapters.value.find((c) => c.chapter_index === chapterIndex.value);
    const { content } = await api.getChapterContent(bookId.value, chapterIndex.value);
    title.value = m?.title || `第 ${chapterIndex.value + 1} 章`;

    // 正文段落:去掉与标题重复的首行
    const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && (lines[0] === title.value || title.value.includes(lines[0]))) lines.shift();
    paragraphs.value = lines;

    if (resetProgress) {
      if (pendingEnd.value) {
        // “去上一章末页”意图优先
        pendingEnd.value = false;
        pendingProgress.value = 1;
        targetPage.value = 0;
      } else {
        // 恢复进度:优先 ?pos(书签/全文搜索跳转的章内比例)、query.page(精确页),否则用户进度比例
        const posQ = route.query.pos ? Number(route.query.pos) : null;
        const qp = route.query.page ? Number(route.query.page) : null;
        if (posQ !== null && !Number.isNaN(posQ)) {
          pendingProgress.value = Math.min(1, Math.max(0, posQ));
          targetPage.value = 0;
        } else if (qp !== null && !Number.isNaN(qp)) {
          pendingProgress.value = null;
          targetPage.value = Math.max(0, qp);
        } else {
          const p = await api.getProgress(bookId.value);
          if (p && p.chapter_index === chapterIndex.value) {
            pendingProgress.value = p.progress;
          } else {
            pendingProgress.value = 0;
          }
          targetPage.value = 0;
        }
      }
    }
  } catch (err: any) {
    loadError.value = err?.message || '加载失败';
  } finally {
    loading.value = false;
  }

  // content 已渲染,现在才能测量分页
  page.value = 0;
  await nextTick();
  await repaginate();
  if (settings.mode === 'paged') {
    if (targetPage.value > 0) {
      goToPage(targetPage.value, true);
      targetPage.value = 0;
    } else if (pendingProgress.value != null) {
      const idx = Math.round(pendingProgress.value * Math.max(0, pageCount.value - 1));
      goToPage(idx, true);
      pendingProgress.value = null;
    }
  }
  scheduleHideUi();
}

const targetPage = ref(0);
const pendingEnd = ref(false); // “去上一章末页”意图

// ---------- 分页(CSS columns) ----------
async function repaginate() {
  if (!viewport.value || !contentEl.value) return;
  const vp = viewport.value;
  viewportH.value = vp.clientHeight;
  viewportW.value = vp.clientWidth;
  if (settings.mode !== 'paged' || viewportH.value <= 0 || viewportW.value <= 0) return;
  animating.value = false;
  await nextTick();
  const step = viewportW.value + GAP;
  const sw = contentEl.value.scrollWidth;
  pageCount.value = Math.max(1, Math.round(sw / step));
  // clamp
  if (page.value >= pageCount.value) page.value = pageCount.value - 1;
  await nextTick();
  animating.value = true;
}

function goToPage(p: number, instant = false) {
  if (instant) animating.value = false;
  page.value = Math.min(Math.max(0, p), Math.max(0, pageCount.value - 1));
  if (instant) {
    nextTick(() => (animating.value = true));
  }
  scheduleSave();
  scheduleHideUi();
}

function nextPage() {
  if (settings.mode === 'scroll') {
    viewport.value?.scrollBy({ top: viewport.value!.clientHeight * 0.9, behavior: 'smooth' });
    scheduleHideUi();
    return;
  }
  if (page.value < pageCount.value - 1) {
    goToPage(page.value + 1);
  } else if (chapterIndex.value + 1 < chapters.value.length) {
    router.replace(`/reader/${bookId.value}/${chapterIndex.value + 1}`);
  }
}

function prevPage() {
  if (settings.mode === 'scroll') {
    viewport.value?.scrollBy({ top: -viewport.value!.clientHeight * 0.9, behavior: 'smooth' });
    scheduleHideUi();
    return;
  }
  if (page.value > 0) {
    goToPage(page.value - 1);
  } else if (chapterIndex.value > 0) {
    goPrevChapterEnd();
  }
}

async function goPrevChapterEnd() {
  // 上一章:加载后定位到最后一页
  pendingEnd.value = true;
  await router.replace(`/reader/${bookId.value}/${chapterIndex.value - 1}`);
}

// ---------- 进度保存 ----------
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!book.value) return;
    let progress = 0;
    if (settings.mode === 'paged') {
      progress = pageCount.value > 1 ? page.value / (pageCount.value - 1) : 1;
    } else {
      const el = viewport.value;
      if (!el) return;
      const max = el.scrollHeight - el.clientHeight;
      progress = max > 0 ? el.scrollTop / max : 1;
    }
    api
      .saveProgress(bookId.value, {
        chapter_index: chapterIndex.value,
        page: page.value,
        progress: Math.min(1, Math.max(0, progress)),
      })
      .catch(() => {});
  }, 400);
}

// ---------- UI 显隐 ----------
function toggleUi() {
  uiVisible.value = !uiVisible.value;
  if (uiVisible.value) scheduleHideUi();
}
function scheduleHideUi() {
  clearTimeout(hideUiTimer);
  if (!uiVisible.value) return;
  hideUiTimer = setTimeout(() => {
    if (!showSettings.value && !showToc.value && !showAI.value) uiVisible.value = false;
  }, 3500);
}
function centerTap() {
  if (showSettings.value) showSettings.value = false;
  else if (showToc.value) showToc.value = false;
  else toggleUi();
}

// ---------- 点击分区(左 25% 上一页,右 25% 下一页) ----------
function onViewportClick(e: MouseEvent) {
  if (loading.value) return;
  const el = viewport.value!;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  if (x < rect.width * 0.25) prevPage();
  else if (x > rect.width * 0.75) nextPage();
  else centerTap();
}

// ---------- 触摸滑动 ----------
let touchStart: { x: number; y: number } | null = null;
function onTouchStart(e: TouchEvent) {
  touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
}
function onTouchEnd(e: TouchEvent) {
  if (!touchStart) return;
  const dx = e.changedTouches[0].clientX - touchStart.x;
  const dy = e.changedTouches[0].clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 60) {
    dx < 0 ? nextPage() : prevPage();
  }
}

// ---------- 键盘 ----------
function onKeydown(e: KeyboardEvent) {
  const tag = (e.target as HTMLElement)?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
      e.preventDefault();
      nextPage();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      e.preventDefault();
      prevPage();
      break;
    case 'Escape':
      e.preventDefault();
      if (showAI.value) showAI.value = false;
      else if (showSettings.value) showSettings.value = false;
      else if (showToc.value) showToc.value = false;
      else toggleUi();
      break;
    case 't':
    case 'T':
      showToc.value = !showToc.value;
      break;
    case 'a':
    case 'A':
      showAI.value = !showAI.value;
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

// ---------- 滚动模式进度 ----------
function onScroll() {
  if (settings.mode !== 'scroll') return;
  scheduleSave();
}

// ---------- 选中文字 → AI ----------
const selPopup = ref<{ x: number; y: number; term: string; context: string } | null>(null);

function onMouseUp() {
  const sel = window.getSelection();
  const text = sel?.toString().trim() || '';
  if (!text || !sel || sel.isCollapsed) {
    selPopup.value = null;
    return;
  }
  // 限制长度
  const term = text.slice(0, 30);
  // 所在段落上下文
  let context = '';
  const node = sel.anchorNode;
  const el = (node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement)) as HTMLElement | null;
  if (el?.tagName === 'P') context = el.textContent?.trim().slice(0, 300) || '';
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selPopup.value = { x: rect.left + rect.width / 2, y: rect.top - 8, term, context };
}

async function aiExplain() {
  const s = selPopup.value;
  selPopup.value = null;
  window.getSelection()?.removeAllRanges();
  if (!s) return;
  showAI.value = true;
  await nextTick();
  aiPanel.value?.explainTerm(s.term, s.context);
}

const aiPanel = ref<InstanceType<typeof AIPanel> | null>(null);

// ---------- 书签 ----------
const bookmarkToast = ref('');
let toastTimer: any = null;
async function addBookmark() {
  const el = viewport.value;
  let pos = 0;
  if (settings.mode === 'paged') {
    pos = pageCount.value > 1 ? page.value / (pageCount.value - 1) : 1;
  } else if (el) {
    const max = el.scrollHeight - el.clientHeight;
    pos = max > 0 ? el.scrollTop / max : 1;
  }
  try {
    const r = await api.addBookmark(bookId.value, { chapter_index: chapterIndex.value, position: pos });
    bookmarkToast.value = r.duplicate ? '此位置已有书签' : '已添加书签';
  } catch {
    bookmarkToast.value = '添加失败';
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (bookmarkToast.value = ''), 1800);
}

// ---------- 阅读统计心跳(每 30s,页面可见时) ----------
let heartbeatTimer: any = null;
function startHeartbeat() {
  heartbeatTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    api.heartbeat(bookId.value, 30);
  }, 30_000);
}

// ---------- 主题 ----------
function applyTheme() {
  document.documentElement.setAttribute('data-theme', settings.effectiveTheme);
}
watch(() => settings.theme, applyTheme, { immediate: true });
let mediaQuery: MediaQueryList | null = null;
try {
  mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener?.('change', applyTheme);
} catch {}
onBeforeUnmount(() => mediaQuery?.removeEventListener?.('change', applyTheme));

// ---------- 设置变化 → 重新分页 ----------
watch(
  () => [settings.fontSize, settings.lineHeight, settings.width, settings.mode, settings.font],
  async () => {
    await nextTick();
    const progressRatio =
      settings.mode === 'paged' && pageCount.value > 1 ? page.value / (pageCount.value - 1) : null;
    await repaginate();
    if (progressRatio != null && settings.mode === 'paged') {
      goToPage(Math.round(progressRatio * (pageCount.value - 1)), true);
    }
    scheduleSave();
  },
);

// ---------- 路由切换 → 重新加载 ----------
watch(chapterIndex, (n, o) => {
  if (n !== o) loadChapter(true);
});
watch(bookId, () => {
  book.value = null;
  chapters.value = [];
  loadChapter(true);
});

// ---------- resize ----------
function setupObserver() {
  resizeObserver = new ResizeObserver(async () => {
    if (settings.mode !== 'paged' || loading.value || !contentEl.value) return;
    const ratio = pageCount.value > 1 ? page.value / (pageCount.value - 1) : 0;
    await repaginate();
    goToPage(Math.round(ratio * (pageCount.value - 1)), true);
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
}

onMounted(() => {
  loadChapter(true);
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('mouseup', onMouseUp);
  nextTick(setupObserver);
  startHeartbeat();
});
onBeforeUnmount(() => clearInterval(heartbeatTimer));
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mouseup', onMouseUp);
  resizeObserver?.disconnect();
  clearTimeout(saveTimer);
  clearTimeout(hideUiTimer);
});

// ---------- 样式绑定 ----------
const contentStyle = computed(() => {
  const base: Record<string, string> = {
    fontSize: `${settings.fontSize}px`,
    lineHeight: String(settings.lineHeight),
    '--reader-font': settings.fontFamily,
  };
  if (settings.mode === 'paged') {
    // 首次测量前给一个安全占位,避免 0 尺寸闪烁
    const w = viewportW.value || window.innerWidth;
    const h = viewportH.value || window.innerHeight;
    base.height = `${h}px`;
    base.width = `${w}px`;
    base.columnWidth = `${w}px`;
    base.columnGap = `${GAP}px`;
    base.columnFill = 'auto';
    base.transform = `translateX(-${page.value * (w + GAP)}px)`;
    base.transition = animating.value ? 'transform 0.32s cubic-bezier(0.25, 0.1, 0.25, 1)' : 'none';
  } else {
    base.maxWidth = `${settings.width}px`;
  }
  return base;
});

const viewportStyle = computed(() => {
  const bg = 'var(--bg)';
  if (settings.mode === 'scroll') {
    return { overflowY: 'auto', background: bg, WebkitOverflowScrolling: 'touch' } as any;
  }
  return { overflow: 'hidden', background: bg } as any;
});

const progressPercent = computed(() => {
  // 章内进度 + 全书章节比例
  const inChapter = settings.mode === 'paged'
    ? pageCount.value > 1
      ? page.value / (pageCount.value - 1)
      : 1
    : (() => {
        const el = viewport.value;
        if (!el) return 0;
        const max = el.scrollHeight - el.clientHeight;
        return max > 0 ? el.scrollTop / max : 0;
      })();
  const bookRatio = chapters.value.length ? (chapterIndex.value + inChapter) / chapters.value.length : 0;
  return Math.min(100, Math.max(0, Math.round(bookRatio * 100)));
});

const chapterTitleShort = computed(() => {
  const t = title.value;
  return t.length > 24 ? t.slice(0, 24) + '…' : t;
});

// 段落渲染 key
const paraKey = (i: number) => `p${i}`;
</script>

<template>
  <div class="fixed inset-0 flex flex-col select-none" style="background: var(--bg)">
    <!-- 阅读区 -->
    <div
      ref="viewport"
      class="flex-1 relative"
      :style="viewportStyle"
      @click="onViewportClick"
      @touchstart.passive="onTouchStart"
      @touchend.passive="onTouchEnd"
      @scroll.passive="onScroll"
    >
      <!-- 加载 -->
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center">
        <Loader2 class="w-6 h-6 text-dim animate-spin" />
      </div>
      <div v-else-if="loadError" class="absolute inset-0 flex flex-col items-center justify-center gap-3 text-sm text-dim">
        <span>{{ loadError }}</span>
        <button class="btn" @click="loadChapter(true)">重试</button>
      </div>

      <!-- 正文 -->
      <div
        v-else
        ref="contentEl"
        class="reader-content mx-auto will-change-transform"
        :class="settings.mode === 'paged' && 'paged'"
        :style="contentStyle"
      >
        <h1 class="rtitle">{{ title }}</h1>
        <p v-for="(p, i) in paragraphs" :key="paraKey(i)" class="select-text">{{ p }}</p>
        <div class="chapter-nav-hint text-center text-sm text-dim select-none" style="text-indent: 0">
          — {{ chapterIndex + 1 < chapters.length ? '继续下一章' : '已是最后一章' }} —
        </div>
      </div>
    </div>

    <!-- 选中弹出 -->
    <div
      v-if="selPopup"
      class="fixed z-50 -translate-x-1/2 -translate-y-full"
      :style="{ left: selPopup.x + 'px', top: selPopup.y + 'px' }"
    >
      <button class="btn btn-primary !text-xs shadow-lg" @click="aiExplain">
        <Sparkle class="w-3.5 h-3.5" /> AI 解释「{{ selPopup.term.slice(0, 8) }}{{ selPopup.term.length > 8 ? '…' : '' }}」
      </button>
    </div>

    <!-- 书签 toast -->
    <Transition name="fade">
      <div
        v-if="bookmarkToast"
        class="absolute top-16 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1.5 px-4 py-2 rounded-full text-sm shadow-lg"
        style="background: var(--accent); color: #fff"
      >
        <CheckCircle2 class="w-4 h-4" /> {{ bookmarkToast }}
      </div>
    </Transition>

    <!-- 顶栏 -->
    <Transition name="fade">
      <header
        v-if="uiVisible"
        class="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-3 py-2"
        style="background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border)"
        @click.stop
      >
        <div class="flex items-center gap-1 min-w-0">
          <RouterLink :to="`/books/${bookId}`" class="btn !border-0 !bg-transparent !px-2">
            <ArrowLeft class="w-5 h-5" />
          </RouterLink>
          <div class="min-w-0">
            <div class="text-sm font-medium truncate max-w-[40vw]">{{ book?.title }}</div>
            <div class="text-xs text-dim truncate">{{ chapterTitleShort }}</div>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <button class="btn !border-0 !bg-transparent !px-2" title="目录 (T)" @click="showToc = !showToc">
            <ListTree class="w-5 h-5" />
          </button>
          <button class="btn !border-0 !bg-transparent !px-2" title="添加书签" @click="addBookmark">
            <BookmarkPlus class="w-5 h-5" />
          </button>
          <button class="btn !border-0 !bg-transparent !px-2" title="AI 助手 (A)" @click="showAI = !showAI">
            <Sparkles class="w-5 h-5" :class="showAI && 'accent'" />
          </button>
          <button class="btn !border-0 !bg-transparent !px-2" title="设置" @click="showSettings = !showSettings">
            <Settings2 class="w-5 h-5" />
          </button>
        </div>
      </header>
    </Transition>

    <!-- 底栏 -->
    <Transition name="fade">
      <footer
        v-if="uiVisible"
        class="absolute bottom-0 inset-x-0 z-30 flex items-center justify-between px-4 py-2.5 text-xs text-dim"
        style="background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-top: 1px solid var(--border)"
        @click.stop
      >
        <button class="btn !border-0 !bg-transparent !text-xs gap-1" :disabled="chapterIndex === 0" @click="chapterIndex > 0 && goPrevChapterEnd()">
          <ChevronLeft class="w-3.5 h-3.5" /> 上一章
        </button>
        <div class="flex-1 mx-4 flex items-center gap-2">
          <div class="h-1 flex-1 rounded-full overflow-hidden" style="background: var(--bg-soft)">
            <div class="h-full rounded-full transition-all" :style="{ width: `${progressPercent}%`, background: 'var(--accent)' }" />
          </div>
          <span class="tabular-nums">{{ progressPercent }}%</span>
        </div>
        <button
          class="btn !border-0 !bg-transparent !text-xs gap-1"
          :disabled="chapterIndex + 1 >= chapters.length"
          @click="chapterIndex + 1 < chapters.length && router.replace(`/reader/${bookId}/${chapterIndex + 1}`)"
        >
          下一章 <ChevronRight class="w-3.5 h-3.5" />
        </button>
      </footer>
    </Transition>

    <!-- 设置面板 -->
    <ReaderSettingsPanel v-model:open="showSettings" />

    <!-- 目录 -->
    <TocDrawer
      v-model:open="showToc"
      :book-id="bookId"
      :book-title="book?.title || ''"
      :current-index="chapterIndex"
    />

    <!-- AI -->
    <AIPanel
      ref="aiPanel"
      :book-id="bookId"
      :chapter-index="chapterIndex"
      :book-title="book?.title || ''"
      :open="showAI"
      @close="showAI = false"
    />
  </div>
</template>

<style scoped>
.reader-content.paged {
  position: relative;
  text-align: justify;
}
.chapter-nav-hint {
  padding: 2em 0 3em;
}
/* 滚动模式容器内边距 */
.reader-content:not(.paged) {
  padding: 4rem 1.25rem 4rem;
}
@media (min-width: 640px) {
  .reader-content:not(.paged) {
    padding: 5rem 2rem 5rem;
  }
}
.fade-enter-active, .fade-leave-active { transition: opacity .25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>