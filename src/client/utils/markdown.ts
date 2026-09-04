// Markdown 渲染 —— 基于 markdown-it(GFM 表格 / 代码块 / 链接 / 嵌套列表)
// html:false → 原始 HTML 一律转义,输出安全;AI 助手输出专用
import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
  html: false, // 禁止原始 HTML 注入
  linkify: false, // 不自动识别裸链接(避免误判书名等)
  breaks: true, // 单个换行 → <br>,更贴合聊天阅读体验
});

// 链接新窗口打开 + 防钓鱼(rel)
const defaultLinkOpen =
  md.renderer.rules.link_open ||
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank');
  tokens[idx].attrSet('rel', 'noopener noreferrer');
  return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(src: string): string {
  return md.render(src || '');
}