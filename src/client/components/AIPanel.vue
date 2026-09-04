<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted } from 'vue';
import { Sparkles, X, Send, Loader2, FileQuestion, Users, BookMarked, History, Trash2 } from 'lucide-vue-next';
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

// ---- 对话历史(按书持久化到 localStorage,上限 60 条) ----
const historyKey = computed(() => `ai-chat-${props.bookId}`);

function loadHistory() {
  try {
    const raw = localStorage.getItem(historyKey.value);
    if (raw) {
      const arr = JSON.parse(raw) as Msg[];
      messages.value = arr.slice(-60).map((m) => ({ ...m, streaming: false }));
      return;
    }
  } catch {}
  messages.value = [];
}

function saveHistory() {
  try {
    localStorage.setItem(historyKey.value, JSON.stringify(messages.value.slice(-60)));
  } catch {}
}

function clearHistory() {
  abort?.abort();
  flushTicker();
  busy.value = false;
  messages.value = [];
  try {
    localStorage.removeItem(historyKey.value);
  } catch {}
}

onMounted(loadHistory);

// 消息变化 → 持久化(streaming 中的消息跳过部分内容也可,简单起见完成时保存)
watch(
  () => messages.value.length,
  () => {
    if (!messages.value.some((m) => m.streaming)) saveHistory();
  },
);

const quickActions = [
  { mode: 'summarize', label: '总结本章', icon: FileQuestion },
  { mode: 'characters', label: '人物关系', icon: Users },
  { mode: 'setting', label: '解释设定', icon: BookMarked },
  { mode: 'recap', label: '回顾剧情', icon: History },
];

const html = (s: string) => renderMarkdown(s);

// ---- 流式平滑(打字机效果)----
// 上游可能是突发批量到达(免费模型节流/缓存回放),缓冲后按固定节奏逐字放出,
// 保证视觉上始终是平滑的逐字输出,与网络层到达节奏解耦
let pendingText = '';
let smoother: ReturnType<typeof setInterval> | null = null;
let smoothTarget: Msg | null = null;
let sourceDone = false;
let smoothError: string | null = null;

function nearBottom(): boolean {
  const el = scrollEl.value;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollBottom() {
  nextTick(() => {
    scrollEl.value?.scrollTo({ top: scrollEl.value.scrollHeight });
  });
}

function ensureTicker() {
  if (smoother) return;
  smoother = setInterval(smoothTick, 30);
}

function smoothTick() {
  const msg = smoothTarget;
  if (!msg) {
    stopTicker();
    return;
  }
  if (pendingText.length) {
    const stick = nearBottom();
    // 自适应速率:积压越多放得越快,最多落后 ~1.5s;少量时 4字/30ms ≈ 133字/s
    const rate = Math.max(4, Math.ceil(pendingText.length / 18));
    msg.content += pendingText.slice(0, rate);
    pendingText = pendingText.slice(rate);
    if (stick) scrollBottom();
  } else if (sourceDone) {
    finishMsg();
  }
}

function stopTicker() {
  if (smoother) {
    clearInterval(smoother);
    smoother = null;
  }
}

/** 缓冲排空后收尾:结束 streaming 状态、解除 busy、持久化 */
function finishMsg() {
  stopTicker();
  const msg = smoothTarget;
  smoothTarget = null;
  if (msg) {
    msg.content += pendingText;
    msg.streaming = false;
  }
  pendingText = '';
  busy.value = false;
  if (msg) {
    if (smoothError) messages.value.push({ role: 'error', content: smoothError });
    smoothError = null;
  }
  saveHistory();
  scrollBottom();
}

/** 立即冲刷(停止/清空/切换书时) */
function flushTicker() {
  const msg = smoothTarget;
  stopTicker();
  smoothTarget = null;
  sourceDone = false;
  pendingText = '';
  smoothError = null;
  if (msg) {
    msg.streaming = false;
    busy.value = false;
  }
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

  pendingText = '';
  sourceDone = false;
  smoothError = null;
  smoothTarget = msg;

  abort = new AbortController();
  await streamAI(
    { mode, bookId: props.bookId, chapterIndex: props.chapterIndex, ...extra },
    {
      onMeta: (meta) => {
        msg.cached = meta.cached;
      },
      onDelta: (delta) => {
        pendingText += delta;
        ensureTicker();
      },
      onError: (m) => {
        if (!msg.content && !pendingText) {
          // 还没输出任何内容 → 替换为错误消息
          stopTicker();
          smoothTarget = null;
          messages.value.splice(messages.value.indexOf(msg), 1);
          messages.value.push({ role: 'error', content: m });
          busy.value = false;
        } else {
          // 已有部分内容 → 冲刷完已有内容后追加错误提示
          smoothError = m;
          sourceDone = true;
          ensureTicker();
        }
      },
      onDone: () => {
        sourceDone = true;
        if (!smoother) finishMsg(); // 无待冲刷内容时直接收尾
      },
    },
    abort.signal,
  );
  sourceDone = true;
  // 流已结束:若缓冲已排空则立即收尾,否则交给 ticker 排完后收尾
  if (smoothTarget === msg && !pendingText.length) finishMsg();
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
  flushTicker();
}

/** 选中文字 → AI 解释 */
function explainTerm(term: string, context: string) {
  // 打开后立即执行
  setTimeout(() => run('explain', { term, context }), 50);
}

// 切换书籍时加载对应会话(同书跨章节保留对话)
watch(
  () => props.bookId,
  () => {
    abort?.abort();
    flushTicker();
    loadHistory();
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
        <div class="flex items-center">
          <button
            v-if="hasMessages"
            class="btn !p-2 !border-0 text-dim"
            title="清空对话"
            @click="clearHistory"
          >
            <Trash2 class="w-4 h-4" />
          </button>
          <button class="btn !p-2 !border-0" @click="emit('close')"><X class="w-4 h-4" /></button>
        </div>
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
.md-body :deep(h1), .md-body :deep(h2) { font-size: 1em; font-weight: 700; margin: 0.8em 0 0.4em; }
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
.md-body :deep(pre) {
  background: var(--bg-soft);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6em 0.8em;
  overflow-x: auto;
}
.md-body :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.8em;
}
.md-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.85em;
  margin: 0.6em 0;
  display: block;
  overflow-x: auto;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid var(--border);
  padding: 0.35em 0.6em;
  text-align: left;
  vertical-align: top;
}
.md-body :deep(th) {
  background: var(--bg-soft);
  font-weight: 600;
  white-space: nowrap;
}
.md-body :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md-body :deep(blockquote) { margin: 0.6em 0; }
.md-body :deep(blockquote p) { margin: 0.2em 0; }
.md-body :deep(hr) { border: none; border-top: 1px solid var(--border); margin: 0.8em 0; }
.md-body :deep(strong) { font-weight: 600; }
</style>