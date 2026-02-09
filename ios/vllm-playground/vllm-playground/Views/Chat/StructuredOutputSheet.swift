import SwiftUI

struct StructuredOutputSheet: View {
    @Binding var config: StructuredOutputConfig?
    @Environment(\.dismiss) private var dismiss

    @State private var selectedType: StructuredOutputType = .jsonObject
    @State private var isEnabled = false

    // Choice
    @State private var choiceText = ""  // Comma-separated

    // Regex
    @State private var regexPattern = ""

    // JSON Schema
    @State private var schemaName = "response"
    @State private var schemaJSON = """
    {
      "type": "object",
      "properties": {
        "answer": { "type": "string" }
      },
      "required": ["answer"]
    }
    """

    // Grammar
    @State private var grammarText = ""

    var body: some View {
        NavigationStack {
            ZStack {
                AppColors.pageBg.ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 20) {
                        // Enable toggle with hero header
                        settingCard {
                            VStack(spacing: 14) {
                                HStack(spacing: 12) {
                                    ZStack {
                                        Circle()
                                            .fill(AppColors.appPrimary.opacity(0.12))
                                            .frame(width: 40, height: 40)
                                        Image(systemName: "text.badge.checkmark")
                                            .font(.body.weight(.medium))
                                            .foregroundStyle(AppColors.appPrimary)
                                    }

                                    VStack(alignment: .leading, spacing: 2) {
                                        Text("Structured Output")
                                            .font(.subheadline.weight(.semibold))
                                            .foregroundStyle(AppColors.textPrimary)
                                        Text("Constrain model responses to a specific format")
                                            .font(.caption)
                                            .foregroundStyle(AppColors.textTertiary)
                                    }

                                    Spacer()

                                    Toggle("", isOn: $isEnabled)
                                        .labelsHidden()
                                        .tint(AppColors.appPrimary)
                                }
                            }
                        }

                        if isEnabled {
                            // Type selector as vertical cards
                            settingCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    sectionLabel("Constraint Type")

                                    ForEach(StructuredOutputType.allCases) { type in
                                        typeCard(type)
                                        if type != StructuredOutputType.allCases.last {
                                            Divider().background(AppColors.border)
                                        }
                                    }
                                }
                            }
                            .transition(.opacity.combined(with: .move(edge: .top)))

                            // Type-specific editor
                            editorCard
                                .transition(.opacity.combined(with: .move(edge: .bottom)))
                        }
                    }
                    .padding(16)
                    .animation(.spring(response: 0.35, dampingFraction: 0.85), value: isEnabled)
                    .animation(.spring(response: 0.3, dampingFraction: 0.8), value: selectedType)
                }
            }
            .navigationTitle("Structured Output")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(AppColors.textSecondary)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Apply") {
                        applyConfig()
                        dismiss()
                    }
                    .foregroundStyle(AppColors.appPrimary)
                    .fontWeight(.semibold)
                }
            }
            .onAppear(perform: loadExisting)
        }
    }

    // MARK: - Type Card

    private func typeCard(_ type: StructuredOutputType) -> some View {
        Button {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                selectedType = type
            }
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(selectedType == type ? typeColor(type).opacity(0.15) : AppColors.inputBg)
                        .frame(width: 36, height: 36)
                    Image(systemName: typeIcon(type))
                        .font(.callout.weight(.medium))
                        .foregroundStyle(selectedType == type ? typeColor(type) : AppColors.textTertiary)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(type.rawValue)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(AppColors.textPrimary)
                    Text(typeDescription(type))
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }

                Spacer()

                if selectedType == type {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.body)
                        .foregroundStyle(AppColors.appPrimary)
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .padding(.vertical, 4)
        }
        .buttonStyle(.plain)
    }

    private func typeIcon(_ type: StructuredOutputType) -> String {
        switch type {
        case .choice: return "list.bullet"
        case .regex: return "textformat.abc"
        case .jsonSchema: return "curlybraces"
        case .jsonObject: return "doc.text"
        case .grammar: return "text.alignleft"
        }
    }

    private func typeColor(_ type: StructuredOutputType) -> Color {
        switch type {
        case .choice: return .orange
        case .regex: return .purple
        case .jsonSchema: return AppColors.appPrimary
        case .jsonObject: return .blue
        case .grammar: return .pink
        }
    }

    private func typeDescription(_ type: StructuredOutputType) -> String {
        switch type {
        case .choice: return "Constrain to a set of values"
        case .regex: return "Match a regular expression"
        case .jsonSchema: return "Conform to a JSON Schema"
        case .jsonObject: return "Output valid JSON"
        case .grammar: return "Follow EBNF grammar rules"
        }
    }

    // MARK: - Type-Specific Editors

    @ViewBuilder
    private var editorCard: some View {
        switch selectedType {
        case .choice:
            settingCard {
                VStack(alignment: .leading, spacing: 10) {
                    sectionLabel("Choices (comma-separated)")
                    TextField("positive, negative, neutral", text: $choiceText)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    if !choiceText.isEmpty {
                        let choices = parseChoices()
                        FlowLayout(spacing: 6) {
                            ForEach(choices, id: \.self) { choice in
                                Text(choice)
                                    .font(.caption.weight(.medium))
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 5)
                                    .background(AppColors.appPrimary.opacity(0.12))
                                    .foregroundStyle(AppColors.appPrimary)
                                    .clipShape(Capsule())
                            }
                        }
                    }
                }
            }

        case .regex:
            settingCard {
                VStack(alignment: .leading, spacing: 8) {
                    sectionLabel("Regex Pattern")
                    HStack(spacing: 8) {
                        Text("/")
                            .font(.system(.callout, design: .monospaced).weight(.bold))
                            .foregroundStyle(AppColors.textTertiary)
                        TextField("\\d{3}-\\d{3}-\\d{4}", text: $regexPattern)
                            .font(.system(.callout, design: .monospaced))
                            .foregroundStyle(AppColors.textPrimary)
                        Text("/")
                            .font(.system(.callout, design: .monospaced).weight(.bold))
                            .foregroundStyle(AppColors.textTertiary)
                    }
                    .padding(12)
                    .background(AppColors.inputBg)
                    .clipShape(RoundedRectangle(cornerRadius: 10))

                    Label("Output will be constrained to match this pattern", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }
            }

        case .jsonSchema:
            settingCard {
                VStack(alignment: .leading, spacing: 10) {
                    sectionLabel("Schema Name")
                    TextField("response", text: $schemaName)
                        .font(.callout)
                        .foregroundStyle(AppColors.textPrimary)
                        .padding(12)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    sectionLabel("JSON Schema")
                    TextEditor(text: $schemaJSON)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(AppColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 150)
                        .padding(10)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    // Validation indicator
                    if !schemaJSON.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        if JSONValue.parse(schemaJSON) != nil {
                            Label("Valid JSON Schema", systemImage: "checkmark.circle.fill")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(AppColors.appSuccess)
                        } else {
                            Label("Invalid JSON -- check syntax", systemImage: "xmark.circle.fill")
                                .font(.caption.weight(.medium))
                                .foregroundStyle(AppColors.appRed)
                        }
                    }
                }
            }

        case .jsonObject:
            settingCard {
                HStack(spacing: 12) {
                    ZStack {
                        Circle()
                            .fill(Color.blue.opacity(0.12))
                            .frame(width: 40, height: 40)
                        Image(systemName: "doc.text")
                            .font(.body)
                            .foregroundStyle(.blue)
                    }

                    VStack(alignment: .leading, spacing: 4) {
                        Text("JSON Object Mode")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(AppColors.textPrimary)
                        Text("The model will be constrained to output valid JSON. No schema is required.")
                            .font(.caption)
                            .foregroundStyle(AppColors.textSecondary)
                    }
                }
            }

        case .grammar:
            settingCard {
                VStack(alignment: .leading, spacing: 8) {
                    sectionLabel("EBNF Grammar")
                    TextEditor(text: $grammarText)
                        .font(.system(.caption, design: .monospaced))
                        .foregroundStyle(AppColors.textPrimary)
                        .scrollContentBackground(.hidden)
                        .frame(minHeight: 120)
                        .padding(10)
                        .background(AppColors.inputBg)
                        .clipShape(RoundedRectangle(cornerRadius: 10))

                    Label("Define grammar rules to constrain output structure", systemImage: "info.circle")
                        .font(.caption)
                        .foregroundStyle(AppColors.textTertiary)
                }
            }
        }
    }

    // MARK: - Helpers

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.footnote.weight(.semibold))
            .foregroundStyle(AppColors.textSecondary)
            .textCase(.uppercase)
    }

    private func settingCard<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        content()
            .padding(16)
            .background(AppColors.cardBg)
            .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func parseChoices() -> [String] {
        choiceText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    private func loadExisting() {
        guard let existing = config else { return }
        isEnabled = true
        switch existing {
        case .choice(let choices):
            selectedType = .choice
            choiceText = choices.joined(separator: ", ")
        case .regex(let pattern):
            selectedType = .regex
            regexPattern = pattern
        case .jsonSchema(let name, let schema):
            selectedType = .jsonSchema
            schemaName = name
            schemaJSON = schema
        case .jsonObject:
            selectedType = .jsonObject
        case .grammar(let g):
            selectedType = .grammar
            grammarText = g
        }
    }

    private func applyConfig() {
        guard isEnabled else {
            config = nil
            return
        }

        switch selectedType {
        case .choice:
            let choices = parseChoices()
            config = choices.isEmpty ? nil : .choice(choices)
        case .regex:
            config = regexPattern.isEmpty ? nil : .regex(regexPattern)
        case .jsonSchema:
            config = schemaJSON.isEmpty ? nil : .jsonSchema(name: schemaName, schema: schemaJSON)
        case .jsonObject:
            config = .jsonObject
        case .grammar:
            config = grammarText.isEmpty ? nil : .grammar(grammarText)
        }
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, position) in result.positions.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + position.x, y: bounds.minY + position.y), proposal: .unspecified)
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, positions: [CGPoint]) {
        let maxWidth = proposal.width ?? .infinity
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var totalHeight: CGFloat = 0
        var totalWidth: CGFloat = 0

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth && x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            positions.append(CGPoint(x: x, y: y))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
            totalWidth = max(totalWidth, x - spacing)
            totalHeight = y + rowHeight
        }

        return (CGSize(width: totalWidth, height: totalHeight), positions)
    }
}

#Preview {
    StructuredOutputSheet(config: .constant(nil))
}
