<script setup lang="ts">
import { ref, onMounted, computed, nextTick } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '@/api';
import type { Book, ChapterMeta, ReadingProgress } from '@shared/types';
import BookCover from '@/components/BookCover.vue';
import PageHeader from '@/components/PageHeader.vue';
import {
  BookOpen, PlayCircle, FileText, AlertTriangle, Pencil, ImagePlus, ImageOff,
  Check, X, Trash2,
} from 'lucide-vue-next';

const route = useRoute();
const router = useRouter();
const bookId = Number(route.params.id);

const book = ref<Book | null>(null);
const chapters = ref<ChapterMeta[]>([]);
const progress = ref<ReadingProgress | null>(null);
const loading = ref(true);
const tocQuery = ref('');

// 封面
const coverVersion = ref(0);
const uploading = ref(false);

// 编辑信息
const editing = ref(false);
const editTitle = ref('');
const editAuthor = ref('');
const saving = ref(false);

// 标签
const tags = computed(() => {
  try {
    const arr = JSON.parse(book.value?.tags || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
});
const newTag = ref('');
async function addTag() {
  const t = newTag.value.trim();
  if (!t || !book.value || tags.value.includes(t)) return;
  const r = await api.updateBook(bookId, { tags: [...tags.value, t].slice(0, 12) });
  book.value = { ...r.book, hasCover: book.value?.hasCover };
  newTag.value = '';
}
async function removeTag(t: string) {
  if (!book.value) return;
  const r = await api.updateBook(bookId, { tags: tags.value.filter((x) => x !== t) });
  book.value = { ...r.book, hasCover: book.value?.hasCover };
}

onMounted(async () => {
  try {
    book.value = await api.getBook(bookId);
    [chapters.value, progress.value] = await Promise.all([api.getChapters(bookId), api.getProgress(bookId)]);
    await nextTick();
    scrollToCurrentChapter();
  } finally {
    loading.value = false;
  }
});

const readProgress = computed(() =>
  progress.value && progress.value.progress > 0.001 ? progress.value : null,
);
const resumeChapterIndex = computed(() => readProgress.value?.chapter_index ?? 0);
const chapterPercent = computed(() => Math.round((readProgress.value?.progress ?? 0) * 100));
const progressPercent = computed(() => {
  const p = readProgress.value;
  const b = book.value;
  if (!p || !b) return 0;
  const c = chapters.value.find((x) => x.chapter_index === p.chapter_index);
  if (!c || !b.file_size) return chapterPercent.value;
  const span = Math.max(1, c.end_offset - c.start_offset);
  const abs = c.start_offset + p.progress * span;
  return Math.round(Math.min(1, Math.max(0, abs / b.file_size)) * 100);
});

function goToReader() {
  const p = readProgress.value;
  if (p) router.push(`/reader/${bookId}/${p.chapter_index}?pos=${p.progress}`);
  else router.push(`/reader/${bookId}/0`);
}

// ---- 目录:大书分批渲染 ----
const RENDER_CAP = 400;
const SEARCH_CAP = 800;
const renderLimit = ref(RENDER_CAP);
const tocMatches = computed(() => {
  const q = tocQuery.value.trim().toLowerCase();
  if (!q) return chapters.value;
  return chapters.value.filter((c) => c.title?.toLowerCase().includes(q));
});
const filteredChapters = computed(() =>
  tocQuery.value.trim()
    ? tocMatches.value.slice(0, SEARCH_CAP)
    : tocMatches.value.slice(0, renderLimit.value),
);
const hasMore = computed(() => filteredChapters.value.length < tocMatches.value.length);

const tocList = ref<HTMLElement | null>(null);
function scrollToCurrentChapter() {
  const list = tocList.value;
  const target = list?.querySelector('[data-current="true"]') as HTMLElement | null;
  if (!list || !target) return;
  const lr = list.getBoundingClientRect();
  const tr = target.getBoundingClientRect();
  list.scrollTop += tr.top - lr.top - list.clientHeight / 2 + tr.height / 2;
}

// ---- 封面 ----
async function onCoverPick(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  uploading.value = true;
  try {
    await api.uploadCover(bookId, file);
    if (book.value) book.value = { ...book.value, hasCover: true };
    coverVersion.value++;
  } catch (err: any) {
    alert(err?.message || '上传失败');
  } finally {
    uploading.value = false;
  }
}

async function removeCover() {
  if (!confirm('移除自定义封面?系统会自动生成一张占位封面。')) return;
  await api.removeCover(bookId).catch(() => {});
  if (book.value) book.value = { ...book.value, hasCover: false };
  coverVersion.value++;
}

// ---- 删除 ----
const deletingBook = ref(false);
async function deleteBook() {
  if (!book.value || deletingBook.value) return;
  if (!confirm(`确定删除《${book.value.title}》?\n将同时删除本地 TXT 文件、章节索引、书签与阅读进度,不可恢复。`)) return;
  deletingBook.value = true;
  try {
    await api.deleteBook(bookId);
    router.push('/books');
  } catch (err: any) {
    alert(err?.message || '删除失败');
  } finally {
    deletingBook.value = false;
  }
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
    book.value = { ...r.book, hasCover: book.value?.hasCover };
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
    <PageHeader title="小说详情" back-to="/" />

    <template v-if="book">
      <!-- 信息 -->
      <div class="flex gap-4 sm:gap-6 items-start">
        <div class="relative shrink-0 group">
          <BookCover
            :book-id="bookId"
            :title="book.title"
            :version="coverVersion"
            eager
            class="w-24 sm:w-28 aspect-[5/7] rounded-lg"
            initial-class="text-4xl"
          />
          <label
            class="absolute inset-0 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:flex flex-col items-center justify-center text-white text-xs cursor-pointer"
            title="更换封面"
          >
            <ImagePlus class="w-5 h-5 mb-1" />
            {{ uploading ? '上传中…' : '换封面' }}
            <input type="file" accept="image/*" class="hidden" :disabled="uploading" @change="onCoverPick" />
          </label>
          <label
            class="absolute top-1.5 right-1.5 sm:hidden w-7 h-7 rounded-full bg-black/55 text-white flex items-center justify-center cursor-pointer"
            title="更换封面"
          >
            <ImagePlus class="w-3.5 h-3.5" />
            <input type="file" accept="image/*" class="hidden" :disabled="uploading" @change="onCoverPick" />
          </label>
          <button
            v-if="book.hasCover"
            class="mt-1.5 w-full text-[11px] text-dim hover:text-red-500 inline-flex items-center justify-center gap-1"
            title="移除自定义封面"
            @click="removeCover"
          >
            <ImageOff class="w-3 h-3" /> 移除封面
          </button>
        </div>

        <div class="min-w-0 flex-1 pt-0.5">
          <!-- 查看 / 编辑 -->
          <template v-if="!editing">
            <div class="flex items-start gap-2">
              <h2 class="text-xl sm:text-2xl font-bold leading-snug min-w-0">{{ book.title }}</h2>
              <button class="btn !p-1.5 !border-0 text-dim mt-0.5 shrink-0" title="编辑信息" @click="startEdit">
                <Pencil class="w-3.5 h-3.5" />
              </button>
              <button
                class="btn !p-1.5 !border-0 text-dim hover:text-red-500 mt-0.5 shrink-0"
                title="删除这本书"
                :disabled="deletingBook"
                @click="deleteBook"
              >
                <Trash2 class="w-3.5 h-3.5" />
              </button>
            </div>
            <p class="text-sm text-dim mt-1 truncate">
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

          <!-- 标签 -->
          <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
            <span
              v-for="t in tags"
              :key="t"
              class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs"
              style="background: var(--accent-soft); color: var(--accent)"
            >
              {{ t }}
              <button class="opacity-60 hover:opacity-100" @click="removeTag(t)"><X class="w-3 h-3" /></button>
            </span>
            <form class="inline-flex" @submit.prevent="addTag">
              <input
                v-model="newTag"
                class="input !py-1 !text-xs !w-24 !rounded-full"
                placeholder="+ 标签"
                maxlength="20"
              />
            </form>
          </div>

          <p class="text-xs sm:text-sm text-dim mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span class="inline-flex items-center gap-1"><FileText class="w-3.5 h-3.5" /> {{ book.chapter_count }} 章</span>
            <span>{{ (book.file_size / 1024 / 1024).toFixed(2) }} MB</span>
          </p>
          <p v-if="book.status === 'warn'" class="text-xs mt-2 flex items-center gap-1" style="color: #c58a2d">
            <AlertTriangle class="w-3.5 h-3.5" /> {{ book.error || '章节识别可能异常' }}
          </p>

          <!-- 阅读进度 -->
          <div v-if="readProgress" class="mt-3 max-w-xs">
            <div class="flex items-center justify-between text-[11px] text-dim mb-1">
              <span>读至第 {{ readProgress.chapter_index + 1 }} 章</span>
              <span class="tabular-nums" :title="`本章 ${chapterPercent}%`">全书 {{ progressPercent }}%</span>
            </div>
            <div class="h-1.5 rounded-full overflow-hidden" style="background: var(--bg-soft)">
              <div
                class="h-full rounded-full"
                :style="{ width: `${Math.max(2, progressPercent)}%`, background: 'var(--accent)' }"
              />
            </div>
          </div>

          <div class="mt-4 flex gap-3">
            <button class="btn btn-primary" @click="goToReader">
              <PlayCircle class="w-4 h-4" />
              {{ readProgress ? '继续阅读' : '开始阅读' }}
            </button>
          </div>
        </div>
      </div>

      <!-- 目录 -->
      <div class="mt-10">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h3 class="text-sm font-medium text-dim shrink-0">
            目录 · {{ chapters.length }} 章
            <span v-if="tocQuery.trim()" class="ml-1">({{ tocMatches.length }} 条匹配)</span>
          </h3>
          <input v-model="tocQuery" class="input !py-1.5 !text-xs !w-36 sm:!w-48" placeholder="搜索章节…" />
        </div>
        <ul
          ref="tocList"
          class="panel rounded-2xl divide-y max-h-[60vh] overflow-y-auto"
          style="border-color: var(--border)"
        >
          <li v-for="c in filteredChapters" :key="c.id">
            <RouterLink
              :to="`/reader/${bookId}/${c.chapter_index}`"
              :data-current="c.chapter_index === resumeChapterIndex ? 'true' : undefined"
              class="flex items-center gap-3 px-4 py-3 text-sm hover:opacity-75"
            >
              <span class="text-xs text-dim w-12 shrink-0 tabular-nums">{{ c.chapter_index + 1 }}</span>
              <span class="truncate flex-1" :class="c.chapter_index === resumeChapterIndex && 'accent font-medium'">
                {{ c.title }}
              </span>
              <BookOpen v-if="c.chapter_index === resumeChapterIndex" class="w-3.5 h-3.5 accent shrink-0" />
            </RouterLink>
          </li>
        </ul>
        <div v-if="hasMore" class="text-center mt-3">
          <button v-if="!tocQuery.trim()" class="btn !text-xs" @click="renderLimit += RENDER_CAP">显示更多</button>
          <span v-else class="text-xs text-dim">仅显示前 {{ SEARCH_CAP }} 条匹配</span>
        </div>
      </div>
    </template>
    <div v-else-if="loading" class="text-center text-dim py-20 text-sm">加载中…</div>
    <div v-else class="text-center text-dim py-20 text-sm">书籍不存在</div>
  </div>
</template>
