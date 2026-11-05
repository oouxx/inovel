<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { api, type Bookmark, type FullTextHit } from '@/api';
import type { ChapterMeta } from '@shared/types';
import { X, Search, Bookmark as BookmarkIcon, ListTree, Loader2, Trash2 } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  bookId: number;
  bookTitle: string;
  currentIndex: number;
}>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

type Tab = 'toc' | 'marks' | 'find';
const tab = ref<Tab>('toc');

const chapters = ref<ChapterMeta[]>([]);
const query = ref('');
const listEl = ref<HTMLElement | null>(null);
const RENDER_CAP = 300;
const SEARCH_CAP = 1000;
const renderLimit = ref(RENDER_CAP);

// 书签
const bookmarks = ref<Bookmark[]>([]);

// 全文搜索
const findQuery = ref('');
const findResults = ref<FullTextHit[]>();
const findTotal = ref(0);
const findLoading = ref(false);
const findSearched = ref(false);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    if (!chapters.value.length) chapters.value = await api.getChapters(props.bookId);
    // 当前章可能超过默认渲染上限,打开时确保它已渲染
    renderLimit.value = Math.max(RENDER_CAP, props.currentIndex + 50);
    await nextTick();
    scrollToCurrent();
    if (tab.value === 'marks') await loadBookmarks();
  },
);

async function loadBookmarks() {
  bookmarks.value = await api.listBookmarks(props.bookId);
}

watch(tab, async (t) => {
  // 每次切到书签页都重新拉取,避免阅读中新增书签后列表还是旧的
  if (t === 'marks') await loadBookmarks();
});

async function scrollToCurrent() {
  setTimeout(() => {
    const list = listEl.value;
    const target = list?.querySelector(`[data-index="${props.currentIndex}"]`) as HTMLElement | null;
    if (!list || !target) return;
    const lr = list.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    list.scrollTop += tr.top - lr.top - list.clientHeight / 2 + tr.height / 2;
  }, 60);
}

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? chapters.value.filter((c) => c.title?.toLowerCase().includes(q)) : chapters.value;
});
const filtered = computed(() =>
  query.value.trim() ? matches.value.slice(0, SEARCH_CAP) : matches.value.slice(0, renderLimit.value),
);
const hasMore = computed(() => filtered.value.length < matches.value.length);

// ---- 书签 ----
async function removeBookmark(id: number) {
  await api.deleteBookmark(id);
  bookmarks.value = bookmarks.value.filter((b) => b.id !== id);
}

function fmtTime(ts: number) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ---- 全文搜索 ----
let findTimer: any = null;
function onFindInput() {
  clearTimeout(findTimer);
  findTimer = setTimeout(() => doFind(), 400);
}
async function doFind() {
  const q = findQuery.value.trim();
  if (!q) {
    findResults.value = undefined;
    findSearched.value = false;
    return;
  }
  findLoading.value = true;
  findSearched.value = true;
  try {
    const r = await api.fullText(props.bookId, q);
    findResults.value = r.chapters;
    findTotal.value = r.total;
  } finally {
    findLoading.value = false;
  }
}
watch(query, () => {
  renderLimit.value = RENDER_CAP;
});
watch(() => props.bookId, () => {
  bookmarks.value = [];
  findResults.value = undefined;
  findQuery.value = '';
  findSearched.value = false;
  tab.value = 'toc';
  chapters.value = [];
  query.value = '';
  renderLimit.value = RENDER_CAP;
});
</script>

<template>
  <Transition name="toc">
    <div v-if="open" class="fixed inset-0 z-50 flex" @click.self="emit('update:open', false)">
      <div class="absolute inset-0 bg-black/30" @click="emit('update:open', false)" />

      <div
        class="relative w-full sm:w-80 h-full flex flex-col"
        style="background: var(--panel); box-shadow: 8px 0 30px rgba(0,0,0,0.1)"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--border)">
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ bookTitle }}</div>
            <div class="text-xs text-dim">
              {{ query.trim() ? `${matches.length} 条匹配` : `${chapters.length} 章` }}
            </div>
          </div>
          <button class="btn !p-2 !border-0" @click="emit('update:open', false)"><X class="w-4 h-4" /></button>
        </div>

        <!-- Tabs -->
        <div class="flex border-b text-xs" style="border-color: var(--border)">
          <button
            v-for="t in [
              { key: 'toc', label: '目录', icon: ListTree },
              { key: 'marks', label: '书签', icon: BookmarkIcon },
              { key: 'find', label: '全文搜索', icon: Search },
            ]"
            :key="t.key"
            class="flex-1 flex items-center justify-center gap-1.5 py-2.5 border-b-2 transition-colors"
            :style="tab === t.key ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : { color: 'var(--text-dim)', borderColor: 'transparent' }"
            @click="tab = t.key as Tab"
          >
            <component :is="t.icon" class="w-3.5 h-3.5" />
            {{ t.label }}
          </button>
        </div>

        <!-- 目录 -->
        <template v-if="tab === 'toc'">
          <div class="px-3 py-2 border-b" style="border-color: var(--border)">
            <div class="relative">
              <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <input v-model="query" class="input !py-1.5 !pl-8 !text-xs" placeholder="搜索章节…" />
            </div>
          </div>
          <div ref="listEl" class="flex-1 overflow-y-auto py-1">
            <RouterLink
              v-for="c in filtered"
              :key="c.id"
              :to="`/reader/${bookId}/${c.chapter_index}`"
              :data-index="c.chapter_index"
              class="flex items-baseline gap-3 px-4 py-2.5 text-sm"
              :class="c.chapter_index === currentIndex && 'font-medium'"
              :style="c.chapter_index === currentIndex ? { color: 'var(--accent)', background: 'var(--accent-soft)' } : {}"
              @click="emit('update:open', false)"
            >
              <span class="text-xs text-dim w-10 shrink-0 tabular-nums">{{ c.chapter_index + 1 }}</span>
              <span class="truncate">{{ c.title }}</span>
            </RouterLink>
            <div v-if="hasMore" class="px-4 py-3 text-center">
              <button v-if="!query.trim()" class="btn !py-1 !text-xs" @click="renderLimit += RENDER_CAP">
                显示更多
              </button>
              <span v-else class="text-xs text-dim">仅显示前 {{ SEARCH_CAP }} 条匹配</span>
            </div>
          </div>
        </template>

        <!-- 书签 -->
        <template v-else-if="tab === 'marks'">
          <div class="flex-1 overflow-y-auto">
            <div v-if="!bookmarks.length" class="text-center text-xs text-dim py-16">
              还没有书签<br />阅读时点击顶栏的书签按钮即可添加
            </div>
            <div
              v-for="b in bookmarks"
              :key="b.id"
              class="flex items-center gap-3 px-4 py-3 border-b text-sm group"
              style="border-color: var(--border)"
            >
              <BookmarkIcon class="w-4 h-4 accent shrink-0" />
              <RouterLink
                :to="`/reader/${bookId}/${b.chapter_index}?pos=${b.position.toFixed(3)}`"
                class="min-w-0 flex-1"
                @click="emit('update:open', false)"
              >
                <div class="truncate">{{ b.chapter_title || `第 ${b.chapter_index + 1} 章` }}</div>
                <div class="text-xs text-dim mt-0.5">
                  第 {{ b.chapter_index + 1 }} 章 · {{ Math.round(b.position * 100) }}% · {{ fmtTime(b.created_at) }}
                </div>
              </RouterLink>
              <button class="btn !p-1.5 !border-0 opacity-100 sm:opacity-0 sm:group-hover:opacity-100" @click="removeBookmark(b.id)">
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </template>

        <!-- 全文搜索 -->
        <template v-else>
          <div class="px-3 py-2 border-b" style="border-color: var(--border)">
            <div class="relative">
              <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
              <input
                v-model="findQuery"
                class="input !py-1.5 !pl-8 !text-xs"
                placeholder="在全书正文中搜索…"
                @input="onFindInput"
              />
            </div>
          </div>
          <div class="flex-1 overflow-y-auto">
            <div v-if="findLoading" class="text-center text-xs text-dim py-12 flex items-center justify-center gap-2">
              <Loader2 class="w-4 h-4 animate-spin" /> 全书扫描中…
            </div>
            <div v-else-if="findSearched && !findResults?.length" class="text-center text-xs text-dim py-16">
              全书未找到「{{ findQuery }}」
            </div>
            <div v-else-if="findResults?.length" class="py-1">
              <div class="px-4 py-1.5 text-xs text-dim sticky top-0" style="background: var(--panel)">
                共 {{ findTotal }} 处命中,前 {{ findResults.length }} 章
              </div>
              <RouterLink
                v-for="h in findResults"
                :key="h.chapter_index"
                :to="`/reader/${bookId}/${h.chapter_index}?pos=${h.position.toFixed(3)}`"
                class="block px-4 py-3 border-b hover:opacity-80"
                style="border-color: var(--border)"
                @click="emit('update:open', false)"
              >
                <div class="text-sm flex items-center gap-2">
                  <span class="truncate font-medium">{{ h.title }}</span>
                  <span class="text-xs text-dim shrink-0">× {{ h.count }}</span>
                </div>
                <div class="text-xs text-dim mt-1 line-clamp-2 leading-relaxed">{{ h.snippet }}</div>
              </RouterLink>
            </div>
            <div v-else class="text-center text-xs text-dim py-16">输入关键词,搜索全书正文</div>
          </div>
        </template>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toc-enter-active, .toc-leave-active { transition: opacity .2s ease; }
.toc-enter-from, .toc-leave-to { opacity: 0; }
</style>