import Foundation

// MARK: - Data Structures

struct APIParam: Identifiable, Codable {
    var id = UUID()
    let name: String
    let type: String
    let required: Bool
    let defaultValue: String
    let description: String
}

struct APIEndpoint: Identifiable, Codable {
    var id = UUID()
    let method: HTTPMethod
    let path: String
    let name: String
    let category: EndpointCategory
    let description: String
    let parameters: [APIParam]
    let sampleCurl: String
    let samplePython: String

    enum HTTPMethod: String, Codable {
        case get = "GET"
        case post = "POST"
        case websocket = "WebSocket"
    }

    enum EndpointCategory: String, CaseIterable, Codable {
        case generative = "Generative"
        case audio = "Audio"
        case embeddingsPooling = "Embeddings & Pooling"
        case tokenizer = "Tokenizer"
        case system = "System"
    }
}

struct ClassProperty: Identifiable, Codable {
    var id = UUID()
    let name: String
    let type: String
    let defaultValue: String
    let description: String
}

struct PythonAPIClass: Identifiable, Codable {
    var id = UUID()
    let name: String
    let category: PythonAPICategory
    let description: String
    let properties: [ClassProperty]
    let samplePython: String

    enum PythonAPICategory: String, CaseIterable, Codable {
        case core = "Core"
        case engines = "Engines"
        case configuration = "Configuration"
        case multiModal = "Multi-Modal"
    }
}

// MARK: - Online Inference: HTTP Endpoints

enum VLLMEndpoints {
    static let all: [APIEndpoint] = generative + audio + embeddingsPooling + tokenizer + system

    // ── Generative ──

    static let generative: [APIEndpoint] = [
        APIEndpoint(
            method: .post,
            path: "/v1/chat/completions",
            name: "Chat Completions",
            category: .generative,
            description: "Generate chat completions given a list of messages. Compatible with OpenAI's Chat Completions API. Supports streaming, tool calling, structured outputs, and multi-modal inputs.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model name or ID to use for completion."),
                APIParam(name: "messages", type: "array", required: true, defaultValue: "", description: "List of messages in the conversation. Each message has a role (system/user/assistant) and content."),
                APIParam(name: "temperature", type: "float", required: false, defaultValue: "1.0", description: "Sampling temperature. Higher values make output more random."),
                APIParam(name: "top_p", type: "float", required: false, defaultValue: "1.0", description: "Nucleus sampling threshold."),
                APIParam(name: "max_tokens", type: "int", required: false, defaultValue: "None", description: "Maximum number of tokens to generate."),
                APIParam(name: "stream", type: "bool", required: false, defaultValue: "false", description: "Whether to stream partial results as server-sent events."),
                APIParam(name: "stop", type: "string|array", required: false, defaultValue: "None", description: "Sequences where the API will stop generating."),
                APIParam(name: "frequency_penalty", type: "float", required: false, defaultValue: "0.0", description: "Penalize tokens based on their frequency in the text so far."),
                APIParam(name: "presence_penalty", type: "float", required: false, defaultValue: "0.0", description: "Penalize tokens based on whether they appear in the text so far."),
                APIParam(name: "tools", type: "array", required: false, defaultValue: "None", description: "List of tools the model may call (function calling)."),
                APIParam(name: "tool_choice", type: "string|object", required: false, defaultValue: "auto", description: "Controls which tool the model calls."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/chat/completions \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "messages": [
                  {"role": "user", "content": "Hello!"}
                ],
                "temperature": 0.7,
                "max_tokens": 256
              }'
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            completion = client.chat.completions.create(
                model="meta-llama/Llama-3.1-8B-Instruct",
                messages=[
                    {"role": "user", "content": "Hello!"}
                ],
            )
            print(completion.choices[0].message)
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/v1/completions",
            name: "Text Completions",
            category: .generative,
            description: "Generate text completions for a given prompt. Compatible with OpenAI's Completions API. Suitable for non-chat text generation tasks.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model name or ID to use."),
                APIParam(name: "prompt", type: "string|array", required: true, defaultValue: "", description: "The prompt(s) to generate completions for."),
                APIParam(name: "max_tokens", type: "int", required: false, defaultValue: "16", description: "Maximum number of tokens to generate."),
                APIParam(name: "temperature", type: "float", required: false, defaultValue: "1.0", description: "Sampling temperature."),
                APIParam(name: "top_p", type: "float", required: false, defaultValue: "1.0", description: "Nucleus sampling threshold."),
                APIParam(name: "stream", type: "bool", required: false, defaultValue: "false", description: "Whether to stream partial results."),
                APIParam(name: "logprobs", type: "int", required: false, defaultValue: "None", description: "Include log probabilities of the top N tokens."),
                APIParam(name: "stop", type: "string|array", required: false, defaultValue: "None", description: "Sequences where the API will stop generating."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/completions \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "prompt": "The future of AI is",
                "max_tokens": 128,
                "temperature": 0.7
              }'
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            completion = client.completions.create(
                model="meta-llama/Llama-3.1-8B-Instruct",
                prompt="The future of AI is",
                max_tokens=128,
            )
            print(completion.choices[0].text)
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/v1/responses",
            name: "Responses API",
            category: .generative,
            description: "Generate responses compatible with OpenAI's Responses API. Supports tool use, structured outputs, and multi-turn conversations with built-in state management.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model name or ID."),
                APIParam(name: "input", type: "string|array", required: true, defaultValue: "", description: "Input text or list of input items."),
                APIParam(name: "instructions", type: "string", required: false, defaultValue: "None", description: "System-level instructions for the model."),
                APIParam(name: "temperature", type: "float", required: false, defaultValue: "1.0", description: "Sampling temperature."),
                APIParam(name: "max_output_tokens", type: "int", required: false, defaultValue: "None", description: "Maximum number of output tokens."),
                APIParam(name: "tools", type: "array", required: false, defaultValue: "None", description: "Tools the model can use."),
                APIParam(name: "stream", type: "bool", required: false, defaultValue: "false", description: "Whether to stream the response."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/responses \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "input": "Explain quantum computing briefly."
              }'
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            response = client.responses.create(
                model="meta-llama/Llama-3.1-8B-Instruct",
                input="Explain quantum computing briefly.",
            )
            print(response.output_text)
            """
        ),
    ]

    // ── Audio ──

    static let audio: [APIEndpoint] = [
        APIEndpoint(
            method: .post,
            path: "/v1/audio/transcriptions",
            name: "Transcriptions",
            category: .audio,
            description: "Transcribe audio into text. Compatible with OpenAI's Transcriptions API. Applicable to Automatic Speech Recognition (ASR) models.",
            parameters: [
                APIParam(name: "file", type: "file", required: true, defaultValue: "", description: "The audio file to transcribe (multipart form upload)."),
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model to use for transcription."),
                APIParam(name: "language", type: "string", required: false, defaultValue: "None", description: "Language of the input audio (ISO-639-1)."),
                APIParam(name: "prompt", type: "string", required: false, defaultValue: "None", description: "Optional text to guide transcription style."),
                APIParam(name: "response_format", type: "string", required: false, defaultValue: "json", description: "Output format: json, text, srt, verbose_json, or vtt."),
                APIParam(name: "temperature", type: "float", required: false, defaultValue: "0", description: "Sampling temperature."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/audio/transcriptions \\
              -H "Authorization: Bearer token-abc123" \\
              -F file=@audio.wav \\
              -F model=openai/whisper-large-v3
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            transcription = client.audio.transcriptions.create(
                model="openai/whisper-large-v3",
                file=open("audio.wav", "rb"),
            )
            print(transcription.text)
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/v1/audio/translations",
            name: "Translations",
            category: .audio,
            description: "Translate audio into English text. Compatible with OpenAI's Translations API. Applicable to ASR models that support translation.",
            parameters: [
                APIParam(name: "file", type: "file", required: true, defaultValue: "", description: "The audio file to translate."),
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model to use for translation."),
                APIParam(name: "prompt", type: "string", required: false, defaultValue: "None", description: "Optional text to guide translation style."),
                APIParam(name: "response_format", type: "string", required: false, defaultValue: "json", description: "Output format."),
                APIParam(name: "temperature", type: "float", required: false, defaultValue: "0", description: "Sampling temperature."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/audio/translations \\
              -H "Authorization: Bearer token-abc123" \\
              -F file=@audio_fr.wav \\
              -F model=openai/whisper-large-v3
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            translation = client.audio.translations.create(
                model="openai/whisper-large-v3",
                file=open("audio_fr.wav", "rb"),
            )
            print(translation.text)
            """
        ),

        APIEndpoint(
            method: .websocket,
            path: "/v1/realtime",
            name: "Realtime",
            category: .audio,
            description: "WebSocket endpoint for real-time audio streaming and transcription. Applicable to ASR models that support streaming. Provides low-latency bidirectional communication.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model to use (passed as query param)."),
            ],
            sampleCurl: """
            # WebSocket - use a WS client
            websocat ws://localhost:8000/v1/realtime?model=openai/whisper-large-v3
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            # Use the realtime API for streaming audio
            with client.realtime.connect(
                model="openai/whisper-large-v3"
            ) as conn:
                conn.send_audio(audio_bytes)
                for event in conn:
                    print(event)
            """
        ),
    ]

    // ── Embeddings & Pooling ──

    static let embeddingsPooling: [APIEndpoint] = [
        APIEndpoint(
            method: .post,
            path: "/v1/embeddings",
            name: "Embeddings",
            category: .embeddingsPooling,
            description: "Generate embeddings for input text. Compatible with OpenAI's Embeddings API. Only applicable to embedding models.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Embedding model name or ID."),
                APIParam(name: "input", type: "string|array", required: true, defaultValue: "", description: "Input text(s) to embed."),
                APIParam(name: "encoding_format", type: "string", required: false, defaultValue: "float", description: "Format of the embeddings: float or base64."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/v1/embeddings \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "intfloat/e5-mistral-7b-instruct",
                "input": "Hello world"
              }'
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            embedding = client.embeddings.create(
                model="intfloat/e5-mistral-7b-instruct",
                input="Hello world",
            )
            print(embedding.data[0].embedding[:5])
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/pooling",
            name: "Pooling",
            category: .embeddingsPooling,
            description: "Custom vLLM pooling endpoint. Applicable to all pooling models. Returns pooled output representations.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Pooling model to use."),
                APIParam(name: "input", type: "string|array", required: true, defaultValue: "", description: "Input text(s) to pool."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/pooling \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "intfloat/e5-mistral-7b-instruct",
                "input": "Hello world"
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/pooling",
                json={
                    "model": "intfloat/e5-mistral-7b-instruct",
                    "input": "Hello world",
                },
            )
            print(resp.json())
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/classify",
            name: "Classification",
            category: .embeddingsPooling,
            description: "Custom vLLM classification endpoint. Only applicable to classification models. Returns predicted class labels and scores.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Classification model to use."),
                APIParam(name: "input", type: "string|array", required: true, defaultValue: "", description: "Input text(s) to classify."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/classify \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "jason9693/Qwen2.5-1.5B-apeach",
                "input": "I am so happy today!"
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/classify",
                json={
                    "model": "jason9693/Qwen2.5-1.5B-apeach",
                    "input": "I am so happy today!",
                },
            )
            print(resp.json())
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/score",
            name: "Score",
            category: .embeddingsPooling,
            description: "Compute similarity scores between text pairs. Applicable to embedding models and cross-encoder models.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model to use for scoring."),
                APIParam(name: "text_1", type: "string|array", required: true, defaultValue: "", description: "First text(s) in the pair."),
                APIParam(name: "text_2", type: "string|array", required: true, defaultValue: "", description: "Second text(s) in the pair."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/score \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "BAAI/bge-reranker-v2-m3",
                "text_1": "What is AI?",
                "text_2": "Artificial intelligence is..."
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/score",
                json={
                    "model": "BAAI/bge-reranker-v2-m3",
                    "text_1": "What is AI?",
                    "text_2": "Artificial intelligence is...",
                },
            )
            print(resp.json())
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/rerank",
            name: "Re-rank",
            category: .embeddingsPooling,
            description: "Re-rank documents by relevance to a query. Compatible with Jina AI's and Cohere's re-rank APIs. Also available at /v1/rerank and /v2/rerank. Only applicable to cross-encoder models.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Re-ranking model to use."),
                APIParam(name: "query", type: "string", required: true, defaultValue: "", description: "The search query."),
                APIParam(name: "documents", type: "array", required: true, defaultValue: "", description: "List of documents to re-rank."),
                APIParam(name: "top_n", type: "int", required: false, defaultValue: "None", description: "Number of top results to return."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/rerank \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "BAAI/bge-reranker-v2-m3",
                "query": "What is deep learning?",
                "documents": [
                  "Deep learning is a subset of ML.",
                  "The weather is nice today.",
                  "Neural networks power deep learning."
                ]
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/rerank",
                json={
                    "model": "BAAI/bge-reranker-v2-m3",
                    "query": "What is deep learning?",
                    "documents": [
                        "Deep learning is a subset of ML.",
                        "The weather is nice today.",
                        "Neural networks power deep learning.",
                    ],
                },
            )
            print(resp.json())
            """
        ),
    ]

    // ── Tokenizer ──

    static let tokenizer: [APIEndpoint] = [
        APIEndpoint(
            method: .post,
            path: "/tokenize",
            name: "Tokenize",
            category: .tokenizer,
            description: "Tokenize text into token IDs using the model's tokenizer. Custom vLLM endpoint applicable to any model with a tokenizer.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model whose tokenizer to use."),
                APIParam(name: "prompt", type: "string", required: true, defaultValue: "", description: "Text to tokenize."),
                APIParam(name: "add_special_tokens", type: "bool", required: false, defaultValue: "true", description: "Whether to add special tokens (e.g. BOS)."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/tokenize \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "prompt": "Hello world"
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/tokenize",
                json={
                    "model": "meta-llama/Llama-3.1-8B-Instruct",
                    "prompt": "Hello world",
                },
            )
            print(resp.json())
            """
        ),

        APIEndpoint(
            method: .post,
            path: "/detokenize",
            name: "Detokenize",
            category: .tokenizer,
            description: "Convert token IDs back into text. Custom vLLM endpoint applicable to any model with a tokenizer.",
            parameters: [
                APIParam(name: "model", type: "string", required: true, defaultValue: "", description: "Model whose tokenizer to use."),
                APIParam(name: "tokens", type: "array[int]", required: true, defaultValue: "", description: "List of token IDs to detokenize."),
            ],
            sampleCurl: """
            curl -X POST http://localhost:8000/detokenize \\
              -H "Content-Type: application/json" \\
              -d '{
                "model": "meta-llama/Llama-3.1-8B-Instruct",
                "tokens": [15339, 1917]
              }'
            """,
            samplePython: """
            import requests
            resp = requests.post(
                "http://localhost:8000/detokenize",
                json={
                    "model": "meta-llama/Llama-3.1-8B-Instruct",
                    "tokens": [15339, 1917],
                },
            )
            print(resp.json())
            """
        ),
    ]

    // ── System ──

    static let system: [APIEndpoint] = [
        APIEndpoint(
            method: .get,
            path: "/v1/models",
            name: "List Models",
            category: .system,
            description: "List all models currently available on the server. Compatible with OpenAI's Models API.",
            parameters: [],
            sampleCurl: """
            curl http://localhost:8000/v1/models
            """,
            samplePython: """
            from openai import OpenAI
            client = OpenAI(
                base_url="http://localhost:8000/v1",
                api_key="token-abc123",
            )
            models = client.models.list()
            for m in models.data:
                print(m.id)
            """
        ),

        APIEndpoint(
            method: .get,
            path: "/health",
            name: "Health Check",
            category: .system,
            description: "Check if the vLLM server is running and ready to accept requests. Returns HTTP 200 if healthy.",
            parameters: [],
            sampleCurl: """
            curl http://localhost:8000/health
            """,
            samplePython: """
            import requests
            resp = requests.get("http://localhost:8000/health")
            print(f"Status: {resp.status_code}")
            # 200 = healthy
            """
        ),

        APIEndpoint(
            method: .get,
            path: "/metrics",
            name: "Prometheus Metrics",
            category: .system,
            description: "Expose Prometheus-format metrics for monitoring. Includes request counts, latencies, token throughput, GPU utilization, and more.",
            parameters: [],
            sampleCurl: """
            curl http://localhost:8000/metrics
            """,
            samplePython: """
            import requests
            resp = requests.get("http://localhost:8000/metrics")
            print(resp.text[:500])  # Prometheus text format
            """
        ),
    ]
}

// MARK: - Offline Inference: Python API

enum VLLMPythonAPI {
    static let all: [PythonAPIClass] = core + engines + configuration + multiModal

    // ── Core ──

    static let core: [PythonAPIClass] = [
        PythonAPIClass(
            name: "LLM",
            category: .core,
            description: "Main class for offline LLM inference. Creates an LLM instance that loads a model and runs generation locally without a server. Supports batched inference, sampling, beam search, and multi-modal inputs.",
            properties: [
                ClassProperty(name: "model", type: "str", defaultValue: "", description: "HuggingFace model name or local path."),
                ClassProperty(name: "tokenizer", type: "str | None", defaultValue: "None", description: "Tokenizer name or path. Defaults to the model."),
                ClassProperty(name: "dtype", type: "str", defaultValue: "auto", description: "Data type for model weights (auto, float16, bfloat16, float32)."),
                ClassProperty(name: "quantization", type: "str | None", defaultValue: "None", description: "Quantization method (awq, gptq, fp8, etc.)."),
                ClassProperty(name: "trust_remote_code", type: "bool", defaultValue: "False", description: "Allow code execution from the model repository."),
                ClassProperty(name: "tensor_parallel_size", type: "int", defaultValue: "1", description: "Number of GPUs for tensor parallelism."),
                ClassProperty(name: "gpu_memory_utilization", type: "float", defaultValue: "0.9", description: "Fraction of GPU memory to use."),
                ClassProperty(name: "max_model_len", type: "int | None", defaultValue: "None", description: "Maximum context length. Auto-derived if not set."),
                ClassProperty(name: "enforce_eager", type: "bool", defaultValue: "False", description: "Disable CUDA graphs for debugging."),
                ClassProperty(name: "seed", type: "int", defaultValue: "0", description: "Random seed for reproducibility."),
            ],
            samplePython: """
            from vllm import LLM, SamplingParams

            llm = LLM(model="meta-llama/Llama-3.1-8B-Instruct")
            sampling = SamplingParams(
                temperature=0.8, top_p=0.95, max_tokens=256
            )
            outputs = llm.generate(
                ["What is the meaning of life?"],
                sampling,
            )
            for output in outputs:
                print(output.outputs[0].text)
            """
        ),

        PythonAPIClass(
            name: "SamplingParams",
            category: .core,
            description: "Parameters for controlling text generation sampling. Used with both online and offline inference to control randomness, length, and stopping conditions.",
            properties: [
                ClassProperty(name: "temperature", type: "float", defaultValue: "1.0", description: "Randomness of sampling. 0 = greedy."),
                ClassProperty(name: "top_p", type: "float", defaultValue: "1.0", description: "Nucleus sampling probability threshold."),
                ClassProperty(name: "top_k", type: "int", defaultValue: "-1", description: "Top-K sampling. -1 = disabled."),
                ClassProperty(name: "min_p", type: "float", defaultValue: "0.0", description: "Minimum probability threshold relative to top token."),
                ClassProperty(name: "max_tokens", type: "int | None", defaultValue: "16", description: "Maximum number of tokens to generate."),
                ClassProperty(name: "stop", type: "list[str]", defaultValue: "[]", description: "Stop sequences."),
                ClassProperty(name: "frequency_penalty", type: "float", defaultValue: "0.0", description: "Frequency-based repetition penalty."),
                ClassProperty(name: "presence_penalty", type: "float", defaultValue: "0.0", description: "Presence-based repetition penalty."),
                ClassProperty(name: "repetition_penalty", type: "float", defaultValue: "1.0", description: "Repetition penalty (1.0 = no penalty)."),
                ClassProperty(name: "seed", type: "int | None", defaultValue: "None", description: "Random seed for reproducibility."),
                ClassProperty(name: "logprobs", type: "int | None", defaultValue: "None", description: "Number of log probs to return per token."),
                ClassProperty(name: "best_of", type: "int", defaultValue: "1", description: "Number of candidates to generate, return the best."),
            ],
            samplePython: """
            from vllm import SamplingParams

            # Creative generation
            creative = SamplingParams(
                temperature=0.9, top_p=0.95, max_tokens=512
            )

            # Deterministic / greedy
            greedy = SamplingParams(
                temperature=0, max_tokens=256
            )

            # With repetition penalty
            diverse = SamplingParams(
                temperature=0.7,
                repetition_penalty=1.2,
                max_tokens=256,
            )
            """
        ),

        PythonAPIClass(
            name: "PoolingParams",
            category: .core,
            description: "Parameters for controlling pooling model inference. Used when running embedding or classification models offline.",
            properties: [
                ClassProperty(name: "additional_data", type: "Any | None", defaultValue: "None", description: "Additional data to pass to the pooling model."),
            ],
            samplePython: """
            from vllm import LLM, PoolingParams

            llm = LLM(
                model="intfloat/e5-mistral-7b-instruct",
                runner="pooling",
            )
            params = PoolingParams()
            outputs = llm.encode(
                ["What is deep learning?"],
                params,
            )
            print(outputs[0].outputs.embedding[:5])
            """
        ),
    ]

    // ── Engines ──

    static let engines: [PythonAPIClass] = [
        PythonAPIClass(
            name: "LLMEngine",
            category: .engines,
            description: "Low-level synchronous engine for inference. Provides fine-grained control over request scheduling and execution. Most users should prefer the higher-level LLM class instead.",
            properties: [
                ClassProperty(name: "model_config", type: "ModelConfig", defaultValue: "", description: "Model configuration."),
                ClassProperty(name: "cache_config", type: "CacheConfig", defaultValue: "", description: "KV cache configuration."),
                ClassProperty(name: "parallel_config", type: "ParallelConfig", defaultValue: "", description: "Parallelism configuration."),
                ClassProperty(name: "scheduler_config", type: "SchedulerConfig", defaultValue: "", description: "Scheduler configuration."),
            ],
            samplePython: """
            from vllm import EngineArgs, LLMEngine, SamplingParams

            args = EngineArgs(model="meta-llama/Llama-3.1-8B-Instruct")
            engine = LLMEngine.from_engine_args(args)
            sampling = SamplingParams(temperature=0.7, max_tokens=100)

            engine.add_request("req-001", "Hello!", sampling)
            while engine.has_unfinished_requests():
                outputs = engine.step()
                for output in outputs:
                    if output.finished:
                        print(output.outputs[0].text)
            """
        ),

        PythonAPIClass(
            name: "AsyncLLMEngine",
            category: .engines,
            description: "Asynchronous engine for inference. Designed for building custom async servers or integrating vLLM into async Python applications. Wraps LLMEngine with async/await support.",
            properties: [
                ClassProperty(name: "engine", type: "LLMEngine", defaultValue: "", description: "The underlying synchronous engine."),
                ClassProperty(name: "start_engine_loop", type: "bool", defaultValue: "True", description: "Whether to start the engine loop automatically."),
            ],
            samplePython: """
            import asyncio
            from vllm import AsyncEngineArgs, AsyncLLMEngine, SamplingParams

            async def main():
                args = AsyncEngineArgs(
                    model="meta-llama/Llama-3.1-8B-Instruct"
                )
                engine = AsyncLLMEngine.from_engine_args(args)
                sampling = SamplingParams(temperature=0.7, max_tokens=100)

                async for output in engine.generate(
                    "Hello!", sampling, request_id="req-001"
                ):
                    if output.finished:
                        print(output.outputs[0].text)

            asyncio.run(main())
            """
        ),
    ]

    // ── Configuration ──

    static let configuration: [PythonAPIClass] = [
        PythonAPIClass(
            name: "ModelConfig",
            category: .configuration,
            description: "Configuration for the model. Controls model selection, data types, quantization, context length, and other model-specific settings.",
            properties: [
                ClassProperty(name: "model", type: "str", defaultValue: "", description: "HuggingFace model name or local path."),
                ClassProperty(name: "dtype", type: "str", defaultValue: "auto", description: "Data type for weights and activations."),
                ClassProperty(name: "quantization", type: "str | None", defaultValue: "None", description: "Quantization method."),
                ClassProperty(name: "max_model_len", type: "int | None", defaultValue: "None", description: "Maximum context length."),
                ClassProperty(name: "trust_remote_code", type: "bool", defaultValue: "False", description: "Trust remote code from HuggingFace."),
                ClassProperty(name: "seed", type: "int", defaultValue: "0", description: "Random seed."),
                ClassProperty(name: "enforce_eager", type: "bool", defaultValue: "False", description: "Disable CUDA graphs."),
            ],
            samplePython: """
            from vllm.config import ModelConfig

            config = ModelConfig(
                model="meta-llama/Llama-3.1-8B-Instruct",
                dtype="auto",
                max_model_len=4096,
                trust_remote_code=False,
            )
            """
        ),

        PythonAPIClass(
            name: "CacheConfig",
            category: .configuration,
            description: "Configuration for the KV cache. Controls memory allocation, block sizes, and caching behavior for the key-value cache used during inference.",
            properties: [
                ClassProperty(name: "block_size", type: "int", defaultValue: "16", description: "Token block size for KV cache."),
                ClassProperty(name: "gpu_memory_utilization", type: "float", defaultValue: "0.9", description: "Fraction of GPU memory for KV cache."),
                ClassProperty(name: "swap_space", type: "int", defaultValue: "4", description: "CPU swap space size in GiB."),
                ClassProperty(name: "enable_prefix_caching", type: "bool", defaultValue: "False", description: "Enable automatic prefix caching."),
            ],
            samplePython: """
            from vllm.config import CacheConfig

            cache = CacheConfig(
                gpu_memory_utilization=0.9,
                swap_space=4,
                enable_prefix_caching=True,
            )
            """
        ),

        PythonAPIClass(
            name: "LoadConfig",
            category: .configuration,
            description: "Configuration for loading model weights. Controls the format, download directory, and loading strategy.",
            properties: [
                ClassProperty(name: "load_format", type: "str", defaultValue: "auto", description: "Weight format: auto, pt, safetensors, npcache, dummy, etc."),
                ClassProperty(name: "download_dir", type: "str | None", defaultValue: "None", description: "Directory to download weights to."),
            ],
            samplePython: """
            from vllm.config import LoadConfig

            load_cfg = LoadConfig(
                load_format="safetensors",
                download_dir="/models/cache",
            )
            """
        ),

        PythonAPIClass(
            name: "ParallelConfig",
            category: .configuration,
            description: "Configuration for distributed execution. Controls tensor parallelism, pipeline parallelism, and data parallelism settings.",
            properties: [
                ClassProperty(name: "tensor_parallel_size", type: "int", defaultValue: "1", description: "Number of tensor parallel groups."),
                ClassProperty(name: "pipeline_parallel_size", type: "int", defaultValue: "1", description: "Number of pipeline stages."),
                ClassProperty(name: "data_parallel_size", type: "int", defaultValue: "1", description: "Number of data parallel replicas."),
                ClassProperty(name: "distributed_executor_backend", type: "str | None", defaultValue: "None", description: "Backend: 'ray' or 'mp'."),
            ],
            samplePython: """
            from vllm.config import ParallelConfig

            parallel = ParallelConfig(
                tensor_parallel_size=4,
                pipeline_parallel_size=1,
            )
            """
        ),

        PythonAPIClass(
            name: "SchedulerConfig",
            category: .configuration,
            description: "Configuration for the request scheduler. Controls batching, preemption, and scheduling policies.",
            properties: [
                ClassProperty(name: "max_num_seqs", type: "int", defaultValue: "256", description: "Maximum number of sequences per iteration."),
                ClassProperty(name: "max_num_batched_tokens", type: "int | None", defaultValue: "None", description: "Maximum tokens in a batch."),
                ClassProperty(name: "enable_chunked_prefill", type: "bool", defaultValue: "False", description: "Enable chunked prefill for long prompts."),
            ],
            samplePython: """
            from vllm.config import SchedulerConfig

            scheduler = SchedulerConfig(
                max_num_seqs=256,
                enable_chunked_prefill=True,
            )
            """
        ),

        PythonAPIClass(
            name: "DeviceConfig",
            category: .configuration,
            description: "Configuration for the compute device. Specifies whether to run on CUDA, CPU, TPU, or other accelerators.",
            properties: [
                ClassProperty(name: "device", type: "str", defaultValue: "auto", description: "Device type: auto, cuda, cpu, tpu."),
            ],
            samplePython: """
            from vllm.config import DeviceConfig

            device = DeviceConfig(device="cuda")
            """
        ),
    ]

    // ── Multi-Modal ──

    static let multiModal: [PythonAPIClass] = [
        PythonAPIClass(
            name: "MultiModalDataDict",
            category: .multiModal,
            description: "Dictionary for passing multi-modal inputs (images, audio, video) alongside text prompts. Used with the multi_modal_data field in prompt inputs for models that support vision, audio, or video understanding.",
            properties: [
                ClassProperty(name: "image", type: "Image | list[Image]", defaultValue: "None", description: "PIL image(s) for vision models."),
                ClassProperty(name: "audio", type: "tuple[ndarray, int]", defaultValue: "None", description: "Audio data as (samples, sample_rate)."),
                ClassProperty(name: "video", type: "ndarray | list[Image]", defaultValue: "None", description: "Video frames for video understanding."),
            ],
            samplePython: """
            from vllm import LLM, SamplingParams
            from PIL import Image

            llm = LLM(model="llava-hf/llava-1.5-7b-hf")
            image = Image.open("photo.jpg")

            outputs = llm.generate(
                {
                    "prompt": "<image>\\nDescribe this image.",
                    "multi_modal_data": {"image": image},
                },
                SamplingParams(max_tokens=256),
            )
            print(outputs[0].outputs[0].text)
            """
        ),
    ]
}
