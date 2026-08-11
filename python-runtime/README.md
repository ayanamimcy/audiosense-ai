# Local Audio Runtime

这是给 `AudioSense AI` 提供本地模型推理能力的 Python sidecar。

默认能力：

- 默认以 `faster-whisper` 生成不可被后处理覆盖的权威文本
- 文件转写默认关闭 VAD，避免在进入 ASR 前丢弃有效语音
- 可选使用 WhisperX 细化词级时间戳；失败或漏字时保留原始时间戳
- 仍可显式选择完整的 WhisperX 转写后端以兼容旧部署
- 本地文件转写
- 可选 `pyannote.audio` 说话人分离
- WhisperX 集成单次 diarization
- 并行 / 串行 diarization 调度
- 基于 WebSocket 的 live mode (`/ws/live`)
- Silero + WebRTC VAD recorder runtime
- 常驻进程缓存模型，避免每个任务重复加载

## 安装

建议在 `python-runtime/` 下创建虚拟环境并安装：

```bash
cd python-runtime
python3 -m venv .venv
source .venv/bin/activate
pip install -e '.[full]'
```

如果只需要本地转写，不需要 diarization，可以只安装：

```bash
pip install -e '.[whisper]'
```

如果你还要 live mode / VAD，但不需要 pyannote，可以安装：

```bash
pip install -e '.[whisper,live]'
```

## 启动

```bash
PYTHONPATH=src python3 -m local_audio_runtime.server
```

默认监听 `127.0.0.1:8765`。

完整性优先的默认配置：

```bash
LOCAL_AUDIO_ENGINE_BACKEND=faster-whisper
LOCAL_AUDIO_ENGINE_VAD_FILTER=false
LOCAL_AUDIO_ENGINE_WHISPERX_ALIGNMENT=false
```

需要 WhisperX forced alignment 时，可将最后一项设为 `true`。该增强只更新时间戳，
不会替换 faster-whisper 的文本；使用 `auto` diarization 策略时会自动采用串行加载以降低显存占用。

## 主要接口

- `POST /transcribe`
- `POST /transcribe-file`
- `GET /health`
- `WS /ws/live`
