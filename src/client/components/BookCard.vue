<script setup lang="ts">
import type { Book } from '@shared/types';
import { computed, ref } from 'vue';

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
const coverOk = ref(true);
const coverKey = ref(0);
const coverSrc = computed(() => `/api/books/${props.book.id}/cover?v=${coverKey.value}`);
</script>

<template>
  <RouterLink :to="`/books/${book.id}`" class="block group">
    <div class="book-cover w-full aspect-[5/7]" :style="coverStyle">
      <img
        v-if="coverOk"
        :src="coverSrc"
        :key="coverKey"
        class="absolute inset-0 w-full h-full object-cover"
        loading="lazy"
        @error="coverOk = false"
      />
      <template v-else>
        <span class="text-white/95 text-3xl font-semibold drop-shadow">{{ initial }}</span>
        <span class="absolute inset-x-0 bottom-0 p-2 text-white/90 text-xs leading-tight line-clamp-2 text-center drop-shadow">
          {{ book.title }}
        </span>
      </template>
    </div>
    <div class="mt-2 text-sm font-medium truncate group-hover:accent">{{ book.title }}</div>
    <div class="text-xs text-dim truncate">
      <span v-if="book.author">{{ book.author }}</span>
      <span v-if="book.category && book.author"> · </span>
      <span v-if="book.category">{{ book.category }}</span>
      <span v-if="(book.category || book.author) && book.chapter_count"> · </span>
      <span v-if="book.chapter_count">{{ book.chapter_count }} 章</span>
    </div>
  </RouterLink>
</template>