<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { api, type StatsSummary, type AIConfigInfo } from '@/api';
import type { Book, ScanStatus } from '@shared/types';
import {
  ArrowLeft,
  RefreshCw,
  Upload,
  Database,
  FolderOpen,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Sparkles,
  Clock,
  Trash2,
  PlugZap,
} from 'lucide-vue-next';

const status = ref<ScanStatus & { novelsDir: string } | null>(null);
const books = ref<Book[]>([]);
const stats = ref<StatsSummary | null>(null);
const scanning = ref(false);
const dragOver = ref(false);
const uploadResults = ref<{ fileName: string; status: string; chapterCount: number; encoding: string; error?: string }[]>([]);
let pollTimer: any = null;

onMounted(async () => {
  await refresh();
  poll();
});
onUnmounted(() => clearInterval(pollTimer));

function poll() {
  pollTimer = setInterval(async () => {
    try {
      status.value = await api.scanStatus();
      if (scanning.value && !status.value.scanning) {
        scanning.value = false;
        await refresh();
      }
    } catch {}
  }, 1500);
}

async function refresh() {
  status.value = await api.scanStatus();
  const r = await api.listBooksPage({ limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE });
  total.value = r.total;
  // 删除后当前页可能变空,回退一页
  if (r.books.length === 0 && page.value > 1) {
    page.value -= 1;
    const r2 = await api.listBooksPage({ limit: PAGE_SIZE, offset: (page.value - 1) * PAGE_SIZE });
    books.value = r2.books;
    total.value = r2.total;
  } else {
    books.value = r.books;
  }
  aiCfg.value = await api.aiConfig().catch(() => null);
  if (aiCfg.value) fillAIForm(aiCfg.value);
  stats.value = await api.stats().catch(() => null);
}

// ---- 分页 ----
const PAGE_SIZE = 20;
const page = ref(1);
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));

async function goPage(p: number) {
  if (p < 1 || p > totalPages.value || p === page.value) return;
  page.value = p;
  await refresh();
}

function fmtDuration(s: number) {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分钟`;
}

async function triggerScan() {
  scanning.value = true;
  await api.triggerScan();
}

async function onDrop(e: DragEvent) {
  dragOver.value = false;
  const files = Array.from(e.dataTransfer?.files || []);
  await doUpload(files);
}

async function onPick(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  await doUpload(files);
  (e.target as HTMLInputElement).value = '';
}

async function doUpload(files: File[]) {
  const txts = files.filter((f) => /\.txt$/i.test(f.name));
  if (!txts.length) return;
  scanning.value = true;
  try {
    const res = await api.upload(txts);
    uploadResults.value = [...res.results, ...uploadResults.value].slice(0, 50);
    await refresh();
  } finally {
    scanning.value = false;
  }
}

function fmtSize(n: number) {
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

// ---- AI 配置 ----
const aiCfg = ref<AIConfigInfo | null>(null);
const aiForm = ref({ provider: 'openai', baseUrl: '', model: '', apiKey: '' });
const aiSaving = ref(false);
const aiTesting = ref(false);
const aiTestResult = ref<{ ok: boolean; text: string } | null>(null);
const aiSavedTip = ref(false);

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI 兼容(DeepSeek / 通义 / Ollama 等)',
  anthropic: 'Anthropic',
  google: 'Google',
  openrouter: 'OpenRouter',
};
const PROVIDER_BASE_PLACEHOLDER: Record<string, string> = {
  openai: '默认官方端点,自建/兼容端点填如 https://api.deepseek.com/v1',
  anthropic: '默认官方端点,可不填',
  google: '默认官方端点,可不填',
  openrouter: '默认 https://openrouter.ai/api/v1',
};

function fillAIForm(c: AIConfigInfo) {
  aiForm.value = { provider: c.provider, baseUrl: c.baseUrl, model: c.model, apiKey: '' };
}

async function saveAI(clearKey = false) {
  aiSaving.value = true;
  aiTestResult.value = null;
  try {
    const payload: { provider: string; baseUrl: string; model: string; apiKey?: string } = {
      provider: aiForm.value.provider,
      baseUrl: aiForm.value.baseUrl,
      model: aiForm.value.model,
    };
    if (clearKey) payload.apiKey = '';
    else if (aiForm.value.apiKey.trim()) payload.apiKey = aiForm.value.apiKey.trim();
    const r = await api.saveAIConfig(payload);
    aiCfg.value = r;
    fillAIForm(r);
    aiSavedTip.value = true;
    setTimeout(() => (aiSavedTip.value = false), 2500);
  } catch (err: any) {
    alert(err?.message || '保存失败');
  } finally {
    aiSaving.value = false;
  }
}

async function testAI() {
  aiTesting.value = true;
  aiTestResult.value = null;
  try {
    const r = await api.aiTest();
    aiTestResult.value = r.ok
      ? { ok: true, text: `连通成功 · ${r.model} · ${r.latencyMs}ms${r.reply ? ` · 回复「${r.reply}」` : ''}` }
      : { ok: false, text: r.error || '测试失败' };
  } catch (err: any) {
    aiTestResult.value = { ok: false, text: err?.message || '测试失败' };
  } finally {
    aiTesting.value = false;
  }
}

// ---- 删除书籍 ----
const deleting = ref<number | null>(null);

async function removeBook(b: Book) {
  if (!confirm(`确定删除《${b.title}》?\n将同时删除本地 TXT 文件、章节索引、书签与阅读进度,不可恢复。`)) return;
  deleting.value = b.id;
  try {
    await api.deleteBook(b.id);
    await refresh();
  } catch (err: any) {
    alert(err?.message || '删除失败');
  } finally {
    deleting.value = null;
  }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-5 pb-24">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">书库管理</h1>
    </header>

    <!-- 扫描 -->
    <section class="panel rounded-2xl p-5 mb-6">
      <div class="flex items-center justify-between flex-wrap gap-3">
        <div class="flex items-center gap-3">
          <Database class="w-5 h-5 accent" />
          <div>
            <div class="font-medium">自动扫描</div>
            <div class="text-xs text-dim flex items-center gap-1 mt-0.5">
              <FolderOpen class="w-3.5 h-3.5" /> {{ status?.novelsDir }}
            </div>
          </div>
        </div>
        <button class="btn btn-primary" :disabled="scanning" @click="triggerScan">
          <RefreshCw class="w-4 h-4" :class="scanning && 'animate-spin'" />
          {{ scanning ? '扫描中…' : '立即扫描' }}
        </button>
      </div>
      <div v-if="status?.lastResult" class="text-xs text-dim mt-3">
        上次扫描:新增 {{ status.lastResult.added.length }} · 更新 {{ status.lastResult.updated.length }} · 未变化
        {{ status.lastResult.unchanged }} · 移除 {{ status.lastResult.removed.length }} · 耗时
        {{ (status.lastResult.durationMs / 1000).toFixed(1) }}s
      </div>
    </section>

    <!-- AI 配置 -->
    <section class="panel rounded-2xl p-5 mb-6">
      <div class="flex items-center gap-3 mb-4">
        <Sparkles class="w-5 h-5 accent" />
        <div class="flex-1">
          <div class="font-medium">AI 阅读助手</div>
          <div class="text-xs mt-0.5">
            <span v-if="aiCfg?.configured" style="color: var(--accent)">已配置 · {{ aiCfg.provider }} · {{ aiCfg.model }}</span>
            <span v-else style="color: #c58a2d">未配置,请填写下方信息</span>
          </div>
        </div>
        <span v-if="aiSavedTip" class="text-xs" style="color: var(--accent)">已保存</span>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block">
          <span class="text-xs text-dim">Provider</span>
          <select v-model="aiForm.provider" class="input !py-1.5 text-sm mt-1">
            <option v-for="p in aiCfg?.supportedProviders || ['openai', 'anthropic', 'google', 'openrouter']" :key="p" :value="p">
              {{ PROVIDER_LABELS[p] || p }}
            </option>
          </select>
        </label>
        <label class="block">
          <span class="text-xs text-dim">Model</span>
          <input
            v-model="aiForm.model"
            class="input !py-1.5 text-sm mt-1"
            placeholder="如 gpt-4o-mini / claude-sonnet-4 / gemini-2.0-flash"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs text-dim">Base URL(选填)</span>
          <input
            v-model="aiForm.baseUrl"
            class="input !py-1.5 text-sm mt-1"
            :placeholder="PROVIDER_BASE_PLACEHOLDER[aiForm.provider] || 'https://…/v1'"
          />
        </label>
        <label class="block sm:col-span-2">
          <span class="text-xs text-dim">API Key</span>
          <input
            v-model="aiForm.apiKey"
            type="password"
            autocomplete="off"
            class="input !py-1.5 text-sm mt-1"
            :placeholder="aiCfg?.hasApiKey ? `已保存(${aiCfg.apiKeyHint}),留空保持不变` : 'sk-…'"
          />
        </label>
      </div>

      <div class="flex items-center gap-2 mt-4 flex-wrap">
        <button class="btn btn-primary" :disabled="aiSaving" @click="saveAI(false)">
          {{ aiSaving ? '保存中…' : '保存配置' }}
        </button>
        <button class="btn" :disabled="aiTesting || aiSaving" @click="testAI">
          <PlugZap class="w-4 h-4" />
          {{ aiTesting ? '测试中…' : '测试连通' }}
        </button>
        <button
          v-if="aiCfg?.hasApiKey"
          class="btn !border-0 text-dim hover:text-red-500"
          :disabled="aiSaving"
          @click="saveAI(true)"
        >
          清除 Key
        </button>
      </div>
      <div v-if="aiTestResult" class="text-xs mt-3" :class="aiTestResult.ok ? 'text-dim' : 'text-red-500'">
        {{ aiTestResult.ok ? '✓ ' : '✗ ' }}{{ aiTestResult.text }}
      </div>
      <p class="text-[10px] text-dim mt-3">
        配置保存在服务端 data/ai-config.json;Key 仅服务端可见。阅读页右侧 AI 助手立即生效,无需重启。
      </p>
    </section>

    <!-- 阅读统计 -->
    <section v-if="stats" class="panel rounded-2xl p-5 mb-6">
      <div class="flex items-center gap-3 mb-3">
        <Clock class="w-5 h-5 accent" />
        <div class="font-medium">阅读统计</div>
      </div>
      <div class="grid grid-cols-2 gap-3 mb-3">
        <div class="rounded-xl p-3" style="background: var(--bg-soft)">
          <div class="text-xs text-dim">今日阅读</div>
          <div class="text-lg font-semibold mt-1">{{ fmtDuration(stats.todaySeconds) }}</div>
        </div>
        <div class="rounded-xl p-3" style="background: var(--bg-soft)">
          <div class="text-xs text-dim">累计阅读</div>
          <div class="text-lg font-semibold mt-1">{{ fmtDuration(stats.totalSeconds) }}</div>
        </div>
      </div>
      <div v-if="stats.books.length" class="text-xs divide-y" style="border-color: var(--border)">
        <div v-for="b in stats.books.slice(0, 5)" :key="b.id" class="flex items-center py-2">
          <RouterLink :to="`/books/${b.id}`" class="truncate hover:accent">{{ b.title }}</RouterLink>
          <span class="ml-auto text-dim shrink-0">{{ fmtDuration(b.seconds) }}</span>
        </div>
      </div>
      <div v-else class="text-xs text-dim">阅读时长大约每 30 秒自动记录一次,开始阅读后这里会有数据</div>
    </section>

    <!-- 批量导入 -->
    <section
      class="rounded-2xl border-2 border-dashed p-8 text-center mb-6 transition-colors"
      :style="{
        borderColor: dragOver ? 'var(--accent)' : 'var(--border)',
        background: dragOver ? 'var(--accent-soft)' : 'transparent',
      }"
      @dragover.prevent="dragOver = true"
      @dragleave="dragOver = false"
      @drop.prevent="onDrop"
    >
      <Upload class="w-8 h-8 mx-auto text-dim mb-3" />
      <p class="text-sm">拖拽 TXT 文件到此处,或</p>
      <label class="btn btn-primary mt-3 cursor-pointer">
        选择文件
        <input type="file" multiple accept=".txt" class="hidden" @change="onPick" />
      </label>
      <p class="text-xs text-dim mt-3">文件将保存到 novels/uploads/ 并自动解析入库</p>
    </section>

    <!-- 导入结果 -->
    <div v-if="uploadResults.length" class="panel rounded-2xl p-4 mb-6">
      <div class="text-sm font-medium mb-2">最近导入</div>
      <div class="text-xs divide-y" style="border-color: var(--border)">
        <div v-for="(r, i) in uploadResults" :key="i" class="flex items-center gap-2 py-2">
          <CheckCircle2 v-if="r.status === 'ok'" class="w-4 h-4" style="color: var(--accent)" />
          <AlertTriangle v-else-if="r.status === 'warn'" class="w-4 h-4" style="color: #c58a2d" />
          <XCircle v-else class="w-4 h-4 text-red-500" />
          <span class="flex-1 truncate">{{ r.fileName }}</span>
          <span class="text-dim">{{ r.encoding }}</span>
          <span class="font-medium">{{ r.status === 'error' ? '失败' : `${r.chapterCount} 章` }}</span>
          <span v-if="r.error" class="text-dim">{{ r.error }}</span>
        </div>
      </div>
    </div>

    <!-- 书库列表 -->
    <section>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-medium text-dim">书库 · 共 {{ total }} 本</h3>
        <span v-if="totalPages > 1" class="text-xs text-dim">第 {{ page }} / {{ totalPages }} 页</span>
      </div>
      <div class="panel rounded-2xl divide-y overflow-hidden" style="border-color: var(--border)">
        <div v-for="b in books" :key="b.id" class="flex items-center gap-3 px-4 py-3 text-sm">
          <RouterLink :to="`/books/${b.id}`" class="font-medium truncate hover:accent max-w-[30%]">{{ b.title }}</RouterLink>
          <span class="text-xs text-dim hidden sm:inline">{{ b.category || '未分类' }}</span>
          <span class="text-xs text-dim hidden md:inline">{{ b.encoding }}</span>
          <span class="text-xs text-dim ml-auto hidden sm:inline">{{ fmtSize(b.file_size) }}</span>
          <span class="text-xs font-medium">{{ b.chapter_count }} 章</span>
          <CheckCircle2 v-if="b.status === 'ok'" class="w-4 h-4" style="color: var(--accent)" />
          <AlertTriangle v-else class="w-4 h-4" style="color: #c58a2d" />
          <button
            class="btn !p-1.5 !border-0 text-dim hover:text-red-500 shrink-0"
            title="删除这本书"
            :disabled="deleting === b.id"
            @click="removeBook(b)">
            <Trash2 class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 分页 -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-3 mt-3">
        <button class="btn !py-1 !text-xs" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <span class="text-xs text-dim">{{ page }} / {{ totalPages }}</span>
        <button class="btn !py-1 !text-xs" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </div>
    </section>
  </div>
</template>