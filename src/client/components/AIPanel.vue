<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue';
import { Sparkles, X, Send, Loader2, FileQuestion, Users, BookMarked, History } from 'lucide-vue-next';
import { streamAI } from '@/utils/ai';
import { renderMarkdown } from '@/utils/markdown';

const props = defineProps<{
  bookId: number;
  chapterIndex: number;
  bookTitle: string;
  open: boolean;
}>();
const emit = defineEmits<{ close: [] }>();

interface Msg {
  role: 'user' | 'assistant' | 'error';
  content: string;
  streaming?: boolean;
  cached?: boolean;
}

const messages = ref<Msg[]>([]);
const input = ref('');
const busy = ref(false);
const scrollEl = ref<HTMLElement | null>(null);
let abort: AbortController | null = null;

const quickActions = [
  { mode: 'summarize', label: '总结本章', icon: FileQuestion },
  { mode: 'characters', label: '人物关系', icon: Users },
  { mode: 'setting', label: '解释设定', icon: BookMarked },
  { mode: 'recap', label: '回顾剧情', icon: History },
];

const html = (s: string) => renderMarkdown(s);

function scrollBottom() {
  nextTick(() => {
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight });
  });
}

async function run(mode: string, extra: { question?: string; term?: string; context?: string } = {}) {
  if (busy.value) return;
  busy.value = true;
  const userContent =
    mode === 'chat' ? extra.question! : mode === 'explain' ? `解释「${extra.term}」` : labelOf(mode);
  messages.value.push({ role: 'user', content: userContent });
  const msg: Msg = { role: 'assistant', content: '', streaming: true };
  messages.value.push(msg);
  scrollBottom();

  abort = new AbortController();
  await streamAI(
    { mode, bookId: props.bookId, chapterIndex: props.chapterIndex, ...extra },
    {
      onMeta: (meta) => {
        msg.cached = meta.cached;
      },
      onDelta: (delta) => {
        msg.content += delta;
        scrollBottom();
      },
      onError: (m) => {
        if (!msg.content) {
          messages.value.splice(messages.value.indexOf(msg), 1);
          messages.value.push({ role: 'error', content: m });
        }
      },
      onDone: () => {
        msg.streaming = false;
        busy.value = false;
      },
    },
    abort.signal,
  );
  if (msg.streaming) {
    msg.streaming = false;
    busy.value = false;
  }
  scrollBottom();
}

function labelOf(mode: string): string {
  return quickActions.find((a) => a.mode === mode)?.label || '请分析';
}

function send() {
  const q = input.value.trim();
  if (!q || busy.value) return;
  input.value = '';
  run('chat', { question: q });
}

function stop() {
  abort?.abort();
}

/** 选中文字 → AI 解释 */
function explainTerm(term: string, context: string) {
  // 打开后立即执行
  setTimeout(() => run('explain', { term, context }), 50);
}

watch(
  () => [props.bookId, props.chapterIndex],
  () => {
    // 切换章节清空会话
    messages.value = [];
  },
);

defineExpose({ explainTerm });

const hasMessages = computed(() => messages.value.length > 0);
</script>

<template>
  <Transition name="panel">
    <aside
      v-if="open"
      class="ai-panel fixed z-40 flex flex-col"
      style="background: var(--panel)"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color: var(--border)">
        <div class="flex items-center gap-2">
          <Sparkles class="w-4 h-4 accent" />
          <span class="text-sm font-medium">AI 阅读助手</span>
          <span class="text-[10px] text-dim">《{{ bookTitle }}》</span>
        </div>
        <button class="btn !p-2 !border-0" @click="emit('close')"><X class="w-4 h-4" /></button>
      </div>

      <!-- 快捷操作 -->
      <div class="px-4 py-2.5 border-b flex gap-2 overflow-x-auto shrink-0" style="border-color: var(--border)">
        <button
          v-for="a in quickActions"
          :key="a.mode"
          class="btn !py-1.5 !px-2.5 !text-xs shrink-0"
          :disabled="busy"
          @click="run(a.mode)"
        >
          <component :is="a.icon" class="w-3.5 h-3.5" />
          {{ a.label }}
        </button>
      </div>

      <!-- 消息 -->
      <div ref="scrollEl" class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div v-if="!hasMessages" class="text-center text-xs text-dim py-10">
          <Sparkles class="w-6 h-6 mx-auto mb-3 opacity-50" />
          试试上方的快捷操作,或直接提问<br />
          例如:「为什么萧炎突然突破?」
        </div>
        <template v-for="(m, i) in messages" :key="i">
          <div v-if="m.role === 'user'" class="flex justify-end">
            <div class="user-bubble max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">
              {{ m.content }}
            </div>
          </div>
          <div v-else-if="m.role === 'error'" class="text-xs text-red-500 text-center py-1">{{ m.content }}</div>
          <div v-else class="flex justify-start">
            <div class="max-w-[92%] text-sm leading-relaxed md-body" v-html="html(m.content || (m.streaming ? '正在分析……' : ''))" />
          </div>
        </template>
      </div>

      <!-- 输入 -->
      <div class="p-3 border-t shrink-0" style="border-color: var(--border)">
        <form class="flex gap-2" @submit.prevent="send()">
          <input v-model="input" class="input !py-2 text-sm" placeholder="请输入问题……" :disabled="busy" />
          <button v-if="busy" type="button" class="btn btn-primary" @click="stop">停止</button>
          <button v-else type="submit" class="btn btn-primary" :disabled="!input.trim()">
            <Send class="w-4 h-4" />
          </button>
        </form>
        <p class="text-[10px] text-dim mt-1.5 text-center">AI 回答基于当前章节与上下文,仅供参考</p>
      </div>
    </aside>
  </Transition>
</template>

<style scoped>
.ai-panel {
  /* 桌面:右侧抽屉;移动:底部 sheet */
  right: 0;
  top: 0;
  bottom: 0;
  width: min(400px, 100vw);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 30px rgba(0, 0, 0, 0.12);
  max-height: 100vh;
}
@media (max-width: 640px) {
  .ai-panel {
    top: auto;
    height: 72vh;
    width: 100vw;
    border-left: none;
    border-top: 1px solid var(--border);
    border-radius: 16px 16px 0 0;
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.18);
  }
}
.panel-enter-active,
.panel-leave-active {
  transition: transform 0.25s ease, opacity 0.25s ease;
}
.panel-enter-from,
.panel-leave-to {
  transform: translateX(30px);
  opacity: 0;
}
@media (max-width: 640px) {
  .panel-enter-from,
  .panel-leave-to {
    transform: translateY(30%);
  }
}
.user-bubble {
}
.user-bubble,
.user-bubble {
  background: var(--accent-soft);
}
.md-body :deep(h2) { font-size: 1em; font-weight: 700; margin: 0.8em 0 0.4em; }
.md-body :deep(h3) { font-size: 0.95em; font-weight: 700; margin: 0.8em 0 0.4em; }
.md-body :deep(h4) { font-size: 0.9em; font-weight: 600; margin: 0.6em 0 0.3em; }
.md-body :deep(p) { margin: 0.4em 0; }
.md-body :deep(ul), .md-body :deep(ol) { margin: 0.4em 0; padding-left: 1.2em; }
.md-body :deep(li) { margin: 0.2em 0; }
.md-body :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 0.8em;
  color: var(--text-dim);
  margin: 0.5em 0;
}
.md-body :deep(code) {
  background: var(--bg-soft);
  padding: 0.1em 0.35em;
  border-radius: 4px;
  font-size: 0.85em;
}
.md-body :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 0.8em 0; }
.md-body :deep(strong) { font-weight: 600; }
</style>