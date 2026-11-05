<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { Book, ChapterMeta, ReadingProgress } from '@shared/types';
import { useSettingsStore, type ThemeName } from '@/stores/settings';
import AIPanel from '@/components/AIPanel.vue';
import ReaderSettingsPanel from '@/components/ReaderSettingsPanel.vue';
import TocDrawer from '@/components/TocDrawer.vue';
import {
  ArrowLeft, ListTree, Sparkles, ChevronLeft, ChevronRight, Loader2, Sparkle,
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
const aiPanel = ref<InstanceType<typeof AIPanel> | null>(null);
const selPopup = ref<{ x: number; y: number; term: string; context: string } | null>(null);

// ---------- 分页 / 位置状态 ----------
const viewport = ref<HTMLElement | null>(null);
const contentEl = ref<HTMLElement | null>(null);
const page = ref(0);
const pageCount = ref(1);
const animating = ref(false);
const viewportH = ref(0);
const viewportW = ref(0);
const scrollRatio = ref(0);
const GAP = 56;
const pendingProgress = ref<number | null>(null); // 分页完成后要恢复的进度(0~1)
const targetPage = ref(0);
const pendingEnd = ref(false); // “去上一章末页”意图
const FONT_MIN = 14;
const FONT_MAX = 32;

// ---------- 进度拖动 ----------
const scrubTrack = ref<HTMLElement | null>(null);
const scrubbing = ref(false);
const scrubRatio = ref(0);
const scrubPreview = ref<ScrubLocation | null>(null);

// ---------- 章节预取 ----------
interface ChapterData {
  title: string;
  paragraphs: string[];
}
const CACHE_LIMIT = 6;
const chapterCache = new Map<number, ChapterData>();
const pendingFetches = new Map<number, Promise<ChapterData>>();
let loadToken = 0;

let saveTimer: any = null;
let hideUiTimer: any = null;
let toastTimer: any = null;
let selTimer: any = null;
let suppressTimer: any = null;
let resizeObserver: ResizeObserver | null = null;
let suppressClick = false;

// ---------- 工具 ----------
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

// ---------- 系统偏好 ----------
const reducedMotion = ref(false);
let motionQuery: MediaQueryList | null = null;
try {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotion.value = motionQuery.matches;
} catch {}
function onMotionPref() {
  reducedMotion.value = !!motionQuery?.matches;
}

// ---------- 当前章节 / 进度 ----------
const currentChapter = computed(() => chapters.value.find((c) => c.chapter_index === chapterIndex.value) || null);
const nextChapterMeta = computed(
  () => chapters.value.find((c) => c.chapter_index === chapterIndex.value + 1) || null,
);
const chapterRatio = computed(() =>
  settings.mode === 'paged'
    ? pageCount.value > 1
      ? page.value / (pageCount.value - 1)
      : 0
    : scrollRatio.value,
);

/** 按字节偏移计算全书进度(比按章节数更准确) */
const globalRatio = computed(() => {
  const c = currentChapter.value;
  const size = book.value?.file_size ?? 0;
  const last = chapters.value[chapters.value.length - 1];
  const atChapterEnd =
    settings.mode === 'paged' ? pageCount.value <= 1 || chapterRatio.value >= 1 : scrollRatio.value >= 1;
  if (last && chapterIndex.value >= last.chapter_index && atChapterEnd) return 1;
  if (c && size > 0) {
    const span = Math.max(1, c.end_offset - c.start_offset);
    return clamp01((c.start_offset + chapterRatio.value * span) / size);
  }
  return chapters.value.length
    ? clamp01((chapterIndex.value + chapterRatio.value) / chapters.value.length)
    : 0;
});
const progressPercent = computed(() => Math.round(globalRatio.value * 100));
const displayRatio = computed(() => (scrubbing.value ? scrubRatio.value : globalRatio.value));
const displayPercent = computed(() => Math.round(displayRatio.value * 100));

const pageLabel = computed(() =>
  settings.mode === 'paged'
    ? `第 ${Math.min(page.value + 1, pageCount.value)} / ${pageCount.value} 页`
    : `本章 ${Math.round(chapterRatio.value * 100)}%`,
);
const chapterTitleShort = computed(() => {
  const t = title.value;
  return t.length > 24 ? t.slice(0, 24) + '…' : t;
});
const nextChapterTitle = computed(() => {
  const t = nextChapterMeta.value?.title || '下一章';
  return t.length > 18 ? t.slice(0, 18) + '…' : t;
});

// ---------- 章节数据(带相邻章预取) ----------
function prepareContent(content: string, chapterTitle: string): ChapterData {
  const lines = content.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length && (lines[0] === chapterTitle || chapterTitle.includes(lines[0]))) lines.shift();
  return { title: chapterTitle, paragraphs: lines };
}

function pruneCache(keep: number) {
  while (chapterCache.size > CACHE_LIMIT) {
    let victim: number | null = null;
    for (const key of chapterCache.keys()) {
      if (key !== keep && key !== chapterIndex.value) {
        victim = key;
        break;
      }
    }
    if (victim == null) break;
    chapterCache.delete(victim);
  }
}

async function getChapterData(index: number): Promise<ChapterData> {
  const cached = chapterCache.get(index);
  if (cached) return cached;
  const pending = pendingFetches.get(index);
  if (pending) return pending;

  const bid = bookId.value;
  const meta = chapters.value.find((c) => c.chapter_index === index);
  const chapterTitle = meta?.title || `第 ${index + 1} 章`;
  const p = api
    .getChapterContent(bid, index)
    .then(({ content }) => {
      const data = prepareContent(content, chapterTitle);
      if (bid === bookId.value) {
        chapterCache.set(index, data);
        pruneCache(index);
      }
      return data;
    })
    .finally(() => pendingFetches.delete(index));
  pendingFetches.set(index, p);
  return p;
}

function prefetchChapter(index: number) {
  if (index < 0 || index >= chapters.value.length || chapterCache.has(index)) return;
  getChapterData(index).catch(() => {});
}

// ---------- 加载章节 ----------
async function loadChapter(resetProgress: boolean) {
  const token = ++loadToken;
  loading.value = true;
  loadError.value = '';
  try {
    if (!book.value || book.value.id !== bookId.value) {
      book.value = await api.getBook(bookId.value);
    }
    if (!chapters.value.length || chapters.value[0]?.book_id !== bookId.value) {
      chapters.value = await api.getChapters(bookId.value);
    }
    if (token !== loadToken) return;

    const data = await getChapterData(chapterIndex.value);
    if (token !== loadToken) return;
    title.value = data.title;
    paragraphs.value = data.paragraphs;

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
    if (token === loadToken) loadError.value = err?.message || '加载失败';
  } finally {
    if (token === loadToken) loading.value = false;
  }
  if (token !== loadToken) return;

  // content 已渲染,现在才能测量分页
  page.value = 0;
  pageCount.value = 1;
  scrollRatio.value = 0;
  await nextTick();
  await repaginate();

  const ratio = pendingProgress.value;
  if (settings.mode === 'paged') {
    if (targetPage.value > 0) {
      goToPage(targetPage.value, true);
      targetPage.value = 0;
    } else if (ratio != null) {
      goToPage(Math.round(ratio * Math.max(0, pageCount.value - 1)), true);
      pendingProgress.value = null;
    }
  } else if (ratio != null) {
    await setScrollRatio(ratio, true);
    pendingProgress.value = null;
  }

  prefetchChapter(chapterIndex.value + 1);
  prefetchChapter(chapterIndex.value - 1);
  scheduleHideUi();
}

// ---------- 分页(CSS columns) ----------
async function repaginate() {
  if (!viewport.value || !contentEl.value) return;
  const vp = viewport.value;
  viewportH.value = vp.clientHeight;
  viewportW.value = vp.clientWidth;
  if (settings.mode !== 'paged' || viewportH.value <= 0 || viewportW.value <= 0) return;
  animating.value = false;
  await nextTick();
  // 列宽 = min(屏宽, 设置宽度);两侧留白计入列间距,保证每一页视觉居中
  const colW = pageColumnWidth.value;
  const step = colW + pageGap.value;
  const sw = contentEl.value.scrollWidth;
  pageCount.value = Math.max(1, Math.round((sw - pagePad.value - colW) / step) + 1);
  // clamp
  if (page.value >= pageCount.value) page.value = pageCount.value - 1;
  await nextTick();
  animating.value = true;
}

/** 分页列宽:窄 560 / 标准 680 / 宽 860,但不超出屏幕 */
const pageColumnWidth = computed(() => Math.max(280, Math.min(viewportW.value || window.innerWidth, settings.width)));
const pagePad = computed(() => Math.max(0, ((viewportW.value || window.innerWidth) - pageColumnWidth.value) / 2));
const pageGap = computed(() => Math.max(GAP, (viewportW.value || window.innerWidth) - pageColumnWidth.value));

function goToPage(p: number, instant = false) {
  if (instant) animating.value = false;
  page.value = clamp(Math.round(p), 0, Math.max(0, pageCount.value - 1));
  selPopup.value = null;
  if (instant) {
    nextTick(() => (animating.value = true));
  }
  scheduleSave();
  scheduleHideUi();
}

async function setScrollRatio(ratio: number, afterLayout = false) {
  if (afterLayout) {
    await nextTick();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }
  const el = viewport.value;
  if (!el) return;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const top = clamp01(ratio) * max;
  el.scrollTop = top;
  scrollRatio.value = max > 0 ? top / max : 0;
}

async function applyRatio(ratio: number) {
  const r = clamp01(ratio);
  if (settings.mode === 'paged') goToPage(Math.round(r * Math.max(0, pageCount.value - 1)), true);
  else await setScrollRatio(r, true);
  scheduleSave();
}

function nextPage() {
  if (settings.mode === 'scroll') {
    viewport.value?.scrollBy({
      top: viewport.value!.clientHeight * 0.9,
      behavior: reducedMotion.value ? 'auto' : 'smooth',
    });
    scheduleHideUi();
    return;
  }
  if (page.value < pageCount.value - 1) {
    goToPage(page.value + 1);
  } else if (chapterIndex.value + 1 < chapters.value.length) {
    nextChapter();
  }
}

function prevPage() {
  if (settings.mode === 'scroll') {
    viewport.value?.scrollBy({
      top: -viewport.value!.clientHeight * 0.9,
      behavior: reducedMotion.value ? 'auto' : 'smooth',
    });
    scheduleHideUi();
    return;
  }
  if (page.value > 0) {
    goToPage(page.value - 1);
  } else if (chapterIndex.value > 0) {
    goPrevChapterEnd();
  }
}

function nextChapter() {
  if (chapterIndex.value + 1 >= chapters.value.length) return;
  flushSave();
  router.replace(`/reader/${bookId.value}/${chapterIndex.value + 1}?pos=0`);
}

async function goPrevChapterEnd() {
  if (chapterIndex.value <= 0) return;
  flushSave();
  // 上一章:加载后定位到最后一页
  pendingEnd.value = true;
  await router.replace(`/reader/${bookId.value}/${chapterIndex.value - 1}`);
}

// ---------- 进度保存 ----------
function flushSave(forChapter = chapterIndex.value, forBook = bookId.value, ratio = chapterRatio.value) {
  clearTimeout(saveTimer);
  if (!forBook || loading.value) return;
  api
    .saveProgress(forBook, {
      chapter_index: forChapter,
      page: page.value,
      progress: clamp01(ratio),
    })
    .catch(() => {});
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), 400);
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
    if (!showSettings.value && !showToc.value && !showAI.value && !scrubbing.value) uiVisible.value = false;
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
  if (suppressClick) {
    suppressClick = false;
    return;
  }
  if (selPopup.value) {
    selPopup.value = null;
    return; // 先收起划词按钮,不误触翻页
  }
  const el = viewport.value;
  if (!el) return;
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
  // 滚动模式交给浏览器原生滚动,避免横向滑动与滚动叠加
  if (settings.mode !== 'paged') return;
  if (Math.abs(dx) > 60 && Math.abs(dy) < 60) {
    // 滑动后浏览器仍会补发 click,抑制它避免连翻两页
    suppressClick = true;
    clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => (suppressClick = false), 400);
    dx < 0 ? nextPage() : prevPage();
  }
}

// ---------- 键盘 ----------
const THEME_CYCLE: ThemeName[] = ['auto', 'light', 'sepia', 'gray', 'black'];
function cycleTheme() {
  const i = THEME_CYCLE.indexOf(settings.theme);
  settings.set('theme', THEME_CYCLE[(i + 1) % THEME_CYCLE.length]);
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
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
    case '+':
    case '=':
      e.preventDefault();
      settings.set('fontSize', clamp(settings.fontSize + 1, FONT_MIN, FONT_MAX));
      break;
    case '-':
    case '_':
      e.preventDefault();
      settings.set('fontSize', clamp(settings.fontSize - 1, FONT_MIN, FONT_MAX));
      break;
    case 'd':
    case 'D':
      cycleTheme();
      break;
    case 'm':
    case 'M':
      settings.set('mode', settings.mode === 'paged' ? 'scroll' : 'paged');
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
  const el = viewport.value;
  if (el) {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    scrollRatio.value = max > 0 ? el.scrollTop / max : 0;
  }
  selPopup.value = null;
  scheduleSave();
  scheduleHideUi();
}

// ---------- 选中文字 → AI ----------
function showSelPopup() {
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
  if (el?.closest?.('.reader-content')) {
    const p = el.closest('p');
    if (p) context = p.textContent?.trim().slice(0, 300) || '';
  } else {
    selPopup.value = null;
    return; // 选区不在阅读内容内
  }
  const rect = sel.getRangeAt(0).getBoundingClientRect();
  selPopup.value = { x: rect.left + rect.width / 2, y: rect.top - 8, term, context };
}

function onMouseUp() {
  showSelPopup();
}

// 移动端:长按选择后 touchend / selectionchange 触发
function onSelectionChange() {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    // 延迟检查:触摸选择的句柄调整需要时间
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && sel.toString().trim()) showSelPopup();
  }, 350);
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

// ---------- 书签 ----------
const bookmarkToast = ref('');
async function addBookmark() {
  const pos = clamp01(chapterRatio.value);
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

// ---------- 进度条拖动(全书跳转) ----------
interface ScrubLocation {
  chapterIndex: number;
  title: string;
  ratio: number;
}

function ratioToLocation(ratio: number): ScrubLocation | null {
  const r = clamp01(ratio);
  if (!chapters.value.length) return null;
  const size = book.value?.file_size ?? 0;
  if (size > 0) {
    const target = Math.min(size - 1, r * size);
    let lo = 0;
    let hi = chapters.value.length - 1;
    let idx = chapters.value.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (chapters.value[mid].end_offset <= target) lo = mid + 1;
      else {
        idx = mid;
        hi = mid - 1;
      }
    }
    const c = chapters.value[idx];
    const span = Math.max(1, c.end_offset - c.start_offset);
    return {
      chapterIndex: c.chapter_index,
      title: c.title,
      ratio: clamp01((target - c.start_offset) / span),
    };
  }
  const count = chapters.value.length;
  const pos = r * count;
  const i = Math.min(count - 1, Math.floor(pos));
  const c = chapters.value[i];
  return { chapterIndex: c.chapter_index, title: c.title, ratio: clamp01(pos - i) };
}

function updateScrub(e: PointerEvent) {
  const el = scrubTrack.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return;
  scrubRatio.value = clamp01((e.clientX - rect.left) / rect.width);
  scrubPreview.value = ratioToLocation(scrubRatio.value);
}

function onScrubDown(e: PointerEvent) {
  if (!scrubTrack.value) return;
  e.preventDefault();
  e.stopPropagation();
  scrubbing.value = true;
  clearTimeout(hideUiTimer);
  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  updateScrub(e);
}

function onScrubMove(e: PointerEvent) {
  if (!scrubbing.value) {
    if (e.pointerType === 'mouse') updateScrub(e);
    return;
  }
  e.preventDefault();
  updateScrub(e);
}

function onScrubUp(e: PointerEvent) {
  if (!scrubbing.value) return;
  updateScrub(e);
  scrubbing.value = false;
  const loc = scrubPreview.value;
  scrubPreview.value = null;
  if (loc) seekTo(loc);
  scheduleHideUi();
}

function onScrubCancel() {
  scrubbing.value = false;
  scrubPreview.value = null;
  scheduleHideUi();
}

function onScrubLeave() {
  if (!scrubbing.value) scrubPreview.value = null;
}

function seekTo(loc: ScrubLocation) {
  if (loc.chapterIndex === chapterIndex.value) {
    if (settings.mode === 'paged') goToPage(Math.round(loc.ratio * Math.max(0, pageCount.value - 1)), true);
    else void setScrollRatio(loc.ratio, true);
    scheduleSave();
  } else {
    flushSave();
    router.push(`/reader/${bookId.value}/${loc.chapterIndex}?pos=${loc.ratio.toFixed(4)}`);
  }
}

/** 键盘无障碍:聚焦进度条后 ←/→ 微调 1% */
function nudgeScrub(delta: number) {
  const loc = ratioToLocation(clamp01(globalRatio.value + delta / 100));
  if (loc) seekTo(loc);
}

// ---------- 路由切换 ----------
watch([bookId, chapterIndex], ([nBook, nCh], old) => {
  const [oBook, oCh] = old ?? [nBook, nCh];
  if (nBook === oBook && nCh === oCh) return;
  flushSave(oCh, oBook);
  if (nBook !== oBook) {
    chapterCache.clear();
    pendingFetches.clear();
    book.value = null;
    chapters.value = [];
    page.value = 0;
    pageCount.value = 1;
    scrollRatio.value = 0;
  }
  loadChapter(true);
});

// 同一章内通过书签/全文搜索带 pos 跳转
watch(
  () => [route.query.pos, route.query.page] as const,
  async ([posQ, pageQ]) => {
    if (loading.value) return;
    if (posQ != null) {
      const v = Number(posQ);
      if (!Number.isNaN(v)) await applyRatio(v);
    } else if (pageQ != null && settings.mode === 'paged') {
      const v = Number(pageQ);
      if (!Number.isNaN(v)) goToPage(v, true);
    }
  },
);

// ---------- 设置变化 → 重新分页并保持位置 ----------
watch(
  () => [
    settings.fontSize,
    settings.lineHeight,
    settings.width,
    settings.mode,
    settings.font,
    settings.paragraphSpacing,
    settings.boldText,
    settings.pageTurn,
  ] as const,
  async (_nv, old) => {
    if (loading.value) return;
    const prevMode = old?.[3] ?? settings.mode;
    const ratio =
      prevMode === 'paged'
        ? pageCount.value > 1
          ? page.value / (pageCount.value - 1)
          : 0
        : scrollRatio.value;
    await nextTick();
    await repaginate();
    if (settings.mode === 'paged') {
      goToPage(Math.round(ratio * Math.max(0, pageCount.value - 1)), true);
    } else {
      await setScrollRatio(ratio, true);
    }
    scheduleSave();
  },
);

// ---------- resize ----------
function setupObserver() {
  // ResizeObserver 在 observe 时会立即回调一次;跳过首次,避免覆盖刚恢复的阅读位置
  let lastW = viewport.value?.clientWidth ?? 0;
  let lastH = viewport.value?.clientHeight ?? 0;
  resizeObserver = new ResizeObserver(async () => {
    if (loading.value || !contentEl.value || !viewport.value) return;
    const w = viewport.value.clientWidth;
    const h = viewport.value.clientHeight;
    if (w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    if (settings.mode === 'paged') {
      const ratio = pageCount.value > 1 ? page.value / (pageCount.value - 1) : 0;
      await repaginate();
      goToPage(Math.round(ratio * Math.max(0, pageCount.value - 1)), true);
    } else {
      const ratio = scrollRatio.value;
      await setScrollRatio(ratio, true);
    }
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
}

// ---------- 生命周期 ----------
function onVisibilityChange() {
  if (document.visibilityState === 'hidden') flushSave();
}
function onPageHide() {
  flushSave();
}

onMounted(() => {
  loadChapter(true);
  window.addEventListener('keydown', onKeydown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('selectionchange', onSelectionChange);
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  motionQuery?.addEventListener?.('change', onMotionPref);
  nextTick(setupObserver);
  startHeartbeat();
});

onBeforeUnmount(() => {
  flushSave();
  window.removeEventListener('keydown', onKeydown);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('selectionchange', onSelectionChange);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', onPageHide);
  motionQuery?.removeEventListener?.('change', onMotionPref);
  mediaQuery?.removeEventListener?.('change', applyTheme);
  resizeObserver?.disconnect();
  clearTimeout(saveTimer);
  clearTimeout(hideUiTimer);
  clearTimeout(toastTimer);
  clearTimeout(selTimer);
  clearTimeout(suppressTimer);
  clearInterval(heartbeatTimer);
});

// ---------- 样式绑定 ----------
const contentStyle = computed(() => {
  const base: Record<string, string> = {
    fontSize: `${settings.fontSize}px`,
    lineHeight: String(settings.lineHeight),
    fontWeight: settings.boldText ? '500' : '400',
    '--reader-font': settings.fontFamily,
    '--reader-para-gap': `${settings.paragraphSpacing}em`,
  };
  if (settings.mode === 'paged') {
    // 首次测量前给一个安全占位,避免 0 尺寸闪烁
    const w = viewportW.value || window.innerWidth;
    const h = viewportH.value || window.innerHeight;
    const colW = Math.max(280, Math.min(w, settings.width));
    const pad = Math.max(0, (w - colW) / 2);
    const gap = Math.max(GAP, w - colW);
    base.height = `${h}px`;
    base.width = `${w}px`;
    base.paddingTop = 'calc(3.5rem + env(safe-area-inset-top))';
    base.paddingBottom = 'calc(5rem + env(safe-area-inset-bottom))';
    base.paddingLeft = `${pad}px`;
    base.paddingRight = `${pad}px`;
    base.columnWidth = `${colW}px`;
    base.columnGap = `${gap}px`;
    base.columnFill = 'auto';
    base.transform = `translateX(-${page.value * (colW + gap)}px)`;
    base.transition =
      !reducedMotion.value && settings.pageTurn === 'slide' && animating.value
        ? 'transform 0.32s cubic-bezier(0.25, 0.1, 0.25, 1)'
        : 'none';
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
        <button
          v-if="chapterIndex + 1 < chapters.length"
          class="chapter-nav-hint select-none"
          @click.stop="nextChapter"
        >
          <span class="chapter-nav-hint-title">— 下一章：{{ nextChapterTitle }} —</span>
        </button>
        <div v-else class="chapter-nav-hint select-none" style="cursor: default">
          <span class="chapter-nav-hint-title">— 已是最后一章 —</span>
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
        style="background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-bottom: 1px solid var(--border); padding-top: calc(0.5rem + env(safe-area-inset-top))"
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
          <button class="btn !border-0 !bg-transparent !px-2" title="阅读设置 (Aa)" @click="showSettings = !showSettings">
            <span class="font-semibold leading-none" style="font-family: Georgia, 'Times New Roman', serif; font-size: 15px">Aa</span>
          </button>
        </div>
      </header>
    </Transition>

    <!-- 底栏:Apple Books 式进度 + 剩余时间 + 可拖动跳转 -->
    <Transition name="fade">
      <footer
        v-if="uiVisible"
        class="absolute bottom-0 inset-x-0 z-30 px-3 pt-1 pb-2 text-xs text-dim"
        style="background: color-mix(in srgb, var(--bg) 88%, transparent); backdrop-filter: blur(12px); border-top: 1px solid var(--border); padding-bottom: calc(0.5rem + env(safe-area-inset-bottom))"
        @click.stop
      >
        <div class="flex items-center gap-1.5">
          <button
            class="reader-nav-btn"
            :disabled="chapterIndex === 0"
            title="上一章"
            @click="goPrevChapterEnd"
          >
            <ChevronLeft class="w-4 h-4" />
          </button>

          <div
            ref="scrubTrack"
            class="relative flex-1 py-2.5 cursor-pointer touch-none focus:outline-none"
            role="slider"
            tabindex="0"
            aria-label="全书进度"
            aria-valuemin="0"
            aria-valuemax="100"
            :aria-valuenow="displayPercent"
            @pointerdown="onScrubDown"
            @pointermove="onScrubMove"
            @pointerup="onScrubUp"
            @pointercancel="onScrubCancel"
            @pointerleave="onScrubLeave"
            @keydown.left.stop.prevent="nudgeScrub(-1)"
            @keydown.right.stop.prevent="nudgeScrub(1)"
          >
            <div class="relative h-1.5 rounded-full group" style="background: var(--border)">
              <div
                class="absolute inset-y-0 left-0 rounded-full"
                :style="{
                  width: `${displayPercent}%`,
                  background: 'var(--accent)',
                  transition: scrubbing ? 'none' : 'width .2s ease',
                }"
              />
              <div
                class="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full shadow-sm pointer-events-none transition-opacity"
                :class="scrubbing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
                :style="{ left: `${displayPercent}%`, background: 'var(--accent)' }"
              />
            </div>

            <!-- 拖动预览 -->
            <div
              v-if="scrubPreview"
              class="absolute bottom-full mb-2 -translate-x-1/2 px-2.5 py-1 rounded-lg text-[11px] whitespace-nowrap shadow-lg pointer-events-none"
              :style="{
                left: `${Math.min(90, Math.max(10, scrubRatio * 100))}%`,
                background: 'var(--panel)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
              }"
            >
              <span class="font-medium">第 {{ scrubPreview.chapterIndex + 1 }} 章</span>
              <span class="text-dim"> · {{ Math.round(scrubPreview.ratio * 100) }}%</span>
              <div class="text-[10px] text-dim truncate max-w-[180px]">{{ scrubPreview.title }}</div>
            </div>
          </div>

          <button
            class="reader-nav-btn"
            :disabled="chapterIndex + 1 >= chapters.length"
            title="下一章"
            @click="nextChapter"
          >
            <ChevronRight class="w-4 h-4" />
          </button>
        </div>

        <div class="flex items-center justify-between gap-3 px-1 tabular-nums">
          <span class="truncate">{{ pageLabel }}</span>
          <span class="truncate">全书 {{ progressPercent }}%</span>
        </div>
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
  display: block;
  width: 100%;
  padding: 2em 0 3em;
  background: none;
  border: 0;
  color: var(--text-dim);
  font: inherit;
  font-size: 0.82em;
  text-align: center;
  text-indent: 0;
  cursor: pointer;
  transition: color .15s ease;
}
.chapter-nav-hint:hover {
  color: var(--accent);
}
.chapter-nav-hint-title {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reader-content.paged .chapter-nav-hint {
  break-inside: avoid;
}
.reader-nav-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.85rem;
  height: 1.85rem;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--text-dim);
  transition: color .15s ease, background .15s ease;
}
.reader-nav-btn:hover {
  color: var(--accent);
  background: var(--bg-soft);
}
.reader-nav-btn:disabled {
  opacity: .3;
  pointer-events: none;
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
