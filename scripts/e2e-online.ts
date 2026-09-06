/**
 * 端到端验证:真实 Legado 书源 → 导入 → 测试 → 搜索 → 详情 → 目录 → 试读 → 下载入库
 * 用法: bun run scripts/e2e-online.ts [书源URL] [搜索词]
 * 默认: https://shuyuan-api.yiove.com/import/book-source/82c1edb2-a341-4016-afc7-d6a96fd10cab
 * 注意:使用真实站点,依赖网络可达。
 */
import { rmSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8099';
const PORT = '8099';
const TMP = '/tmp/inovel-online-e2e';
const SOURCE_URL = process.argv[2] || 'https://shuyuan-api.yiove.com/import/book-source/82c1edb2-a341-4016-afc7-d6a96fd10cab';
const SEARCH_KEYWORD = process.argv[3] || '故事';

let failures = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

async function api<T = any>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

async function waitHealth(timeoutMs = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) });
      if (r.ok) return true;
    } catch {}
    await Bun.sleep(400);
  }
  return false;
}

// ---------- 环境 ----------
rmSync(TMP, { recursive: true, force: true });
mkdirSync(`${TMP}/novels`, { recursive: true });
mkdirSync(`${TMP}/data`, { recursive: true });

const server = Bun.spawn({
  cmd: ['bun', 'src/server/index.ts'],
  env: { ...process.env, PORT, NOVELS_DIR: `${TMP}/novels`, DATA_DIR: `${TMP}/data` },
  stdout: 'pipe',
  stderr: 'pipe',
});
let serverLog = '';
const logReader = (async () => {
  const reader = server.stderr.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    serverLog += dec.decode(value);
  }
})();
const stdoutReader = (async () => {
  const reader = server.stdout.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    serverLog += dec.decode(value);
  }
})();

process.on('exit', () => server.kill());

try {
  ok('服务启动', await waitHealth());

  // 1. 导入真实书源
  const srcRes = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(30_000) });
  const sourceText = await srcRes.text();
  ok('拉取真实书源 JSON', sourceText.includes('bookSourceUrl'), `${sourceText.length} bytes`);
  const imp = await api('/api/online/sources/import', { method: 'POST', body: JSON.stringify({ text: sourceText }) });
  ok('导入书源', imp.status === 200 && imp.data?.added >= 1, JSON.stringify(imp.data));
  ok('拉取源名称', sourceText.includes('bookSourceName'), SOURCE_URL.slice(-20));

  const list = (await api('/api/online/sources')).data.sources;
  ok('书源列表', list.length >= 1, JSON.stringify(list.map((s: any) => s.bookSourceName)));
  const SOURCE = list[0].bookSourceUrl;
  const SOURCE_NAME = list[0].bookSourceName;

  // 2. 书源连通性测试
  const test = (await api('/api/online/sources/test', {
    method: 'POST',
    body: JSON.stringify({ sourceUrl: SOURCE, keyword: SEARCH_KEYWORD }),
  })).data;
  ok('书源测试成功', test.ok === true, `count=${test.count} cost=${test.costMs}ms err=${test.error ?? ''} sample=${test.sample}`);

  // 3. 多源搜索
  const search = (await api(`/api/online/search?q=${encodeURIComponent(SEARCH_KEYWORD)}`)).data;
  const okSource = (search.results ?? []).find((r: any) => r.sourceUrl === SOURCE && !r.error);
  ok('在线搜索有结果', (okSource?.books?.length ?? 0) >= 3, `共 ${search.total} 条,来自 ${(search.results ?? []).length} 个源`);

  // 4. 详情
  const firstBook = okSource.books.find((b: any) => b.bookUrl);
  const info = (await api(`/api/online/book?source=${encodeURIComponent(SOURCE)}&bookUrl=${encodeURIComponent(firstBook.bookUrl)}`)).data;
  ok('详情:书名', (info.info?.name ?? '').length > 0, info.info?.name);
  ok('详情:简介', (info.info?.intro ?? '').length > 0, `${(info.info?.intro ?? '').length} 字`);
  ok('详情:目录地址', (info.info?.tocUrl ?? '').length > 0);

  // 5. 目录
  const toc = (await api(`/api/online/toc?source=${encodeURIComponent(SOURCE)}&bookUrl=${encodeURIComponent(firstBook.bookUrl)}`)).data;
  ok('目录章节 ≥ 1', (toc.chapters?.length ?? 0) >= 1, `${toc.chapters?.length} 章`);
  const chapter1 = toc.chapters[0];
  ok('目录:章节标题', (chapter1.title ?? '').length > 0, chapter1.title);

  // 6. 试读正文
  const content = (await api(
    `/api/online/content?source=${encodeURIComponent(SOURCE)}&url=${encodeURIComponent(chapter1.url)}&title=${encodeURIComponent(chapter1.title)}`,
  )).data;
  ok('试读正文 > 200 字', (content.content ?? '').length > 200, `${(content.content ?? '').length} 字`);

  // 7. 下载为 TXT 入库
  const dl = (await api('/api/online/download', {
    method: 'POST',
    body: JSON.stringify({ source: SOURCE, bookUrl: firstBook.bookUrl }),
  })).data;
  ok('创建下载任务', dl.ok === true && dl.task?.id, dl.task?.id);

  let task = dl.task;
  const t0 = Date.now();
  while (Date.now() - t0 < 180_000) {
    await Bun.sleep(1500);
    const tasks = (await api('/api/online/tasks')).data.tasks;
    task = tasks.find((t: any) => t.id === dl.task.id);
    if (['done', 'error', 'canceled'].includes(task.status)) break;
  }
  ok('下载完成', task.status === 'done', `status=${task.status} ${task.finished}/${task.total} ${task.error ?? ''}`);
  ok('下载入库 bookId', (task.bookId ?? 0) > 0, `bookId=${task.bookId}`);

  // 8. 复用现有阅读器全链路验证
  const books = (await api('/api/books')).data.books;
  const localBook = books.find((b: any) => b.id === task.bookId);
  ok('书库中能找到下载的书', !!localBook, localBook ? `${localBook.title} / ${localBook.category} / ${localBook.chapter_count} 章` : '未找到');
  const chapters = (await api(`/api/books/${task.bookId}/chapters`)).data.chapters;
  ok('本地章节已索引', chapters.length >= 1, `${chapters.length} 章,第一章: ${chapters[0]?.title}`);
  const ch = (await api(`/api/books/${task.bookId}/chapters/0/content`)).data;
  ok('本地正文可读', (ch.content ?? '').length > 10, `${(ch.content ?? '').length} 字(第1章)`);
  // 本地章节内容包含标题行(本站 TXT 索引从标题行起算),故用包含关系校验
  // 合集帖正文可能自带内嵌章节标题(如 第五章),本地会被拆成多章,故取前 3 章聚合校验
  let localNorm = '';
  for (const c of chapters.slice(0, 3)) {
    const cc = await api(`/api/books/${task.bookId}/chapters/${c.chapter_index}/content`);
    localNorm += (cc.data.content ?? '').replace(/\s+/g, '');
  }
  const sampleOnline = (content.content ?? '').replace(/\s+/g, '').slice(0, 20);
  ok('本地正文包含在线试读内容', localNorm.includes(sampleOnline), `采样=[${sampleOnline}] 本地前3章=${localNorm.length} 字`);

  // 9. 进度保存(在线书与本地书统一)
  const prog = await api(`/api/progress/${task.bookId}`, {
    method: 'PUT',
    body: JSON.stringify({ chapter_index: 0, page: 0, progress: 0.5 }),
  });
  ok('阅读进度保存', prog.status === 200);
} catch (e: any) {
  failures++;
  console.log('✗ e2e 异常中断:', e?.message || e);
} finally {
  server.kill();
  await Bun.sleep(500);
  if (failures > 0) {
    console.log('\n----- server log(尾部)-----');
    console.log(serverLog.slice(-3000));
  }
}

console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);