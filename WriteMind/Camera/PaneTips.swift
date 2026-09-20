import AppKit
import SwiftUI

// The app's own tooltips, away from the editor's bar.
//
// The bar's tooltips (`BarTip`, `BarTipModifier`, `BarTipBubble` in
// Views/TopBar.swift) are the look Sean asked for — a beat, then a bubble
// that keeps up with the pointer, with a title, keycaps and a line of
// detail — and the camera pane's controls were still on `.help()` (Sean,
// 2026-09-19: "the camera pane's own buttons never had the tooltip
// treatment the editor's bar got").
//
// Two things stop the camera pane simply hosting the bar's own bubble:
//
//  * `BarTipKey`, the anchor preference `barTip(_:)` writes to, is PRIVATE
//    to TopBar.swift, so no other file can read it back out with
//    `.overlayPreferenceValue`. Making it and `BarTipAnchor` internal would
//    let `paneTip`/`PaneTipKey` below be deleted outright.
//  * the bar always has room UNDER it; a pane does not. The three buttons
//    on a drawn box sit at the bottom of the picture when the box does, and
//    the VideoMenu popover is 244 points wide and clips its own content —
//    so a bubble here has to flip above the control and narrow itself to the
//    space it is in. `BarTipBubble` always hangs below and always caps at
//    240.
//
// Everything else is shared, on purpose: the same `BarTip` value, the same
// `BarTipBubble.detailWidth` rule (measured, capped — the fix behind
// BarTipTests) and the same `BarTipTiming`, so walking the pointer from the
// bar onto the video keeps the quick timing instead of waiting again.

/// Where a bubble goes, and how wide the line under its title may be. Pure,
/// so the awkward cases — no room below, a pane narrower than the bubble —
/// are tested rather than eyeballed.
enum PaneTipPlacement {
    /// Between the control and its bubble.
    static let gap: CGFloat = 8
    /// Between the bubble and the edge of the pane it is drawn in.
    static let margin: CGFloat = 6
    /// The chrome either side of the detail line: `BarTipBubble`'s 9pt of
    /// horizontal padding, twice.
    static let chrome: CGFloat = 18

    /// The cap for `BarTipBubble.detailWidth` in a pane this wide: the bar's
    /// 240 where there is room, less in a narrow popover, never so little
    /// that the words stack one per line.
    static func detailCap(within: CGSize) -> CGFloat {
        max(120, min(240, within.width - 2 * margin - chrome))
    }

    /// The bubble's CENTRE. Below the control by preference, above it when
    /// the bottom of the pane is too close, and inside the pane either way.
    static func centre(over: CGRect, bubble: CGSize, within: CGSize) -> CGPoint {
        CGPoint(x: x(over: over, bubble: bubble, within: within),
                y: y(over: over, bubble: bubble, within: within))
    }

    private static func x(over: CGRect, bubble: CGSize, within: CGSize) -> CGFloat {
        let half = bubble.width / 2
        let lowest = half + margin
        let highest = within.width - half - margin
        // A bubble wider than the pane has no honest place: keep it left
        // rather than inverting the range and throwing it off the far side.
        return min(max(over.midX, lowest), max(lowest, highest))
    }

    private static func y(over: CGRect, bubble: CGSize, within: CGSize) -> CGFloat {
        let half = bubble.height / 2
        if over.maxY + gap + bubble.height <= within.height - margin {
            return over.maxY + gap + half
        }
        if over.minY - gap - bubble.height >= margin {
            return over.minY - gap - half
        }
        let lowest = half + margin
        let highest = within.height - half - margin
        return min(max(over.midY, lowest), max(lowest, highest))
    }
}

private struct PaneTipAnchor: Equatable {
    var tip: BarTip
    var bounds: Anchor<CGRect>
}

private struct PaneTipKey: PreferenceKey {
    static let defaultValue: PaneTipAnchor? = nil
    static func reduce(value: inout PaneTipAnchor?, nextValue: () -> PaneTipAnchor?) {
        value = nextValue() ?? value
    }
}

extension View {
    /// Give this control the app's own tooltip. It is drawn by the nearest
    /// enclosing `paneTipHost()` — without one, nothing appears at all.
    func paneTip(_ tip: BarTip) -> some View { modifier(PaneTipModifier(tip: tip)) }

    /// Draw the bubbles for every `paneTip` inside this view, inside this
    /// view's own bounds. A popover is its own window and clips its content,
    /// so a panel put up over the bar (VideoMenu) hosts its own.
    func paneTipHost() -> some View { modifier(PaneTipHost()) }
}

private struct PaneTipModifier: ViewModifier {
    let tip: BarTip
    @State private var hovering = false
    @State private var showing = false

    func body(content: Content) -> some View {
        content
            .onHover { inside in
                hovering = inside
                if !inside {
                    // Remember when the last bubble went away, so the next
                    // control the pointer reaches answers straight away.
                    if showing { BarTipTiming.lastShown = Date() }
                    showing = false
                }
            }
            .task(id: hovering) {
                guard hovering else { return }
                try? await Task.sleep(nanoseconds: BarTipTiming.delay)
                guard !Task.isCancelled, hovering else { return }
                showing = true
                BarTipTiming.lastShown = Date()
            }
            .anchorPreference(key: PaneTipKey.self, value: .bounds) { bounds in
                showing ? PaneTipAnchor(tip: tip, bounds: bounds) : nil
            }
    }
}

private struct PaneTipHost: ViewModifier {
    func body(content: Content) -> some View {
        content.overlayPreferenceValue(PaneTipKey.self) { anchor in
            GeometryReader { proxy in
                if let anchor {
                    PaneTipBubble(tip: anchor.tip, over: proxy[anchor.bounds], within: proxy.size)
                }
            }
            .allowsHitTesting(false)
        }
    }
}

/// The bar's bubble, drawn where it fits. Not private: the tests read it.
struct PaneTipBubble: View {
    let tip: BarTip
    let over: CGRect
    let within: CGSize
    @State private var size: CGSize = .zero

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(tip.title).font(.system(size: 12, weight: .semibold))
                if !tip.keys.isEmpty {
                    HStack(spacing: 2) {
                        ForEach(Array(tip.keys.enumerated()), id: \.offset) { _, key in
                            Text(key)
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .frame(minWidth: 15)
                                .padding(.vertical, 1)
                                .background(Color.primary.opacity(0.10),
                                            in: RoundedRectangle(cornerRadius: 3))
                                .overlay(RoundedRectangle(cornerRadius: 3)
                                    .strokeBorder(Color.primary.opacity(0.14)))
                        }
                    }
                    .foregroundStyle(.secondary)
                }
            }
            if let detail = tip.detail, !detail.isEmpty {
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    // A concrete width, not a maxWidth: under `.fixedSize()`
                    // nothing proposes one and the line draws straight out of
                    // the material behind it (see BarTipTests).
                    .frame(width: BarTipBubble.detailWidth(detail,
                                                           cap: PaneTipPlacement.detailCap(within: within)),
                           alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 7))
        .overlay(RoundedRectangle(cornerRadius: 7).strokeBorder(Color.primary.opacity(0.10)))
        .shadow(color: .black.opacity(0.18), radius: 7, y: 3)
        .fixedSize()
        .background {
            GeometryReader { proxy in
                Color.clear
                    .onAppear { size = proxy.size }
                    .onChange(of: proxy.size) { _, new in size = new }
            }
        }
        .position(placed)
        .transition(.opacity)
    }

    /// Before it has measured itself the bubble has nowhere sensible to be,
    /// so it sits under the control and moves on the next pass.
    private var placed: CGPoint {
        guard size.width > 0, size.height > 0 else {
            return CGPoint(x: over.midX, y: over.maxY + PaneTipPlacement.gap)
        }
        return PaneTipPlacement.centre(over: over, bubble: size, within: within)
    }
}
