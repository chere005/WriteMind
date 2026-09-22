import AppKit
import SwiftUI

/// THE MARK AT AN EVALUATION CELL'S LEFT — `In[n]` over the code, `Out[n]`
/// over its answer, the way a notebook puts them (Sean, 2026-09-22: "show
/// in and out to the left of input and output cells similar to
/// mathematica.. the dropdown for evaluator type will become the In[n]
/// after evaluation").
///
/// ONE COLUMN, so the two boxes of a pair start at the same x. Before this
/// the answer had no mark at all and its box began a badge's width to the
/// left of the code's, which is the first thing the eye notices about a
/// pair that is meant to read as one thing.
///
/// A CELL THAT HAS NOT RUN CARRIES THE CHOICE; ONE THAT HAS CARRIES ITS
/// NUMBER (Sean, 2026-09-22: "the dropdown for selecting an evaluator
/// shows before it's evaluated.. after it's evaluated it disappears and is
/// replaced by the In[]"). So the mark is a BUTTON while there is
/// something to decide — the menu that says what the cell runs as,
/// labelled `PY`, `WL`, `C++` — and a plain label once the cell has an
/// answer, `In[n]` over the code and `Out[n]` over the answer. A notebook
/// reads that way: the margin is a record of what ran, not a row of
/// controls.
///
/// Nothing is lost by the menu going: the fence still says what the cell
/// runs as, in the other pane and in the file, and ⌘9 puts an environment
/// back on the cell the caret is in.
///
/// ALWAYS THERE, whichever it is. It used to be built inside the rendered
/// block, so clicking into a cell to type took it away at the moment you
/// are most likely to want it (Sean, 2026-09-22: "the indicator for
/// WL/Python/C++ never goes away"). It is built out here so the rendered
/// block and the open editor can put the same one in the same place. And
/// there is no ▶: a button for a thing the keyboard already does is one
/// control too many, and ⇧↩ runs the cell the caret is in.
struct CellMark: View {
    enum Role: Equatable {
        /// The code. The environment menu until it has been run, and
        /// `In[n]` afterwards.
        case input(fence: String?, number: Int?)
        /// Its answer. A label, and nothing to press.
        case output(number: Int)
    }

    var role: Role
    /// A run of this cell is in flight — the only thing in this column
    /// that moves.
    var isRunning = false
    var onPick: (Evaluator) -> Void = { _ in }

    /// The column both marks are laid out in. Wide enough for `Out[99]`
    /// at this size; a number past that shrinks rather than clips, which
    /// is the right way round for a mark nobody is meant to read twice.
    static let width: CGFloat = 44
    /// How far down the cell the mark sits: level with the FIRST LINE of
    /// the code, which is the cell's own padding.
    static var topInset: CGFloat { MarkdownPreview.codePadding }
    private static let height: CGFloat = 18
    private static let font = Font.system(size: 9, weight: .semibold, design: .monospaced)

    /// What the mark says.
    static func title(_ role: Role) -> String {
        switch role {
        case .input(let fence, let number):
            if let number { return "In[\(number)]" }
            return Evaluator.from(fence: fence)?.badge ?? "—"
        case .output(let number):
            return "Out[\(number)]"
        }
    }

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            switch role {
            case .input(let fence, nil): button(picking: Evaluator.from(fence: fence))
            default: label
            }
            if isRunning {
                ProgressView().controlSize(.small).frame(height: Self.height)
            }
        }
        .frame(width: Self.width, alignment: .trailing)
        .padding(.top, Self.topInset)
    }

    /// A mark with nothing left to decide — `In[n]` over a cell that has
    /// run, `Out[n]` over its answer. It says which pair this is and does
    /// nothing, so it is drawn as text and not as a control.
    private var label: some View {
        text.foregroundStyle(.secondary).frame(height: Self.height)
    }

    /// The code's mark: A BUTTON, and drawn like one (Sean, 2026-09-22:
    /// "this dropdown icon should look like a button and be positioned
    /// well"). It was bare text on the page, which said nothing about
    /// being pressable — the tooltip and the pointer were the only hints,
    /// and neither is on screen until you are already over it.
    ///
    /// A PLAIN BUTTON POPPING AN NSMenu, and not a SwiftUI `Menu`. A
    /// `Menu` under `.menuStyle(.borderlessButton)` draws its OWN
    /// chevron, on the LEFT, and throws the label's background and
    /// border away — so the thing on screen was a system disclosure
    /// arrow with text beside it, which is neither a button nor lined up
    /// with the `Out[n]` under it. `CellTypeMenu` already pops a real
    /// menu at a screen point for the + on the insertion bar; this is
    /// that, for the evaluators.
    private func button(picking evaluator: Evaluator?) -> some View {
        Button { EvaluatorMenu.popUp(current: evaluator, choose: onPick) } label: {
            HStack(spacing: 3) {
                text
                Image(systemName: "chevron.down").font(.system(size: 6, weight: .black))
            }
            .foregroundStyle(.secondary)
            .padding(.horizontal, 5)
            .frame(height: Self.height)
            .background(Color.secondary.opacity(0.14), in: RoundedRectangle(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4)
                .strokeBorder(Color.secondary.opacity(0.28), lineWidth: 0.75))
        }
        .buttonStyle(.plain)
        .help(evaluator.map { "Runs as \($0.title) — ⇧↩ to run it, or pick another here" }
                ?? "No language: pick what this cell runs as")
        // A BUTTON TAKES THE HAND: the cell's own I-beam runs over it
        // otherwise, and a text cursor on a thing that pops a menu says
        // the wrong thing about what a click will do.
        .pointingHand()
    }

    private var text: some View {
        Text(Self.title(role))
            .font(Self.font)
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

/// The evaluators, as a real menu popped where the pointer is.
///
/// The same shape as `CellTypeMenu`, and for the same reason: a SwiftUI
/// `Menu` cannot be made to look like the button this is meant to be, and
/// there is no NSView behind a rendered cell to pop a menu inside — so it
/// goes up at the screen point, which is where the press was.
enum EvaluatorMenu {
    static func popUp(current: Evaluator?, choose: @escaping (Evaluator) -> Void) {
        let chooser = Chooser(choose: choose)
        let menu = Menu(title: "Runs As")
        // The menu keeps the closure alive: NSMenuItem holds its target
        // weakly and sends the action from inside the menu's own tracking
        // loop, so something has to, and the menu is the thing that
        // outlives exactly as long as the choice can be made.
        menu.chooser = chooser
        menu.autoenablesItems = false
        for evaluator in Evaluator.allCases {
            let item = NSMenuItem(title: evaluator.title, action: #selector(Chooser.pick(_:)),
                                  keyEquivalent: "")
            item.target = chooser
            item.representedObject = evaluator.rawValue
            item.state = evaluator == current ? .on : .off
            menu.addItem(item)
        }
        menu.popUp(positioning: nil, at: NSEvent.mouseLocation, in: nil)
    }

    private final class Menu: NSMenu {
        var chooser: AnyObject?

        override init(title: String) { super.init(title: title) }
        // Never decoded: this menu is built in code every time it is
        // popped, and nothing in the app archives one.
        required init(coder: NSCoder) { fatalError("EvaluatorMenu is not decoded") }
    }

    private final class Chooser: NSObject {
        private let choose: (Evaluator) -> Void

        init(choose: @escaping (Evaluator) -> Void) { self.choose = choose }

        @objc func pick(_ sender: NSMenuItem) {
            guard let raw = sender.representedObject as? String,
                  let evaluator = Evaluator(rawValue: raw) else { return }
            choose(evaluator)
        }
    }
}
