import CoreGraphics
import Foundation

/// WHAT SHAPE THE VIEWFINDER IS (Sean, 2026-09-21: "add aspect ratio
/// control"). It sits beside the turn and the zoom in the Picture panel,
/// because it is the third thing you do to the picture before you take it.
///
/// A ratio here is the SHAPE OF THE VIEWFINDER, not a crop of the camera's
/// own frame and not a setting on the device. The pane lays the whole
/// camera view out inside the largest rectangle of this shape that fits in
/// it, and everything that already worked in pane points — the box you
/// drag, the zoom, what the capture button brings in — goes on working
/// unchanged inside that rectangle, because it is the rectangle they are
/// measured against. Nothing else had to learn about it.
///
/// Both orientations are on the list rather than a ratio plus a flip. A
/// page is photographed upright and a whiteboard sideways, and which one
/// you want is not a modifier of the other — it is the thing you are
/// pointing at. `free` is the picture as the camera hands it over, which
/// is what this app did before there was a choice.
enum CameraAspect: String, CaseIterable, Identifiable {
    case free
    case square
    case fourThree
    case threeFour
    case threeTwo
    case twoThree
    case sixteenNine
    case nineSixteen

    var id: String { rawValue }

    var title: String {
        switch self {
        case .free: return "Free"
        case .square: return "1:1"
        case .fourThree: return "4:3"
        case .threeFour: return "3:4"
        case .threeTwo: return "3:2"
        case .twoThree: return "2:3"
        case .sixteenNine: return "16:9"
        case .nineSixteen: return "9:16"
        }
    }

    /// Width ÷ height. Nil for `free`, which has no shape of its own.
    var ratio: CGFloat? {
        switch self {
        case .free: return nil
        case .square: return 1
        case .fourThree: return 4.0 / 3
        case .threeFour: return 3.0 / 4
        case .threeTwo: return 3.0 / 2
        case .twoThree: return 2.0 / 3
        case .sixteenNine: return 16.0 / 9
        case .nineSixteen: return 9.0 / 16
        }
    }

    /// Whether this is taller than it is wide — what the chips are grouped
    /// by, so the upright ones are together.
    var isUpright: Bool { (ratio ?? 1) < 1 }

    /// The largest rectangle of this shape that fits in the pane. `free`
    /// is the pane itself, so nothing is given away when nothing is asked
    /// for.
    ///
    /// A pane too small to hold anything hands back what it was given: a
    /// zero-sized viewfinder is a divider dragged shut, not a choice, and
    /// every coordinate downstream divides by these numbers.
    func fit(in pane: CGSize) -> CGSize {
        guard let ratio, ratio > 0, pane.width > 1, pane.height > 1 else { return pane }
        let byWidth = CGSize(width: pane.width, height: pane.width / ratio)
        let byHeight = CGSize(width: pane.height * ratio, height: pane.height)
        return byWidth.height <= pane.height ? byWidth : byHeight
    }
}
