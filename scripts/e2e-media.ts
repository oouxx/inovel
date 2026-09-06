/**
 * 端到端验证:音频(源类型1)/ 漫画(源类型2)在线书架全链路
 * 本地 mock 两种源 → 导入 → 搜索(sourceType)→ 加入书架 → 媒体解析 → 图片/音频代理 → 进度
 * 用法: bun run scripts/e2e-media.ts
 */
import { rmSync, mkdirSync } from 'node:fs';

const BASE = 'http://127.0.0.1:8099';
const MOCK = 'http://127.0.0.1:8097';
const PORT = '8099';
const TMP = '/tmp/inovel-media-e2e';
const COMIC_SRC = `${MOCK}/comic`;
const AUDIO_SRC = `${MOCK}/audio`;

let failures = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

async function api<T = any>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const res = await fetch(BASE + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  let data: any = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const dec = encodeURIComponent;

// ---------- mock 站点 ----------
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 0x61)]);
const MP3 = Buffer.concat([Buffer.from('ID3MOCKAUDIODATA'), Buffer.alloc(256, 0x55)]);
const CHAPTERS = 3;

const mock = Bun.serve({
  port: 8097,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const html = (s: string) =>
      new Response(`<!DOCTYPE html><html><head><meta charset="utf-8">${s}</head><body></body></html>`, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });

    if (p === '/comic/search') {
      const kw = url.searchParams.get('keyword') || '';
      const names = kw === '斗' ? ['斗罗漫画', '斗破漫画'] : ['斗罗漫画'];
      return html(`<div class="list">${names
        .map((n, i) => `<div class="item"><a href="/comic/book/${i + 1}">${n}</a><span class="author">画师${i + 1}</span></div>`)
        .join('')}</div>`);
    }
    if (p.startsWith('/comic/book/')) {
      const id = p.split('/')[3];
      return html(
        `<meta property="og:title" content="斗罗漫画${id}"/><meta property="og:novel:author" content="画师${id}"/><meta property="og:image" content="/img/cover.jpg"/><a class="toc-link" href="/comic/toc/${id}">目录</a>`,
      );
    }
    if (p.startsWith('/comic/toc/')) {
      return html(
        `<ul class="chapters">${Array.from({ length: CHAPTERS }, (_, i) => `<li><a href="/comic/ch/${i + 1}">第${i + 1}话 测试话</a></li>`).join('')}</ul>`,
      );
    }
    if (p.startsWith('/comic/ch/')) {
      const n = Number(p.split('/')[3]);
      return html(`<div id="pics"><img src="/img/${n}-1.jpg"/><img src="/img/${n}-2.jpg"/></div>`);
    }
    if (p.startsWith('/img/')) {
      // 防盗链:必须携带本站 Referer
      const ref = req.headers.get('referer') || '';
      if (!ref.includes('127.0.0.1:8097')) return new Response('forbidden', { status: 403 });
      return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } });
    }
    if (p === '/audio/search') return Response.json({ data: [{ id: 1, name: '斗罗有声书', author: '主播甲' }] });
    if (p.startsWith('/audio/book/')) return Response.json({ result: { id: 1, name: '斗罗有声书', author: '主播甲' } });
    if (p.startsWith('/audio/chapters/'))
      return Response.json({ data: Array.from({ length: CHAPTERS }, (_, i) => ({ id: i + 1, title: `第${i + 1}集 有声测试` })) });
    if (p.startsWith('/audio/media/')) return Response.json({ data: { url: `/audio/file/${p.split('/')[3]}.mp3` } });
    if (p.startsWith('/audio/file/')) {
      const range = req.headers.get('range');
      if (range) {
        const m = range.match(/bytes=(\d+)-(\d*)/)!;
        const start = Number(m[1]);
        const end = m[2] ? Number(m[2]) : MP3.length - 1;
        const slice = MP3.subarray(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Range': `bytes ${start}-${end}/${MP3.length}`,
            'Content-Length': String(slice.length),
            'Accept-Ranges': 'bytes',
          },
        });
      }
      return new Response(MP3, {
        headers: { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Content-Length': String(MP3.length) },
      });
    }
    return new Response('not found', { status: 404 });
  },
});

// ---------- 被测服务 ----------
rmSync(TMP, { recursive: true, force: true });
mkdirSync(`${TMP}/novels`, { recursive: true });
mkdirSync(`${TMP}/data`, { recursive: true });
const app = Bun.spawn({
  cmd: ['bun', 'src/server/index.ts'],
  env: { ...process.env, PORT, NOVELS_DIR: `${TMP}/novels`, DATA_DIR: `${TMP}/data` },
  stdout: 'pipe',
  stderr: 'pipe',
});
process.on('exit', () => app.kill());
let appLog = '';
(async () => {
  const dec = new TextDecoder();
  for (const stream of [app.stdout, app.stderr]) {
    (async () => {
      const reader = stream.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        appLog += dec.decode(value);
      }
    })();
  }
})();
async function waitHealth() {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(1500) })).ok) return true;
    } catch {}
    await Bun.sleep(400);
  }
  return false;
}

const SOURCES_JSON = JSON.stringify([
  {
    bookSourceName: 'Mock漫画',
    bookSourceUrl: `${MOCK}/comic`,
    bookSourceType: 2,
    enabled: true,
    searchUrl: '/comic/search?keyword={{key}}&page={{page}}',
    ruleSearch: { bookList: 'class.item', name: 'tag.a.0@text', author: 'class.author.0@text', bookUrl: 'tag.a.0@href' },
    ruleBookInfo: {
      name: '//meta[@property="og:title"]/@content',
      author: '//meta[@property="og:novel:author"]/@content',
      coverUrl: '//meta[@property="og:image"]/@content',
      tocUrl: 'class.toc-link.0@href',
    },
    ruleToc: { chapterList: 'class.chapters.0@tag.li', chapterName: 'tag.a.0@text', chapterUrl: 'tag.a.0@href' },
    ruleContent: { content: '@css:#pics img@src' },
  },
  {
    bookSourceName: 'Mock音频',
    bookSourceUrl: `${MOCK}/audio`,
    bookSourceType: 1,
    enabled: true,
    searchUrl: '/audio/search?q={{key}}&page={{page}}',
    ruleSearch: { bookList: '$.data[*]', name: '$.name', author: '$.author', bookUrl: '$.id@js:"http://127.0.0.1:8097/audio/book/"+result' },
    ruleBookInfo: { name: '$.result.name', author: '$.result.author', tocUrl: '$.result.id@js:"http://127.0.0.1:8097/audio/chapters/"+result' },
    ruleToc: { chapterList: '$.data[*]', chapterName: '$.title', chapterUrl: '$.id@js:"http://127.0.0.1:8097/audio/media/"+result' },
    ruleContent: { content: '$.data.url' },
  },
]);

try {
  ok('服务启动', await waitHealth());

  const imp = await api('/api/online/sources/import', { method: 'POST', body: JSON.stringify({ text: SOURCES_JSON }) });
  ok('导入音频/漫画书源', imp.status === 200 && imp.data?.added === 2, JSON.stringify(imp.data));

  const search = (await api(`/api/online/search?q=${encodeURIComponent('斗')}`)).data;
  const comicR = search.results.find((r: any) => r.sourceName === 'Mock漫画');
  const audioR = search.results.find((r: any) => r.sourceName === 'Mock音频');
  ok('漫画源搜索', comicR?.books?.length === 2, `${comicR?.books?.length} 条`);
  ok('音频源搜索', audioR?.books?.length === 1, `${audioR?.books?.length} 条`);
  ok('结果携带 sourceType', comicR?.sourceType === 2 && audioR?.sourceType === 1, `漫画=${comicR?.sourceType} 音频=${audioR?.sourceType}`);

  // 漫画加入书架(服务端抓目录)
  const comicAdd = (
    await api('/api/online/library', {
      method: 'POST',
      body: JSON.stringify({ source: COMIC_SRC, bookUrl: `${MOCK}/comic/book/1`, name: '斗罗漫画1', author: '画师1', coverUrl: '', sourceType: 2 }),
    })
  ).data;
  ok('漫画加入书架(目录 3 章)', comicAdd.ok === true && comicAdd.book?.chapterCount === CHAPTERS, `chapters=${comicAdd.book?.chapterCount}`);

  // 音频加入书架
  const audioAdd = (
    await api('/api/online/library', {
      method: 'POST',
      body: JSON.stringify({ source: AUDIO_SRC, bookUrl: `${MOCK}/audio/book/1`, name: '斗罗有声书', author: '主播甲', coverUrl: '', sourceType: 1 }),
    })
  ).data;
  ok('音频加入书架', audioAdd.ok === true && audioAdd.book?.chapterCount === CHAPTERS);

  const shelf = (await api('/api/online/library')).data.books;
  ok('书架列表(2 本,带类型)', shelf.length === 2 && shelf.some((b: any) => b.sourceType === 2) && shelf.some((b: any) => b.sourceType === 1));

  // 媒体解析:漫画 → 2 张图片
  const media1 = (
    await api(`/api/online/media?source=${dec(COMIC_SRC)}&url=${dec(MOCK + '/comic/ch/1')}&title=第1话&name=斗罗漫画1`)
  ).data;
  ok('漫画媒体解析 kind=image', media1?.kind === 'image');
  ok('漫画解析出 2 张图', media1?.items?.length === 2, JSON.stringify(media1?.items));

  // 图片代理:防盗链 Referer + 字节透传
  const imgRes = await fetch(
    `${BASE}/api/online/img?u=${dec(MOCK + '/img/1-1.jpg')}&source=${dec(COMIC_SRC)}&ref=${dec(MOCK + '/comic/ch/1')}`,
  );
  const imgBuf = new Uint8Array(await imgRes.arrayBuffer());
  ok('图片代理 200 + image/jpeg', imgRes.status === 200 && (imgRes.headers.get('content-type') || '').includes('image/jpeg'));
  ok('图片代理透传字节(JPEG 头)', imgBuf[0] === 0xff && imgBuf[1] === 0xd8);
  const noRef = await fetch(`${BASE}/api/online/img?u=${dec(MOCK + '/img/1-1.jpg')}&source=${dec(COMIC_SRC)}`);
  ok('未带 Referer 时源站防盗链生效(502 透传)', noRef.status === 502);

  // 音频媒体解析 + 代理 + Range
  const audioMedia = (
    await api(`/api/online/media?source=${dec(AUDIO_SRC)}&url=${dec(MOCK + '/audio/media/1')}&title=第1集&name=斗罗有声书`)
  ).data;
  ok('音频媒体解析 kind=audio', audioMedia?.kind === 'audio' && audioMedia?.items?.length === 1, JSON.stringify(audioMedia?.items));
  const audioRes = await fetch(`${BASE}/api/online/audio?u=${dec(audioMedia.items[0])}&source=${dec(AUDIO_SRC)}&ref=x`);
  const audioBuf = new Uint8Array(await audioRes.arrayBuffer());
  ok('音频代理 200 + audio/mpeg', audioRes.status === 200 && (audioRes.headers.get('content-type') || '').includes('audio'));
  ok('音频代理字节完整', audioBuf.length === MP3.length);
  const rangeRes = await fetch(`${BASE}/api/online/audio?u=${dec(audioMedia.items[0])}&source=${dec(AUDIO_SRC)}`, {
    headers: { Range: 'bytes=0-9' },
  });
  ok('音频 Range 透传 206', rangeRes.status === 206 && (rangeRes.headers.get('content-range') || '').includes('bytes 0-9/'));

  // 进度
  await api(`/api/online/progress/${comicAdd.book.id}`, { method: 'PUT', body: JSON.stringify({ chapter_index: 2, position: 0.8 }) });
  const pr = (await api(`/api/online/progress/${comicAdd.book.id}`)).data.progress;
  ok('漫画进度保存/读取', pr?.chapter_index === 2 && pr?.position === 0.8, JSON.stringify(pr));
  await api(`/api/online/progress/${audioAdd.book.id}`, { method: 'PUT', body: JSON.stringify({ chapter_index: 1, position: 45.5 }) });
  const shelf2 = (await api('/api/online/library')).data.books;
  const a2 = shelf2.find((b: any) => b.id === audioAdd.book.id);
  ok('书架携带进度', a2?.progress?.chapter_index === 1, JSON.stringify(a2?.progress));

  // 音频源拒绝下载(引导书架)
  const dl = await api('/api/online/download', { method: 'POST', body: JSON.stringify({ source: AUDIO_SRC, bookUrl: `${MOCK}/audio/book/1` }) });
  ok('音频源拒绝下载(引导书架)', dl.status === 400 && String(dl.data.error).includes('书架'), JSON.stringify(dl.data));
} catch (e: any) {
  failures++;
  console.log('✗ e2e 异常中断:', e?.message || e);
} finally {
  app.kill();
  mock.stop(true);
  await Bun.sleep(300);
  if (failures > 0) {
    console.log('\n----- server log -----');
    console.log(appLog.slice(-2000));
  }
}
console.log(failures === 0 ? '\n✅ 全部通过' : `\n❌ ${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);