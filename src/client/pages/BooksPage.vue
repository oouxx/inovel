<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { Book } from '@shared/types';
import BookCard from '@/components/BookCard.vue';
import PageHeader from '@/components/PageHeader.vue';
import { Search, X, ArrowDownUp } from 'lucide-vue-next';

type SortKey = 'recent' | 'title' | 'author' | 'chapters';

const route = useRoute();
const router = useRouter();
const books = ref<Book[]>([]);
const categories = ref<{ name: string; count: number }[]>([]);
const activeCat = ref(typeof route.query.category === 'string' ? route.query.category : '');
const keyword = ref('');
const sort = ref<SortKey>('recent');
const loading = ref(true);

watch(
  () => route.query.category,
  (c) => {
    const v = typeof c === 'string' ? c : '';
    if (v !== activeCat.value) activeCat.value = v;
  },
);

function setCategory(cat: string) {
  activeCat.value = cat;
  router.replace({ query: cat ? { category: cat } : {} });
}

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
  const q = keyword.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (b) =>
        b.title.toLowerCase().includes(q) ||
        b.author.toLowerCase().includes(q) ||
        b.category.toLowerCase().includes(q),
    );
  }
  const sorted = [...list];
  switch (sort.value) {
    case 'title':
      sorted.sort((a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'));
      break;
    case 'author':
      sorted.sort((a, b) => (a.author || '').localeCompare(b.author || '', 'zh-Hans-CN'));
      break;
    case 'chapters':
      sorted.sort((a, b) => b.chapter_count - a.chapter_count);
      break;
    default:
      sorted.sort((a, b) => b.updated_at - a.updated_at);
  }
  return sorted;
});

const hasFilter = computed(() => !!activeCat.value || !!keyword.value.trim());

function resetFilter() {
  activeCat.value = '';
  keyword.value = '';
  router.replace({ query: {} });
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-5 pb-24">
    <PageHeader title="全部小说" :subtitle="`${filtered.length} / ${books.length} 本`" back-to="/">
      <template #actions>
        <RouterLink to="/search" class="btn !px-3" title="搜索书库"><Search class="w-4 h-4" /></RouterLink>
      </template>
    </PageHeader>

    <!-- 搜索 + 排序 -->
    <div class="flex gap-2 mb-4">
      <div class="relative flex-1">
        <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
        <input v-model="keyword" class="input !pl-9 !pr-9" placeholder="搜索书名 / 作者 / 分类…" />
        <button
          v-if="keyword"
          class="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-full text-dim hover:text-accent"
          title="清除"
          @click="keyword = ''"
        >
          <X class="w-4 h-4" />
        </button>
      </div>
      <label class="relative shrink-0">
        <ArrowDownUp class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim pointer-events-none" />
        <select v-model="sort" class="input !pl-9 !w-auto text-sm">
          <option value="recent">最近更新</option>
          <option value="title">书名</option>
          <option value="author">作者</option>
          <option value="chapters">章节数</option>
        </select>
      </label>
    </div>

    <div class="flex flex-wrap gap-2 mb-8">
      <button class="btn !py-1.5 !text-xs" :class="!activeCat && 'btn-primary'" @click="setCategory('')">
        全部 · {{ books.length }}
      </button>
      <button
        v-for="c in categories"
        :key="c.name"
        class="btn !py-1.5 !text-xs"
        :class="activeCat === (c.name || '未分类') && 'btn-primary'"
        @click="setCategory(c.name || '未分类')"
      >
        {{ c.name || '未分类' }} · {{ c.count }}
      </button>
      <button v-if="hasFilter" class="btn !py-1.5 !text-xs !border-0 text-dim" @click="resetFilter">
        清除筛选
      </button>
    </div>

    <!-- 加载骨架 -->
    <div v-if="loading" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-5">
      <div v-for="i in 18" :key="i">
        <div class="w-full aspect-[5/7] rounded-lg skeleton" />
        <div class="h-3.5 w-4/5 rounded skeleton mt-2.5" />
        <div class="h-3 w-3/5 rounded skeleton mt-1.5" />
      </div>
    </div>

    <div v-else-if="filtered.length" class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-5">
      <BookCard v-for="b in filtered" :key="b.id" :book="b" />
    </div>

    <!-- 空状态 -->
    <div v-else class="text-center py-20">
      <p class="text-dim text-sm">{{ books.length ? '没有匹配的小说' : '书库还没有书' }}</p>
      <button v-if="hasFilter" class="btn mt-4" @click="resetFilter">清除筛选</button>
      <RouterLink v-else-if="!books.length" to="/settings" class="btn btn-primary mt-4">去导入</RouterLink>
    </div>
  </div>
</template>
