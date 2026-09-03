import { readFileSync } from 'node:fs';
import { detectEncoding } from '../src/server/parser/encoding';
import { detectChapters } from '../src/server/parser/chapterDetector';

const files = [
  '/tmp/novel-test/玄幻/斗破苍穹-测试.txt',
  '/tmp/novel-test/玄幻/凡人修仙传-测试.txt',
  '/tmp/novel-test/测试/繁体小說-測試.txt',
  '/tmp/novel-test/测试/数字章节-测试.txt',
  '/tmp/novel-test/测试/无章节-测试.txt',
  '/tmp/novel-test/测试/English-Novel.txt',
];

for (const f of files) {
  const buf = readFileSync(f);
  const enc = detectEncoding(buf);
  const { chapters, bestConfidence } = detectChapters(buf, enc);
  console.log('---', f.split('/').pop());
  console.log('  encoding:', enc, '| chapters:', chapters.length, '| best conf:', bestConfidence.toFixed(2));
  if (chapters.length) {
    console.log('  first:', JSON.stringify(chapters[0].title), 'conf', chapters[0].confidence.toFixed(2));
    console.log('  last :', JSON.stringify(chapters[chapters.length-1].title), 'conf', chapters[chapters.length-1].confidence.toFixed(2));
  }
}
