<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { SearchResultItem } from '@shared/types';
import { Search, ArrowLeft, BookOpen } from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const q = ref((route.query.q as string) || '');
const results = ref<SearchResultItem[]>([]);
const loading = ref(false);
const searched = ref(false);

async function doSearch(q: string) {
  if (!q.trim()) return;
  loading.value = true;
  searched.value = true;
  try {
    results.value = await api.search(q);
    router.replace({ query: { q } });
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (q.value) doSearch(q.value);
});
watch(
  () => route.query.q,
  (nq) => {
    if (nq && typeof nq === 'string' && nq !== q.value) {
      q.value = nq;
      doSearch(nq);
    }
  },
);
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 pb-24">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">搜索</h1>
    </header>

    <form class="flex gap-2 mb-8" @submit.prevent="doSearch(q)">
      <div class="relative flex-1">
        <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input v-model="q" class="input !pl-9" placeholder="搜索书名 / 作者 / 分类…" autofocus />
      </div>
      <button type="submit" class="btn btn-primary" :disabled="loading">搜索</button>
    </form>

    <div v-if="loading" class="text-center text-dim text-sm py-10">搜索中…</div>
    <div v-else-if="searched && !results.length" class="text-center text-dim text-sm py-10">未找到相关小说</div>

    <ul v-if="results.length" class="divide-y" style="border-color: var(--border)">
      <li v-for="r in results" :key="r.id">
        <button
          class="w-full flex items-center gap-4 py-4 text-left hover:opacity-80"
          @click="router.push(`/books/${r.id}`)"
        >
          <div
            class="w-10 h-14 rounded-md flex items-center justify-center text-white text-lg font-semibold shrink-0"
            style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
          >
            {{ r.title.slice(0, 1) }}
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ r.title }}</div>
            <div class="text-xs text-dim mt-1">
              <span v-if="r.category">{{ r.category }}</span>
              <span v-if="r.chapter_count"> · {{ r.chapter_count }} 章</span>
              <span> · {{ r.encoding }}</span>
            </div>
          </div>
          <BookOpen class="w-4 h-4 text-dim shrink-0" />
        </button>
      </li>
    </ul>
  </div>
</template>