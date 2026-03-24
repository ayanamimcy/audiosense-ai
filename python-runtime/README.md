# Local Audio Runtime

这是给 `AudioSense AI` 提供本地模型推理能力的 Python sidecar。

默认能力：

- 本地 `faster-whisper` / `whisperx` 模型加载
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

## 主要接口

- `POST /transcribe`
- `POST /transcribe-file`
- `GET /health`
- `WS /ws/live`
