import AppKit
import SwiftUI

/// One block of the note, edited where it sits in the preview.
///
/// It is a real `NSTextView`, and that is the point: every button on the bar
/// goes through `EditorBridge`, and the bridge needs a text view to talk to.
/// With one here, bold, the heading ladder, bullets, quotes, indentation, the
/// text style, ⌘D and the maths menu all work on the rendered page exactly as
/// they do in the source (Sean, 2026-09-18). What it holds is the block's own
/// markdown, styled as it goes — so nothing is hidden and nothing is lost.
struct BlockEditor: NSViewRepresentable {
    @Binding var text: String
    let font: NSFont
    let bridge: EditorBridge
    /// Changing this takes the keyboard.
    var focusToken: Int
    var caretAtStart = false
    var placeholder = ""
    /// A list, a quote or a fenced block: Return adds a line to it rather
    /// than starting a new block.
    var keepsNewlines = false
    var onSplit: ((String, String) -> Void)?
    var onDeleteEmpty: (() -> Void)?
    var onMove: ((Move) -> Void)?

    enum Move { case up, down, out }

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> BlockTextView {
        let view = BlockTextView(usingTextLayoutManager: false)
        view.delegate = context.coordinator
        view.layoutManager?.delegate = context.coordinator.bullets
        // ⌘V with a picture goes on the drawing layer here too, not into the
        // block as nothing (Sean, 2026-09-18).
        view.onPasteImage = { [bridge] in bridge.pasteImage?($0) ?? false }
        view.isRichText = false
        view.allowsUndo = true
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.isContinuousSpellCheckingEnabled = true
        view.isGrammarCheckingEnabled = false
        view.drawsBackground = false
        view.textContainerInset = NSSize(width: 0, height: 2)
        view.isVerticallyResizable = false
        view.isHorizontallyResizable = false
        view.textContainer?.widthTracksTextView = true
        view.textContainer?.lineFragmentPadding = 0
        view.placeholder = placeholder
        view.baseFont = font
        view.string = text
        context.coordinator.restyle(view)
        return view
    }

    func updateNSView(_ view: BlockTextView, context: Context) {
        context.coordinator.parent = self
        view.placeholder = placeholder
        bridge.textView = view

        if view.baseFont != font {
            view.baseFont = font
            context.coordinator.restyle(view)
        }
        // Only take the text from outside when the outside is what changed —
        // otherwise every keystroke would put the caret back at the end.
        if view.string != text, view.window?.firstResponder !== view {
            view.string = text
            context.coordinator.restyle(view)
        }

        if context.coordinator.focusToken != focusToken {
            context.coordinator.focusToken = focusToken
            let caretAtStart = caretAtStart
            DispatchQueue.main.async {
                guard let window = view.window else { return }
                window.makeFirstResponder(view)
                let length = (view.string as NSString).length
                view.setSelectedRange(NSRange(location: caretAtStart ? 0 : length, length: 0))
            }
        }
    }

    static func dismantleNSView(_ view: BlockTextView, coordinator: Coordinator) {
        if coordinator.parent.bridge.textView === view { coordinator.parent.bridge.textView = nil }
        // Nothing may be left that could be undone INTO this view once it is
        // gone (see Coordinator.undoManager).
        coordinator.undoManager.removeAllActions()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: BlockTextView, context: Context) -> CGSize? {
        guard let width = proposal.width, width > 0, width < .infinity else { return nil }
        return CGSize(width: width, height: nsView.height(fitting: width))
    }

    // MARK: -

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: BlockEditor
        var focusToken = Int.min
        /// This editor's own undo stack. Left to itself an NSTextView puts its
        /// undo actions on the WINDOW's undo manager, and a block editor is
        /// torn down every time the block stops being edited — so ⌘Z later
        /// invoked an action whose text view was long freed, and the app
        /// died (WriteMind-2026-09-18-034439.ips: `_NSUndoStack popAndInvoke`
        /// → objc_msgSend on a dead object). A stack the editor owns dies with
        /// it, and is emptied on the way out for good measure.
        let undoManager = UndoManager()
        /// Draws `- ` as a round bullet while the block is being edited.
        let bullets = BulletGlyphs()

        init(_ parent: BlockEditor) { self.parent = parent }

        func undoManager(for view: NSTextView) -> UndoManager? { undoManager }

        func restyle(_ view: BlockTextView) {
            guard let storage = view.textStorage else { return }
            let selection = view.selectedRanges
            MarkdownSourceStyle.apply(to: storage, base: view.baseFont, paragraph: BlockTextView.paragraphStyle)
            view.typingAttributes = [.font: view.baseFont,
                                     .foregroundColor: NSColor.textColor,
                                     .paragraphStyle: BlockTextView.paragraphStyle]
            view.selectedRanges = selection
            view.invalidateIntrinsicContentSize()
        }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? BlockTextView else { return }
            parent.bridge.endOccurrenceRun()
            restyle(view)
            if parent.text != view.string { parent.text = view.string }
        }

        func textView(_ textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard let view = textView as? BlockTextView else { return false }
            let text = view.string
            let caret = view.selectedRange()

            switch selector {
            case #selector(NSResponder.insertNewline(_:)):
                return newline(in: view, text: text, caret: caret)

            case #selector(NSResponder.insertLineBreak(_:)),
                 #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)):
                view.insertText("\n", replacementRange: caret)
                return true

            case #selector(NSResponder.insertTab(_:)):
                parent.bridge.indent()
                return true

            case #selector(NSResponder.insertBacktab(_:)):
                parent.bridge.outdent()
                return true

            case #selector(NSResponder.deleteBackward(_:)):
                if text.isEmpty {
                    parent.onDeleteEmpty?()
                    return true
                }
                return parent.bridge.outdentForBackspace()

            case #selector(NSResponder.cancelOperation(_:)):
                parent.onMove?(.out)
                return true

            case #selector(NSResponder.moveUp(_:)):
                guard PreviewEditing.lineRange(in: text, at: caret.location).location == 0 else { return false }
                parent.onMove?(.up)
                return true

            case #selector(NSResponder.moveDown(_:)):
                let line = PreviewEditing.lineRange(in: text, at: caret.location)
                guard NSMaxRange(line) >= (text as NSString).length else { return false }
                parent.onMove?(.down)
                return true

            default:
                return false
            }
        }

        /// Return: a new block, unless this block is a list — in which case it
        /// is the next item, and an empty item ends the list instead.
        private func newline(in view: BlockTextView, text: String, caret: NSRange) -> Bool {
            if parent.keepsNewlines {
                let lineRange = PreviewEditing.lineRange(in: text, at: caret.location)
                let line = (text as NSString).substring(with: lineRange)
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\n"))
                guard let continuation = PreviewEditing.listContinuation(for: line) else { return false }
                if continuation.isEmpty {
                    view.insertText("", replacementRange: lineRange)
                    parent.onSplit?((view.string as NSString).substring(to: view.selectedRange().location),
                                    (view.string as NSString).substring(from: view.selectedRange().location))
                } else {
                    view.insertText("\n" + continuation, replacementRange: caret)
                }
                return true
            }
            let ns = text as NSString
            parent.onSplit?(ns.substring(to: caret.location), ns.substring(from: NSMaxRange(caret)))
            return true
        }
    }
}

/// A text view that is exactly as tall as what is in it, with a line of grey
/// text when it is empty.
final class BlockTextView: PasteAwareTextView {
    var placeholder = ""
    var baseFont: NSFont = .systemFont(ofSize: 15)

    static let paragraphStyle: NSParagraphStyle = {
        let style = NSMutableParagraphStyle()
        style.lineSpacing = 3
        return style
    }()

    func height(fitting width: CGFloat) -> CGFloat {
        guard let container = textContainer, let manager = layoutManager else { return 22 }
        container.containerSize = NSSize(width: max(width, 1), height: .greatestFiniteMagnitude)
        manager.ensureLayout(for: container)
        let used = manager.usedRect(for: container).height
        return max(ceil(used), baseFont.pointSize * 1.3) + textContainerInset.height * 2
    }

    override var intrinsicContentSize: NSSize {
        NSSize(width: NSView.noIntrinsicMetric, height: height(fitting: bounds.width))
    }

    override func didChangeText() {
        super.didChangeText()
        invalidateIntrinsicContentSize()
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: baseFont,
            .foregroundColor: NSColor.tertiaryLabelColor,
            .paragraphStyle: Self.paragraphStyle
        ]
        (placeholder as NSString).draw(at: NSPoint(x: textContainerInset.width,
                                                   y: textContainerInset.height),
                                       withAttributes: attributes)
    }
}
