import Foundation

/// Built-in tool presets matching the web app.
enum ToolPreset: String, CaseIterable, Identifiable {
    case weather
    case calculator
    case search
    case codeExecution
    case database

    var id: String { rawValue }

    var name: String {
        switch self {
        case .weather: return "Weather Tools"
        case .calculator: return "Calculator"
        case .search: return "Web Search"
        case .codeExecution: return "Code Execution"
        case .database: return "Database"
        }
    }

    var description: String {
        switch self {
        case .weather: return "Get weather for locations"
        case .calculator: return "Evaluate math expressions"
        case .search: return "Search the web"
        case .codeExecution: return "Execute Python code"
        case .database: return "Query a database"
        }
    }

    var icon: String {
        switch self {
        case .weather: return "cloud.sun"
        case .calculator: return "function"
        case .search: return "magnifyingglass"
        case .codeExecution: return "terminal"
        case .database: return "cylinder"
        }
    }

    var tools: [ToolDefinition] {
        switch self {
        case .weather:
            return [
                ToolDefinition(function: ToolFunction(
                    name: "get_current_weather",
                    description: "Get the current weather in a given location",
                    parameters: .object([
                        "type": .string("object"),
                        "properties": .object([
                            "location": .object([
                                "type": .string("string"),
                                "description": .string("The city and state, e.g. San Francisco, CA")
                            ]),
                            "unit": .object([
                                "type": .string("string"),
                                "enum": .array([.string("celsius"), .string("fahrenheit")]),
                                "description": .string("Temperature unit")
                            ])
                        ]),
                        "required": .array([.string("location")])
                    ])
                ))
            ]

        case .calculator:
            return [
                ToolDefinition(function: ToolFunction(
                    name: "calculate",
                    description: "Evaluate a mathematical expression",
                    parameters: .object([
                        "type": .string("object"),
                        "properties": .object([
                            "expression": .object([
                                "type": .string("string"),
                                "description": .string("The mathematical expression to evaluate, e.g. '2 + 2 * 3'")
                            ])
                        ]),
                        "required": .array([.string("expression")])
                    ])
                ))
            ]

        case .search:
            return [
                ToolDefinition(function: ToolFunction(
                    name: "web_search",
                    description: "Search the web for information",
                    parameters: .object([
                        "type": .string("object"),
                        "properties": .object([
                            "query": .object([
                                "type": .string("string"),
                                "description": .string("The search query")
                            ]),
                            "num_results": .object([
                                "type": .string("integer"),
                                "description": .string("Number of results to return (default: 5)")
                            ])
                        ]),
                        "required": .array([.string("query")])
                    ])
                ))
            ]

        case .codeExecution:
            return [
                ToolDefinition(function: ToolFunction(
                    name: "execute_python",
                    description: "Execute Python code and return the output",
                    parameters: .object([
                        "type": .string("object"),
                        "properties": .object([
                            "code": .object([
                                "type": .string("string"),
                                "description": .string("The Python code to execute")
                            ])
                        ]),
                        "required": .array([.string("code")])
                    ])
                ))
            ]

        case .database:
            return [
                ToolDefinition(function: ToolFunction(
                    name: "query_database",
                    description: "Execute a SQL query against the database",
                    parameters: .object([
                        "type": .string("object"),
                        "properties": .object([
                            "query": .object([
                                "type": .string("string"),
                                "description": .string("The SQL query to execute")
                            ]),
                            "database": .object([
                                "type": .string("string"),
                                "description": .string("The database name (default: main)")
                            ])
                        ]),
                        "required": .array([.string("query")])
                    ])
                ))
            ]
        }
    }
}
