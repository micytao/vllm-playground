# vLLM Playground - Quick Reference Guide

## 🚀 Quick Start

### 1. Start the WebUI
```bash
cd vllm-playground
./scripts/start.sh
```
Or manually:
```bash
pip install -r requirements.txt
python3 run.py
```

### 2. Access the Interface
Open your browser: http://localhost:7860

### 3. Start a vLLM Server
1. Select or enter a model name
2. Configure settings (optional)
3. Click "Start Server"
4. Wait for "Application startup complete" in logs
5. Start chatting!

## 📖 Common Use Cases

### Testing with a Small Model
```
Model: facebook/opt-125m
Tensor Parallel: 1
GPU Memory: 50%
```
Perfect for quick testing and development.

### Production Setup (7B Model)
```
Model: meta-llama/Llama-2-7b-chat-hf
Tensor Parallel: 1
GPU Memory: 90%
Enable Prefix Caching: ✓
```

### Large Model with Multiple GPUs
```
Model: meta-llama/Llama-2-13b-chat-hf
Tensor Parallel: 2 (or 4)
GPU Memory: 90%
Enable Prefix Caching: ✓
```

## ⚙️ Configuration Reference

### Model Settings

| Setting | Description | Default |
|---------|-------------|---------|
| Model | HuggingFace model name or path | facebook/opt-125m |
| Host | Server bind address | 0.0.0.0 |
| Port | Server port | 8000 |
| Tensor Parallel Size | Number of GPUs for parallelism | 1 |
| GPU Memory Utilization | GPU memory fraction (0.0-1.0) | 0.9 |
| Data Type | Model precision | auto |
| Max Model Length | Override max sequence length | auto |

### Advanced Options

| Option | Description | When to Use |
|--------|-------------|-------------|
| Trust Remote Code | Execute model code | Models with custom code |
| Enable Prefix Caching | Reuse KV cache | Repeated prompts |
| Disable Log Stats | Skip periodic stats | Cleaner logs |

### Generation Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| Temperature | 0.0 - 2.0 | Higher = more random |
| Max Tokens | 1 - 4096 | Response length limit |

## 🔧 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd + Enter | Send message |

## 🐛 Troubleshooting

### "Model not found"
- Check model name spelling
- Ensure you have access (login with `huggingface-cli login`)
- Try a different model first

### "CUDA out of memory"
- Reduce GPU memory utilization
- Use a smaller model
- Increase tensor parallel size
- Set max model length

### "Server won't start"
- Check if port 8000 is available
- Look for errors in logs panel
- Verify CUDA/GPU availability

### "WebSocket disconnected"
- Check if WebUI is still running
- Refresh the page
- Check browser console for errors

## 💡 Tips & Best Practices

### 1. Start Small
Begin with `facebook/opt-125m` to verify everything works.

### 2. Monitor Logs
Watch the log panel during startup for any warnings or errors.

### 3. GPU Memory
- Start with 70-80% if unsure
- Increase gradually based on available memory
- Leave headroom for other processes

### 4. Temperature Settings
- 0.0-0.3: Focused, deterministic
- 0.4-0.8: Balanced (default: 0.7)
- 0.9-1.5: Creative, varied
- 1.5+: Very random (use with caution)

### 5. Prefix Caching
Enable for:
- System prompts
- Few-shot examples
- Repeated context

### 6. Chat Best Practices
- Clear chat between different tasks
- Adjust temperature per use case
- Start with lower max tokens for faster responses

## 🔗 Useful Commands

### Check GPU Status
```bash
nvidia-smi
```

### Monitor GPU Usage
```bash
watch -n 1 nvidia-smi
```

### View Available Models
```bash
huggingface-cli scan-cache
```

### Login to HuggingFace
```bash
huggingface-cli login
```

## 🌐 API Endpoints

The WebUI exposes these endpoints:

- `GET /` - Main interface
- `GET /api/status` - Server status
- `POST /api/start` - Start vLLM server
- `POST /api/stop` - Stop vLLM server
- `POST /api/chat` - Send chat message
- `GET /api/models` - List common models
- `WS /ws/logs` - Log streaming WebSocket

## 📊 Status Indicators

| Indicator | Meaning |
|-----------|---------|
| 🔴 Disconnected | WebUI not connected |
| 🟢 Connected | WebUI ready |
| 🔵 Server Running | vLLM server active |

## 🎨 Customization

### Change WebUI Port
```bash
WEBUI_PORT=8080 python3 run.py
```

### Change vLLM Port
Update "Port" field in configuration panel.

## 📝 Notes

- WebUI runs on port 7860 (configurable)
- vLLM server runs on port 8000 (configurable)
- Logs are color-coded: Info (blue), Warning (yellow), Error (red)
- Chat history is maintained per session
- Server stops when WebUI is closed

## 🆘 Getting Help

1. Check the logs panel for error messages
2. Review this guide
3. Consult vLLM documentation
4. Open an issue on GitHub

---

Happy chatting! 🚀
