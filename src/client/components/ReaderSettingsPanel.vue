<script setup lang="ts">
import { computed } from 'vue';
import { X, RotateCcw } from 'lucide-vue-next';
import {
  useSettingsStore,
  type ThemeName,
  type FontName,
  type ReadMode,
  type PageTurn,
} from '@/stores/settings';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [boolean] }>();

const s = useSettingsStore();

interface Option<T> {
  value: T;
  label: string;
}

const FONT_MIN = 14;
const FONT_MAX = 32;

const fonts: Option<FontName>[] = [
  { value: 'system', label: '系统字体' },
  { value: 'serif', label: '思源宋体' },
  { value: 'sans', label: '苹方 / 黑体' },
];

const widths: Option<number>[] = [
  { value: 560, label: '窄' },
  { value: 680, label: '标准' },
  { value: 860, label: '宽' },
];

const themes: { value: ThemeName; label: string; bg: string }[] = [
  { value: 'auto', label: '自动', bg: 'linear-gradient(90deg,#fff 50%,#232529 50%)' },
  { value: 'light', label: '白色', bg: '#ffffff' },
  { value: 'sepia', label: '米色', bg: '#f7f4ec' },
  { value: 'gray', label: '深灰', bg: '#232529' },
  { value: 'black', label: '纯黑', bg: '#000000' },
];

const modes: Option<ReadMode>[] = [
  { value: 'paged', label: '分页' },
  { value: 'scroll', label: '滚动' },
];

const pageTurns: Option<PageTurn>[] = [
  { value: 'slide', label: '滑动' },
  { value: 'none', label: '无动画' },
];

const lineHeightLabel = computed(() => s.lineHeight.toFixed(1));
const paragraphSpacingLabel = computed(() => (s.paragraphSpacing === 0 ? '无' : `${s.paragraphSpacing.toFixed(1)} 字`));

function bumpFont(delta: number) {
  s.set('fontSize', Math.min(FONT_MAX, Math.max(FONT_MIN, s.fontSize + delta)));
}
function onFontSize(e: Event) {
  s.set('fontSize', Number((e.target as HTMLInputElement).value));
}
function onLineHeight(e: Event) {
  s.set('lineHeight', Number((e.target as HTMLInputElement).value));
}
function onParagraphSpacing(e: Event) {
  s.set('paragraphSpacing', Number((e.target as HTMLInputElement).value));
}
</script>

<template>
  <Transition name="sheet">
    <div v-if="props.open" class="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-end" @click.self="emit('update:open', false)">
      <div
        class="w-full sm:w-[22rem] rounded-t-2xl sm:rounded-2xl sm:mr-6 p-5 max-h-[82vh] overflow-y-auto"
        style="background: var(--panel); border: 1px solid var(--border); box-shadow: 0 10px 40px rgba(0,0,0,0.15)"
      >
        <div class="flex items-center justify-between mb-5">
          <span class="font-medium text-sm">阅读设置</span>
          <div class="flex items-center gap-1">
            <button class="btn !p-1.5 !border-0 text-dim" title="恢复默认" @click="s.reset()">
              <RotateCcw class="w-4 h-4" />
            </button>
            <button class="btn !p-1.5 !border-0" @click="emit('update:open', false)"><X class="w-4 h-4" /></button>
          </div>
        </div>

        <!-- 字号(Apple Books 式 A-/A+) -->
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-dim">字号</span>
            <span class="text-xs text-dim tabular-nums">{{ s.fontSize }}px</span>
          </div>
          <div class="flex items-center gap-3">
            <button class="size-btn" title="缩小字号" @click="bumpFont(-1)">A<span class="text-[0.7em] -ml-0.5">−</span></button>
            <input
              class="reader-range flex-1"
              type="range"
              :min="FONT_MIN"
              :max="FONT_MAX"
              step="1"
              :value="s.fontSize"
              aria-label="字号"
              @input="onFontSize"
            />
            <button class="size-btn !text-lg" title="放大字号" @click="bumpFont(1)">A<span class="text-[0.7em] -ml-0.5">+</span></button>
          </div>
        </div>

        <!-- 主题 -->
        <div class="mb-5">
          <div class="text-xs text-dim mb-2">主题</div>
          <div class="grid grid-cols-5 gap-2">
            <button
              v-for="t in themes"
              :key="t.value"
              class="flex flex-col items-center gap-1.5"
              :title="t.label"
              @click="s.set('theme', t.value)"
            >
              <span
                class="w-full h-9 rounded-lg border-2 transition-all"
                :style="{
                  background: t.bg,
                  borderColor: s.theme === t.value ? 'var(--accent)' : 'var(--border)',
                }"
              />
              <span class="text-[10px]" :class="s.theme === t.value ? 'accent font-medium' : 'text-dim'">
                {{ t.label }}
              </span>
            </button>
          </div>
        </div>

        <!-- 字体 -->
        <div class="mb-5">
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

        <!-- 行距 -->
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-dim">行距</span>
            <span class="text-xs text-dim tabular-nums">{{ lineHeightLabel }}</span>
          </div>
          <input
            class="reader-range w-full"
            type="range"
            min="1.3"
            max="2.4"
            step="0.1"
            :value="s.lineHeight"
            aria-label="行距"
            @input="onLineHeight"
          />
        </div>

        <!-- 段间距 -->
        <div class="mb-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-dim">段间距</span>
            <span class="text-xs text-dim tabular-nums">{{ paragraphSpacingLabel }}</span>
          </div>
          <input
            class="reader-range w-full"
            type="range"
            min="0"
            max="1.5"
            step="0.1"
            :value="s.paragraphSpacing"
            aria-label="段间距"
            @input="onParagraphSpacing"
          />
        </div>

        <!-- 宽度 -->
        <div class="mb-5">
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
        <div class="mb-5">
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

        <!-- 翻页动画 -->
        <div class="mb-5">
          <div class="text-xs text-dim mb-2">翻页动画</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="p in pageTurns"
              :key="p.value"
              class="btn !text-xs !py-2"
              :class="s.pageTurn === p.value && 'btn-primary'"
              @click="s.set('pageTurn', p.value)"
            >
              {{ p.label }}
            </button>
          </div>
        </div>

        <!-- 正文加粗 -->
        <button class="flex w-full items-center justify-between py-1" @click="s.set('boldText', !s.boldText)">
          <span class="text-xs text-dim">正文加粗</span>
          <span class="toggle" :class="s.boldText && 'on'"><span /></span>
        </button>

        <p class="text-[11px] text-dim mt-4">设置会自动保存,并在所有书籍间共享。</p>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.sheet-enter-active, .sheet-leave-active { transition: opacity .22s ease; }
.sheet-enter-from, .sheet-leave-to { opacity: 0; }
.sheet-enter-active > div, .sheet-leave-active > div {
  transition: transform .22s cubic-bezier(0.25, 0.1, 0.25, 1);
}
.sheet-enter-from > div, .sheet-leave-to > div { transform: translateY(16px); }

.size-btn {
  display: inline-flex;
  align-items: baseline;
  justify-content: center;
  min-width: 2.25rem;
  padding: 0.35rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.5rem;
  background: var(--panel);
  color: var(--text);
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
  transition: all .15s ease;
}
.size-btn:hover { border-color: var(--accent); color: var(--accent); }
.size-btn:active { transform: scale(0.95); }

.reader-range {
  accent-color: var(--accent);
  height: 1.25rem;
}

.toggle {
  width: 2.5rem;
  height: 1.45rem;
  border-radius: 999px;
  background: var(--bg-soft);
  border: 1px solid var(--border);
  padding: 2px;
  transition: background .18s ease, border-color .18s ease;
}
.toggle span {
  display: block;
  width: 1rem;
  height: 1rem;
  border-radius: 999px;
  background: var(--text-dim);
  transition: transform .18s ease, background .18s ease;
}
.toggle.on { background: var(--accent); border-color: var(--accent); }
.toggle.on span { transform: translateX(1.05rem); background: #fff; }
</style>
