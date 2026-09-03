import iconv from 'iconv-lite';

/**
 * TXT 编码检测:
 * 1. BOM 检测 (UTF-8 / UTF-16LE / UTF-16BE)
 * 2. 严格 UTF-8 序列验证(采样:开头 / 中间 / 结尾)
 * 3. GB18030 vs Big5 启发式(简体/繁体高频字命中率 + 假名惩罚)
 * 失败返回 unknown
 */

// 简体高频字(GBK 典型)
const SIMPLIFIED_COMMON =
  '的一是了我不人在他有这上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感';
// 繁体高频字(Big5 典型)
const TRADITIONAL_COMMON =
  '的一是了我不人在他有這上們來到時大地為子中你說生國年著就那和要她出也得裡後自以會家可下而過天去能對小多然於心學麼之都好看起發當沒成只如事把還用第樣道想作種開美總從無情己面最女但現前些所同日手又行意動方期它頭經長兒回位分愛老因很給名法間斯知世什兩次使身者被高已親其進此話常與活正感';
// 日文假名 —— Big5 解码 GBK 文本时极易大量出现
const KANA = /[\u3040-\u30ff]/g;
// 常见简体标点,GBK 全角区解码正常,Big5 解码会变成乱符号
const SIMPLIFIED_PUNCT = /[，。、！？；：""''（）《》……——]/g;

const SIM_SET = new Set(SIMPLIFIED_COMMON.split(''));
const TRAD_SET = new Set(TRADITIONAL_COMMON.split(''));

export type SampledBuffer = Buffer;

/** 严格验证字节序列是否为合法 UTF-8。
 *  skipHead:跳过开头的孤立续字节(采样段切割可能截断字符)
 *  allowTruncTail:末尾字符被截断时视为合法(采样段结束处) */
export function isValidUtf8(buf: Buffer, skipHead = false, allowTruncTail = false): boolean {
  const n = buf.length;
  let i = 0;
  if (skipHead) {
    let skip = 0;
    while (i < n && skip < 3 && (buf[i] & 0xc0) === 0x80) {
      i++;
      skip++;
    }
  }
  while (i < n) {
    const b = buf[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return false;
    if (i + need >= n) {
      // 末尾字符被采样截断
      return allowTruncTail;
    }
    for (let k = 1; k <= need; k++) {
      const cb = buf[i + k];
      if (cb < 0x80 || cb > 0xbf) return false;
    }
    // 排除过短编码(E0 后第二字节须 A0-BF,F0 后第二字节须 90-BF)
    if (b === 0xe0 && buf[i + 1] < 0xa0) return false;
    if (b === 0xf0 && buf[i + 1] < 0x90) return false;
    i += need + 1;
  }
  return true;
}

/** 分段采样严格验证:头 / 中 / 尾三段,段边界对齐字符边界 */
function isLikelyUtf8(buf: Buffer): boolean {
  const n = buf.length;
  if (n <= 1024 * 1024) return isValidUtf8(buf);

  const alignForward = (pos: number): number => {
    let i = pos;
    let skip = 0;
    while (i < n && skip < 3 && (buf[i] & 0xc0) === 0x80) {
      i++;
      skip++;
    }
    return i;
  };

  const head = buf.subarray(0, Math.min(512 * 1024, n));
  const midStart = alignForward(Math.max(0, Math.floor(n / 2) - 256 * 1024));
  const mid = buf.subarray(midStart, Math.min(midStart + 512 * 1024, n));
  const tailStart = alignForward(Math.max(0, n - 128 * 1024));
  const tail = buf.subarray(tailStart);

  return (
    isValidUtf8(head, false, true) &&
    isValidUtf8(mid, true, true) &&
    isValidUtf8(tail, true, false)
  );
}

export function detectEncoding(buf: Buffer): string {
  // 1) BOM
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return 'utf-8-bom';
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'utf-16le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'utf-16be';

  // 2) 严格 UTF-8 验证(分段采样,边界对齐)
  if (isLikelyUtf8(buf)) return 'utf-8';

  // 3) GB18030 / Big5 启发式(用头部样本解码评分)
  const sample = buf.subarray(0, Math.min(512 * 1024, buf.length));
  const gbkText = iconv.decode(sample, 'gb18030');
  const big5Text = iconv.decode(sample, 'big5');
  const gbkScore = scoreChinese(gbkText, SIM_SET, true);
  const big5Score = scoreChinese(big5Text, TRAD_SET, false);

  if (gbkScore > big5Score * 1.05) return 'gb18030';
  if (big5Score > gbkScore * 1.05) return 'big5';
  // 接近时默认 gb18030(GB18030 兼容 GBK,大陆 TXT 最常见)
  if (gbkScore >= 0.2) return 'gb18030';
  return 'unknown';
}

function scoreChinese(text: string, set: Set<string>, isSimplified: boolean): number {
  let han = 0;
  let hit = 0;
  let kana = 0;
  let punct = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 0x4e00 && code <= 0x9fff) {
      han++;
      if (set.has(ch)) hit++;
    } else if (code >= 0x3040 && code <= 0x30ff) {
      kana++;
    } else if (SIMPLIFIED_PUNCT.test(ch)) {
      punct++;
    }
  }
  if (han === 0) return 0;
  const hanRatio = han / Math.max(1, (text.match(/[\s\S]/gu) || []).length);
  let score = (hit / han) * (0.6 + 0.4 * Math.min(1, hanRatio * 8));
  if (!isSimplified) {
    // Big5 解码简体文本 → 大量假名与错误标点,重罚
    score *= Math.max(0.05, 1 - (kana / Math.max(1, han)) * 5 - (punct / Math.max(1, han)) * 2);
  } else {
    score *= Math.max(0.3, 1 - (kana / Math.max(1, han)) * 3);
  }
  return score;
}

const DECODABLE = new Set(['utf-8', 'utf-8-bom', 'gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be', 'unknown']);

export function isDecodable(enc: string): boolean {
  return DECODABLE.has(enc);
}

/** 按检测到的编码解码 Buffer。
 *  注意:BOM 分支仅用于整文件解码;行级解码请传 stripBom=false */
export function decodeBuffer(buf: Buffer, encoding: string, stripBom = true): string {
  switch (encoding) {
    case 'utf-8':
    case 'unknown':
      return buf.toString('utf8');
    case 'utf-8-bom':
      // 仅当 stripBom 且文件以 BOM 开头时去除前 3 字节
      return stripBom && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf
        ? buf.subarray(3).toString('utf8')
        : buf.toString('utf8');
    case 'utf-16le':
      return buf.toString('utf16le');
    case 'utf-16be':
      return iconv.decode(buf, 'utf-16be');
    case 'gbk':
      return iconv.decode(buf, 'gbk');
    case 'gb18030':
      return iconv.decode(buf, 'gb18030');
    case 'big5':
      return iconv.decode(buf, 'big5');
    default:
      return buf.toString('utf8');
  }
}