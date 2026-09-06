<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { api } from '@/api';
import type { BookSource, OnlineSourceTestResult } from '@shared/types';
import {
  ArrowLeft,
  Download,
  Trash2,
  PlayCircle,
  RefreshCw,
  Globe,
  CheckCircle2,
  XCircle,
  Link2,
} from 'lucide-vue-next';

const sources = ref<BookSource[]>([]);
const importUrl = ref('');
const importText = ref('');
const importing = ref(false);
const importMsg = ref<{ ok: boolean; text: string } | null>(null);
const testResults = ref<Record<string, OnlineSourceTestResult | 'testing'>>({});
const deleting = ref<string | null>(null);

let pollTimer: any = null;

async function refresh() {
  sources.value = await api.onlineSources();
}

onMounted(async () => {
  await refresh();
  pollTimer = setInterval(refresh, 30_000);
});
onUnmounted(() => clearInterval(pollTimer));

async function doImport() {
  if (!importUrl.value.trim() && !importText.value.trim()) return;
  importing.value = true;
  importMsg.value = null;
  try {
    const r = await api.importSource({
      url: importUrl.value.trim() || undefined,
      text: importText.value.trim() || undefined,
    });
    importMsg.value = { ok: true, text: `导入成功:新增 ${r.added} · 更新 ${r.updated}` };
    importUrl.value = '';
    importText.value = '';
    await refresh();
  } catch (e: any) {
    importMsg.value = { ok: false, text: e?.message || '导入失败' };
  } finally {
    importing.value = false;
  }
}

async function toggle(s: BookSource) {
  await api.toggleSource(s.bookSourceUrl, !s.enabled);
  s.enabled = !s.enabled;
}

async function remove(s: BookSource) {
  deleting.value = s.bookSourceUrl;
  try {
    await api.deleteSource(s.bookSourceUrl);
    await refresh();
  } finally {
    deleting.value = null;
  }
}

async function test(s: BookSource) {
  testResults.value[s.bookSourceUrl] = 'testing' as any;
  try {
    const r = await api.testSource(s.bookSourceUrl, '我');
    testResults.value[s.bookSourceUrl] = r;
  } catch (e: any) {
    testResults.value[s.bookSourceUrl] = {
      sourceUrl: s.bookSourceUrl,
      sourceName: s.bookSourceName,
      ok: false,
      count: 0,
      costMs: 0,
      sample: '',
      error: e?.message || '测试失败',
    };
  }
}

async function importYiove() {
  importUrl.value = 'https://shuyuan-api.yiove.com/import/book-source/82c1edb2-a341-4016-afc7-d6a96fd10cab';
  await doImport();
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-5 pb-24">
    <header class="flex items-center gap-3 py-6">
      <RouterLink to="/online" class="btn !px-3"><ArrowLeft class="w-4 h-4" /></RouterLink>
      <h1 class="text-lg font-semibold">书源管理</h1>
      <button class="btn ml-auto" @click="refresh"><RefreshCw class="w-4 h-4" /> 刷新</button>
    </header>

    <!-- 导入 -->
    <section class="panel rounded-2xl p-4 mb-6">
      <h2 class="text-sm font-medium mb-3 flex items-center gap-2"><Download class="w-4 h-4" /> 导入书源</h2>
      <div class="flex gap-2 mb-2">
        <div class="relative flex-1">
          <Link2 class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-dim" />
          <input
            v-model="importUrl"
            class="input !pl-9"
            placeholder="书源链接(网络导入,如 https://…/shuyuan)"
          />
        </div>
        <button class="btn btn-primary" :disabled="importing" @click="doImport">导入</button>
      </div>
      <textarea
        v-model="importText"
        class="input font-mono text-xs"
        rows="4"
        placeholder="或粘贴书源 JSON 文本(支持 Legado 导出格式,数组或单对象)"
      ></textarea>
      <p v-if="importMsg" class="text-xs mt-2" :class="importMsg.ok ? 'accent' : 'text-red-500'">
        {{ importMsg.text }}
      </p>
      <p class="text-xs text-dim mt-2">
        支持阅读(Legado)书源格式。推荐来源:
        <button class="underline" @click="importYiove">Yiove 书源</button>
        ·
        <a class="underline" href="https://yuedu.xiu2.xyz" target="_blank">XIU2/Yuedu</a>
      </p>
    </section>

    <!-- 书源列表 -->
    <section>
      <h2 class="text-sm font-medium text-dim mb-3">已导入({{ sources.length }})</h2>
      <div v-if="!sources.length" class="text-center py-16 text-dim text-sm">
        还没有书源,先从上方导入
      </div>
      <ul class="space-y-2">
        <li v-for="s in sources" :key="s.bookSourceUrl" class="panel rounded-2xl p-4">
          <div class="flex items-start gap-3">
            <Globe class="w-4 h-4 text-dim shrink-0 mt-1" />
            <div class="min-w-0 flex-1">
              <div class="font-medium flex items-center gap-2">
                <span class="truncate min-w-0">{{ s.bookSourceName }}</span>
                <span v-if="s.bookSourceGroup" class="text-xs text-dim shrink-0">{{ s.bookSourceGroup }}</span>
              </div>
              <div class="text-xs text-dim truncate mt-0.5">{{ s.bookSourceUrl }}</div>

              <!-- 测试结果 -->
              <div v-if="testResults[s.bookSourceUrl] && testResults[s.bookSourceUrl] !== 'testing'" class="mt-2 text-xs flex items-center gap-1.5">
                <template v-if="(testResults[s.bookSourceUrl] as any).ok">
                  <CheckCircle2 class="w-3.5 h-3.5 text-green-600" />
                  <span class="text-green-600">
                    可用 · {{ (testResults[s.bookSourceUrl] as any).count }} 条结果 ·
                    {{ (testResults[s.bookSourceUrl] as any).costMs }}ms
                  </span>
                </template>
                <template v-else>
                  <XCircle class="w-3.5 h-3.5 text-red-500" />
                  <span class="text-red-500 truncate">{{ (testResults[s.bookSourceUrl] as any).error }}</span>
                </template>
              </div>
              <div v-else-if="testResults[s.bookSourceUrl] === 'testing'" class="mt-2 text-xs text-dim">
                测试中…
              </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <button class="btn !px-2.5" title="测试搜索" @click="test(s)"><PlayCircle class="w-4 h-4" /></button>
              <button
                class="btn !px-2.5"
                :title="s.enabled ? '已启用,点击禁用' : '已禁用,点击启用'"
                @click="toggle(s)"
              >
                <span
                  class="relative inline-block w-7 h-4 rounded-full transition-colors shrink-0"
                  :style="{ background: s.enabled ? 'var(--accent)' : 'rgba(128,128,128,.35)' }"
                >
                  <span
                    class="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                    :style="{ left: s.enabled ? '14px' : '2px' }"
                  ></span>
                </span>
                <span class="hidden sm:inline text-xs" :class="s.enabled ? 'accent' : 'text-dim'">{{ s.enabled ? '启用中' : '已禁用' }}</span>
              </button>
              <button class="btn !px-2.5 text-red-500" title="删除" @click="remove(s)">
                <Trash2 class="w-4 h-4" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>