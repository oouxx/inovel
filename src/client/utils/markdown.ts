// 极简 Markdown 渲染(标题/粗体/斜体/列表/引用/分隔线),输出安全 HTML
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split('\n');
  const out: string[] = [];
  let inList = false;
  let listTag = 'ul';

  const closeList = () => {
    if (inList) {
      out.push(`</${listTag}>`);
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(#{1,4})\s+(.*)$/.exec(t))) {
      closeList();
      const level = Math.min(4, m[1].length) + 1;
      out.push(`<h${level}>${inline(m[2])}</h${level}>`);
    } else if (/^[-*]\s+/.test(t)) {
      if (!inList || listTag !== 'ul') {
        closeList();
        out.push('<ul>');
        inList = true;
        listTag = 'ul';
      }
      out.push(`<li>${inline(t.replace(/^[-*]\s+/, ''))}</li>`);
    } else if (/^\d+[.、]\s*/.test(t)) {
      if (!inList || listTag !== 'ol') {
        closeList();
        out.push('<ol>');
        inList = true;
        listTag = 'ol';
      }
      out.push(`<li>${inline(t.replace(/^\d+[.、]\s*/, ''))}</li>`);
    } else if (/^&gt;\s?/.test(t)) {
      closeList();
      out.push(`<blockquote>${inline(t.replace(/^&gt;\s?/, ''))}</blockquote>`);
    } else if (/^(---|___)$/.test(t)) {
      closeList();
      out.push('<hr />');
    } else {
      closeList();
      out.push(`<p>${inline(t)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}