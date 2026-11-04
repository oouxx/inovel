<script setup lang="ts">
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    bookId: number;
    title: string;
    /** 递增可强制刷新封面(上传/移除后) */
    version?: number;
    /** 占位首字字号 */
    initialClass?: string;
    /** 首屏封面不要懒加载 */
    eager?: boolean;
  }>(),
  { version: 0, initialClass: 'text-3xl', eager: false },
);

const coverOk = ref(true);
const hue = computed(() => {
  let h = 0;
  for (const ch of props.title) h = (h * 31 + (ch.codePointAt(0) ?? 0)) % 360;
  return h;
});
const coverStyle = computed(() => ({
  background: `linear-gradient(145deg, hsl(${hue.value} 42% 52%), hsl(${(hue.value + 40) % 360} 38% 38%))`,
}));
const coverSrc = computed(() => `/api/books/${props.bookId}/cover?v=${props.version}`);

watch(
  () => [props.bookId, props.version],
  () => (coverOk.value = true),
);
</script>

<template>
  <div class="book-cover" :style="coverStyle">
    <img
      v-if="coverOk"
      :src="coverSrc"
      :alt="title"
      class="absolute inset-0 w-full h-full object-cover"
      :loading="eager ? 'eager' : 'lazy'"
      decoding="async"
      draggable="false"
      @error="coverOk = false"
    />
    <span v-else class="text-white/95 font-semibold drop-shadow" :class="initialClass">
      {{ title.slice(0, 1) }}
    </span>
  </div>
</template>
