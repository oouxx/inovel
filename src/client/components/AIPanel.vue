<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted, defineAsyncComponent } from 'vue';
import { Sparkles, X, Send, Trash2, Copy, Check } from 'lucide-vue-next';
import { streamAI } from '@/utils/ai';

// markstream-vue 较重(约 750KB/92KB CSS),面板首次打开时才异步加载,不进阅读页主包
const MarkdownRender = defineAsyncComponent(async () => {
  const [{ default: Comp }] = await Promise.all([
    import('markstream-vue'),
    import('markstream-vue/index.css'),
  ]);
  return Comp;
});

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
const inputEl = ref<HTMLTextAreaElement | null>(null);
const copiedIndex = ref(-1);
let abort: AbortController | null = null;
let copyTimer: any = null;

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
  if (messages.value.length && !confirm('清空当前书籍的 AI 对话?')) return;
  abort?.abort();
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

// ---- 流式渲染(markstream-vue)----
// 渐进式渲染 / 打字机 / 平滑节奏 / 不完整语法容错均由库内部处理,
// 这里只负责数据流(delta 追加)与智能滚动

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

/** 用户本来就在底部才跟随滚动,上滑回看时不拽人 */
function followScroll() {
  const stick = nearBottom();
  if (stick) scrollBottom();
}

async function run(mode: 'chat' | 'explain', extra: { question?: string; term?: string; context?: string } = {}) {
  if (busy.value) return;
  busy.value = true;
  const userContent = mode === 'explain' ? `解释「${extra.term}」` : extra.question || '';
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
        followScroll();
      },
      onError: (m) => {
        if (!msg.content) messages.value.splice(messages.value.indexOf(msg), 1);
        messages.value.push({ role: 'error', content: m });
        busy.value = false;
      },
      onDone: () => {
        msg.streaming = false;
        busy.value = false;
        saveHistory();
      },
    },
    abort.signal,
  );
  if (msg.streaming) {
    // 中断/异常结束未触发 onDone
    msg.streaming = false;
    busy.value = false;
  }
  scrollBottom();
  nextTick(() => inputEl.value?.focus());
}

function onEnter(e: KeyboardEvent) {
  // 中文输入法候选框里的 Enter 不发送
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  send();
}

function onEscape(e: KeyboardEvent) {
  if (e.isComposing) return;
  e.preventDefault();
  emit('close');
}

function send() {
  const q = input.value.trim();
  if (!q || busy.value) return;
  input.value = '';
  nextTick(() => {
    autoResize();
    inputEl.value?.focus();
  });
  run('chat', { question: q });
}

function autoResize() {
  const el = inputEl.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

async function copyMessage(index: number, content: string) {
  try {
    await navigator.clipboard.writeText(content);
    copiedIndex.value = index;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => {
      if (copiedIndex.value === index) copiedIndex.value = -1;
    }, 1600);
  } catch {}
}

function stop() {
  abort?.abort();
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
    loadHistory();
  },
);

defineExpose({ explainTerm });

// ---- iOS Safari 软键盘适配 ----
// iOS 弹出软键盘不缩小布局视口,fixed 底部面板的输入行会被键盘整段盖住(打字看不到内容);
// 用 visualViewport 把面板压缩、抬升到键盘上方。桌面/鼠标设备直接跳过,无副作用
const panelEl = ref<HTMLElement | null>(null);

function syncKeyboard() {
  const el = panelEl.value;
  const vv = window.visualViewport;
  if (!el || !vv || !window.matchMedia('(pointer: coarse)').matches) return;
  // 键盘遮挡高度 = 布局视口高 - 可视区顶部偏移 - 可视区高度
  const covered = window.innerHeight - vv.offsetTop - vv.height;
  if (covered > 150) {
    el.style.height = `${vv.height}px`;
    el.style.bottom = `${covered}px`;
  } else {
    // 键盘收起:还原为 CSS 里的 72vh 底部 sheet
    el.style.height = '';
    el.style.bottom = '';
  }
}

onMounted(() => {
  window.visualViewport?.addEventListener('resize', syncKeyboard);
  window.visualViewport?.addEventListener('scroll', syncKeyboard);
});

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    autoResize();
    inputEl.value?.focus();
  },
);
onUnmounted(() => {
  window.visualViewport?.removeEventListener('resize', syncKeyboard);
  window.visualViewport?.removeEventListener('scroll', syncKeyboard);
  clearTimeout(copyTimer);
});

const hasMessages = computed(() => messages.value.length > 0);
</script>

<template>
  <Transition name="panel">
    <aside
      v-if="open"
      ref="panelEl"
      class="ai-panel fixed z-40 flex flex-col"
      style="background: var(--panel)"
    >
      <!-- 头部 -->
      <div class="flex items-center justify-between px-4 py-3 border-b shrink-0" style="border-color: var(--border)">
        <div class="flex items-center gap-2">
          <Sparkles class="w-4 h-4 accent" />
          <span class="text-sm font-medium">AI 阅读助手</span>
          <span class="text-[10px] text-dim truncate">《{{ bookTitle }}》 · 第 {{ chapterIndex + 1 }} 章</span>
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

      <!-- 消息 -->
      <div ref="scrollEl" class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div v-if="!hasMessages" class="text-center text-xs text-dim py-10">
          <Sparkles class="w-6 h-6 mx-auto mb-3 opacity-50" />
          可以问关于这本书的任何问题
          <div class="mt-1.5 opacity-80">AI 会结合当前章节与全书相关内容回答</div>
        </div>
        <template v-for="(m, i) in messages" :key="i">
          <div v-if="m.role === 'user'" class="flex justify-end">
            <div class="user-bubble max-w-[85%] rounded-2xl rounded-br-sm px-3.5 py-2 text-sm">
              {{ m.content }}
            </div>
          </div>
          <div v-else-if="m.role === 'error'" class="text-xs text-red-500 text-center py-1">{{ m.content }}</div>
          <div v-else class="flex justify-start">
            <div class="max-w-[92%] text-sm leading-relaxed">
              <MarkdownRender
                v-if="m.content"
                class="md-stream"
                mode="chat"
                :content="m.content"
                :final="!m.streaming"
                typewriter="precise"
                smooth-streaming="auto"
                :fade="false"
                :render-code-blocks-as-pre="true"
                :max-live-nodes="0"
                :batch-rendering="true"
                :render-batch-size="12"
                :render-batch-delay="8"
                :render-batch-budget-ms="4"
              />
              <span v-else-if="m.streaming" class="text-xs text-dim">正在分析…</span>
              <button
                v-if="m.content && !m.streaming"
                class="mt-1.5 inline-flex items-center gap-1 text-[10px] text-dim hover:accent"
                title="复制回答"
                @click="copyMessage(i, m.content)"
              >
                <Check v-if="copiedIndex === i" class="w-3 h-3" />
                <Copy v-else class="w-3 h-3" />
                {{ copiedIndex === i ? '已复制' : '复制' }}
              </button>
            </div>
          </div>
        </template>
      </div>

      <!-- 输入 -->
      <div class="p-3 border-t shrink-0" style="border-color: var(--border)">
        <form class="flex items-end gap-2" @submit.prevent="send()">
          <textarea
            ref="inputEl"
            v-model="input"
            rows="1"
            class="input !py-2 text-sm resize-none flex-1 max-h-[7.5rem]"
            placeholder="问关于这本书的任何问题…"
            :disabled="busy"
            aria-label="向 AI 提问"
            @input="autoResize"
            @keydown.enter.exact="onEnter"
            @keydown.esc="onEscape"
          />
          <button v-if="busy" type="button" class="btn btn-primary shrink-0" @click="stop">停止</button>
          <button v-else type="submit" class="btn btn-primary shrink-0" :disabled="!input.trim()">
            <Send class="w-4 h-4" />
          </button>
        </form>
        <p class="text-[10px] text-dim mt-1.5 text-center">Enter 发送,Shift+Enter 换行 · 回答仅供参考</p>
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
  background: var(--accent-soft);
}
/* ---- markstream-vue 主题融合:把阅读主题映射进库的 CSS 变量 ---- */
.md-stream {
  /* 正文用主题色/字号(覆盖库默认的 1rem + 固定前景色) */
  color: var(--text);
  font-size: inherit;
  --ms-text-body: 0.875rem;
  --ms-text-h2: 1em;
  --ms-text-h3: 0.95em;
  --ms-text-h4: 0.9em;
  --ms-flow-heading-2-mt: 1em;
  --ms-flow-heading-2-mb: 0.5em;
  --ms-flow-heading-3-mt: 0.9em;
  --ms-flow-heading-3-mb: 0.45em;
  --ms-flow-paragraph-y: 0.45em;
  /* 派生色直接映射主题变量 */
  --inline-code-bg: var(--bg-soft);
  --inline-code-fg: var(--text);
  --code-bg: var(--bg-soft);
  --code-fg: var(--text);
  --code-border: var(--border);
  --table-border: var(--border);
  --table-header-bg: var(--bg-soft);
  --blockquote-border: var(--border);
  --hr-border: var(--border);
  --link-color: var(--accent);
  --list-marker: var(--text-dim);
  --list-counter-marker: var(--text-dim);
}
.ai-panel .md-stream,
.ai-panel .md-stream :deep(h1),
.ai-panel .md-stream :deep(h2),
.ai-panel .md-stream :deep(h3),
.ai-panel .md-stream :deep(h4),
.ai-panel .md-stream :deep(p),
.ai-panel .md-stream :deep(li),
.ai-panel .md-stream :deep(td),
.ai-panel .md-stream :deep(strong) {
  color: var(--text);
}
.ai-panel .md-stream :deep(a) {
  color: var(--accent);
}
.ai-panel .md-stream :deep(pre),
.ai-panel .md-stream :deep(code) {
  background: var(--bg-soft);
  color: var(--text);
}
.ai-panel .md-stream :deep(table),
.ai-panel .md-stream :deep(th),
.ai-panel .md-stream :deep(td) {
  border-color: var(--border);
}
.ai-panel .md-stream :deep(th) {
  background: var(--bg-soft);
}
.ai-panel .md-stream :deep(blockquote) {
  border-left-color: var(--border);
  color: var(--text-dim);
}
</style>