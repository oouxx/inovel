<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '@/api';
import type { Book, ChapterMeta, ReadingProgress } from '@shared/types';
import { ArrowLeft, BookOpen, PlayCircle, FileText, AlertTriangle, Pencil, ImagePlus, Check, X } from 'lucide-vue-next';

const route = useRoute();
const bookId = Number(route.params.id);

const book = ref<Book | null>(null);
const chapters = ref<ChapterMeta[]>([]);
const progress = ref<ReadingProgress | null>(null);
const loading = ref(true);
const tocQuery = ref('');

// 封面
const coverOk = ref(true);
const coverKey = ref(0);
const uploading = ref(false);

// 编辑信息
const editing = ref(false);
const editTitle = ref('');
const editAuthor = ref('');
const saving = ref(false);

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

// ---- 封面 ----
async function onCoverPick(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  try {
    await api.uploadCover(bookId, file);
    coverOk.value = true;
    coverKey.value++;
  } catch (err: any) {
    alert(err?.message || '上传失败');
  }
}

async function removeCover() {
  await api.removeCover(bookId).catch(() => {});
  coverOk.value = false;
  coverKey.value++;
}

// ---- 编辑 ----
function startEdit() {
  editTitle.value = book.value?.title || '';
  editAuthor.value = book.value?.author || '';
  editing.value = true;
}

async function saveEdit() {
  if (!book.value) return;
  saving.value = true;
  try {
    const r = await api.updateBook(bookId, { title: editTitle.value, author: editAuthor.value });
    book.value = r.book;
    editing.value = false;
  } catch (err: any) {
    alert(err?.message || '保存失败');
  } finally {
    saving.value = false;
  }
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
        <div class="relative shrink-0 group">
          <div
            class="book-cover w-28 aspect-[5/7] rounded-lg flex items-center justify-center overflow-hidden"
            style="background: linear-gradient(145deg, hsl(210 40% 50%), hsl(250 35% 35%))"
          >
            <img
              v-if="coverOk"
              :src="api.coverUrl(bookId) + `?v=${coverKey}`"
              :key="coverKey"
              class="absolute inset-0 w-full h-full object-cover"
              @error="coverOk = false"
            />
            <span v-else class="text-white text-4xl font-semibold">{{ book.title.slice(0, 1) }}</span>
          </div>
          <label
            class="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center text-white text-xs cursor-pointer"
            title="上传封面"
          >
            <ImagePlus class="w-5 h-5 mb-1" />
            {{ uploading ? '上传中…' : '换封面' }}
            <input type="file" accept="image/*" class="hidden" @change="onCoverPick" />
          </label>
        </div>

        <div class="min-w-0 flex-1 pt-1">
          <!-- 查看 / 编辑 -->
          <template v-if="!editing">
            <div class="flex items-start gap-2">
              <h2 class="text-2xl font-bold leading-snug">{{ book.title }}</h2>
              <button class="btn !p-1.5 !border-0 text-dim mt-1.5" title="编辑信息" @click="startEdit">
                <Pencil class="w-3.5 h-3.5" />
              </button>
            </div>
            <p class="text-sm text-dim mt-1">
              {{ book.author || '佚名' }}
              <span v-if="book.category"> · {{ book.category }}</span>
            </p>
          </template>
          <template v-else>
            <div class="space-y-2 max-w-sm">
              <input v-model="editTitle" class="input !py-1.5 text-sm" placeholder="书名" />
              <input v-model="editAuthor" class="input !py-1.5 text-sm" placeholder="作者" />
              <div class="flex gap-2">
                <button class="btn btn-primary !text-xs" :disabled="saving" @click="saveEdit">
                  <Check class="w-3.5 h-3.5" /> 保存
                </button>
                <button class="btn !py-1.5 !text-xs" @click="editing = false"><X class="w-3.5 h-3.5" /> 取消</button>
              </div>
            </div>
          </template>

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