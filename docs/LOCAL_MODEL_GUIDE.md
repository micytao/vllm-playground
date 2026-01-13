# Local Model Support Guide

## Overview

vLLM Playground now supports loading models from local directories, enabling you to:
- Use compressed models created by LLM-Compressor
- Load pre-downloaded models from HuggingFace
- Use custom fine-tuned models
- Work offline without re-downloading models

## Features

### 1. Model Source Selection
- **HuggingFace Hub**: Download and use models from HuggingFace (default)
- **Local Folder**: Load models from your local filesystem

### 2. Automatic Validation
- Validates directory structure before starting server
- Checks for required files (config.json, tokenizer_config.json, model weights)
- Displays model information (type, size, architecture)
- Provides detailed error messages if validation fails

### 3. Compression Integration
- One-click loading of compressed models
- Seamless workflow: Compress → Load → Start Server
- Automatic path population and validation

## How to Use

### Using HuggingFace Hub (Default)

1. Select "🤗 HuggingFace" as model source
2. Choose a model from the dropdown or enter a custom model name
3. For gated models (Llama, Gemma), provide your HF token
4. Click "Start Server"

### Using Local Models

#### Method 1: Manual Path Entry

1. Select "📁 Local" as model source
2. Enter the **absolute path** to your model directory
   - Example: `/Users/username/models/my-model`
   - Example: `/home/username/compressed_models/TinyLlama-w8a8`
   - Example: `~/models/my-model` (tilde expands to home directory)
3. Click **"Validate"** button below the input to validate the path
   - Or the path will be automatically validated when you click away from the input
4. Review model information displayed
5. Configure server settings (CPU/GPU, memory, etc.)
6. Click "Start Server"

#### Method 2: Browse for Folder

1. Select "📁 Local" as model source
2. Click **"📁 Browse"** button
   - Chrome/Edge: Native OS folder picker opens
   - Other browsers: Web-based folder browser modal
3. Navigate and select your model directory
4. Path is automatically validated
5. Click "Start Server"

#### Method 2: Load Compressed Model

1. Go to "🔧 Model Compression" section
2. Configure and run compression on a model
3. Wait for compression to complete
4. Click "Load into vLLM" button
5. Model path will be automatically populated and validated
6. Click "Start Server"

## Directory Structure Requirements

A valid model directory must contain:

### Required Files
- `config.json` - Model configuration
- `tokenizer_config.json` - Tokenizer configuration
- Model weights in one of these formats:
  - `*.safetensors` (recommended)
  - `*.bin` (PyTorch)
  - `pytorch_model.bin`
  - `model.safetensors`

### Example Structure
```
my-model/
├── config.json
├── tokenizer_config.json
├── tokenizer.json
├── special_tokens_map.json
├── model-00001-of-00002.safetensors
└── model-00002-of-00002.safetensors
```

## Validation Messages

### Success
✅ **Valid model directory**
- Shows model name, type, size
- Green checkmark indicator
- Model info box displayed

### Error Messages
❌ **Path does not exist**
- Directory not found at specified path
- Check for typos or incorrect path

❌ **Missing required files**
- Lists which files are missing
- Ensure complete model download/export

❌ **No model weight files found**
- No .safetensors or .bin files detected
- Download or generate model weights

## API Endpoints

### Validate Local Model Path
```bash
POST /api/models/validate-local
Content-Type: application/json

{
  "path": "/absolute/path/to/model"
}
```

**Response (Success):**
```json
{
  "valid": true,
  "info": {
    "path": "/absolute/path/to/model",
    "model_type": "llama",
    "architectures": ["LlamaForCausalLM"],
    "size_mb": 2200.5,
    "weight_format": "*.safetensors"
  }
}
```

**Response (Error):**
```json
{
  "valid": false,
  "error": "Missing required files: config.json"
}
```

## Configuration

### Backend (Python)
```python
config = VLLMConfig(
    local_model_path="/path/to/model",  # Takes precedence over 'model'
    use_cpu=True,
    cpu_kvcache_space=4,
    # ... other settings
)
```

### Frontend (JavaScript)
```javascript
const config = {
    model: "fallback-model-name",
    local_model_path: "/path/to/model",  // Set if using local model
    // ... other settings
};
```

## Tips & Best Practices

1. **Use Absolute Paths**: Always provide full absolute paths, not relative paths
2. **Validate Before Starting**: Path validation happens automatically, but you can trigger it manually by clicking outside the input field
3. **Check Disk Space**: Ensure sufficient disk space for model loading and KV cache
4. **Compressed Models**: Compressed models work exactly like regular models - just point to the directory
5. **Model Format**: Safetensors format is recommended for faster loading and better security

## Troubleshooting

### "Path does not exist"
- Verify the path is correct and absolute
- Check permissions - ensure read access to the directory
- You can use `~` for home directory (e.g., `~/models/my-model`)
- The path will be automatically expanded to full absolute path

### "Missing required files"
- Ensure the model was fully downloaded or exported
- Check if files were moved or deleted
- Re-download or re-export the model if necessary

### "No model weight files found"
- Model may have been partially downloaded
- Check if weights are in a subdirectory
- Ensure files have correct extensions (.safetensors or .bin)

### Server fails to start
- Check server logs for detailed error messages
- Verify model format is compatible with vLLM
- Ensure sufficient system resources (RAM/VRAM)
- Try reducing `max_model_len` or `cpu_kvcache_space`

## Workflow Examples

### Example 1: Using a Pre-downloaded Model
```bash
# 1. Download model using huggingface-cli
huggingface-cli download TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --local-dir /Users/me/models/tinyllama

# 2. In vLLM Playground:
#    - Select "Local Folder"
#    - Enter: /Users/me/models/tinyllama
#    - Click "Start Server"
```

### Example 2: Compress Then Load
```bash
# 1. In vLLM Playground, go to "Model Compression" section
# 2. Select model: TinyLlama/TinyLlama-1.1B-Chat-v1.0
# 3. Choose format: W8A8_INT8
# 4. Click "Compress Model"
# 5. After completion, click "Load into vLLM"
# 6. Click "Start Server"
```

### Example 3: Custom Fine-tuned Model
```bash
# 1. Export your fine-tuned model to a directory
python export_model.py --output-dir /path/to/my-finetuned-model

# 2. In vLLM Playground:
#    - Select "Local Folder"
#    - Enter: /path/to/my-finetuned-model
#    - Validate
#    - Start Server
```

## Technical Details

### Validation Process
1. **Path Check**: Verify directory exists and is accessible
2. **File Check**: Ensure config.json and tokenizer_config.json present
3. **Weights Check**: Confirm at least one weight file exists
4. **Info Extraction**: Read model_type and architecture from config
5. **Size Calculation**: Sum total directory size

### Priority Rules
- If `local_model_path` is provided, it takes precedence over `model`
- The `model` field is still required as a fallback identifier
- HF token is not required for local models (only for HF Hub gated models)

### Server Startup
1. Frontend validates path using `/api/models/validate-local`
2. Config with `local_model_path` sent to `/api/start`
3. Backend validates path again (comprehensive check)
4. vLLM started with local path as `--model` argument
5. vLLM loads model from local directory

## Support

For issues or questions:
- Check server logs for detailed error messages
- Verify model directory structure matches requirements
- Ensure vLLM version supports local model loading
- Consult vLLM documentation for model format requirements

## Changelog

### v1.0.0 (Current)
- Added model source toggle (HuggingFace Hub / Local Folder)
- Implemented local path validation API
- Added model information display
- Integrated with compression feature
- Added comprehensive error handling
- Created documentation and examples
