<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { SearchResultItem } from '@shared/types';
import BookCover from '@/components/BookCover.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Search, X, Clock3, Loader2 } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const q = ref((route.query.q as string) || '');
const results = ref<SearchResultItem[]>([]);
const loading = ref(false);
const searched = ref(false);
const searchError = ref('');

const RECENT_KEY = 'novel-reader-recent-searches';
function loadRecent(): string[] {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, 6) : [];
  } catch {
    return [];
  }
}
const recent = ref<string[]>(loadRecent());

function remember(keyword: string) {
  const list = [keyword, ...recent.value.filter((x) => x !== keyword)].slice(0, 6);
  recent.value = list;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {}
}

function clearRecent() {
  recent.value = [];
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch {}
}

let searchTimer: any = null;
let searchSeq = 0;

async function doSearch(keyword: string, rememberIt = false) {
  const v = keyword.trim();
  if (!v) {
    results.value = [];
    searched.value = false;
    loading.value = false;
    return;
  }
  const seq = ++searchSeq;
  loading.value = true;
  searched.value = true;
  searchError.value = '';
  try {
    const found = await api.search(v);
    if (seq !== searchSeq) return;
    results.value = found;
    if (rememberIt) remember(v);
    if (route.query.q !== v) router.replace({ query: { q: v } });
  } catch (err: any) {
    if (seq === searchSeq) {
      results.value = [];
      searchError.value = err?.message || '搜索失败';
    }
  } finally {
    if (seq === searchSeq) loading.value = false;
  }
}

function onInput() {
  clearTimeout(searchTimer);
  if (!q.value.trim()) {
    searchSeq++;
    results.value = [];
    searched.value = false;
    loading.value = false;
    searchError.value = '';
    router.replace({ query: {} });
    return;
  }
  searchTimer = setTimeout(() => doSearch(q.value, false), 260);
}

function submit() {
  clearTimeout(searchTimer);
  doSearch(q.value, true);
}

function clear() {
  clearTimeout(searchTimer);
  searchSeq++;
  q.value = '';
  results.value = [];
  searched.value = false;
  searchError.value = '';
  router.replace({ query: {} });
}

function pickRecent(keyword: string) {
  q.value = keyword;
  clearTimeout(searchTimer);
  doSearch(keyword, true);
}

onMounted(() => {
  if (q.value) doSearch(q.value);
});
onUnmounted(() => clearTimeout(searchTimer));

watch(
  () => route.query.q,
  (nq) => {
    if (typeof nq === 'string' && nq !== q.value) {
      q.value = nq;
      if (nq) doSearch(nq);
      else {
        searchSeq++;
        results.value = [];
        searched.value = false;
        searchError.value = '';
        loading.value = false;
      }
    }
  },
);
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 pb-24">
    <PageHeader title="搜索书库" subtitle="按书名 / 作者 / 分类查找本地小说" back-to="/" />

    <form class="flex gap-2 mb-5" @submit.prevent="submit">
      <div class="relative flex-1">
        <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input
          v-model="q"
          class="input !pl-9 !pr-9"
          placeholder="搜索书名 / 作者 / 分类…"
          autofocus
          @input="onInput"
          @keydown.esc="clear"
        />
        <button
          v-if="q"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-dim hover:text-accent"
          title="清除"
          @click="clear"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
      <button type="submit" class="btn btn-primary" :disabled="loading || !q.trim()">
        <Loader2 v-if="loading" class="w-4 h-4 animate-spin" />
        <span>搜索</span>
      </button>
    </form>

    <!-- 最近搜索 -->
    <section v-if="!q.trim() && recent.length" class="mb-8">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs text-dim flex items-center gap-1.5"><Clock3 class="w-3.5 h-3.5" /> 最近搜索</span>
        <button class="text-xs text-dim hover:text-accent" @click="clearRecent">清空</button>
      </div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="r in recent"
          :key="r"
          class="btn !py-1.5 !text-xs"
          @click="pickRecent(r)"
        >
          {{ r }}
        </button>
      </div>
    </section>

    <div v-if="loading" class="text-center text-dim text-sm py-12 flex items-center justify-center gap-2">
      <Loader2 class="w-4 h-4 animate-spin" /> 搜索中…
    </div>
    <div v-else-if="searchError" class="text-center text-red-500 text-sm py-12">{{ searchError }}</div>
    <div v-else-if="searched && !results.length" class="text-center text-dim text-sm py-12">
      未找到「{{ q }}」相关小说
    </div>
    <div v-else-if="results.length" class="mb-2 text-xs text-dim">找到 {{ results.length }} 本</div>

    <ul v-if="results.length" class="divide-y" style="border-color: var(--border)">
      <li v-for="r in results" :key="r.id">
        <RouterLink :to="`/books/${r.id}`" class="flex items-center gap-4 py-3.5 hover:opacity-80">
          <BookCover
            :book-id="r.id"
            :title="r.title"
            class="w-10 h-14 shrink-0 !rounded-md !shadow-none"
            initial-class="text-lg"
          />
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ r.title }}</div>
            <div class="text-xs text-dim mt-0.5 truncate">{{ r.author || '佚名' }}</div>
            <div class="text-xs text-dim mt-1 flex flex-wrap items-center gap-x-2">
              <span v-if="r.category">{{ r.category }}</span>
              <span v-if="r.chapter_count">{{ r.chapter_count }} 章</span>
              <span class="hidden sm:inline">{{ r.encoding }}</span>
            </div>
          </div>
        </RouterLink>
      </li>
    </ul>

    <div v-else-if="!q.trim()" class="text-center py-16 text-dim text-sm">
      输入书名、作者或分类开始搜索
    </div>
  </div>
</template>
