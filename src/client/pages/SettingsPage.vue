<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import type { Book, ScanStatus } from '@shared/types';
import { ArrowLeft, RefreshCw, Upload, Database, FolderOpen, CheckCircle2, AlertTriangle, XCircle, Sparkles, Clock } from 'lucide-vue-next';
import { api as apiClient, type StatsSummary } from '@/api';

const status = ref<ScanStatus & { novelsDir: string } | null>(null);
const books = ref<Book[]>([]);
const aiInfo = ref<{ provider: string; model: string; configured: boolean } | null>(null);
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
  books.value = await api.listBooks();
  aiInfo.value = await apiClient.aiStatus().catch(() => null);
  stats.value = await apiClient.stats().catch(() => null);
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

    <!-- AI 配置状态 -->
    <section v-if="aiInfo" class="panel rounded-2xl p-5 mb-6">
      <div class="flex items-center gap-3">
        <Sparkles class="w-5 h-5 accent" />
        <div class="flex-1">
          <div class="font-medium">AI 阅读助手</div>
          <div class="text-xs text-dim mt-0.5">
            {{ aiInfo.provider }} · {{ aiInfo.model }}
            <span :style="{ color: aiInfo.configured ? 'var(--accent)' : '#c58a2d' }">
              · {{ aiInfo.configured ? '已配置' : '未配置(设置环境变量 AI_PROVIDER / API_KEY)' }}
            </span>
          </div>
        </div>
      </div>
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
      <h3 class="text-sm font-medium text-dim mb-3">书库 · {{ books.length }} 本</h3>
      <div class="panel rounded-2xl divide-y overflow-hidden" style="border-color: var(--border)">
        <div v-for="b in books" :key="b.id" class="flex items-center gap-3 px-4 py-3 text-sm">
          <RouterLink :to="`/books/${b.id}`" class="font-medium truncate hover:accent max-w-[35%]">{{ b.title }}</RouterLink>
          <span class="text-xs text-dim hidden sm:inline">{{ b.category || '未分类' }}</span>
          <span class="text-xs text-dim hidden md:inline">{{ b.encoding }}</span>
          <span class="text-xs text-dim ml-auto hidden sm:inline">{{ fmtSize(b.file_size) }}</span>
          <span class="text-xs font-medium">{{ b.chapter_count }} 章</span>
          <CheckCircle2 v-if="b.status === 'ok'" class="w-4 h-4" style="color: var(--accent)" />
          <AlertTriangle v-else class="w-4 h-4" style="color: #c58a2d" />
        </div>
      </div>
    </section>
  </div>
</template>