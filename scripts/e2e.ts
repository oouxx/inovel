/**
 * 端到端验证:书架 → 详情 → 阅读器分页 → 进度恢复 → 搜索 → AI → 设置
 * 用法: bun run scripts/e2e.ts
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080';
let failures = 0;

function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => {
  console.log('  [pageerror]', String(err).slice(0, 200));
});

// 1. 书架
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
ok('书架页标题', (await page.textContent('h1'))?.includes('我的书架') || false);
await page.waitForTimeout(800);
const bookCards = await page.locator('.book-cover').count();
ok('书架显示书籍', bookCards >= 6, `found ${bookCards}`);

// 2. 搜索
await page.goto(BASE + '/search', { waitUntil: 'networkidle' });
await page.fill('input.input', '斗破');
await page.click('button[type=submit]');
await page.waitForTimeout(800);
const searchHit = await page.locator('li').count();
ok('搜索"斗破"有结果', searchHit >= 1, `found ${searchHit}`);

// 动态查找"斗破"的 bookId
const booksResp = await fetch(BASE + '/api/books').then((r) => r.json()) as { books: { id: number; title: string }[] };
const target = booksResp.books.find((b) => b.title.includes('斗破'))!;
const BOOK_ID = target.id;
console.log(`  (斗破 bookId = ${BOOK_ID})`);

// 3. 详情页
await page.goto(BASE + `/books/${BOOK_ID}`, { waitUntil: 'networkidle' });
const detailTitle = await page.textContent('h2');
ok('详情页书名', detailTitle!.includes('斗破'), detailTitle || '');
const chapterCount = await page.locator('ul li').count();
ok('目录章节数', chapterCount >= 30, `found ${chapterCount}`);

// 4. 阅读器:分页 + 翻页(?page=0 强制从第 0 页开始)
await page.goto(BASE + `/reader/${BOOK_ID}/0?page=0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const title0 = await page.locator('.rtitle').textContent();
ok('阅读器章节标题', !!title0 && title0.includes('第1章'), title0 || '');
const paras = await page.locator('.reader-content p').count();
ok('正文段落渲染', paras >= 10, `found ${paras}`);

// 初始 UI 可见(3.5s 内)
ok('底栏初始可见', await page.locator('footer').isVisible());

// 记录初始进度,翻页(多页章节)
const p0 = await page.locator('footer span.tabular-nums').textContent();
await page.keyboard.press('ArrowRight');
await page.waitForTimeout(500);
const p1 = await page.locator('footer span.tabular-nums').textContent();
ok('翻页后进度变化', p0 !== p1, `${p0} → ${p1}`);

// 5. 进度保存与恢复:回到同章节 URL,应恢复到第 1 页后的位置
await page.waitForTimeout(700); // 等待 debounce 保存
await page.goto(BASE + `/reader/${BOOK_ID}/0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const p2 = await page.locator('footer span.tabular-nums').textContent();
ok('重开恢复进度', p1 === p2, `${p2} (期望 ${p1})`);

// 6. 键盘翻页到下一章
await page.keyboard.press('Escape'); // 此时 UI 可见 → 隐藏
await page.waitForTimeout(300);
ok('Esc 隐藏 UI', !(await page.locator('footer').isVisible()));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
ok('再 Esc 显示 UI', await page.locator('footer').isVisible());

// 7. 目录抽屉
await page.keyboard.press('t');
await page.waitForTimeout(500);
ok('目录抽屉打开(T)', await page.locator('input[placeholder="搜索章节…"]').isVisible());
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// 8. AI 面板:未配置 → 提示
await page.keyboard.press('a');
await page.waitForTimeout(500);
ok('AI 面板打开(A)', await page.locator('.ai-panel').isVisible());
await page.locator('.ai-panel button:has-text("总结本章")').click();
await page.waitForTimeout(1200);
const aiMsg = await page.locator('.ai-panel').textContent();
// 未配置 → 提示;已配置(mock/真实)→ 正常总结输出
const aiOk = aiMsg?.includes('未配置') || aiMsg?.includes('剧情概述') || false;
ok('AI 面板响应正常(提示或总结)', aiOk);
await page.keyboard.press('Escape'); // 关闭 AI 面板
await page.waitForTimeout(400);

// 9. 设置面板
await page.click('button[title="设置"]');
await page.waitForTimeout(400);
ok('阅读设置面板', await page.locator('text=阅读设置').isVisible());

// 主题切换
await page.click('button:has-text("纯黑")');
await page.waitForTimeout(300);
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
ok('主题切换到黑色', theme === 'black', theme || '');
await page.click('button:has-text("米色")');

// 滚动模式切换
await page.click('button:has-text("滚动")');
await page.waitForTimeout(600);
const scrollable = await page.evaluate(() => {
  const el = document.querySelector('.flex-1.relative') as HTMLElement | null;
  return el ? el.scrollHeight > el.clientHeight + 100 : false;
});
ok('滚动模式可滚动', scrollable);
await page.click('button:has-text("分页")').catch(() => {});

// 10. 手机视口
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(BASE + `/reader/${BOOK_ID}/0`, { waitUntil: 'networkidle' });
await mobile.waitForTimeout(1500);
const mTitle = await mobile.locator('.rtitle').textContent();
ok('手机端阅读器', !!mTitle && mTitle.includes('第1章'), mTitle || '');

// 手机书架
await mobile.goto(BASE + '/', { waitUntil: 'networkidle' });
await mobile.waitForTimeout(600);
ok('手机端书架', (await mobile.locator('.book-cover').count()) >= 6);

await browser.close();
console.log(failures === 0 ? '\n✅ ALL PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);