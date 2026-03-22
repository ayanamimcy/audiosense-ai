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
- `audio-engine/` 音频解析引擎 + `TranscriptionProvider` 注册表
- `user_settings`、`provider_health`、`task_chunks`、SQLite FTS
- `python-runtime/` 本地模型 sidecar，可加载 faster-whisper / WhisperX / PyAnnote

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
- `local-python`

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
- `lib/audio-engine/engine.ts`: 音频解析主入口，负责媒体探测、provider fallback、结果标准化
- `lib/audio-engine/normalize.ts`: 统一整理 provider 返回的 text / segment / word / speaker 数据
- `lib/audio-engine/speaker-merge.ts`: 参考 TranscriptionSuite 的时间戳对齐策略做说话人合并
- `lib/audio-engine/providers/*`: 各个 ASR provider 适配器
- `lib/audio-engine/providers/local-python.ts`: 调用仓库内本地 Python 推理服务
- `python-runtime/src/local_audio_runtime/server.py`: 本地模型 HTTP runtime
- `python-runtime/src/local_audio_runtime/model_manager.py`: 本地模型缓存和生命周期管理
- `python-runtime/src/local_audio_runtime/backends.py`: 本地 faster-whisper / WhisperX backend，含 WhisperX 集成 diarization
- `python-runtime/src/local_audio_runtime/parallel_diarize.py`: 并行 / 串行 diarization 调度
- `python-runtime/src/local_audio_runtime/recorder.py`: AudioToTextRecorder 运行时
- `python-runtime/src/local_audio_runtime/vad.py`: Silero + WebRTC 双 VAD
- `python-runtime/src/local_audio_runtime/live_engine.py`: 实时 sentence-by-sentence live mode
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

如果你想走本地模型，再补：

- `LOCAL_AUDIO_ENGINE_ENABLED=true`
- `LOCAL_AUDIO_ENGINE_URL=http://127.0.0.1:8765`
- `LOCAL_AUDIO_ENGINE_MODEL`
- `HF_TOKEN` 或 `LOCAL_AUDIO_ENGINE_HF_TOKEN`（启用 diarization 时）
- `LOCAL_AUDIO_ENGINE_DIARIZATION_STRATEGY=auto|parallel|sequential`
- `SQLITE_FILENAME`（容器或自定义数据目录时推荐）
- `UPLOAD_DIR`（容器或共享卷时推荐）

并安装 Python runtime 依赖：

```bash
cd python-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[full]'
```

3. 启动 API + worker

```bash
npm run dev
```

默认地址：

- `http://localhost:3000`

本地音频 runtime 也可以单独启动：

```bash
npm run dev:local-engine
```

当前本地 runtime 已支持：

- `WhisperX transcribe_with_diarization()` 单次集成 speaker 流程
- 非 WhisperX backend 的并行 / 串行 diarization 调度
- 基于 `AudioToTextRecorder` 的本地 live VAD / streaming runtime
- `ws://127.0.0.1:8765/ws/live` 的实时 WebSocket live mode

## Docker 部署

仓库现在已经带上了这些容器文件：

- `Dockerfile`: Node API + 前端静态产物 + worker 共享镜像
- `docker-compose.yml`: `app`、`worker`、`local-audio-runtime` 三服务编排
- `python-runtime/Dockerfile.cuda`: 适合 Linux + NVIDIA CUDA 的本地模型 runtime

部署前提：

- Linux 主机已经装好 NVIDIA Driver
- 已安装 `nvidia-container-toolkit`
- 使用 `docker compose` v2

推荐步骤：

1. 复制环境变量文件

```bash
cp .env.example .env
```

2. 至少把这些变量填好

- `TRANSCRIPTION_PROVIDER=local-python`
- `LOCAL_AUDIO_ENGINE_ENABLED=true`
- `LOCAL_AUDIO_ENGINE_AUTOSTART=false`
- `LOCAL_AUDIO_ENGINE_HF_TOKEN=...`
- `LLM_API_KEY=...`（如果你要摘要 / 问答）
- `EMBEDDING_API_KEY=...`（如果你要向量检索）

3. 启动整套服务

```bash
docker compose up -d --build
```

4. 打开服务

- `http://localhost:3000`

几个部署细节：

- Compose 里默认让 `local-audio-runtime` 走 `whisperx + cuda + float16`
- `app` 和 `worker` 共用 SQLite 数据卷与 `uploads/` 音频卷
- `worker` 把文件路径传给 Python runtime，所以 `worker` 和 `local-audio-runtime` 必须挂同一个 `/app/uploads`
- 模型下载缓存会落在 `audiosense-models`、`audiosense-hf-cache`、`audiosense-torch-cache`
- 第一次启动会下载 Whisper / PyAnnote 模型，耗时会明显更长

如果你要改模型大小，最常调的是：

- `LOCAL_AUDIO_ENGINE_MODEL=small|medium|large-v3`
- `LOCAL_AUDIO_ENGINE_BATCH_SIZE`
- `LOCAL_AUDIO_ENGINE_COMPUTE_TYPE=float16`
- `LOCAL_AUDIO_ENGINE_PRELOAD=true|false`

## 架构建议

当前最推荐的形态不是“把所有语音模型逻辑直接塞进主 API”，也不是一上来就拆成多个完全独立仓库，而是：

1. 保持现在这种同仓库、双进程结构
2. `server.ts` 只负责鉴权、资源管理、入队、检索、LLM 编排
3. `worker.ts` 专注转写任务执行
4. provider 适配器放在 `lib/transcription.ts` 或后续拆到独立目录

这样做的好处：

- 现在开发快，联调简单
- 后面加 WhisperX、Qwen ASR、Azure/OpenAI/第三方 API 时，只是在 `audio-engine/providers` 层扩展
- 文件元数据探测、结果标准化、speaker merge 不会散落在业务逻辑里
- 真到压力变大时，可以把 worker 单独部署，甚至再拆成独立 speech service，而不动前端和主 API 的业务边界

## 如果后面继续往生产走

下一步我建议优先补这些：

1. 对象存储，替换本地 `uploads/`
2. 更强的队列，比如 Redis / SQS / RabbitMQ
3. provider 级别的限流、熔断、fallback
4. 更强的 ANN 向量索引和检索服务
5. Notebook 共享、团队权限、多租户
