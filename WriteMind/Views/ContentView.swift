import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var appState: AppState

    var body: some View {
        HStack(spacing: 0) {
            if appState.showSidebar {
                SidebarView()
                    .frame(width: 250)
                    .transition(.move(edge: .leading).combined(with: .opacity))
                Divider()
            }

            // Either pane can be put away — the video from the sidebar
            // header's own toggle, left of New Note (Sean, 2026-09-18); the
            // notes pane from the View menu. AppState keeps at least one up.
            // HSplitView is rebuilt (the .id) when the set of panes changes,
            // because it remembers divider positions for the panes it had and
            // will otherwise hand the survivor the width of the pair.
            HSplitView {
                if appState.showEditor {
                    // The editor carries the formatting bar — which is inside
                    // that pane, over the text only (Sean, 2026-09-18), never
                    // across the sidebar or the video — so it gets the larger
                    // share by default. The video is a viewfinder.
                    EditorPane()
                        .frame(minWidth: 460, idealWidth: 720, maxWidth: .infinity, maxHeight: .infinity)
                }
                if appState.showCamera {
                    CameraPane()
                        .frame(minWidth: 280,
                               idealWidth: appState.showEditor ? 420 : 900,
                               maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .id("\(appState.showEditor)-\(appState.showCamera)")

        }
    }
}
