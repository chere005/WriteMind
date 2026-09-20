import AppKit
import SwiftUI

/// The text box's own editor.
///
/// SwiftUI's TextField and TextEditor both bring insets of their own that
/// nobody can see or set, and a text box has to be typed into EXACTLY where
/// it is drawn — otherwise the words shift as the caret arrives and shift
/// back as it leaves, which is what they used to do (Sean, 2026-09-19:
/// "text boxes look like shit… just start over and do better"). So the
/// editor is an NSTextView with the card's own font and padding, no
/// background of its own and no scrolling: what is typed is where it lands.
struct TextBoxField: NSViewRepresentable {
    @Binding var text: String
    /// The colour the card decided is readable on it.
    var ink: NSColor

    func makeNSView(context: Context) -> NSTextView {
        let view = NSTextView()
        view.delegate = context.coordinator
        view.isRichText = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        // Laid out by SwiftUI rather than by a scroll view, so it takes the
        // width it is given and grows down as the words wrap.
        view.minSize = .zero
        view.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude,
                              height: CGFloat.greatestFiniteMagnitude)
        view.autoresizingMask = [.width]
        view.textContainerInset = NSSize(width: TextBoxStyle.padding.width,
                                         height: TextBoxStyle.padding.height)
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.font = TextBoxStyle.font
        view.textColor = ink
        view.insertionPointColor = ink
        view.string = text
        view.setSelectedRange(NSRange(location: (text as NSString).length, length: 0))
        // The box was just put down or just double-clicked: the caret goes
        // in it without another click.
        DispatchQueue.main.async { [weak view] in
            guard let view, let window = view.window else { return }
            window.makeFirstResponder(view)
        }
        return view
    }

    func updateNSView(_ view: NSTextView, context: Context) {
        context.coordinator.text = $text
        if view.string != text { view.string = text }
        if view.textColor != ink {
            view.textColor = ink
            view.insertionPointColor = ink
        }
        view.font = TextBoxStyle.font
    }

    func makeCoordinator() -> Coordinator { Coordinator(text: $text) }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var text: Binding<String>
        init(text: Binding<String>) { self.text = text }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            text.wrappedValue = view.string
        }
    }
}
