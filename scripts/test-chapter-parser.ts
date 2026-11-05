import assert from 'node:assert/strict';
import iconv from 'iconv-lite';
import { detectChapters } from '../src/server/parser/chapterDetector';

let passed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err: any) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const body = `${'正'.repeat(120)}。\n`;
const longText = `第一章 开始\n${body}第二章 继续\n${body}第三章 结束\n${body}`;
const shortText = `第一章 开始\n正文\n第二章 继续\n正文\n第三章 结束\n正文\n`;

function titles(buf: Buffer, encoding = 'utf-8') {
  return detectChapters(buf, encoding).chapters.map((c) => c.title);
}

check('UTF-8 标准章节', () => {
  const { chapters, bestConfidence } = detectChapters(Buffer.from(longText), 'utf-8');
  assert.equal(chapters.length, 3);
  assert.deepEqual(chapters.map((c) => c.title), ['第一章 开始', '第二章 继续', '第三章 结束']);
  assert.ok(bestConfidence >= 0.9);
});

check('短章节不会被去重合并', () => {
  const chapters = detectChapters(Buffer.from(shortText), 'utf-8').chapters;
  assert.equal(chapters.length, 3);
});

check('ASCII 空格缩进', () => {
  const text = `  第一章 开始\n${body}  第二章 继续\n${body}  第三章 结束\n${body}`;
  assert.equal(detectChapters(Buffer.from(text), 'utf-8').chapters.length, 3);
});

check('全角空格 / Tab 缩进', () => {
  const text = `　　第一章 开始\n${body}\t第二章 继续\n${body}　第三章 结束\n${body}`;
  assert.equal(detectChapters(Buffer.from(text), 'utf-8').chapters.length, 3);
});

check('UTF-8 BOM', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(longText)]);
  const { chapters } = detectChapters(buf, 'utf-8-bom');
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].start_offset, 3);
});

check('GB18030', () => {
  const buf = iconv.encode(longText, 'gb18030');
  assert.equal(detectChapters(buf, 'gb18030').chapters.length, 3);
});

check('Big5', () => {
  const text = `第一章 開始\n${body}第二章 繼續\n${body}第三章 結束\n${body}`;
  const buf = iconv.encode(text, 'big5');
  assert.equal(detectChapters(buf, 'big5').chapters.length, 3);
});

check('CRLF / CR 换行', () => {
  assert.equal(detectChapters(Buffer.from(longText.replace(/\n/g, '\r\n')), 'utf-8').chapters.length, 3);
  assert.equal(detectChapters(Buffer.from(longText.replace(/\n/g, '\r')), 'utf-8').chapters.length, 3);
});

check('数字分隔符:001、标题 / 001.标题', () => {
  const text = `001、开始\n${body}002、继续\n${body}003、结束\n${body}`;
  assert.equal(detectChapters(Buffer.from(text), 'utf-8').chapters.length, 3);
  const text2 = `001.开始\n${body}002.继续\n${body}003.结束\n${body}`;
  assert.equal(detectChapters(Buffer.from(text2), 'utf-8').chapters.length, 3);
});

check('Chapter / Section', () => {
  const text = `Chapter 1 Start\n${body}Section 2 Next\n${body}Chapter 3 End\n${body}`;
  assert.equal(detectChapters(Buffer.from(text), 'utf-8').chapters.length, 3);
});

check('日期/数字行不误判', () => {
  const text = `第一章 开始\n${body}2023 年\n${body}2023\n${body}第二章 继续\n${body}2023 年\n${body}第三章 结束\n${body}`;
  const chapters = detectChapters(Buffer.from(text), 'utf-8').chapters;
  assert.equal(chapters.length, 3);
});

check('开头目录页去重', () => {
  const text = `目录\n第一章 开始\n第二章 继续\n第三章 结束\n\n第一章 开始\n${body}第二章 继续\n${body}第三章 结束\n${body}`;
  const chapters = detectChapters(Buffer.from(text), 'utf-8').chapters;
  assert.equal(chapters.length, 4); // 前言 + 3 章
  assert.equal(chapters[0].title, '前言');
  assert.ok(chapters[1].title.startsWith('第一章'));
  assert.ok(chapters[3].title.startsWith('第三章'));
});

check('前言内容保留', () => {
  const text = `书名:测试\n作者:某某\n\n第一章 开始\n${body}第二章 继续\n${body}`;
  const chapters = detectChapters(Buffer.from(text), 'utf-8').chapters;
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, '前言');
});

check('括号标题', () => {
  const text = `【第1章 标题】\n${body}【第2章 标题】\n${body}【第3章 标题】\n${body}`;
  const chapters = detectChapters(Buffer.from(text), 'utf-8').chapters;
  assert.equal(chapters.length, 3);
  assert.equal(chapters[0].title, '【第1章 标题】');
});

check('卷/章 序号标题', () => {
  const text = `卷一 开始\n${body}卷二 继续\n${body}卷三 结束\n${body}`;
  assert.equal(detectChapters(Buffer.from(text), 'utf-8').chapters.length, 3);
});

check('UTF-16 不分章,交给全文兜底', () => {
  const buf = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    iconv.encode(longText, 'utf-16le'),
  ]);
  const { chapters } = detectChapters(buf, 'utf-16le');
  assert.equal(chapters.length, 0);
});

console.log(`\n✅ chapter parser: ${passed} passed`);
