<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { api, type StatsSummary } from '@/api';
import type { Book, ReadingProgress } from '@shared/types';
import BookCard from '@/components/BookCard.vue';
import BookCover from '@/components/BookCover.vue';
import { Library, Search, Settings2, Clock, LayoutGrid, BookOpen, ChevronRight } from 'lucide-vue-next';

function fmtDur(s: number) {
  const m = Math.round(s / 60);
  return m < 60 ? `${m} 分钟` : `${Math.floor(m / 60)} 小时 ${m % 60} 分`;
}

interface ContinueItem {
  book: Book;
  progress: ReadingProgress;
}

const books = ref<Book[]>([]);
const continueItems = ref<ContinueItem[]>([]);
const loading = ref(true);
const stats = ref<StatsSummary | null>(null);

onMounted(async () => {
  try {
    const [all, st, cont] = await Promise.all([
      api.listBooks(),
      api.stats().catch(() => null),
      api.continueReading(4).catch(() => []),
    ]);
    stats.value = st;
    books.value = all;
    continueItems.value = cont;
  } finally {
    loading.value = false;
  }
});

const recentBooks = computed(() =>
  [...books.value].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)).slice(0, 8),
);

const categorySummary = computed(() => {
  const counts = new Map<string, number>();
  for (const b of books.value) {
    const key = b.category || '未分类';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hans-CN'));
});

const totalChapters = computed(() => books.value.reduce((n, b) => n + (b.chapter_count || 0), 0));
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 pb-24">
    <!-- 顶栏 -->
    <header class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-4 sm:py-6">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style="background: var(--accent-soft)">
          <Library class="w-5 h-5 accent" />
        </div>
        <div class="min-w-0">
          <h1 class="text-lg font-semibold leading-tight">我的书架</h1>
          <p class="text-xs text-dim truncate">
            本地小说库 · {{ books.length }} 本 · {{ totalChapters }} 章
            <span v-if="stats && stats.todaySeconds > 60" class="inline-flex items-center gap-1 ml-1 accent">
              <Clock class="w-3 h-3" /> 今日 {{ fmtDur(stats.todaySeconds) }}
            </span>
          </p>
        </div>
      </div>
      <nav class="flex items-center gap-2">
        <RouterLink to="/books" class="btn !px-3" title="全部书籍">
          <LayoutGrid class="w-4 h-4" /><span class="hidden sm:inline">全部</span>
        </RouterLink>
        <RouterLink to="/search" class="btn !px-3" title="搜索书库">
          <Search class="w-4 h-4" /><span class="hidden sm:inline">搜索</span>
        </RouterLink>
        <RouterLink to="/settings" class="btn !px-3" title="导入与管理">
          <Settings2 class="w-4 h-4" /><span class="hidden sm:inline">管理</span>
        </RouterLink>
      </nav>
    </header>

    <!-- 继续阅读 -->
    <section v-if="continueItems.length" class="mb-10">
      <div class="flex items-baseline justify-between mb-3">
        <h2 class="text-sm font-medium text-dim">继续阅读</h2>
        <span class="text-xs text-dim">{{ continueItems.length }} 本</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RouterLink
          v-for="item in continueItems"
          :key="item.book.id"
          :to="`/reader/${item.book.id}/${item.progress.chapter_index}`"
          class="panel rounded-2xl p-3.5 flex items-center gap-3.5 hover:-translate-y-0.5 hover:shadow-md transition-all"
        >
          <BookCover
            :book-id="item.book.id"
            :title="item.book.title"
            class="w-12 h-16 shrink-0 !rounded-md !shadow-none"
            initial-class="text-base"
          />
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ item.book.title }}</div>
            <div class="text-xs text-dim mt-0.5 truncate">
              第 {{ item.progress.chapter_index + 1 }} 章 · 本章 {{ Math.round(item.progress.progress * 100) }}%
            </div>
            <div class="mt-2 h-1 rounded-full overflow-hidden" style="background: var(--bg-soft)">
              <div
                class="h-full rounded-full"
                :style="{
                  width: `${Math.max(2, Math.round(item.progress.progress * 100))}%`,
                  background: 'var(--accent)',
                }"
              />
            </div>
          </div>
          <ChevronRight class="w-4 h-4 text-dim shrink-0" />
        </RouterLink>
      </div>
    </section>

    <!-- 加载骨架 -->
    <section v-if="loading">
      <div class="h-4 w-20 rounded skeleton mb-4" />
      <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
        <div v-for="i in 8" :key="i">
          <div class="w-full aspect-[5/7] rounded-lg skeleton" />
          <div class="h-3.5 w-4/5 rounded skeleton mt-2.5" />
          <div class="h-3 w-3/5 rounded skeleton mt-1.5" />
        </div>
      </div>
    </section>

    <template v-else-if="books.length">
      <!-- 最近添加 -->
      <section v-if="recentBooks.length" class="mb-10">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-sm font-medium text-dim">最近添加</h2>
          <RouterLink to="/books" class="text-xs accent hover:opacity-80">查看全部 {{ books.length }} 本 →</RouterLink>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
          <BookCard v-for="b in recentBooks" :key="b.id" :book="b" />
        </div>
      </section>

      <!-- 分类 -->
      <section v-if="categorySummary.length" class="mb-10">
        <div class="flex items-baseline justify-between mb-3">
          <h2 class="text-sm font-medium text-dim">分类</h2>
          <RouterLink to="/books" class="text-xs text-dim hover:accent">在全部小说中筛选 →</RouterLink>
        </div>
        <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <RouterLink
            v-for="c in categorySummary"
            :key="c.name"
            :to="{ path: '/books', query: { category: c.name } }"
            class="panel rounded-xl px-4 py-3 flex items-center justify-between gap-3 hover:-translate-y-0.5 hover:shadow-sm transition-all"
          >
            <span class="text-sm truncate">{{ c.name }}</span>
            <span class="text-xs text-dim shrink-0">{{ c.count }} 本</span>
          </RouterLink>
        </div>
      </section>
    </template>

    <!-- 空状态 -->
    <div v-else class="text-center py-24">
      <div class="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style="background: var(--accent-soft)">
        <BookOpen class="w-7 h-7 accent" />
      </div>
      <p class="text-dim">书架空空如也</p>
      <p class="text-sm text-dim mt-1">将 TXT 文件放入 novels 目录,或到「管理」页批量导入</p>
      <RouterLink to="/settings" class="btn btn-primary mt-5">前往管理</RouterLink>
    </div>
  </div>
</template>
