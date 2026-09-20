import AppKit
import SwiftUI

extension Color {
    /// `#RRGGBB` or `#RRGGBBAA`, with or without the hash.
    init?(hex: String) {
        var raw = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.hasPrefix("#") { raw.removeFirst() }
        guard raw.count == 6 || raw.count == 8, let value = UInt64(raw, radix: 16) else { return nil }
        let hasAlpha = raw.count == 8
        let r = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
        let g = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
        let b = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
        let a = hasAlpha ? Double(value & 0xFF) / 255 : 1
        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)
    }

    /// `#RRGGBB`, always six digits — the alpha is dropped on purpose so a
    /// half-transparent pick still round-trips through AppStorage as a colour.
    var hexString: String {
        let ns = NSColor(self).usingColorSpace(.sRGB) ?? NSColor.black
        let r = Int((ns.redComponent * 255).rounded())
        let g = Int((ns.greenComponent * 255).rounded())
        let b = Int((ns.blueComponent * 255).rounded())
        return String(format: "#%02X%02X%02X", r, g, b)
    }
}
