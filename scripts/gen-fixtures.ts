/**
 * 生成测试 TXT(UTF-8 / GBK / Big5 / 数字章节 / 无章节)
 * 用法: bun run scripts/gen-fixtures.ts [输出目录]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';

const outDir = process.argv[2] || './data/novels';
const chapterCount = 30;

function buildChapters(titlePrefix: string, seedText: string): string {
  let text = '';
  for (let i = 1; i <= chapterCount; i++) {
    text += `第${i}章 测试章节${i}\n`;
    for (let p = 0; p < 24; p++) {
      text += `　　${seedText}这是${titlePrefix}第${i}章第${p + 1}段的内容。萧炎缓缓睁开双眼,望着熟悉的房间,少年握紧了拳头。斗气大陆,魔兽纵横,天才少年一夜之间失去所有修为,却在意外的戒指之中发现了一缕古老的灵魂,从此踏上逆天改命的修行之路。药老缓缓说道:斗之力,三段。望着测验魔石碑上闪亮的光辉,萧炎面色平静,内心却泛起波澜。\n`;
    }
    text += '\n';
  }
  return text;
}

mkdirSync(path.join(outDir, '玄幻'), { recursive: true });
mkdirSync(path.join(outDir, '测试'), { recursive: true });

// 1. UTF-8 规范章节
writeFileSync(
  path.join(outDir, '玄幻', '斗破苍穹-测试.txt'),
  buildChapters('斗破', '萧炎望着天空,修炼斗气。药老浮现在戒指之中,缓缓说道。'),
);

// 2. GBK 编码,章节带空格:第 1 章
const gbkText = (() => {
  let t = '';
  for (let i = 1; i <= chapterCount; i++) {
    t += `第 ${i} 章 凡人修仙${i}\n韩立面无表情地走着,心中暗暗思索。修仙之路,漫长无比。\n　　正文内容一段两段三段,灵石与法器。\n\n`;
  }
  return t;
})();
writeFileSync(path.join(outDir, '玄幻', '凡人修仙传-测试.txt'), iconv.encode(gbkText, 'gbk'));

// 3. Big5 编码
const big5Text = (() => {
  let t = '';
  for (let i = 1; i <= chapterCount; i++) {
    t += `\u7b2c${i}\u7ae0 \u5927\u8a71\u897f\u904a${i}\n\u5b6b\u609f\u7a7a\u62ff\u8d77\u91d1\u7b8d\u68d2\uff0c\u5f80\u5929\u908a\u98db\u53bb\u3002\u9019\u4e00\u6bb5\u662f\u7e41\u9ad4\u5167\u5bb9\uff0c\u6e2c\u8a66\u7de8\u78bc\u5075\u6e2c\u3002\n\n`;
  }
  return t;
})();
writeFileSync(path.join(outDir, '测试', '繁体小說-測試.txt'), iconv.encode(big5Text, 'big5'));

// 4. 数字章节 001 标题
let numText = '';
for (let i = 1; i <= chapterCount; i++) {
  numText += `${String(i).padStart(3, '0')} 数字章节${i}\n这是一段正文,用来测试数字章节识别。\n\n`;
}
writeFileSync(path.join(outDir, '测试', '数字章节-测试.txt'), '\ufeff' + numText); // UTF-8 BOM

// 5. 无章节结构的小说
writeFileSync(
  path.join(outDir, '测试', '无章节-测试.txt'),
  Array.from({ length: 50 }, (_, i) => `　　这是一篇没有章节结构的散文第${i}段。风起于青萍之末。`).join('\n'),
);

// 6. 英文 Chapter
let enText = '';
for (let i = 1; i <= chapterCount; i++) {
  enText += `Chapter ${i} The Beginning ${i}\nThis is a paragraph of an English novel. It tests the Chapter rule.\n\n`;
}
writeFileSync(path.join(outDir, '测试', 'English-Novel.txt'), enText);

console.log('fixtures generated at', path.resolve(outDir));