# AudioSense AI

一个面向语音内容管理的工作台，当前已经支持：

- 录音并入队转写
- 上传音频并入队转写
- Notebook / Tag 管理
- WhisperX 说话人识别与分段
- LLM 摘要、单任务对话、跨任务知识问答
- 真实用户注册 / 登录 / 会话
- 独立 worker 处理长耗时转写任务
- 可扩展 ASR provider 注册表
- provider fallback / 熔断 / 配置面板
- FTS + 向量混合检索

## 当前结构

前端：

- React 19 + Vite
- `Workspace / Knowledge / Upload / Record / Tasks / Settings`

后端：

- Express API
- SQLite 默认存储，可切 PostgreSQL
- Cookie session 鉴权
- `task_jobs` 队列表 + 独立 `worker.ts`
- `TranscriptionProvider` 注册表
- `user_settings`、`provider_health`、`task_chunks`、SQLite FTS

## 已实现的能力

认证与权限：

- 用户注册 / 登录 / 登出
- 服务端 session
- 用户数据隔离，任务、Notebook、音频文件都按用户维度访问

异步任务：

- 上传只负责创建任务并入队
- worker 轮询 `task_jobs` 表执行转写
- 失败自动重试，避免 API 进程长时间阻塞
- provider fallback 链和熔断状态由 worker 执行时判断

ASR provider：

- `whisperx`
- `openai-compatible`
- `azure-openai`

知识能力：

- 单条录音摘要
- 单条录音 chat
- 全局 hybrid search
- 基于 chunk 的跨任务 knowledge ask
- 可选 embedding 向量召回

Provider 管理：

- 默认 provider 配置
- fallback providers 配置
- circuit breaker threshold / cooldown 配置
- provider health 与 circuit reset

## 关键文件

- `server.ts`: 主 API 服务
- `worker.ts`: 队列 worker
- `db.ts`: schema 初始化
- `lib/auth.ts`: 用户与 session
- `lib/task-queue.ts`: 入队、抢占、失败重试
- `lib/task-processor.ts`: 实际转写处理
- `lib/provider-routing.ts`: fallback 与熔断
- `lib/search-index.ts`: chunk 索引、FTS、向量召回
- `lib/settings.ts`: 用户策略配置与 provider health
- `lib/embeddings.ts`: 向量生成与相似度计算
- `lib/transcription.ts`: provider 注册表
- `lib/llm.ts`: 摘要与问答

## 本地运行

1. 安装依赖

```bash
npm install
```

2. 配置环境变量

```bash
cp .env.example .env.local
```

至少建议配置：

- `WHISPERX_API_URL`
- `LLM_API_KEY`

如果你想走其他 provider，再补：

- `OPENAI_TRANSCRIPTION_*`
- `AZURE_OPENAI_*`
- `EMBEDDING_*`

3. 启动 API + worker

```bash
npm run dev
```

默认地址：

- `http://localhost:3000`

## 架构建议

当前最推荐的形态不是“把所有语音模型逻辑直接塞进主 API”，也不是一上来就拆成多个完全独立仓库，而是：

1. 保持现在这种同仓库、双进程结构
2. `server.ts` 只负责鉴权、资源管理、入队、检索、LLM 编排
3. `worker.ts` 专注转写任务执行
4. provider 适配器放在 `lib/transcription.ts` 或后续拆到独立目录

这样做的好处：

- 现在开发快，联调简单
- 后面加 WhisperX、Qwen ASR、Azure/OpenAI/第三方 API 时，只是在 worker/provider 层扩展
- 真到压力变大时，可以把 worker 单独部署，甚至再拆成独立 speech service，而不动前端和主 API 的业务边界

## 如果后面继续往生产走

下一步我建议优先补这些：

1. 对象存储，替换本地 `uploads/`
2. 更强的队列，比如 Redis / SQS / RabbitMQ
3. provider 级别的限流、熔断、fallback
4. 更强的 ANN 向量索引和检索服务
5. Notebook 共享、团队权限、多租户
