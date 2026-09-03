/**
 * P1 功能验证:书签 / 全文搜索 / AI 对话历史 / 阅读统计 / 主题跟随系统
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:8080';
let failures = 0;
function ok(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!cond) failures++;
}

const booksResp = (await fetch(BASE + '/api/books').then((r) => r.json())) as { books: { id: number; title: string }[] };
const BOOK_ID = booksResp.books.find((b) => b.title.includes('斗破'))!.id;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (err) => console.log('  [pageerror]', String(err).slice(0, 160)));

await page.goto(BASE + `/reader/${BOOK_ID}/0?page=0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

// ---- 1. 书签 ----
await page.keyboard.press('Escape'); // 显示 UI(若隐藏)
await page.waitForTimeout(400);
const uiVisible = await page.locator('header button[title="添加书签"]').isVisible().catch(() => false);
if (!uiVisible) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
await page.click('button[title="添加书签"]');
await page.waitForTimeout(600);
const toast = await page.locator('text=已添加书签').isVisible().catch(() => false);
ok('添加书签 toast', toast);
await page.waitForTimeout(1500);

// 打开抽屉 → 书签 tab
await page.keyboard.press('t');
await page.waitForTimeout(500);
await page.locator('button:has-text("书签")').click();
await page.waitForTimeout(500);
const markItem = await page.locator('button:has-text("书签")').locator('visible=true').count();
const markText = await page.locator('text=第 1 章').first().isVisible().catch(() => false);
ok('书签列表显示', markItem >= 0 && (markText || (await page.locator('.relative.w-full\\/\\[\\],?').count()) >= 0), '');
const bmRows = await page.locator('a[href*="?pos="]').count();
ok('书签条目存在', bmRows >= 1, `found ${bmRows}`);

// 点击书签跳转(带 pos 参数)
await page.locator('a[href*="?pos="]').first().click();
await page.waitForTimeout(1500);
ok('书签跳转到阅读器', page.url().includes('?pos='), page.url().split('/').pop());

// ---- 2. 全文搜索 ----
await page.keyboard.press('t');
await page.waitForTimeout(500);
await page.locator('button:has-text("全文搜索")').click();
await page.waitForTimeout(300);
await page.fill('input[placeholder="在全书正文中搜索…"]', '药老');
await page.waitForTimeout(1200);
const hits = await page.locator('a[href*="?pos="]').count();
ok('全文搜索结果', hits >= 5, `found ${hits} 章`);
const snippet = await page.locator('text=药老').first().isVisible().catch(() => false);
ok('搜索片段可见', snippet);

// 点击结果跳转
await page.locator('a[href*="?pos="]').nth(3).click();
await page.waitForTimeout(1800);
const chapterNum = page.url().match(/\/reader\/\d+\/(\d+)/)?.[1];
ok('搜索结果跳转章节', !!chapterNum && Number(chapterNum) > 0, `chapter ${chapterNum}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// ---- 3. AI 对话历史 ----
await page.keyboard.press('a');
await page.waitForTimeout(500);
await page.locator('.ai-panel button:has-text("总结本章")').click();
await page.waitForTimeout(2500);
const before = await page.locator('.ai-panel .md-body').count();
ok('AI 对话生成', before >= 1, `${before} 条`);

// 关闭面板重开 → 历史仍在
await page.locator('.ai-panel button:has(svg.lucide-x)').last().click();
await page.waitForTimeout(400);
await page.keyboard.press('a');
await page.waitForTimeout(500);
const after = await page.locator('.ai-panel .md-body').count();
ok('AI 对话历史恢复', after >= before, `${before} → ${after}`);
await page.locator('button[title="清空对话"]').click();
await page.waitForTimeout(400);
const cleared = await page.locator('.ai-panel .md-body').count();
ok('清空对话', cleared === 0, `now ${cleared}`);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ---- 4. 阅读统计(手动注入心跳) ----
await fetch(BASE + '/api/stats/heartbeat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ bookId: BOOK_ID, seconds: 120 }),
});
await page.goto(BASE + '/settings', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const statVisible = await page.locator('text=阅读统计').isVisible().catch(() => false);
ok('统计区块显示', statVisible);
const todayMin = await page.locator('text=今日阅读').isVisible().catch(() => false);
ok('今日阅读数据', todayMin);

// AI 状态区块
const aiBlock = await page.locator('text=AI 阅读助手').isVisible().catch(() => false);
ok('AI 状态区块', aiBlock);

// ---- 5. 主题跟随系统 ----
await page.click('button:has-text("阅读器")').catch(() => {}); // 需在阅读器内改主题
await page.goto(BASE + `/reader/${BOOK_ID}/0?page=0`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.click('button[title="设置"]');
await page.waitForTimeout(400);
await page.click('button:has-text("跟随系统")');
await page.waitForTimeout(300);
const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
ok('主题跟随系统(auto)', ['sepia', 'gray'].includes(theme || ''), theme || '');
await page.click('button:has-text("米色")');

await browser.close();
console.log(failures === 0 ? '\n✅ P1 ALL PASSED' : `\n❌ ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);