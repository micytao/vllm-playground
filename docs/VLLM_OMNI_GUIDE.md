# vLLM-Omni Integration Guide

vLLM-Omni extends vLLM to support omni-modality model inference, enabling text-to-image generation, Omni models (text + audio), and video generation.

## Overview

vLLM-Omni is a separate project that builds on top of vLLM, adding support for:
- **Image Generation**: Diffusion Transformer (DiT) models like Z-Image-Turbo, Stable Diffusion 3
- **Omni Models**: Qwen-Omni with text and audio input/output
- **Video Generation**: Text-to-video models like Wan2.2

## Prerequisites

### Option 1: Local Installation (Subprocess Mode)

Create a separate virtual environment for vLLM-Omni:

```bash
# Create venv with Python 3.12
uv venv --python 3.12 --seed ~/.venv-vllm-omni
source ~/.venv-vllm-omni/bin/activate

# Install vLLM base
uv pip install vllm==0.12.0 --torch-backend=auto

# Clone and install vLLM-Omni
git clone https://github.com/vllm-project/vllm-omni.git
cd vllm-omni && uv pip install -e .
```

### Option 2: Container Mode

vLLM-Omni provides official container images:

| Platform | Image |
|----------|-------|
| NVIDIA (CUDA) | `docker.io/vllm/vllm-omni:v0.14.0rc1` |
| AMD (ROCm) | `docker.io/vllm/vllm-omni-rocm:v0.14.0rc1` |

## Running Modes

### Subprocess Mode

1. Set the **venv path** to your vLLM-Omni virtual environment
2. Select **Subprocess** run mode
3. The playground will start vLLM-Omni using the CLI

### Container Mode

1. Select **Container** run mode
2. Choose the appropriate accelerator (NVIDIA or AMD)
3. The playground will pull and run the official container image

## Supported Models

### Image Generation Models

| Model | VRAM | Description |
|-------|------|-------------|
| Tongyi-MAI/Z-Image-Turbo | 16GB | Fast image generation |
| Qwen/Qwen-Image | 24GB | High quality images |
| stabilityai/stable-diffusion-3-medium | 16GB | Stable Diffusion 3 |

### Omni Models

| Model | VRAM | Description |
|-------|------|-------------|
| Qwen/Qwen2.5-Omni-7B | 16GB | Text + Audio I/O |
| Qwen/Qwen3-Omni-30B-A3B-Instruct | 48GB | Advanced omni model |

### Video Generation Models

| Model | VRAM | Description |
|-------|------|-------------|
| Wan-AI/Wan2.2-T2V-14B | 24GB+ | Text-to-video generation |

## Using the UI

### Image Generation (Studio Mode)

1. Select **Image Generation** model type
2. Choose a model from the dropdown
3. Configure generation parameters:
   - **Image Size**: Width x Height (default: 1024x1024)
   - **Inference Steps**: More steps = higher quality (default: 50)
   - **Guidance Scale**: Higher = more prompt adherence (default: 4.0)
4. Start the server
5. Enter a prompt and click **Generate**
6. View generated images in the gallery

### Omni Chat (Chat Mode)

1. Select **Omni** model type
2. Choose a Qwen-Omni model
3. Start the server
4. Use the chat interface for text and audio interaction

## API Endpoints

vLLM-Omni runs on a separate port (default: 8091) from the main vLLM server.

### Start Server
```
POST /api/omni/start
```

### Stop Server
```
POST /api/omni/stop
```

### Get Status
```
GET /api/omni/status
```

### Generate Image
```
POST /api/omni/generate
```

### List Models
```
GET /api/omni/models
```

## Generation Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| prompt | Required | Text description of desired image |
| negative_prompt | None | What to avoid in generation |
| width | 1024 | Output image width |
| height | 1024 | Output image height |
| num_inference_steps | 50 | Denoising steps |
| guidance_scale | 4.0 | CFG scale |
| seed | Random | Reproducibility seed |

## Troubleshooting

### vLLM-Omni Not Detected

If the playground doesn't detect vLLM-Omni:
1. Ensure the venv path is correct
2. Verify vLLM-Omni is installed: `pip show vllm-omni`
3. Try restarting the playground

### Out of Memory

Image and video generation requires significant VRAM:
- 16GB minimum for most image models
- 24GB+ for larger models and video generation
- Use `--gpu-memory-utilization` to limit VRAM usage

### Container Pull Fails

If container pull fails:
1. Ensure Docker/Podman is running
2. Check network connectivity
3. Try pulling manually: `docker pull vllm/vllm-omni:v0.14.0rc1`

## References

- [vLLM-Omni GitHub](https://github.com/vllm-project/vllm-omni)
- [vLLM Documentation](https://docs.vllm.ai)
- [vLLM-Omni Blog Post](https://blog.vllm.ai/2025/01/27/vllm-v0.7.3-release-notes.html)
