<script setup lang="ts">
import type { Book } from '@shared/types';
import { computed } from 'vue';

const props = defineProps<{ book: Book }>();
const hue = computed(() => {
  let h = 0;
  for (const ch of props.book.title) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return h;
});
const coverStyle = computed(() => ({
  background: `linear-gradient(145deg, hsl(${hue.value} 42% 52%), hsl(${(hue.value + 40) % 360} 38% 38%))`,
}));
const initial = computed(() => props.book.title.slice(0, 1) || '书');
</script>

<template>
  <RouterLink
    :to="`/books/${book.id}`"
    class="block group"
  >
    <div class="book-cover w-full aspect-[5/7]" :style="coverStyle">
      <span class="text-white/95 text-3xl font-semibold drop-shadow">{{ initial }}</span>
      <span class="absolute inset-x-0 bottom-0 p-2 text-white/90 text-xs leading-tight line-clamp-2 text-center drop-shadow">
        {{ book.title }}
      </span>
    </div>
    <div class="mt-2 text-sm font-medium truncate group-hover:accent">{{ book.title }}</div>
    <div class="text-xs text-dim truncate">
      <span v-if="book.category">{{ book.category }}</span>
      <span v-if="book.category && book.chapter_count"> · </span>
      <span v-if="book.chapter_count">{{ book.chapter_count }} 章</span>
    </div>
  </RouterLink>
</template>