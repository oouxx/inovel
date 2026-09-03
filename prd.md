# 小说阅读器 PRD

## 1. 产品概述

### 1.1 产品名称

**Novel Reader**

一个面向个人小说收藏与阅读的本地化 Web 小说阅读器。

核心目标：

> **自动扫描 TXT → 自动识别小说 → 自动解析章节 → 批量建立书库 → 提供优秀的阅读体验 → AI 辅助阅读。**

产品不依赖传统小说 CMS。

用户只需要将 TXT 文件放入指定目录，系统即可自动发现、解析并加入书库。

---

# 2. 产品定位

### 核心用户

主要面向：

- 拥有大量 TXT 小说的个人用户
- 喜欢在电脑/手机浏览器阅读小说的用户
- 希望统一管理本地小说的人
- 希望使用 AI 理解小说内容的人

### 核心场景

```
我的 TXT 很多
      ↓
放进 novels 目录
      ↓
系统自动扫描
      ↓
识别小说
      ↓
识别章节
      ↓
自动建立书库
      ↓
打开网页直接阅读
      ↓
自动记录阅读进度
      ↓
AI 辅助理解小说
```

---

# 3. 产品核心原则

### 原则一：文件系统优先

TXT 是原始数据源。

不要求用户手动上传每一本小说。

```
/data/novels/
```

即为小说库。

---

### 原则二：自动化

用户不应该手动：

- 新建书籍
- 添加章节
- 输入作者
- 设置章节
- 导入数据库

系统尽可能自动完成。

---

### 原则三：阅读体验优先

阅读页面是整个产品的核心。

UI 应该：

- 极简
- 无干扰
- 高可读性
- 支持深色模式
- 支持键盘操作
- 支持手机
- 支持自定义字体/字号/行距

---

### 原则四：AI 是阅读助手，不是聊天机器人

AI 功能围绕**当前小说、当前章节、全书上下文**展开。

不是单纯增加一个 ChatGPT 页面。

---

# 4. 技术架构

```
┌───────────────────────────────────────┐
│               Browser                 │
│                                       │
│              Vue 3                    │
│          TypeScript                   │
│                                       │
│  Library / Book / Reader / AI Panel   │
└──────────────────┬────────────────────┘
                   │ HTTP / SSE
                   ▼
┌───────────────────────────────────────┐
│                 Bun                   │
│             TypeScript                │
│                                       │
│  REST API                             │
│  TXT Scanner                          │
│  TXT Parser                           │
│  Chapter Detector                     │
│  Search                               │
│  AI Service                           │
└──────────────┬───────────────┬────────┘
               │               │
               ▼               ▼
          ┌─────────┐      Vercel AI SDK
          │ SQLite  │           │
          └─────────┘           ▼
                           OpenAI / Claude /
                           Gemini / Qwen ...
               │
               ▼
          /data/novels
```

---

# 5. 技术栈

## Frontend

```
Vue 3
TypeScript
Vite
Pinia
Vue Router
Tailwind CSS
```

可选：

```
Lucide Vue
```

用于图标。

---

## Backend

```
Bun
TypeScript
Hono
```

Hono 用于 API 路由。

如果希望极简，也可以直接使用：

```
Bun.serve()
```

---

## Database

```
SQLite
```

建议：

```
bun:sqlite
```

不引入独立数据库服务。

---

## AI

```
Vercel AI SDK
```

支持：

```
OpenAI
Anthropic
Google
OpenRouter
其他兼容 Provider
```

AI Provider 必须通过配置切换。

---

# 6. 部署模型

最终：

```
Docker Image
└── novel-reader

Docker Container
├── Bun
├── Frontend
├── Backend
├── SQLite
└── AI SDK

Volume
└── /data/novels
```

运行：

```
docker run -d \
  -p 8080:8080 \
  -v /data/novels:/data/novels \
  -v /data/data:/data/app \
  novel-reader
```

前端 build 后直接由 Bun 提供。

最终：

> **一个 Docker 镜像 + 一个 Container + 一个端口。**

---

# 7. 功能模块

## P0 —— 第一阶段必须实现

### 7.1 自动扫描小说

系统启动时扫描：

```
/data/novels
```

支持：

```
*.txt
```

递归扫描子目录。

例如：

```
/data/novels/

玄幻/
  斗破苍穹.txt
  完美世界.txt

都市/
  重生之...
```

自动识别：

```
分类 = 文件夹名称
书名 = 文件名
```

---

# 8. TXT 编码识别

需要支持常见中文编码：

```
UTF-8
UTF-8 BOM
GBK
GB18030
Big5
```

优先自动检测。

数据库保存：

```
encoding
```

如果自动检测失败：

```
unknown
```

允许用户在管理页面手动指定。

---

# 9. 小说信息识别

第一阶段：

```
文件名 → 书名
```

例如：

```
斗破苍穹.txt
```

自动：

```
title = 斗破苍穹
```

后续可以增加：

```
作者
简介
封面
标签
```

但不是 MVP 必需功能。

---

# 10. 章节识别

实现独立：

```
ChapterDetector
```

支持多种规则。

例如：

```
^第[0-9一二三四五六七八九十百千万]+章
```

```
^第\s*[0-9]+\s*章
```

```
^Chapter\s+\d+
```

```
^[0-9]{1,5}[、.\s]+.+$
```

需要处理：

```
第一章
第一章 陨落的天才
第1章 陨落的天才
第 1 章 陨落的天才
第一章：陨落的天才
```

---

# 11. 章节检测评分

不能简单依赖一个正则。

每一个候选标题计算：

```
confidence
```

例如：

```
第一章 陨落的天才
confidence = 0.98
```

```
第123章
confidence = 0.95
```

```
001 陨落的天才
confidence = 0.78
```

状态：

```
>= 0.9
自动确认

0.7 ~ 0.9
可能章节

< 0.7
忽略
```

---

# 12. 章节存储

**不把正文存进 SQLite。**

SQLite 只保存：

```
book_id
chapter_index
title
start_offset
end_offset
```

例如：

```
斗破苍穹.txt

Chapter 1
0 → 5231

Chapter 2
5231 → 10482
```

阅读时：

```
seek(start_offset)
read(end_offset - start_offset)
```

这样可以支持超大 TXT。

---

# 13. 文件变化检测

使用：

```
file hash
file size
mtime
```

判断小说是否变化。

状态：

```
NEW
UNCHANGED
MODIFIED
DELETED
```

如果 TXT 没变化：

> 不重新解析。

如果发生变化：

> 重新建立章节索引。

---

# 14. 批量导入

管理页面：

```
批量导入
```

支持：

```
拖拽 TXT
选择多个 TXT
```

显示：

```
文件名
解析状态
章节数量
错误
```

例如：

```
斗破苍穹.txt      ✓ 5312章
凡人修仙传.txt    ✓ 3241章
某小说.txt        ⚠ 章节识别异常
```

---

# 15. 书架

首页：

```
我的书架

继续阅读

[斗破苍穹]
第523章
67%

[凡人修仙传]
第1240章
43%
```

下面：

```
全部小说

玄幻
都市
武侠
科幻
历史
```

---

# 16. 搜索

支持：

```
书名搜索
作者搜索
分类搜索
```

SQLite 使用：

```
FTS5
```

实现快速搜索。

---

# 17. 小说详情页

```
┌─────────────────────────────────────┐
│                                     │
│          斗破苍穹                    │
│          天蚕土豆                    │
│                                     │
│          5312 章                     │
│                                     │
│          [继续阅读]                  │
│                                     │
├─────────────────────────────────────┤
│ 目录                                 │
│                                     │
│ 第一章 陨落的天才                    │
│ 第二章 斗气大陆                      │
│ 第三章 客人                          │
│ ...                                 │
└─────────────────────────────────────┘
```

---

# 18. 阅读器

这是产品最重要的页面。

默认：

```
隐藏 UI
居中排版
最大阅读宽度
```

桌面：

```
┌──────────────────────────────────────────┐
│                                          │
│              第一章 陨落的天才            │
│                                          │
│   萧炎缓缓睁开双眼，望着熟悉的房间……      │
│                                          │
│   ……                                     │
│                                          │
│   少年缓缓握紧拳头。                       │
│                                          │
│                                          │
└──────────────────────────────────────────┘
```

---

# 19. 阅读设置

支持：

### 字体

```
系统字体
思源宋体
苹方
```

### 字号

```
小
中
大
特大
```

### 行距

```
1.4
1.6
1.8
2.0
```

### 阅读宽度

```
窄
标准
宽
```

### 主题

```
白色
米色
深灰
纯黑
```

---

# 20. 阅读模式

支持：

### 分页模式

```
上一页 ←
        →
下一页
```

### 滚动模式

```
连续阅读
```

### 章节模式

```
上一章
正文
下一章
```

默认：

> 分页模式。

---

# 21. 自动分页

不能按：

```
1000 字 = 一页
```

必须根据实际 DOM 高度计算。

```
正文
 ↓
Render
 ↓
测量高度
 ↓
Viewport
 ↓
计算 page boundaries
```

调整：

```
字号
行距
窗口
宽度
```

之后重新分页。

---

# 22. 键盘快捷键

```
← 上一页
→ 下一页
Space 下一页
↑ 上一页
↓ 下一页
Esc 显示/隐藏 UI
F 全屏
T 目录
A AI
```

---

# 23. 阅读进度

自动保存：

```
book_id
chapter_id
page
progress
updated_at
```

例如：

```
{
  "bookId": 123,
  "chapterId": 523,
  "page": 12,
  "progress": 0.67
}
```

关闭网页重新打开：

> 自动回到上次阅读位置。

---

# 24. AI 阅读助手

这是第二阶段核心功能。

阅读页面右侧：

```
┌────────────────────┐
│ ✨ AI 阅读助手      │
├────────────────────┤
│ 总结本章            │
│ 人物关系            │
│ 解释设定            │
│ 回顾剧情            │
│                    │
│ ─────────────────  │
│                    │
│ 请输入问题……        │
└────────────────────┘
```

---

# 25. AI 功能

### 本章总结

```
总结这一章
```

返回：

```
剧情概述
关键事件
人物变化
重要伏笔
```

---

### 人物分析

```
分析本章人物关系
```

---

### 剧情解释

例如：

> 为什么萧炎突然突破？

AI 根据当前章节及上下文回答。

---

### 名词解释

用户选中：

```
斗气
```

点击：

```
AI解释
```

---

### 剧情回顾

```
“药老之前什么时候出现过？”
```

AI 搜索小说上下文。

---

# 26. AI 上下文

AI 请求必须区分：

```
当前段落
当前章节
前 N 章
后 N 章
全书检索结果
```

默认：

```
当前章节
+
前后各 1 章
```

需要全书信息时：

```
Search → Relevant chapters → AI
```

---

# 27. AI SDK 架构

```
Vue
 │
 │ POST /api/ai/chat
 ▼
Bun
 │
 ▼
AI Service
 │
 ▼
Vercel AI SDK
 │
 ├── OpenAI
 ├── Anthropic
 ├── Google
 └── OpenRouter
```

API Key：

> **只能存在服务端。**

绝不能放进 Vue。

---

# 28. AI Streaming

AI 输出采用：

```
SSE / Streaming
```

用户看到：

```
正在分析……

萧炎本章主要经历了……
```

逐字/逐段显示，而不是等待完整结果。

---

# 29. AI Provider 配置

环境变量：

```
AI_PROVIDER=openai
AI_MODEL=xxx
OPENAI_API_KEY=xxx
```

以后支持：

```
AI_PROVIDER=anthropic
```

或者：

```
AI_PROVIDER=openrouter
```

无需修改前端。

---

# 30. AI 成本控制

默认不自动调用 AI。

只有用户主动：

```
总结
解释
提问
```

才调用。

AI 结果可以缓存：

```
book_id
chapter_id
prompt_hash
model
response
```

相同请求直接读取缓存。

---

# 31. P1 功能

第二阶段加入：

```
书签
阅读历史
全文搜索
章节搜索
AI 总结缓存
AI 对话历史
封面
作者信息
标签
阅读统计
```

---

# 32. P2 功能

后续：

```
在线小说源
Legado BookSource
在线搜索
在线导入
自动下载
EPUB
MOBI
PDF
```

以及：

```
小说 RAG
人物数据库
世界观数据库
时间线
人物关系图
伏笔追踪
```

---

# 33. 数据库设计

### books

```
id
title
author
file_path
file_hash
file_size
encoding
category
chapter_count
created_at
updated_at
```

### chapters

```
id
book_id
chapter_index
title
start_offset
end_offset
created_at
```

### reading_progress

```
id
book_id
chapter_id
page
progress
updated_at
```

### bookmarks

```
id
book_id
chapter_id
position
note
created_at
```

### ai_cache

```
id
book_id
chapter_id
prompt_hash
model
response
created_at
```

---

# 34. API

### Books

```
GET /api/books
GET /api/books/:id
GET /api/books/:id/chapters
```

### Reader

```
GET /api/chapters/:id/content
```

### Progress

```
GET /api/progress/:bookId
PUT /api/progress/:bookId
```

### Search

```
GET /api/search?q=斗破
```

### Scanner

```
POST /api/scanner/scan
GET /api/scanner/status
```

### AI

```
POST /api/ai/chat
POST /api/ai/summarize
POST /api/ai/explain
```

---

# 35. UI 页面

```
/
├── 首页 / 书架
│
├── /books
│   └── 全部小说
│
├── /books/:id
│   └── 小说详情
│
├── /books/:id/chapters
│   └── 目录
│
├── /reader/:bookId/:chapterId
│   └── 阅读器
│
├── /search
│   └── 搜索
│
└── /settings
    └── 设置
```

管理功能可以暂时隐藏：

```
/admin
```

---

# 36. UI 设计原则

整体风格：

> **Apple Books + Kindle + 极简 Web App**

关键词：

```
Minimal
Elegant
Quiet
Readable
Content-first
```

避免：

```
复杂侧边栏
大量按钮
过度卡片
高饱和颜色
广告式 UI
```

阅读器尤其要做到：

> **让用户忘记自己正在使用一个网站。**

---

# 37. 响应式

必须支持：

```
Desktop
Tablet
Mobile
```

桌面：

```
正文 + AI Sidebar
```

手机：

```
正文
 ↓
AI Bottom Sheet
```

目录：

```
Desktop → Sidebar
Mobile  → Drawer
```

---

# 38. 项目目录

```
novel-reader/
│
├── src/
│   ├── client/
│   │   ├── pages/
│   │   ├── components/
│   │   ├── stores/
│   │   └── router/
│   │
│   ├── server/
│   │   ├── routes/
│   │   ├── services/
│   │   ├── scanner/
│   │   ├── parser/
│   │   ├── ai/
│   │   └── database/
│   │
│   └── shared/
│       ├── types/
│       └── schemas/
│
├── public/
├── data/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── Dockerfile
└── README.md
```

---

# 39. MVP 开发优先级

### Sprint 1：数据层

```
SQLite
TXT Scanner
Encoding Detection
Chapter Detector
File Hash
```

完成：

> 放 TXT → 自动出现在数据库。

---

### Sprint 2：书库

```
首页
书架
搜索
小说详情
目录
```

完成：

> 可以找到任何一本小说。

---

### Sprint 3：阅读器

```
章节阅读
分页
滚动
阅读进度
键盘快捷键
深色模式
字体设置
```

完成：

> 可以舒服地读完整本小说。

---

### Sprint 4：AI

```
Vercel AI SDK
Streaming
本章总结
AI 问答
上下文
缓存
```

完成：

> AI 成为阅读助手。

---

### Sprint 5：高级功能

```
全文搜索
RAG
书签
阅读历史
人物
世界观
Legado
在线书源
```

---

# 40. MVP 验收标准

一个 MVP 必须做到：

```
✓ Docker 启动
✓ 自动扫描 /data/novels
✓ 支持批量 TXT
✓ 自动识别 UTF-8/GBK/GB18030
✓ 自动识别章节
✓ SQLite 建立索引
✓ 书架显示
✓ 搜索小说
✓ 查看目录
✓ 阅读正文
✓ 自动分页
✓ 上一页/下一页
✓ 上一章/下一章
✓ 自动保存进度
✓ 深色模式
✓ 字体/字号/行距设置
✓ 手机端可用
✓ AI Streaming
✓ 本章总结
✓ AI 问答
✓ 一个 Docker 镜像运行
```

---

## 最终产品形态

最终我建议把它定位成：

> **“AI-native Personal Novel Library”**

而不是简单的：

> TXT 阅读器。

核心闭环：

```
                 TXT
                  │
                  ▼
            自动扫描 / 解析
                  │
                  ▼
               SQLite
                  │
          ┌───────┴───────┐
          ▼               ▼
         书架            搜索
          │               │
          └───────┬───────┘
                  ▼
                阅读
                  │
          ┌───────┴───────┐
          ▼               ▼
       阅读进度          AI助手
                          │
                 ┌────────┼────────┐
                 ▼        ▼        ▼
                总结     解释     全书问答
```

**第一版不要做在线书源、RAG、复杂 AI Agent。**先把“**TXT 自动入库 + 漂亮阅读器**”做到非常好，这两个才是产品的地基；AI SDK 接口从第一天预留好即可。
