<script setup lang="ts">
import { ArrowLeft } from 'lucide-vue-next';

withDefaults(
  defineProps<{
    title: string;
    subtitle?: string;
    backTo?: string;
  }>(),
  { subtitle: '', backTo: '/' },
);
</script>

<template>
  <header class="flex items-center gap-3 py-5 sm:py-6">
    <RouterLink v-if="backTo" :to="backTo" class="btn !px-3 shrink-0" title="返回">
      <ArrowLeft class="w-4 h-4" />
    </RouterLink>
    <div class="min-w-0 flex-1">
      <h1 class="text-lg font-semibold leading-tight truncate">{{ title }}</h1>
      <p v-if="subtitle" class="text-xs text-dim truncate mt-0.5">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="flex items-center gap-2 shrink-0">
      <slot name="actions" />
    </div>
  </header>
</template>
