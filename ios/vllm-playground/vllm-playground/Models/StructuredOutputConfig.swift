import Foundation

/// Represents the different structured output constraint types supported by vLLM.
enum StructuredOutputConfig: Equatable {
    case choice([String])
    case regex(String)
    case jsonSchema(name: String, schema: String)
    case jsonObject
    case grammar(String)

    var displayName: String {
        switch self {
        case .choice: return "Choice"
        case .regex: return "Regex"
        case .jsonSchema: return "JSON Schema"
        case .jsonObject: return "JSON Object"
        case .grammar: return "Grammar"
        }
    }

    /// Apply this configuration to a ChatCompletionRequest by setting the
    /// appropriate `response_format` or `structured_outputs` field.
    func applyTo(request: inout ChatCompletionRequest) {
        switch self {
        case .jsonObject:
            request.response_format = ResponseFormatPayload(
                type: "json_object",
                json_schema: nil
            )

        case .jsonSchema(let name, let schema):
            if let schemaValue = JSONValue.parse(schema) {
                request.response_format = ResponseFormatPayload(
                    type: "json_schema",
                    json_schema: JsonSchemaPayload(name: name, schema: schemaValue)
                )
            } else {
                #if DEBUG
                print("[StructuredOutput] Failed to parse JSON schema: \(schema.prefix(200))")
                #endif
            }

        case .choice(let choices):
            request.structured_outputs = StructuredOutputsPayload(
                choice: choices,
                regex: nil,
                grammar: nil
            )

        case .regex(let pattern):
            request.structured_outputs = StructuredOutputsPayload(
                choice: nil,
                regex: pattern,
                grammar: nil
            )

        case .grammar(let grammarStr):
            request.structured_outputs = StructuredOutputsPayload(
                choice: nil,
                regex: nil,
                grammar: grammarStr
            )
        }
    }
}

/// Enum identifying the constraint type for picker selection.
enum StructuredOutputType: String, CaseIterable, Identifiable {
    case choice = "Choice"
    case regex = "Regex"
    case jsonSchema = "JSON Schema"
    case jsonObject = "JSON Object"
    case grammar = "Grammar (EBNF)"

    var id: String { rawValue }
}
