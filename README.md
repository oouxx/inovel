# Novel Reader · AI 原生个人小说库

> 自动扫描 TXT → 自动识别编码 → 自动解析章节 → 批量建库 → 极简阅读器 → AI 阅读助手

一个面向个人小说收藏与阅读的本地化 Web 小说阅读器。把 TXT 放进目录,系统自动发现、解析并加入书库;打开网页即可享受无干扰的阅读体验,AI 助手帮你总结章节、解释设定、回顾剧情。

## ✨ 功能

### 数据层(全自动)
- **文件系统优先**:递归扫描 `NOVELS_DIR` 下所有 `*.txt`,无需手动上传
- **编码自动检测**:UTF-8 / UTF-8 BOM / UTF-16 / GBK / GB18030 / Big5(高频字启发式 + 严格 UTF-8 验证)
- **章节识别**:多规则 + confidence 评分(`第X章`/`Chapter N`/`001 标题`/`楔子` 等),序号连续性校验,>= 0.9 自动确认,0.7~0.9 可能章节,< 0.7 忽略
- **字节偏移索引**:SQLite 只存章节的 `start_offset / end_offset`,阅读时 `seek + read`,轻松支持超大 TXT
- **增量同步**:file hash / size / mtime 判定 NEW / UNCHANGED / MODIFIED / DELETED,未变化不重新解析
- **批量导入**:管理页拖拽/选择 TXT,显示每个文件的解析状态、章节数、编码、错误

### 书库
- 书架(继续阅读 + 分类分组)、全部小说、FTS5 全文搜索(中文按字索引)、详情页 + 目录(章节搜索)

### 阅读器
- **自动分页**:基于 CSS multi-column 实际排版测量,改字号/行距/窗口自动重排
- **滚动模式**:连续阅读
- **阅读设置**:字体(系统/宋体/苹方)、字号 4 档、行距 4 档、宽度 3 档、主题(白/米/深灰/纯黑)
- **键盘快捷键**:`←/→/↑/↓/Space` 翻页、`Esc` 显隐 UI、`T` 目录、`A` AI、`F` 全屏
- **自动进度**:翻页/滚动自动保存,重开自动回到上次位置
- **响应式**:桌面 / 平板 / 手机(触摸滑动翻页、底部抽屉)

### AI 阅读助手
- 基于 **Vercel AI SDK**,支持 `openai / anthropic / google / openrouter / 兼容端点`
- **总结本章 / 人物关系 / 解释设定 / 回顾剧情** 一键操作
- **自由问答**:问题关键词 → 全书章节检索 → 相关片段作为上下文
- **划词解释**:选中文字 → AI 解释,带上下文
- **SSE 流式输出**、结果缓存(`prompt_hash`)、API Key 只存服务端

## 🚀 快速开始

### 本地开发

```bash
bun install

# 放几本 TXT 到 data/novels/(或自定义 NOVELS_DIR)
bun run scripts/gen-fixtures.ts   # 可选:生成测试书籍

# 启动(server :8080 + Vite :5173)
bun run dev
```

生产模式:

```bash
bun run build    # 构建前端到 dist/
bun run start    # 单端口 :8080 提供前端 + API
```

### Docker(推荐)

```bash
docker build -t novel-reader .

docker run -d \
  -p 8080:8080 \
  -v /your/txt/folder:/data/novels \
  -v /your/app/data:/data/app \
  -e AI_PROVIDER=openai \
  -e AI_MODEL=gpt-4o-mini \
  -e OPENAI_API_KEY=sk-xxx \
  novel-reader
```

打开 `http://localhost:8080` 即可。启动时自动扫描 `/data/novels`。

## ⚙️ 配置(环境变量)

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `8080` | 服务端口 |
| `NOVELS_DIR` | `./data/novels`(Docker: `/data/novels`) | 小说 TXT 目录 |
| `DATA_DIR` | `./data`(Docker: `/data/app`) | SQLite 数据目录 |
| `AI_PROVIDER` | `openai` | `openai` / `anthropic` / `google` / `openrouter` |
| `AI_MODEL` | 按 provider 默认 | 模型名 |
| `OPENAI_API_KEY` | - | OpenAI 或兼容端点 Key |
| `AI_BASE_URL` | - | OpenAI 兼容端点(通义/DeepSeek/Ollama 等) |
| `ANTHROPIC_API_KEY` | - | Anthropic |
| `GOOGLE_API_KEY` | - | Google Gemini |
| `OPENROUTER_API_KEY` | - | OpenRouter |

未配置 AI 时,阅读器一切功能可用,AI 面板会显示配置提示。

## 🏗 架构

```
Browser (Vue 3 + TS + Pinia + Tailwind)
    │  HTTP / SSE
    ▼
Bun + Hono
    ├─ Scanner   递归扫描 / hash / 增量解析
    ├─ Parser    编码检测 + ChapterDetector(多规则评分)
    ├─ Services  书库 / 章节 / 进度 / 搜索
    ├─ AI        Vercel AI SDK 多 Provider + 缓存
    └─ bun:sqlite(books / chapters / reading_progress / ai_cache / FTS5)
    │
    ▼
/data/novels(TXT 原文,字节偏移索引)
```

关键设计:**正文永不入库**。SQLite 只存章节边界(字节偏移),阅读时按偏移读取并按检测到的编码解码。

## 📁 目录

```
src/
├── client/          Vue 3 前端(pages / components / stores / router)
├── server/          Bun 后端(routes / services / scanner / parser / ai / database)
└── shared/          共享类型
scripts/             开发辅助(dev / e2e / fixtures)
```

## 🧪 测试

```bash
bun run scripts/gen-fixtures.ts /tmp/novel-test   # 生成 6 种编码/章节结构的测试书
NOVELS_DIR=/tmp/novel-test bun src/server/index.ts
bun run scripts/e2e.ts      # 阅读/搜索/设置/手机端 全流程
bun scripts/mock-ai.ts &    # mock OpenAI 端点
bun run scripts/e2e-ai.ts   # AI 流式/缓存/问答
```

## 🗺 路线图

- P1:书签、阅读历史、章节内全文搜索、封面、作者/标签
- P2:在线书源(Legado)、EPUB/MOBI、小说 RAG、人物关系图、时间线