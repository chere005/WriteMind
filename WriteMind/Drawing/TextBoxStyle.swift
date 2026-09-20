import AppKit
import SwiftUI

/// How a floating text box looks and how it is typed into — ONE description
/// of it, used by the canvas that draws it and by the field that edits it
/// (Sean, 2026-09-19: "text boxes look like shit… just start over and do
/// better").
///
/// What was wrong with the old one, all of it from the two sides disagreeing:
/// the words were drawn at the top left inside six points of padding, and
/// typed into a rounded-border TextField centred over the box with AppKit's
/// own insets, so they jumped the moment the caret arrived and jumped back
/// when it left; the box only grew to fit what had been typed after the
/// typing stopped; an empty box wore a dashed grey outline that read as a
/// glitch; the fill was a hard-cornered rectangle behind a rounded outline;
/// and the ink was whatever the pen was set to, which on a dark fill was
/// nothing at all.
///
/// So: one font, one padding, one corner, one measurement — and the ink is
/// checked against the card it sits on before it is used.
enum TextBoxStyle {
    static let font = NSFont.systemFont(ofSize: 14)
    static var textFont: Font { .system(size: 14) }
    /// Room round the words. The editor uses exactly this, so nothing moves.
    static let padding = CGSize(width: 10, height: 8)
    static let cornerRadius: CGFloat = 6
    /// Nothing narrower is worth typing into.
    static let minimumWidth: CGFloat = 60
    /// The aspect a box falls back to when it is too narrow to measure.
    static let fallbackAspect = 0.3

    // MARK: - Size

    /// How tall the box has to be, in points, to hold `text` at `width`.
    static func height(for text: String, width: CGFloat) -> CGFloat {
        let room = width - padding.width * 2
        guard room > 10 else { return font.boundingRectForFont.height + padding.height * 2 }
        // An empty box still has a line's worth of room, so the caret has
        // somewhere to sit and the card does not collapse.
        let measured = text.isEmpty ? "M" : text
        let bounds = (measured as NSString).boundingRect(
            with: CGSize(width: room, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            attributes: [.font: font])
        return ceil(bounds.height) + padding.height * 2
    }

    /// The same, as height over width — what `ShapeItem.aspect` holds.
    static func aspect(for text: String, boxWidth: CGFloat) -> Double {
        guard boxWidth - padding.width * 2 > 10 else { return fallbackAspect }
        return max(0.08, Double(height(for: text, width: boxWidth) / boxWidth))
    }

    // MARK: - Ink you can read

    /// The pen's colour if it can be read on the card, and black or white if
    /// it cannot (Sean, 2026-09-19: "be mindful of text color... it should
    /// always be visible against the background"). No fill means the note's
    /// own paper, which the pen was picked against, so it is left alone.
    static func readableInk(_ inkHex: String, on fillHex: String?) -> String {
        guard let fillHex, let fill = NSColor(hex: fillHex) else { return inkHex }
        guard let ink = NSColor(hex: inkHex) else { return contrast(with: fill) }
        return ratio(ink, fill) >= 3 ? inkHex : contrast(with: fill)
    }

    /// Black or white, whichever stands out more on `fill`.
    static func contrast(with fill: NSColor) -> String {
        ratio(.black, fill) >= ratio(.white, fill) ? "#000000" : "#FFFFFF"
    }

    /// WCAG's contrast ratio, 1 (identical) to 21 (black on white).
    static func ratio(_ a: NSColor, _ b: NSColor) -> Double {
        let (high, low) = (max(luminance(a), luminance(b)), min(luminance(a), luminance(b)))
        return (high + 0.05) / (low + 0.05)
    }

    /// Relative luminance, gamma taken out the way the standard says.
    static func luminance(_ colour: NSColor) -> Double {
        let rgb = colour.usingColorSpace(.sRGB) ?? .black
        func channel(_ value: Double) -> Double {
            value <= 0.03928 ? value / 12.92 : pow((value + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * channel(rgb.redComponent)
            + 0.7152 * channel(rgb.greenComponent)
            + 0.0722 * channel(rgb.blueComponent)
    }
}
