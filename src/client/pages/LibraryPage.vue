<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import type { Book } from '@shared/types';
import type { ReadingProgress } from '@shared/types';
import BookCard from '@/components/BookCard.vue';
import { Library, Search, Settings2, Compass } from 'lucide-vue-next';

interface ContinueItem {
  book: Book;
  progress: ReadingProgress;
}

const books = ref<Book[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const continueItems = ref<ContinueItem[]>([]);
const loading = ref(true);

onMounted(async () => {
  try {
    const [all, cats] = await Promise.all([api.listBooks(), api.categories()]);
    books.value = all;
    categories.value = cats;
    // 继续阅读:取有进度且进度 > 0 的书,按 updated_at 排序
    const withProgress = await Promise.all(
      all.slice(0, 60).map(async (book) => {
        const progress = await api.getProgress(book.id);
        return progress && progress.progress > 0.001 ? { book, progress } : null;
      }),
    );
    continueItems.value = withProgress
      .filter((x): x is ContinueItem => x !== null)
      .sort((a, b) => b.progress.updated_at - a.progress.updated_at)
      .slice(0, 4);
  } finally {
    loading.value = false;
  }
});

const grouped = ref<Record<string, Book[]>>({});
// 按分类分组
function regroup() {
  const g: Record<string, Book[]> = {};
  for (const b of books.value) {
    const key = b.category || '未分类';
    (g[key] ||= []).push(b);
  }
  grouped.value = g;
}
import { watch } from 'vue';
watch(books, regroup, { immediate: true });
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 pb-24">
    <!-- 顶栏 -->
    <header class="flex items-center justify-between py-6">
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl flex items-center justify-center" style="background: var(--accent-soft)">
          <Library class="w-5 h-5 accent" />
        </div>
        <div>
          <h1 class="text-lg font-semibold leading-tight">我的书架</h1>
          <p class="text-xs text-dim">本地小说库 · {{ books.length }} 本</p>
        </div>
      </div>
      <nav class="flex items-center gap-2">
        <RouterLink to="/search" class="btn"><Search class="w-4 h-4" /> 搜索</RouterLink>
        <RouterLink to="/settings" class="btn"><Settings2 class="w-4 h-4" /> 管理</RouterLink>
      </nav>
    </header>

    <!-- 继续阅读 -->
    <section v-if="continueItems.length" class="mb-10">
      <h2 class="text-sm font-medium text-dim mb-3">继续阅读</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RouterLink
          v-for="item in continueItems"
          :key="item.book.id"
          :to="`/reader/${item.book.id}/${item.progress.chapter_index}`"
          class="panel rounded-2xl p-4 flex items-center gap-4 hover:-translate-y-0.5 transition-transform"
        >
          <div
            class="book-cover !shadow-none w-12 h-16 shrink-0 rounded-md flex items-center justify-center"
            style="background: linear-gradient(145deg, hsl(28 45% 55%), hsl(10 40% 40%))"
          >
            <span class="text-white font-semibold">{{ item.book.title.slice(0, 1) }}</span>
          </div>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">{{ item.book.title }}</div>
            <div class="text-xs text-dim mt-0.5">
              第 {{ item.progress.chapter_index + 1 }} 章 · {{ Math.round(item.progress.progress * 100) }}%
            </div>
            <div class="mt-2 h-1 rounded-full overflow-hidden" style="background: var(--bg-soft)">
              <div
                class="h-full rounded-full"
                :style="{ width: `${Math.max(2, Math.round(item.progress.progress * 100))}%`, background: 'var(--accent)' }"
              />
            </div>
          </div>
          <span class="text-xs accent shrink-0">继续 →</span>
        </RouterLink>
      </div>
    </section>

    <!-- 全部小说 -->
    <section v-if="books.length">
      <h2 class="text-sm font-medium text-dim mb-3">全部小说</h2>
      <div v-for="(list, cat) in grouped" :key="cat" class="mb-8">
        <div class="flex items-center gap-2 mb-3">
          <span class="text-sm font-medium">{{ cat }}</span>
          <span class="text-xs text-dim">{{ list.length }}</span>
        </div>
        <div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-4">
          <BookCard v-for="b in list" :key="b.id" :book="b" />
        </div>
      </div>
    </section>

    <!-- 空状态 -->
    <div v-else-if="!loading" class="text-center py-24">
      <Compass class="w-10 h-10 mx-auto text-dim mb-4" />
      <p class="text-dim">书架空空如也</p>
      <p class="text-sm text-dim mt-1">将 TXT 文件放入 novels 目录,或到「管理」页批量导入</p>
      <RouterLink to="/settings" class="btn btn-primary mt-5">前往管理</RouterLink>
    </div>
  </div>
</template>