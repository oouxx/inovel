<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/api';
import type { ChapterMeta } from '@shared/types';
import { X, Search } from 'lucide-vue-next';

const props = defineProps<{
  open: boolean;
  bookId: number;
  bookTitle: string;
  currentIndex: number;
}>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

const chapters = ref<ChapterMeta[]>([]);
const query = ref('');
const listEl = ref<HTMLElement | null>(null);

watch(
  () => props.open,
  async (open) => {
    if (open && !chapters.value.length) {
      chapters.value = await api.getChapters(props.bookId);
      await scrollToCurrent();
    } else if (open) {
      await scrollToCurrent();
    }
  },
);

async function scrollToCurrent() {
  setTimeout(() => {
    const el = listEl.value?.querySelector(`[data-index="${props.currentIndex}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, 60);
}

const filtered = () => {
  const q = query.value.trim().toLowerCase();
  if (!q) return chapters.value;
  return chapters.value.filter((c) => c.title?.toLowerCase().includes(q));
};
</script>

<template>
  <Transition name="toc">
    <div v-if="open" class="fixed inset-0 z-50 flex" @click.self="emit('update:open', false)">
      <!-- 遮罩 -->
      <div class="absolute inset-0 bg-black/30" @click="emit('update:open', false)" />

      <div
        class="relative w-full sm:w-80 h-full flex flex-col"
        style="background: var(--panel); box-shadow: 8px 0 30px rgba(0,0,0,0.1)"
      >
        <div class="flex items-center justify-between px-4 py-3 border-b" style="border-color: var(--border)">
          <div class="min-w-0">
            <div class="text-sm font-medium truncate">{{ bookTitle }}</div>
            <div class="text-xs text-dim">目录 · {{ chapters.length }} 章</div>
          </div>
          <button class="btn !p-2 !border-0" @click="emit('update:open', false)"><X class="w-4 h-4" /></button>
        </div>

        <div class="px-3 py-2 border-b" style="border-color: var(--border)">
          <div class="relative">
            <Search class="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
            <input v-model="query" class="input !py-1.5 !pl-8 !text-xs" placeholder="搜索章节…" />
          </div>
        </div>

        <div ref="listEl" class="flex-1 overflow-y-auto py-1">
          <RouterLink
            v-for="c in filtered()"
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
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.toc-enter-active, .toc-leave-active { transition: opacity .2s ease; }
.toc-enter-from, .toc-leave-to { opacity: 0; }
</style>