<script setup lang="ts">
import type { Book } from '@shared/types';
import BookCover from './BookCover.vue';

defineProps<{ book: Book }>();
</script>

<template>
  <RouterLink :to="`/books/${book.id}`" class="block group">
    <BookCover :book-id="book.id" :title="book.title" class="w-full aspect-[5/7]" />
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
