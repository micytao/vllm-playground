# Issue: Stable Audio Open model outputs no audio data - `final_output_type` defaults to `image` instead of `audio`

## Summary

When serving `stabilityai/stable-audio-open-1.0` with vLLM-Omni, the model loads and processes requests successfully, but **no audio data is returned** in the response. The server logs show `0 images` after generation completes, and all diffusion-specific parameters are ignored.

## Environment

- **vLLM-Omni Version**: 0.14.0
- **vLLM Version**: 0.14.0
- **GPU**: NVIDIA GPU with CUDA
- **OS**: Ubuntu Linux
- **Python**: 3.10

## Steps to Reproduce

1. Start vLLM-Omni server with Stable Audio model:
```bash
vllm serve stabilityai/stable-audio-open-1.0 --omni --port 8091 --enforce-eager
```

2. Send a generation request:
```bash
curl -s http://localhost:8091/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "stabilityai/stable-audio-open-1.0",
    "messages": [
      {"role": "user", "content": "Calm ambient music, soft synthesizer pads, relaxing atmosphere"}
    ],
    "extra_body": {
      "audio_end_in_s": 10.0,
      "num_inference_steps": 50,
      "guidance_scale": 7.0
    }
  }'
```

## Expected Behavior

- The response should contain audio data (base64-encoded WAV) in the `choices[0].message.content` or `choices[0].message.audio` field
- The diffusion parameters (`audio_end_in_s`, `num_inference_steps`, `guidance_scale`) should be applied

## Actual Behavior

1. **All parameters are ignored**:
```
WARNING 01-31 20:58:22 [protocol.py:117] The following fields were present in the request but ignored: {'audio_end_in_s', 'num_inference_steps', 'audio_start_in_s', 'negative_prompt', 'modality', 'guidance_scale'}
```

2. **Diffusion request shows empty params**:
```
INFO 01-31 20:58:22 [serving_chat.py:1891] Diffusion chat request chatcmpl-xxx: prompt='Calm ambient music...', ref_images=0, params={}
```

3. **Stage config shows `image` output type** (should be `audio`):
```
INFO 01-31 20:58:00 [omni_stage.py:100] [OmniStage] stage_config: {
  'stage_id': 0,
  'stage_type': 'diffusion',
  ...
  'final_output': True,
  'final_output_type': 'image'   # <-- WRONG: Should be 'audio' for Stable Audio
}
```

4. **Generation completes but returns 0 outputs**:
```
INFO 01-31 20:58:24 [serving_chat.py:2063] Diffusion chat completed for request chatcmpl-xxx: 0 images
```

5. **Response contains no audio data** - the response is essentially empty or contains only metadata.

## Full Server Logs

<details>
<summary>Click to expand full server logs</summary>

```
[07:57:57] ✅ Server started in subprocess mode on port 8091
[07:58:02] [OMNI] INFO 01-31 20:57:59 [serve.py:60] Detected diffusion model: stabilityai/stable-audio-open-1.0
[07:58:02] [OMNI] INFO 01-31 20:57:59 [api_server.py:1272] vLLM API server version 0.14.0
[07:58:02] [OMNI] INFO 01-31 20:57:59 [utils.py:263] non-default args: {'model_tag': 'stabilityai/stable-audio-open-1.0', 'port': 8091, 'model': 'stabilityai/stable-audio-open-1.0', 'enforce_eager': True}
[07:58:02] [OMNI] INFO 01-31 20:57:59 [omni.py:119] Initializing stages for model: stabilityai/stable-audio-open-1.0
[07:58:02] [OMNI] INFO 01-31 20:58:00 [omni_stage.py:100] [OmniStage] stage_config: {
  'stage_id': 0,
  'stage_type': 'diffusion',
  'runtime': {
    'process': True,
    'devices': '0',
    'max_batch_size': 1
  },
  'engine_args': {
    'parallel_config': {...},
    'vae_use_slicing': False,
    'vae_use_tiling': False,
    'cache_backend': 'none',
    'enable_cpu_offload': False,
    'enable_layerwise_offload': False,
    'enforce_eager': True,
    'model_stage': 'diffusion'
  },
  'final_output': True,
  'final_output_type': 'image'  # <-- BUG: Should be 'audio'
}
[07:58:15] [OMNI] [Stage-0] INFO 01-31 20:58:12 [diffusion_model_runner.py:103] Model loading took 2.7905 GiB and 2.096310 seconds
[07:58:16] [OMNI] INFO 01-31 20:58:13 [api_server.py:346] Detected pure diffusion mode (single diffusion stage)
[07:58:16] [OMNI] INFO 01-31 20:58:13 [api_server.py:381] Pure diffusion API server initialized for model: stabilityai/stable-audio-open-1.0

# Generation request:
[07:58:25] Generating audio: "Calm ambient music, soft synthesizer pads, relaxin..." (10s, 50 steps, guidance: 7)
[07:58:25] [OMNI] WARNING 01-31 20:58:22 [protocol.py:117] The following fields were present in the request but ignored: {'audio_end_in_s', 'num_inference_steps', 'audio_start_in_s', 'negative_prompt', 'modality', 'guidance_scale'}
[07:58:25] [OMNI] INFO 01-31 20:58:22 [serving_chat.py:1891] Diffusion chat request chatcmpl-1dc526338e9540be: prompt='Calm ambient music...', ref_images=0, params={}
[07:58:27] [OMNI] [Stage-0] INFO 01-31 20:58:24 [diffusion_engine.py:80] Generation completed successfully.
[07:58:27] [OMNI] INFO 01-31 20:58:24 [serving_chat.py:2063] Diffusion chat completed for request chatcmpl-1dc526338e9540be: 0 images
[07:58:27] Audio generated in 1.7s
```

</details>

## Root Cause Analysis

After investigating the vLLM-Omni source code, I found the following:

### 1. StableAudioPipeline Implementation is Correct

The `StableAudioPipeline` in `vllm_omni/diffusion/models/stable_audio/pipeline_stable_audio.py` correctly:
- Implements `SupportAudioOutput` interface
- Returns `DiffusionOutput(output=audio)` with audio tensor
- Reads parameters from `req.sampling_params.extra_args`:
```python
audio_start_in_s = req.sampling_params.extra_args.get("audio_start_in_s", audio_start_in_s)
audio_end_in_s = req.sampling_params.extra_args.get("audio_end_in_s", audio_end_in_s)
```

### 2. Missing Default Stage Config for Stable Audio

Unlike other models (Qwen2.5-Omni, Qwen3-Omni, Bagel, etc.) which have default stage configs in `vllm_omni/model_executor/stage_configs/`, **there is no `stable_audio.yaml`** stage config file.

Current stage configs available:
- `qwen2_5_omni.yaml`
- `qwen3_omni_moe.yaml`
- `qwen3_tts.yaml`
- `bagel.yaml`
- etc.

**Missing**: `stable_audio.yaml`

### 3. Auto-Detection Defaults to Image Output

When no stage config is provided, the auto-detection logic sets `final_output_type: 'image'` instead of detecting that Stable Audio should output audio.

### 4. Parameters Not Routed to `extra_args`

The API layer (`protocol.py`) is ignoring the `extra_body` parameters instead of routing them to `OmniDiffusionSamplingParams.extra_args` where the pipeline expects them.

## Proposed Fix

### Option 1: Add Default Stage Config (Recommended)

Add a default stage config for Stable Audio at `vllm_omni/model_executor/stage_configs/stable_audio.yaml`:

```yaml
# Stage config for Stable Audio Open (stabilityai/stable-audio-open-1.0)

stage_args:
  - stage_id: 0
    stage_type: diffusion
    runtime:
      process: true
      devices: "0"
      max_batch_size: 1
    engine_args:
      model_stage: diffusion
      model_arch: StableAudioPipeline
      gpu_memory_utilization: 0.8
      enforce_eager: true
      trust_remote_code: true
      engine_output_type: audio
      distributed_executor_backend: "mp"
      enable_prefix_caching: false
    final_output: true
    final_output_type: audio  # <-- Key fix
    is_comprehension: false
    default_sampling_params:
      num_inference_steps: 100
      guidance_scale: 7.0
      seed: 42

runtime:
  enabled: true
  defaults:
    window_size: -1
    max_inflight: 1
```

### Option 2: Auto-Detect Audio Models

Update the model detection logic to automatically set `final_output_type: 'audio'` when detecting audio diffusion models:

```python
# In model detection logic
if model_name.lower().contains("stable-audio") or pipeline_class == "StableAudioPipeline":
    final_output_type = "audio"
```

### Option 3: Route Parameters Correctly

Ensure `extra_body` parameters are properly routed to `OmniDiffusionSamplingParams.extra_args` for diffusion models.

## Workaround

Users can manually specify a stage config file:

```bash
vllm serve stabilityai/stable-audio-open-1.0 --omni --port 8091 \
  --stage-configs-path /path/to/stable_audio.yaml
```

## Related Code References

- **StableAudioPipeline**: `vllm_omni/diffusion/models/stable_audio/pipeline_stable_audio.py`
- **OmniDiffusionSamplingParams**: `vllm_omni/inputs/data.py` (line ~150, `extra_args` field)
- **Stage Config Docs**: https://docs.vllm.ai/projects/vllm-omni/en/latest/configuration/stage_configs/
- **Supported Models**: https://docs.vllm.ai/projects/vllm-omni/en/latest/models/supported_models/

## Additional Context

The `StableAudioPipeline` is listed as a supported model in the documentation, but it appears the integration is incomplete:
1. No default stage config
2. Parameters not routed correctly
3. Output type defaults to image

This affects anyone trying to use Stable Audio with the standard vLLM-Omni serving workflow.

---

**Labels**: bug, audio, stable-audio, diffusion, stage-config

**Priority**: Medium - Model is listed as supported but doesn't work out of the box
