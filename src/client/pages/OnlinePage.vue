<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api';
import type {
  OnlineBookInfo,
  OnlineChapter,
  OnlineDownloadTask,
  OnlineExploreCategory,
  OnlineLibraryBook,
  OnlineSearchBook,
  OnlineSearchResult,
  BookSource,
} from '@shared/types';
import { Search, ArrowLeft, BookOpen, Settings2, Download, X, Compass, RefreshCw, BookText, Headphones, Image as ImageIcon, BookMarked, Trash2 } from 'lucide-vue-next';

function typeLabel(t: number) {
  return t === 1 ? '音频' : t === 2 ? '漫画' : '文字';
}

const router = useRouter();
const q = ref('');
const searching = ref(false);
const searched = ref(false);
const results = ref<OnlineSearchResult[]>([]);

const sources = ref<BookSource[]>([]);
const tasks = ref<OnlineDownloadTask[]>([]);
let taskTimer: any = null;

// ---- 详情弹窗 ----
const modalBook = ref<{ source: string; name: string; author: string; bookUrl: string; coverUrl?: string; sourceType: number } | null>(null);
const shelf = ref<OnlineLibraryBook[]>([]);
const shelfAdded = ref(false);
const modalLoading = ref(false);
const modalInfo = ref<OnlineBookInfo | null>(null);
const modalToc = ref<OnlineChapter[] | null>(null);
const modalPreview = ref<{ title: string; content: string } | null>(null);
const modalPreviewLoading = ref(false);
const downloadStarted = ref(false);

// ---- 发现 ----
const exploreSource = ref('');
const exploreCats = ref<OnlineExploreCategory[]>([]);
const exploreCatUrl = ref('');
const exploreBooks = ref<OnlineSearchBook[]>([]);
const exploreLoading = ref(false);

async function refreshShelf() {
  shelf.value = await api.onlineLibrary().catch(() => []);
}
onMounted(async () => {
  sources.value = await api.onlineSources().catch(() => []);
  await refreshShelf();
  await refreshTasks();
  taskTimer = setInterval(refreshTasks, 2000);
});
onUnmounted(() => clearInterval(taskTimer));

async function refreshTasks() {
  tasks.value = await api.downloadTasks().catch(() => []);
}

async function doSearch() {
  const kw = q.value.trim();
  if (!kw) return;
  searching.value = true;
  searched.value = true;
  modalClose();
  try {
    const r = await api.onlineSearch(kw);
    results.value = r.results;
  } finally {
    searching.value = false;
  }
}

function openModal(source: string, b: OnlineSearchBook, sourceType = 0) {
  modalBook.value = { source, name: b.name, author: b.author, bookUrl: b.bookUrl, coverUrl: b.coverUrl, sourceType };
  modalInfo.value = null;
  modalToc.value = null;
  modalPreview.value = null;
  downloadStarted.value = false;
  shelfAdded.value = false;
  loadDetail();
}

async function loadDetail() {
  if (!modalBook.value) return;
  modalLoading.value = true;
  try {
    const r = await api.onlineBook(modalBook.value.source, modalBook.value.bookUrl);
    modalInfo.value = r.info;
  } catch (e: any) {
    modalInfo.value = {
      name: modalBook.value.name, author: modalBook.value.author, kind: '', intro: '',
      coverUrl: '', latestChapter: '', bookUrl: modalBook.value.bookUrl, wordCount: '', tocUrl: '',
    };
    modalToc.value = [];
    modalPreview.value = { title: '错误', content: e?.message || '加载失败' };
  } finally {
    modalLoading.value = false;
  }
}

async function loadToc() {
  if (!modalBook.value) return;
  modalToc.value = [];
  try {
    const r = await api.onlineToc(modalBook.value.source, modalBook.value.bookUrl);
    modalToc.value = r.chapters;
  } catch (e: any) {
    modalToc.value = [];
    alert(e?.message || '目录加载失败');
  }
}

async function previewFirst() {
  const mb = modalBook.value;
  if (!mb) return;
  if (!modalToc.value?.length) await loadToc();
  const ch = modalToc.value?.find((c) => c.url);
  if (!ch) return;
  modalPreviewLoading.value = true;
  try {
    const r = await api.onlineContent(mb.source, ch.url, ch.title);
    modalPreview.value = { title: ch.title, content: r.content };
  } catch (e: any) {
    modalPreview.value = { title: '错误', content: e?.message || '试读失败' };
  } finally {
    modalPreviewLoading.value = false;
  }
}

async function addToShelf() {
  if (!modalBook.value) return;
  try {
    await api.addToLibrary({
      source: modalBook.value.source,
      bookUrl: modalBook.value.bookUrl,
      name: modalInfo.value?.name || modalBook.value.name,
      author: modalInfo.value?.author || modalBook.value.author,
      coverUrl: modalInfo.value?.coverUrl || modalBook.value.coverUrl || '',
      sourceType: modalBook.value.sourceType,
    });
    shelfAdded.value = true;
    await refreshShelf();
  } catch (e: any) {
    alert(e?.message || '加入书架失败');
  }
}

async function removeShelf(id: number) {
  await api.removeFromLibrary(id).catch(() => undefined);
  await refreshShelf();
}

async function download() {
  if (!modalBook.value) return;
  try {
    await api.createDownload(modalBook.value.source, modalBook.value.bookUrl);
    downloadStarted.value = true;
    await refreshTasks();
  } catch (e: any) {
    alert(e?.message || '下载任务创建失败');
  }
}

function modalClose() {
  modalBook.value = null;
}

// ---- 发现 ----
async function loadExploreSources() {
  // 选第一个开启探索的书源
  const s = sources.value.find((x) => x.enabledExplore);
  if (!s) return;
  exploreSource.value = s.bookSourceUrl;
  await loadExploreCats();
}

async function loadExploreCats() {
  exploreCats.value = [];
  exploreBooks.value = [];
  if (!exploreSource.value) return;
  try {
    const r = await api.onlineExplore(exploreSource.value);
    exploreCats.value = r.categories ?? [];
  } catch {}
}

async function loadExploreBooks() {
  if (!exploreSource.value || !exploreCatUrl.value) return;
  exploreLoading.value = true;
  try {
    const r = await api.onlineExploreBooks(exploreSource.value, exploreCatUrl.value);
    exploreBooks.value = r.books;
  } catch (e: any) {
    exploreBooks.value = [];
  } finally {
    exploreLoading.value = false;
  }
}

const activeTasks = computed(() => tasks.value.filter((t) => ['pending', 'running'].includes(t.status)));
const finishedTasks = computed(() => tasks.value.filter((t) => !['pending', 'running'].includes(t.status)).slice(0, 5));
const exploreSourceOptions = computed(() => sources.value.filter((s) => s.enabled && s.enabledExplore));
const enabledSourceCount = computed(() => sources.value.filter((s) => s.enabled).length);
const modalType = computed(() => modalBook.value?.sourceType ?? 0);
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 pb-32">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">在线书源</h1>
      <RouterLink to="/sources" class="btn ml-auto"><Settings2 class="w-4 h-4" /> 书源管理</RouterLink>
    </header>

    <div v-if="!enabledSourceCount" class="panel rounded-2xl p-8 text-center mb-6">
      <Compass class="w-8 h-8 mx-auto text-dim mb-3" />
      <p class="text-sm mb-1">还没有可用的书源</p>
      <p class="text-xs text-dim mb-4">先到书源管理导入 Legado 书源(JSON 链接或文本)</p>
      <RouterLink to="/sources" class="btn btn-primary">去导入书源</RouterLink>
    </div>

    <!-- 在线书架 -->
    <section v-if="shelf.length" class="mb-6">
      <h2 class="text-sm font-medium text-dim mb-2">在线书架</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div v-for="b in shelf" :key="b.id" class="panel rounded-2xl p-3 flex items-center gap-3">
          <button class="flex items-center gap-3 min-w-0 flex-1 text-left" @click="router.push(`/reader/online/${b.id}/${b.progress?.chapter_index ?? 0}`)">
            <div
              class="w-10 h-14 rounded-md flex items-center justify-center text-white shrink-0"
              style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
            >
              <Headphones v-if="b.sourceType === 1" class="w-4 h-4" />
              <ImageIcon v-else-if="b.sourceType === 2" class="w-4 h-4" />
              <span v-else class="font-semibold">{{ (b.name || '?').slice(0, 1) }}</span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ b.name }}</div>
              <div class="text-xs text-dim mt-0.5 truncate">
                {{ b.author }}<span v-if="b.sourceType === 1"> · 音频</span><span v-else-if="b.sourceType === 2"> · 漫画</span>
                <span v-if="b.progress && b.progress.chapter_index > 0"> · 已读 {{ b.progress.chapter_index }} 章</span>
              </div>
            </div>
          </button>
          <button class="btn !px-2 text-dim" title="移出书架" @click="removeShelf(b.id)"><Trash2 class="w-4 h-4" /></button>
        </div>
      </div>
    </section>

    <form class="flex gap-2 mb-6" @submit.prevent="doSearch">
      <div class="relative flex-1">
        <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input v-model="q" class="input !pl-9" placeholder="在所有已启用书源中搜索…" autofocus />
      </div>
      <button type="submit" class="btn btn-primary" :disabled="searching">搜索</button>
    </form>

    <!-- 下载任务 -->
    <section v-if="tasks.length" class="mb-6">
      <h2 class="text-sm font-medium text-dim mb-2">下载任务</h2>
      <ul class="space-y-2">
        <li v-for="t in [...activeTasks, ...finishedTasks]" :key="t.id" class="panel rounded-2xl p-3">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ t.bookName || '加载中…' }}</div>
              <div class="text-xs text-dim mt-0.5">
                <template v-if="t.status === 'running' || t.status === 'pending'">
                  {{ t.finished }}/{{ t.total || '?' }} 章 · {{ t.currentTitle }}
                </template>
                <template v-else-if="t.status === 'done'">完成 · {{ t.finished }} 章</template>
                <template v-else-if="t.status === 'canceled'">已取消</template>
                <template v-else>失败: {{ t.error }}</template>
              </div>
              <div
                v-if="t.status === 'running' || t.status === 'pending'"
                class="mt-2 h-1 rounded-full overflow-hidden"
                style="background: var(--bg-soft)"
              >
                <div
                  class="h-full rounded-full transition-all"
                  :style="{
                    width: `${t.total ? Math.max(2, Math.round((t.finished / t.total) * 100)) : 4}%`,
                    background: 'var(--accent)',
                  }"
                />
              </div>
            </div>
            <button
              v-if="t.status === 'running' || t.status === 'pending'"
              class="btn !px-2.5 text-xs"
              @click="api.cancelDownload(t.id)"
            >
              取消
            </button>
            <RouterLink
              v-else-if="t.status === 'done' && t.bookId"
              :to="`/reader/${t.bookId}/0`"
              class="btn btn-primary !px-3 text-xs"
            >
              <BookText class="w-3.5 h-3.5" /> 阅读
            </RouterLink>
          </div>
        </li>
      </ul>
    </section>

    <!-- 发现 -->
    <section v-if="exploreSourceOptions.length" class="mb-6">
      <h2 class="text-sm font-medium text-dim mb-2">发现</h2>
      <div class="flex gap-2 mb-3">
        <select v-model="exploreSource" class="input" @change="loadExploreCats">
          <option value="" disabled>选择书源</option>
          <option v-for="s in exploreSourceOptions" :key="s.bookSourceUrl" :value="s.bookSourceUrl">
            {{ s.bookSourceName }}
          </option>
        </select>
        <select v-model="exploreCatUrl" class="input" :disabled="!exploreCats.length" @change="loadExploreBooks">
          <option value="" disabled>选择分类</option>
          <option v-for="c in exploreCats" :key="c.url" :value="c.url">{{ c.title }}</option>
        </select>
      </div>
      <div v-if="exploreLoading" class="text-center text-dim text-sm py-6">加载中…</div>
      <ul v-else-if="exploreBooks.length" class="divide-y" style="border-color: var(--border)">
        <li v-for="(b, i) in exploreBooks" :key="i">
          <button
            class="w-full flex items-center gap-3 py-3 text-left hover:opacity-80"
            @click="openModal(exploreSource, b)"
          >
            <BookOpen class="w-4 h-4 text-dim shrink-0" />
            <div class="min-w-0 flex-1">
              <div class="text-sm font-medium truncate">{{ b.name || '(无标题)' }}</div>
              <div class="text-xs text-dim mt-0.5 truncate">
                {{ b.author }}<span v-if="b.latestChapter"> · {{ b.latestChapter }}</span>
              </div>
            </div>
          </button>
        </li>
      </ul>
    </section>

    <!-- 搜索结果 -->
    <div v-if="searching" class="text-center text-dim text-sm py-10">
      正在搜索 {{ enabledSourceCount }} 个书源…
    </div>
    <template v-else-if="results.length">
      <section v-for="r in results" :key="r.sourceUrl" class="mb-8">
        <div class="flex items-center gap-2 mb-2">
          <span class="text-sm font-medium">{{ r.sourceName }}</span>
          <span v-if="r.sourceType === 1" class="text-xs text-dim">音频源</span>
          <span v-else-if="r.sourceType === 2" class="text-xs text-dim">漫画源</span>
          <span v-if="!r.error" class="text-xs text-dim">{{ r.books.length }} 条 · {{ r.costMs }}ms</span>
          <span v-else class="text-xs text-red-500 truncate">{{ r.error }}</span>
        </div>
        <ul v-if="r.books.length" class="divide-y" style="border-color: var(--border)">
          <li v-for="(b, i) in r.books" :key="i">
            <button
              class="w-full flex items-center gap-3 py-3 text-left hover:opacity-80"
              @click="openModal(r.sourceUrl, b, r.sourceType)"
            >
              <div
                class="w-10 h-14 rounded-md flex items-center justify-center text-white text-lg font-semibold shrink-0"
                style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
              >
                {{ (b.name || '?').slice(0, 1) }}
              </div>
              <div class="min-w-0 flex-1">
                <div class="font-medium truncate">{{ b.name || '(无标题)' }}</div>
                <div class="text-xs text-dim mt-1 truncate">
                  {{ b.author }}<span v-if="b.kind"> · {{ b.kind }}</span>
                  <span v-if="b.latestChapter"> · {{ b.latestChapter }}</span>
                </div>
                <div v-if="b.intro" class="text-xs text-dim mt-1 line-clamp-2">{{ b.intro }}</div>
              </div>
            </button>
          </li>
        </ul>
      </section>
    </template>
    <div v-else-if="searched && !searching" class="text-center text-dim text-sm py-10">没有搜索到结果</div>

    <!-- 详情弹窗 -->
    <teleport to="body">
      <div
        v-if="modalBook"
        class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style="background: rgba(0,0,0,.45)"
        @click.self="modalClose"
      >
        <div class="panel rounded-t-3xl sm:rounded-3xl w-full sm:max-w-xl max-h-[85vh] overflow-y-auto p-5">
          <div class="flex items-start gap-4 mb-4">
            <div
              class="w-14 h-20 rounded-md flex items-center justify-center text-white text-xl font-semibold shrink-0"
              style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
            >
              {{ (modalBook.name || '?').slice(0, 1) }}
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="font-semibold leading-snug">{{ modalInfo?.name || modalBook.name }}</h3>
              <p class="text-xs text-dim mt-1">
                {{ modalInfo?.author || modalBook.author }}
                <span v-if="modalInfo?.kind"> · {{ modalInfo.kind }}</span>
              </p>
              <p v-if="modalInfo?.latestChapter" class="text-xs text-dim mt-0.5 truncate">
                最新: {{ modalInfo.latestChapter }}
              </p>
            </div>
            <button class="btn !px-2" @click="modalClose"><X class="w-4 h-4" /></button>
          </div>

          <p v-if="modalInfo?.intro" class="text-sm text-dim leading-relaxed mb-4 line-clamp-6">
            {{ modalInfo.intro }}
          </p>

          <div class="flex flex-wrap gap-2 mb-4">
            <button class="btn" :disabled="modalLoading" @click="loadToc">
              <RefreshCw class="w-4 h-4" /> {{ modalToc ? `目录(${modalToc.filter((c) => c.url).length})` : '查看目录' }}
            </button>
            <template v-if="modalType === 0">
              <button class="btn" :disabled="modalLoading || modalPreviewLoading" @click="previewFirst">
                <BookOpen class="w-4 h-4" /> 试读第一章
              </button>
              <button class="btn btn-primary" :disabled="modalLoading" @click="download">
                <Download class="w-4 h-4" /> 下载入库
              </button>
            </template>
            <template v-else>
              <span class="btn !cursor-default text-xs text-dim self-center">{{ modalType === 1 ? '音频源' : '漫画源' }} · 在线阅读</span>
              <button class="btn btn-primary" :disabled="modalLoading" @click="addToShelf">
                <BookMarked class="w-4 h-4" /> 加入书架
              </button>
            </template>
          </div>

          <p v-if="downloadStarted" class="text-xs accent mb-3">已创建下载任务,可在页面下方任务列表查看进度</p>
          <p v-if="shelfAdded" class="text-xs accent mb-3">已加入书架,可在页面上方「在线书架」打开阅读</p>

          <!-- 试读 -->
          <div v-if="modalPreview" class="mb-4">
            <h3 class="text-sm font-medium mb-2">{{ modalPreview.title }}</h3>
            <pre
              class="panel rounded-xl p-3 text-xs leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto"
              style="font-family: inherit"
            >{{ modalPreview.content }}</pre>
          </div>

          <!-- 目录 -->
          <div v-if="modalToc && modalToc.length">
            <h3 class="text-sm font-medium mb-2">目录</h3>
            <ul class="max-h-64 overflow-y-auto text-sm divide-y" style="border-color: var(--border)">
              <li v-for="(c, i) in modalToc" :key="i" class="py-2 flex items-center gap-2">
                <span class="truncate" :class="c.url ? '' : 'text-dim'">{{ c.title }}</span>
                <span v-if="c.isVip" class="text-xs text-amber-500 shrink-0">VIP</span>
              </li>
            </ul>
          </div>

          <p v-if="modalLoading" class="text-center text-dim text-sm py-4">加载中…</p>
        </div>
      </div>
    </teleport>
  </div>
</template>