import AppKit
import SwiftUI

/// The T button's menu: a font, a size and a colour for the selected text.
/// It writes a `<span style="…">` around the selection — see MarkdownSpans.
struct TextStyleMenu: View {
    @EnvironmentObject private var appState: AppState

    /// A short list beats every font on the Mac in a popover; "Any installed
    /// font…" opens the system panel for the rest.
    private static let families = ["System", "Helvetica Neue", "Avenir Next", "Georgia",
                                   "Palatino", "Times New Roman", "Courier New", "Menlo"]

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Text Style").font(.headline)

            HStack(spacing: 10) {
                Text("Font").frame(width: 42, alignment: .leading)
                Picker("Font", selection: $appState.textFamily) {
                    ForEach(Self.families, id: \.self) { family in
                        Text(family).font(.custom(family == "System" ? "" : family, size: 13)).tag(family)
                    }
                    if !Self.families.contains(appState.textFamily) {
                        Text(appState.textFamily).tag(appState.textFamily)
                    }
                }
                .labelsHidden()
                Button("More…") { pickFromSystemPanel() }
                    .buttonStyle(.link)
                    .help("Choose any font installed on this Mac")
            }

            HStack(spacing: 10) {
                Text("Size").frame(width: 42, alignment: .leading)
                Slider(value: $appState.textSize, in: 9...48, step: 1)
                Text("\(Int(appState.textSize))")
                    .monospacedDigit().foregroundStyle(.secondary)
                    .frame(width: 24, alignment: .trailing)
            }

            HStack(spacing: 10) {
                Text("Colour").frame(width: 42, alignment: .leading)
                ColorPicker("Text colour", selection: colourBinding, supportsOpacity: false)
                    .labelsHidden()
                ForEach(AppState.presetColors, id: \.self) { hex in
                    Button { appState.textColorHex = hex } label: {
                        Circle()
                            .fill(Color(hex: hex) ?? .clear)
                            .frame(width: 18, height: 18)
                            .overlay(
                                Circle().strokeBorder(Color.primary.opacity(0.8), lineWidth: 2)
                                    .opacity(hex.caseInsensitiveCompare(appState.textColorHex) == .orderedSame ? 1 : 0))
                    }
                    .buttonStyle(.plain)
                }
            }

            // Which of the three actually go into the span. Unticking one
            // leaves that part of the text alone rather than pinning it to a
            // default nobody chose.
            HStack(spacing: 14) {
                Toggle("Font", isOn: $appState.textApplyFamily)
                Toggle("Size", isOn: $appState.textApplySize)
                Toggle("Colour", isOn: $appState.textApplyColor)
            }
            .toggleStyle(.checkbox)
            .font(.callout)

            Text(preview).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)

            Divider()

            HStack {
                Button("Remove Styling") { appState.editor.removeSpan() }
                Spacer()
                Button("Apply") { appState.editor.applySpan(appState.spanStyle) }
                    .keyboardShortcut(.defaultAction)
                    .disabled(appState.spanStyle.isEmpty)
            }
        }
        .padding(16)
        .frame(width: 360)
    }

    private var preview: String {
        appState.spanStyle.isEmpty ? "Nothing ticked — Apply would clear the styling."
                                   : "<span style=\"\(appState.spanStyle.css)\">…</span>"
    }

    private var colourBinding: Binding<Color> {
        Binding(get: { Color(hex: appState.textColorHex) ?? .primary },
                set: { appState.textColorHex = $0.hexString })
    }

    private func pickFromSystemPanel() {
        let manager = NSFontManager.shared
        let current = NSFont(name: appState.textFamily, size: appState.textSize)
            ?? NSFont.systemFont(ofSize: appState.textSize)
        manager.setSelectedFont(current, isMultiple: false)
        manager.target = FontPanelTarget.shared
        FontPanelTarget.shared.onChange = { font in
            appState.textFamily = font.familyName ?? font.fontName
            appState.textSize = Double(font.pointSize)
        }
        manager.orderFrontFontPanel(nil)
    }
}

/// NSFontManager reports a pick by sending `changeFont(_:)` up the responder
/// chain; SwiftUI has nowhere to receive that, so this object stands in.
final class FontPanelTarget: NSObject {
    static let shared = FontPanelTarget()
    var onChange: ((NSFont) -> Void)?

    @objc func changeFont(_ sender: Any?) {
        guard let manager = sender as? NSFontManager else { return }
        let converted = manager.convert(NSFont.systemFont(ofSize: 15))
        onChange?(converted)
    }
}
