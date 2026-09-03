<script setup lang="ts">
import { computed } from 'vue';
import { X } from 'lucide-vue-next';
import { useSettingsStore, type ThemeName, type FontName, type ReadMode } from '@/stores/settings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

const s = useSettingsStore();

interface Option<T> {
  value: T;
  label: string;
}

const fonts: Option<FontName>[] = [
  { value: 'system', label: '系统字体' },
  { value: 'serif', label: '思源宋体' },
  { value: 'sans', label: '苹方 / 黑体' },
];

const fontSizes: Option<number>[] = [
  { value: 16, label: '小' },
  { value: 18, label: '中' },
  { value: 21, label: '大' },
  { value: 25, label: '特大' },
];

const lineHeights: Option<number>[] = [
  { value: 1.4, label: '1.4' },
  { value: 1.6, label: '1.6' },
  { value: 1.8, label: '1.8' },
  { value: 2.0, label: '2.0' },
];

const widths: Option<number>[] = [
  { value: 560, label: '窄' },
  { value: 680, label: '标准' },
  { value: 860, label: '宽' },
];

const themes: { value: ThemeName; label: string; bg: string; fg: string }[] = [
  { value: 'light', label: '白色', bg: '#ffffff', fg: '#1c1c1e' },
  { value: 'sepia', label: '米色', bg: '#f7f4ec', fg: '#262019' },
  { value: 'gray', label: '深灰', bg: '#232529', fg: '#c9c9ce' },
  { value: 'black', label: '纯黑', bg: '#000000', fg: '#b8b8bc' },
];

const modes: Option<ReadMode>[] = [
  { value: 'paged', label: '分页' },
  { value: 'scroll', label: '滚动' },
];
</script>

<template>
  <Transition name="sheet">
    <div v-if="open" class="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-end" @click.self="emit('update:open', false)">
      <div
        class="w-full sm:w-80 rounded-t-2xl sm:rounded-2xl sm:mr-6 p-5 max-h-[80vh] overflow-y-auto"
        style="background: var(--panel); border: 1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.15)"
      >
        <div class="flex items-center justify-between mb-4">
          <span class="font-medium text-sm">阅读设置</span>
          <button class="btn !p-1.5 !border-0" @click="emit('update:open', false)"><X class="w-4 h-4" /></button>
        </div>

        <!-- 主题 -->
        <div class="mb-4">
          <div class="text-xs text-dim mb-2">主题</div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="t in themes"
              :key="t.value"
              class="rounded-lg border-2 px-2 py-2.5 text-xs transition-all"
              :style="{
                background: t.bg,
                color: t.fg,
                borderColor: s.theme === t.value ? 'var(--accent)' : 'var(--border)',
              }"
              @click="s.set('theme', t.value)"
            >
              {{ t.label }}
            </button>
          </div>
        </div>

        <!-- 字体 -->
        <div class="mb-4">
          <div class="text-xs text-dim mb-2">字体</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="f in fonts"
              :key="f.value"
              class="btn !text-xs !py-2"
              :class="s.font === f.value && 'btn-primary'"
              @click="s.set('font', f.value)"
            >
              {{ f.label }}
            </button>
          </div>
        </div>

        <!-- 字号 -->
        <div class="mb-4">
          <div class="text-xs text-dim mb-2">字号</div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="fs in fontSizes"
              :key="fs.value"
              class="btn !text-xs !py-2"
              :class="s.fontSize === fs.value && 'btn-primary'"
              @click="s.set('fontSize', fs.value)"
            >
              {{ fs.label }}
            </button>
          </div>
        </div>

        <!-- 行距 -->
        <div class="mb-4">
          <div class="text-xs text-dim mb-2">行距</div>
          <div class="grid grid-cols-4 gap-2">
            <button
              v-for="lh in lineHeights"
              :key="lh.value"
              class="btn !text-xs !py-2 tabular-nums"
              :class="s.lineHeight === lh.value && 'btn-primary'"
              @click="s.set('lineHeight', lh.value)"
            >
              {{ lh.label }}
            </button>
          </div>
        </div>

        <!-- 宽度 -->
        <div class="mb-4">
          <div class="text-xs text-dim mb-2">阅读宽度</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="w in widths"
              :key="w.value"
              class="btn !text-xs !py-2"
              :class="s.width === w.value && 'btn-primary'"
              @click="s.set('width', w.value)"
            >
              {{ w.label }}
            </button>
          </div>
        </div>

        <!-- 模式 -->
        <div>
          <div class="text-xs text-dim mb-2">阅读模式</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="m in modes"
              :key="m.value"
              class="btn !text-xs !py-2"
              :class="s.mode === m.value && 'btn-primary'"
              @click="s.set('mode', m.value)"
            >
              {{ m.label }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet-enter-active, .sheet-leave-active { transition: opacity .2s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
</style>