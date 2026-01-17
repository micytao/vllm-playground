# Usage Examples

Real-world examples of using the command-line demo scripts.

## 🎯 Example 1: Quick 5-Minute Demo

Perfect for presentations or quick tests:

```bash
# Use small model and minimal samples
BASE_MODEL="facebook/opt-125m" \
CALIBRATION_SAMPLES=128 \
BENCHMARK_REQUESTS=50 \
./scripts/demo_full_workflow.sh
```

**Expected Output:**
- vLLM server starts in ~20 seconds
- Chat test completes in ~5 seconds
- - - Benchmark completes in ~2 minutes

**Total time: ~8-12 minutes**

---

## 🎯 Example 2: Full Quality Demo

Complete workflow with high-quality
```bash
# Use TinyLlama with thorough BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
QUANTIZATION_FORMAT="W4A16" \
CALIBRATION_SAMPLES="1024" \
BENCHMARK_REQUESTS="200" \
./scripts/demo_full_workflow.sh
```

**Total time: ~30-40 minutes**

---

## 🎯 Example 4: Load Testing

Stress test your vLLM server:

```bash
# Start with python -m vllm.entrypoints.openai.api_server \
  --model ./  --quantization gptq \
  --port 8000 &

sleep 30

# Progressive load test
echo "Light load (5 req/s)..."
./scripts/benchmark_guidellm.sh 100 5 128 128

echo "Medium load (10 req/s)..."
./scripts/benchmark_guidellm.sh 100 10 128 128

echo "Heavy load (20 req/s)..."
./scripts/benchmark_guidellm.sh 100 20 128 128

echo "Extreme load (50 req/s)..."
./scripts/benchmark_guidellm.sh 100 50 128 128
```

---

## 🎯 Example 5: macOS CPU Demo

Optimized for Apple Silicon:

```bash
# Set CPU environment
export VLLM_CPU_KVCACHE_SPACE=40
export VLLM_CPU_OMP_THREADS_BIND=auto

# Use CPU-friendly model
BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0" \
CALIBRATION_SAMPLES=256 \
BENCHMARK_REQUESTS=50 \
./scripts/demo_full_workflow.sh
```

---

## 🎯 Example 6: Batch Processing Multiple Models

Process multiple models sequentially:

```bash
#!/bin/bash
# batch_
MODELS=(
  "facebook/opt-125m"
  "TinyLlama/TinyLlama-1.1B-Chat-v1.0"
  "microsoft/phi-2"
)

for model in "${MODELS[@]}"; do
  echo "Processing: $model"

  #   ./scripts/    "$model" \
        "W4A16" \
    "GPTQ" \
    512

  echo "Completed: $model"
  echo "---"
done
```

---

## 🎯 Example 7: Custom Configuration

Use a config file for reproducible demos:

```bash
# Create config
cat > my_demo.env << 'EOF'
export BASE_MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"
export VLLM_PORT="8080"
export QUANTIZATION_FORMAT="W4A16"
export CALIBRATION_SAMPLES="512"
export BENCHMARK_REQUESTS="100"
export BENCHMARK_RATE="10"
export PROMPT_TOKENS="256"
export OUTPUT_TOKENS="256"
EOF

# Run with config
source my_demo.env
./scripts/demo_full_workflow.sh
```

---

## 🎯 Example 8: CI/CD Integration

Automate testing in a pipeline:

```bash
#!/bin/bash
# ci_test.sh

set -e  # Exit on error

# Install dependencies
pip install vllm guidellm

# Start server in background
python -m vllm.entrypoints.openai.api_server \
  --model TinyLlama/TinyLlama-1.1B-Chat-v1.0 \
  --port 8000 &
VLLM_PID=$!

# Wait for server
sleep 30

# Run tests
./scripts/test_vllm_serving.sh

# Quick benchmark
./scripts/benchmark_guidellm.sh 50 5 128 128

# Cleanup
kill $VLLM_PID

echo "CI tests passed!"
```

---

## 🎯 Example 9: Remote Server Testing

Test a remote vLLM server:

```bash
# Set remote server details
export VLLM_HOST="remote.server.com"
export VLLM_PORT="8000"

# Test serving
./scripts/test_vllm_serving.sh

# Benchmark remote server
./scripts/benchmark_guidellm.sh 100 5 128 128
```

---

## 🎯 Example 10: Quality Validation

Compare model quality after
```bash
#!/bin/bash
# quality_test.sh

MODEL="TinyLlama/TinyLlama-1.1B-Chat-v1.0"

# Test questions
QUESTIONS=(
  "What is 2+2?"
  "Who was Albert Einstein?"
  "Explain photosynthesis in one sentence."
)

# Function to ask question
ask_question() {
  local model=$1
  local question=$2

  curl -s http://localhost:8000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d "{
      \"model\": \"$model\",
      \"messages\": [{\"role\": \"user\", \"content\": \"$question\"}],
      \"max_tokens\": 100
    }" | python -c "import sys, json; data=json.load(sys.stdin); print(data['choices'][0]['message']['content'])"
}

# Start with base model
python -m vllm.entrypoints.openai.api_server --model "$MODEL" --port 8000 &
sleep 30

echo "=== Base Model Responses ===" | tee quality_results.txt
for q in "${QUESTIONS[@]}"; do
  echo "Q: $q" | tee -a quality_results.txt
  echo "A: $(ask_question "$MODEL" "$q")" | tee -a quality_results.txt
  echo "" | tee -a quality_results.txt
done

# ./scripts/# Restart with pkill -f "vllm.entrypoints.openai.api_server"
sleep 5
python -m vllm.entrypoints.openai.api_server \
  --model "$  --quantization gptq \
  --port 8000 &
sleep 30

echo "=== for q in "${QUESTIONS[@]}"; do
  echo "Q: $q" | tee -a quality_results.txt
  echo "A: $(ask_question "$  echo "" | tee -a quality_results.txt
done

echo "Results saved to quality_results.txt"
```

---

## 🎯 Example 11: Docker Integration

Run demo in a container:

```bash
# Dockerfile
FROM python:3.10

# Install dependencies
RUN pip install vllm guidellm

# Copy scripts
COPY scripts/ /app/scripts/
WORKDIR /app

# Run demo
CMD ["./scripts/demo_full_workflow.sh"]
```

```bash
# Build and run
docker build -t vllm-demo .
docker run -p 8000:8000 vllm-demo
```

---

## 🎯 Example 12: Performance Monitoring

Monitor system resources during benchmark:

```bash
#!/bin/bash
# monitor_benchmark.sh

# Start monitoring in background
(
  while true; do
    echo "$(date): CPU=$(top -l 1 | grep "CPU usage" | awk '{print $3}'), MEM=$(ps aux | awk '{sum+=$4} END {print sum"%"}')"
    sleep 5
  done
) > system_monitor.log &
MONITOR_PID=$!

# Run benchmark
./scripts/benchmark_guidellm.sh 500 10 256 256

# Stop monitoring
kill $MONITOR_PID

echo "System stats saved to system_monitor.log"
```

---

## 📝 Notes

- Adjust `CALIBRATION_SAMPLES` based on time constraints (128=fast, 512=good, 1024=best)
- Use `W4A16` for maximum - Monitor memory usage, especially with larger models
- Results vary based on hardware - these are example timings
- Always test
---

See `docs/CLI_DEMO_GUIDE.md` for more detailed information.
