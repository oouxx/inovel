# Novel Reader · AI 原生个人小说库

> 自动扫描 TXT → 自动识别编码 → 自动解析章节 → 批量建库 → 极简阅读器 → AI 阅读助手 → 在线书源(Legado)

一个面向个人小说收藏与阅读的本地化 Web 小说阅读器。把 TXT 放进目录,系统自动发现、解析并加入书库;支持导入阅读(Legado)书源在线搜索/试读,一键下载为 TXT 入库;打开网页即可享受无干扰的阅读体验,AI 助手帮你总结章节、解释设定、回顾剧情。

## ✨ 功能

### 数据层(全自动)
- **文件系统优先**:递归扫描 `NOVELS_DIR` 下所有 `*.txt`,无需手动上传
- **编码自动检测**:UTF-8 / UTF-8 BOM / UTF-16 / GBK / GB18030 / Big5(高频字启发式 + 严格 UTF-8 验证)
- **章节识别**:多规则 + confidence 评分(`第X章`/`Chapter N`/`001 标题`/`楔子` 等),序号连续性校验,>= 0.9 自动确认,0.7~0.9 可能章节,< 0.7 忽略
- **字节偏移索引**:SQLite 只存章节的 `start_offset / end_offset`,阅读时 `seek + read`,轻松支持超大 TXT
- **增量同步**:file hash / size / mtime 判定 NEW / UNCHANGED / MODIFIED / DELETED,未变化不重新解析
- **批量导入**:管理页拖拽/选择 TXT,显示每个文件的解析状态、章节数、编码、错误

### 书库
- 书架(继续阅读 + 今日阅读时长 + 分类分组)、全部小说、FTS5 搜索(中文按字索引,支持按书名/作者/分类)
- 详情页:封面上传、书籍信息编辑(书名/作者)、目录 + 章节搜索
- **全书全文搜索**:关键词按书籍编码转字节 → 整文件 `Buffer.indexOf` → 章节二分定位,301MB 书秒级搜索,片段展示 + 章内跳转

### 阅读器
- **自动分页**:基于 CSS multi-column 实际排版测量,改字号/行距/窗口自动重排
- **滚动模式**:连续阅读
- **阅读设置**:字体(系统/宋体/苹方)、字号 4 档、行距 4 档、宽度 3 档、主题(白/米/深灰/纯黑)
- **键盘快捷键**:`←/→/↑/↓/Space` 翻页、`Esc` 显隐 UI、`T` 目录、`A` AI、`F` 全屏
- **自动进度**:翻页/滚动自动保存,重开自动回到上次位置
- **书签**:一键添加(章节+位置,自动去重),书签列表跳转
- **阅读统计**:30s 心跳按天聚合,今日/累计时长、按书统计
- **响应式**:桌面 / 平板 / 手机(触摸滑动翻页、底部抽屉、长按划词)

### AI 阅读助手
- 基于 **Vercel AI SDK**,支持 `openai / anthropic / google / openrouter / 兼容端点`
- **总结本章 / 人物关系 / 解释设定 / 回顾剧情** 一键操作
- **自由问答**:问题关键词 → 全书章节检索 → 相关片段作为上下文
- **划词解释**:选中文字 → AI 解释,带上下文(桌面 mouseup / 移动端长按)
- **对话历史**:按书持久化,跨章节保留
- **SSE 流式输出**、结果缓存(`prompt_hash`)、API Key 只存服务端

### 在线书源(Legado)

- **书源管理**(`/sources`):网络导入(URL)/ 粘贴 JSON / 启用禁用 / 删除 / 连通性测试(真实执行一次搜索)
- **在线搜索**(`/online`):多源并发搜索按源分组(标注 文字/音频/漫画 源类型);详情弹窗;发现页分类浏览
- **文字源** → 一键「下载入库」→ 与本地 TXT 书完全一致的阅读体验
- **音频源 / 漫画源**(bookSourceType=1/2)→「加入书架」在线流式阅读:
  - 漫画:图片流式阅读页(防盗链图片代理,自动带源 Referer/Cookie),章节切换与滚动进度
  - 音频:在线播放器(播放/暂停/±15s/拖动进度/自动下一集),播放秒数自动保存
  - 在线书架:进度持久化(章节+位置),可移除
- **下载入库**:抓取全书写为 TXT(章节标题规范为 `第N章` 保证识别),复用阅读器/AI/搜索/进度全链路;任务进度可查、可取消
- **规则引擎**(`src/server/sources/`):
  - jsoup 默认规则(`class.x.0@tag.a@text`/`!N`排除/`[-1:0]`反转/`children[n]`/`text.关键词`/textNodes/ownText/all/规则级 `-` 反转)
  - `@css:` 规则(支持元素作用域)、XPath 常用子集(`//meta[@x='v']/@content`、`last()`、`following-sibling`)
  - JSONPath、`##正则##替换`链、`||` 兜底、`&&` 拼接、纯中文常量规则
  - `@js:`/`<js>`/`@js:`后缀(Rhino 式完成值语义)+ `java.*` API 子集(ajax/get/post/put/get/base64/encodeURI/DES-AES 解密等)
  - `{{key}}/{{page}}/{{$.jsonpath}}/{{book.x}}/{{js表达式}}` 模板;URL options(method/body/charset/headers);GBK/Big5 请求与响应解码(GET 关键词按目标编码百分号)
  - `@put:{}`/`@get:{}` 跨阶段变量、Cookie 持久化、`concurrentRate` 限流、`nextTocUrl`/`nextContentUrl` 翻页
- **已知限制**:需 WebView 人机验证/浏览器交互的源(如起点 Cookie 验证)会明确报错;音频/漫画源为在线流式阅读(不提供下载入库);需登录 UI 配置的源(如番茄密钥)暂不支持
- **网络路径**:实测不同源的网络要求不同 —— 如 cool18 仅代理可达(直连不通),得奇/就爱文学等国内站仅直连可达(拒绝境外代理 IP)。代理统一走容器/系统的 `http_proxy` 环境变量(由 mihomo 等代理分流),`NO_PROXY` 可排除特定域名

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
│   └── sources/     在线书源引擎(store / http / rules / engine / library / downloader)
└── shared/          共享类型
scripts/             开发辅助(dev / e2e / fixtures)
```

## 🧪 测试

```bash
bun run scripts/gen-fixtures.ts /tmp/novel-test   # 生成 6 种编码/章节结构的测试书
NOVELS_DIR=/tmp/novel-test bun src/server/index.ts
bun run scripts/e2e.ts       # 阅读/搜索/设置/手机端 全流程(21 项)
bun run e2e:online           # 真实书源全链路:导入→搜索→详情→目录→试读→下载入库(依赖网络)
bun run e2e:media            # 音频/漫画在线书架全链路(mock 源:媒体解析/图片音频代理/进度)
                             # 默认源: yiove 82c1edb2…;可传参换源与搜索词:
                             #   bun run scripts/e2e-online.ts https://shuyuan-api.yiove.com/import/book-source/2455d578-aa96-4b4f-87b4-cdd079de9bc8
bun scripts/mock-ai.ts &     # mock OpenAI 端点
bun run scripts/e2e-ai.ts    # AI 流式/缓存/问答
bun run scripts/e2e-p1.ts    # 书签/全文搜索/对话历史/统计
bun run scripts/e2e-meta.ts  # 封面/信息编辑/划词解释
```

## 🗺 路线图

- P1:✅ 书签、阅读历史、章节内全文搜索、封面、作者/标签
- P2:✅ 在线书源(Legado 导入/搜索/试读/下载入库)、EPUB/MOBI、小说 RAG、人物关系图、时间线