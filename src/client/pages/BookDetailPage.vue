<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api';
import type { Book, ChapterMeta, ReadingProgress } from '@shared/types';
import { ArrowLeft, BookOpen, PlayCircle, FileText, AlertTriangle } from 'lucide-vue-next';

const route = useRoute();
const bookId = Number(route.params.id);

const book = ref<Book | null>(null);
const chapters = ref<ChapterMeta[]>([]);
const progress = ref<ReadingProgress | null>(null);
const loading = ref(true);
const tocQuery = ref('');

onMounted(async () => {
  try {
    book.value = await api.getBook(bookId);
    [chapters.value, progress.value] = await Promise.all([api.getChapters(bookId), api.getProgress(bookId)]);
  } finally {
    loading.value = false;
  }
});

const resumeChapter = computed(() => {
  if (progress.value && progress.value.progress > 0.001) return progress.value.chapter_index;
  return 0;
});

const filteredChapters = computed(() => {
  const q = tocQuery.value.trim();
  if (!q) return chapters.value;
  return chapters.value.filter((c) => c.title?.toLowerCase().includes(q.toLowerCase()));
});

function goToReader() {
  const p = resumeTarget();
  window.location.href = `/reader/${bookId}/${p.chapterIndex}?page=${p.page}`;
}

function resumeTarget(): { chapterIndex: number; page: number } {
  if (progress.value && progress.value.progress > 0.001) {
    return { chapterIndex: progress.value.chapter_index, page: Math.max(0, progress.value.page) };
  }
  return { chapterIndex: 0, page: 0 };
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 pb-24">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">小说详情</h1>
    </header>

    <template v-if="book">
      <!-- 信息 -->
      <div class="flex gap-6 items-start">
        <div
          class="book-cover w-28 shrink-0 aspect-[5/7] rounded-lg flex items-center justify-center"
          style="background: linear-gradient(145deg, hsl(210 40% 50%), hsl(250 35% 35%))"
        >
          <span class="text-white text-4xl font-semibold">{{ book.title.slice(0, 1) }}</span>
        </div>
        <div class="min-w-0 flex-1 pt-1">
          <h2 class="text-2xl font-bold leading-snug">{{ book.title }}</h2>
          <p class="text-sm text-dim mt-1">
            {{ book.author || '佚名' }}
            <span v-if="book.category"> · {{ book.category }}</span>
          </p>
          <p class="text-sm text-dim mt-2 flex items-center gap-1.5">
            <FileText class="w-4 h-4" /> {{ book.chapter_count }} 章 · {{ (book.file_size / 1024 / 1024).toFixed(2) }} MB ·
            {{ book.encoding }}
          </p>
          <p v-if="book.status === 'warn'" class="text-xs mt-2 flex items-center gap-1" style="color: #c58a2d">
            <AlertTriangle class="w-3.5 h-3.5" /> {{ book.error || '章节识别可能异常' }}
          </p>
          <div class="mt-5 flex gap-3">
            <button class="btn btn-primary" @click="goToReader">
              <PlayCircle class="w-4 h-4" />
              {{ progress && progress.progress > 0.001 ? '继续阅读' : '开始阅读' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 目录 -->
      <div class="mt-10">
        <div class="flex items-center justify-between mb-3">
          <h3 class="text-sm font-medium text-dim">目录 · {{ chapters.length }} 章</h3>
          <input v-model="tocQuery" class="input !py-1.5 !text-xs !w-48" placeholder="搜索章节…" />
        </div>
        <ul class="panel rounded-2xl divide-y max-h-[60vh] overflow-y-auto" style="border-color: var(--border)">
          <li v-for="c in filteredChapters" :key="c.id">
            <RouterLink
              :to="`/reader/${bookId}/${c.chapter_index}`"
              class="flex items-center gap-3 px-4 py-3 text-sm hover:opacity-75"
            >
              <span class="text-xs text-dim w-12 shrink-0 tabular-nums">{{ c.chapter_index + 1 }}</span>
              <span class="truncate flex-1" :class="c.chapter_index === resumeTarget().chapterIndex && 'accent font-medium'">
                {{ c.title }}
              </span>
              <BookOpen v-if="c.chapter_index === resumeTarget().chapterIndex" class="w-3.5 h-3.5 accent shrink-0" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </template>
    <div v-else-if="loading" class="text-center text-dim py-20 text-sm">加载中…</div>
    <div v-else class="text-center text-dim py-20 text-sm">书籍不存在</div>
  </div>
</template>