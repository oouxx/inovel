<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api } from '@/api';
import type { Book } from '@shared/types';
import BookCard from '@/components/BookCard.vue';
import { Search, ArrowLeft } from 'lucide-vue-next';

const books = ref<Book[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const activeCat = ref('');
const keyword = ref('');
const loading = ref(true);

onMounted(async () => {
  try {
    [books.value, categories.value] = await Promise.all([api.listBooks(), api.categories()]);
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  let list = books.value;
  if (activeCat.value) list = list.filter((b) => (b.category || '未分类') === activeCat.value);
  if (keyword.value.trim()) {
    const q = keyword.value.trim().toLowerCase();
    list = list.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q) || b.category.toLowerCase().includes(q),
    );
  }
  return list;
});
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 pb-24">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">全部小说</h1>
      <span class="text-xs text-dim">{{ filtered.length }} 本</span>
    </header>

    <!-- 搜索 + 分类 -->
    <div class="flex gap-2 mb-4">
      <div class="relative flex-1">
        <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input v-model="keyword" class="input !pl-9" placeholder="搜索书名 / 作者 / 分类…" />
      </div>
    </div>
    <div class="flex flex-wrap gap-2 mb-8">
      <button class="btn !py-1.5 !text-xs" :class="!activeCat && 'btn-primary'" @click="activeCat = ''">全部</button>
      <button
        v-for="c in categories"
        :key="c.name"
        class="btn !py-1.5 !text-xs"
        :class="activeCat === (c.name || '未分类') && 'btn-primary'"
        @click="activeCat = c.name || '未分类'"
      >
        {{ c.name || '未分类' }} · {{ c.count }}
      </button>
    </div>

    <div v-if="filtered.length" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-5">
      <BookCard v-for="b in filtered" :key="b.id" :book="b" />
    </div>
    <div v-else-if="!loading" class="text-center py-20 text-dim text-sm">没有匹配的小说</div>
  </div>
</template>