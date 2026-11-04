<script setup lang="ts">
import { RouterView } from 'vue-router';
</script>

<template>
  <div class="app-bg min-h-screen" style="padding-top: env(safe-area-inset-top)">
    <RouterView />
  </div>
</template>