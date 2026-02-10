import Foundation

// MARK: - Command Type

enum VLLMCommandType: String, CaseIterable {
    case serve = "vllm serve"
    case benchServe = "vllm bench serve"
}

// MARK: - Option Enums

enum DTypeOption: String, CaseIterable, Identifiable {
    case auto = "auto"
    case float16 = "float16"
    case bfloat16 = "bfloat16"
    case float32 = "float32"
    var id: String { rawValue }
}

enum QuantizationOption: String, CaseIterable, Identifiable {
    case none = "none"
    case awq = "awq"
    case gptq = "gptq"
    case fp8 = "fp8"
    case bitsandbytes = "bitsandbytes"
    case gguf = "gguf"
    case marlin = "marlin"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .none: return "None"
        case .awq: return "AWQ"
        case .gptq: return "GPTQ"
        case .fp8: return "FP8"
        case .bitsandbytes: return "BitsAndBytes"
        case .gguf: return "GGUF"
        case .marlin: return "Marlin"
        }
    }
}

enum ToolCallParserOption: String, CaseIterable, Identifiable {
    case none = "none"
    case hermes = "hermes"
    case mistral = "mistral"
    case llama = "llama"
    case jamba = "jamba"
    case granite = "granite"
    var id: String { rawValue }
    var displayName: String {
        switch self {
        case .none: return "None"
        default: return rawValue.capitalized
        }
    }
}

enum BenchBackendOption: String, CaseIterable, Identifiable {
    case openai = "openai"
    case openaiChat = "openai-chat"
    case vllm = "vllm"
    var id: String { rawValue }
}

enum BenchDatasetOption: String, CaseIterable, Identifiable {
    case random = "random"
    case sharegpt = "sharegpt"
    case sonnet = "sonnet"
    case hf = "hf"
    case custom = "custom"
    var id: String { rawValue }
}

// MARK: - ViewModel

@Observable
@MainActor
final class CommandGeneratorViewModel {
    var commandType: VLLMCommandType = .serve

    // ── vllm serve: Model ──
    var modelName = ""
    var dtype: DTypeOption = .auto
    var quantization: QuantizationOption = .none
    var trustRemoteCode = false
    var maxModelLen = ""

    // ── vllm serve: Server ──
    var host = ""
    var port = "8000"
    var apiKey = ""
    var servedModelName = ""

    // ── vllm serve: Parallelism ──
    var tensorParallelSize = "1"
    var pipelineParallelSize = "1"
    var dataParallelSize = "1"

    // ── vllm serve: Memory & Performance ──
    var gpuMemoryUtilization: Double = 0.90
    var maxNumSeqs = ""
    var enforceEager = false
    var enableChunkedPrefill = false
    var enablePrefixCaching = false

    // ── vllm serve: Advanced ──
    var seed = ""
    var maxLogprobs = ""
    var chatTemplate = ""
    var toolCallParser: ToolCallParserOption = .none
    var enableAutoToolChoice = false
    var reasoningParser = ""

    // ── vllm bench serve: Target ──
    var benchHost = "127.0.0.1"
    var benchPort = "8000"
    var benchModel = ""
    var benchBackend: BenchBackendOption = .openai

    // ── vllm bench serve: Workload ──
    var numPrompts = "1000"
    var inputLen = "1024"
    var outputLen = "128"
    var requestRate = "inf"
    var datasetName: BenchDatasetOption = .random

    // ── vllm bench serve: Sampling ──
    var benchTemperature = ""
    var benchTopP = ""
    var benchTopK = ""

    // ── vllm bench serve: Output ──
    var saveResult = false
    var resultDir = ""

    // MARK: - Generated Command

    var generatedCommand: String {
        switch commandType {
        case .serve: return buildServeCommand()
        case .benchServe: return buildBenchServeCommand()
        }
    }

    // MARK: - Reset

    func resetToDefaults() {
        modelName = ""
        dtype = .auto
        quantization = .none
        trustRemoteCode = false
        maxModelLen = ""
        host = ""
        port = "8000"
        apiKey = ""
        servedModelName = ""
        tensorParallelSize = "1"
        pipelineParallelSize = "1"
        dataParallelSize = "1"
        gpuMemoryUtilization = 0.90
        maxNumSeqs = ""
        enforceEager = false
        enableChunkedPrefill = false
        enablePrefixCaching = false
        seed = ""
        maxLogprobs = ""
        chatTemplate = ""
        toolCallParser = .none
        enableAutoToolChoice = false
        reasoningParser = ""
        benchHost = "127.0.0.1"
        benchPort = "8000"
        benchModel = ""
        benchBackend = .openai
        numPrompts = "1000"
        inputLen = "1024"
        outputLen = "128"
        requestRate = "inf"
        datasetName = .random
        benchTemperature = ""
        benchTopP = ""
        benchTopK = ""
        saveResult = false
        resultDir = ""
    }

    // MARK: - Build serve command

    private func buildServeCommand() -> String {
        var parts: [String] = ["vllm serve"]

        // Model (required positional arg)
        let model = modelName.trimmingCharacters(in: .whitespaces)
        if !model.isEmpty {
            parts.append(model)
        } else {
            parts.append("<model>")
        }

        // Model options
        if dtype != .auto { parts.append("--dtype \(dtype.rawValue)") }
        if quantization != .none { parts.append("--quantization \(quantization.rawValue)") }
        if trustRemoteCode { parts.append("--trust-remote-code") }
        if !maxModelLen.isEmpty { parts.append("--max-model-len \(maxModelLen)") }

        // Server
        if !host.isEmpty { parts.append("--host \(host)") }
        if port != "8000" && !port.isEmpty { parts.append("--port \(port)") }
        if !apiKey.isEmpty { parts.append("--api-key \(apiKey)") }
        if !servedModelName.isEmpty { parts.append("--served-model-name \(servedModelName)") }

        // Parallelism
        if tensorParallelSize != "1" && !tensorParallelSize.isEmpty {
            parts.append("--tensor-parallel-size \(tensorParallelSize)")
        }
        if pipelineParallelSize != "1" && !pipelineParallelSize.isEmpty {
            parts.append("--pipeline-parallel-size \(pipelineParallelSize)")
        }
        if dataParallelSize != "1" && !dataParallelSize.isEmpty {
            parts.append("--data-parallel-size \(dataParallelSize)")
        }

        // Memory & Performance
        if abs(gpuMemoryUtilization - 0.90) > 0.001 {
            parts.append("--gpu-memory-utilization \(String(format: "%.2f", gpuMemoryUtilization))")
        }
        if !maxNumSeqs.isEmpty { parts.append("--max-num-seqs \(maxNumSeqs)") }
        if enforceEager { parts.append("--enforce-eager") }
        if enableChunkedPrefill { parts.append("--enable-chunked-prefill") }
        if enablePrefixCaching { parts.append("--enable-prefix-caching") }

        // Advanced
        if !seed.isEmpty && seed != "0" { parts.append("--seed \(seed)") }
        if !maxLogprobs.isEmpty && maxLogprobs != "20" { parts.append("--max-logprobs \(maxLogprobs)") }
        if !chatTemplate.isEmpty { parts.append("--chat-template \(chatTemplate)") }
        if enableAutoToolChoice { parts.append("--enable-auto-tool-choice") }
        if toolCallParser != .none { parts.append("--tool-call-parser \(toolCallParser.rawValue)") }
        if !reasoningParser.isEmpty { parts.append("--reasoning-parser \(reasoningParser)") }

        return parts.joined(separator: " \\\n  ")
    }

    // MARK: - Build bench serve command

    private func buildBenchServeCommand() -> String {
        var parts: [String] = ["vllm bench serve"]

        // Target
        if benchHost != "127.0.0.1" && !benchHost.isEmpty { parts.append("--host \(benchHost)") }
        if benchPort != "8000" && !benchPort.isEmpty { parts.append("--port \(benchPort)") }
        let model = benchModel.trimmingCharacters(in: .whitespaces)
        if !model.isEmpty { parts.append("--model \(model)") }
        if benchBackend != .openai { parts.append("--backend \(benchBackend.rawValue)") }

        // Workload
        if numPrompts != "1000" && !numPrompts.isEmpty { parts.append("--num-prompts \(numPrompts)") }
        if datasetName != .random { parts.append("--dataset-name \(datasetName.rawValue)") }
        if inputLen != "1024" && !inputLen.isEmpty { parts.append("--input-len \(inputLen)") }
        if outputLen != "128" && !outputLen.isEmpty { parts.append("--output-len \(outputLen)") }
        if requestRate != "inf" && !requestRate.isEmpty { parts.append("--request-rate \(requestRate)") }

        // Sampling
        if !benchTemperature.isEmpty { parts.append("--temperature \(benchTemperature)") }
        if !benchTopP.isEmpty { parts.append("--top-p \(benchTopP)") }
        if !benchTopK.isEmpty { parts.append("--top-k \(benchTopK)") }

        // Output
        if saveResult { parts.append("--save-result") }
        if !resultDir.isEmpty { parts.append("--result-dir \(resultDir)") }

        return parts.joined(separator: " \\\n  ")
    }
}
