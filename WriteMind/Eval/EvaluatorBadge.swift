import SwiftUI

/// THE BADGE AT AN EVALUATION CELL'S LEFT: what it runs as, and a menu to
/// change it.
///
/// Sean, 2026-09-21: "the left side of the cell always has an icon with a
/// dropdown for choosing between a wl, c++, or python code cell"; and
/// 2026-09-22: "the indicator for WL/Python/C++ never goes away, and get
/// rid of the play button".
///
/// ALWAYS is the whole point of the view existing. It used to be built
/// inside the rendered block, so clicking into the cell to type replaced
/// the block with a text editor and took the badge with it — the one
/// moment you are most likely to be looking at what the cell runs as is
/// the moment you are writing it. It lives here so both the rendered
/// block and the open editor can put the same badge in the same place.
///
/// And there is NO ▶. Two controls said "what is this" and "do it", and
/// the second was a button for a thing the keyboard already does: ⇧↩ runs
/// the cell the caret is in. Picking the environment rewrites the cell's
/// fence, so the note carries the choice and there is nowhere else for it
/// to disagree.
struct EvaluatorBadge: View {
    /// The cell's info string — `eval python`, `eval wl`, `eval c++`.
    var fence: String?
    /// A run of this cell is in flight, which is the only thing left in
    /// this column that moves.
    var isRunning: Bool
    var onPick: (Evaluator) -> Void

    /// How much of the cell's own padding the badge has to drop past to
    /// sit on its first line of code.
    static let topInset: CGFloat = MarkdownPreview.codePadding
    static let width: CGFloat = 26
    private static let height: CGFloat = 18

    var body: some View {
        let evaluator = Evaluator.from(fence: fence)
        VStack(spacing: 4) {
            Menu {
                ForEach(Evaluator.allCases) { choice in
                    Button { onPick(choice) } label: {
                        HStack {
                            Text(choice.title)
                            if evaluator == choice { Image(systemName: "checkmark") }
                        }
                    }
                }
            } label: {
                Text(evaluator?.badge ?? "—")
                    .font(.system(size: 9, weight: .bold, design: .monospaced))
                    .frame(width: Self.width, height: Self.height)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help(evaluator.map { "Runs as \($0.title) — ⇧↩ to run it, or pick another here" }
                    ?? "No language: pick what this cell runs as")
            // A MENU IS A BUTTON, so it takes the hand: the cell's own
            // I-beam ran over it, and a text cursor on a thing that pops
            // a menu says the wrong thing about what a click will do.
            .pointingHand()

            if isRunning {
                ProgressView().controlSize(.small).frame(width: Self.width, height: Self.height)
            }
        }
        .padding(.top, Self.topInset)
    }
}
