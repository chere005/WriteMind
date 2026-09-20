import AppKit
import SwiftUI

/// The notes that are open, in the order they were opened. Sublime Text's
/// bar: the one in front is lit, the rest are a click away, and ⌘W closes one
/// rather than the window. The wheel moves along the row a tab at a time, and
/// the button on the right lists everything that is open (Sean, 2026-09-18) —
/// which is the way back to a tab that has been scrolled off the end.
struct TabBar: View {
    @EnvironmentObject private var store: NoteStore

    @State private var request: ScrollRequest?
    @State private var focused: Note.ID?
    @State private var hovering = false
    @State private var wheelMonitor: Any?
    @State private var wheelTravel: CGFloat = 0

    private struct ScrollRequest: Equatable {
        let id: Note.ID
        let token: Int
    }

    var body: some View {
        HStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView(.horizontal) {
                    HStack(spacing: 1) {
                        ForEach(tabs) { note in
                            tab(note)
                                .id(note.id)
                        }
                        // The + tab: a new note, the same as the sidebar's
                        // New Note button (Sean, 2026-09-18) — it opens
                        // selected, so its tab appears here in front.
                        Button {
                            store.createNote()
                        } label: {
                            Image(systemName: "plus")
                                .font(.system(size: 10, weight: .bold))
                                .frame(width: 24, height: 22)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .foregroundStyle(.secondary)
                        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 5))
                        .padding(.leading, 3)
                        .help("New note (⌘N)")
                        .accessibilityLabel("New Tab")
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 4)
                }
                .scrollIndicators(.never)
                .onChange(of: store.selection) { _, selection in
                    guard let selection else { return }
                    focused = selection
                    withAnimation(.easeInOut(duration: 0.15)) { proxy.scrollTo(selection, anchor: .center) }
                }
                .onChange(of: request) { _, request in
                    guard let request else { return }
                    withAnimation(.easeInOut(duration: 0.12)) { proxy.scrollTo(request.id, anchor: .center) }
                }
            }
            .onHover { hovering = $0 }

            Divider().frame(height: 18)

            Menu {
                ForEach(tabs) { note in
                    Button {
                        store.selection = note.id
                    } label: {
                        if note.id == store.selection {
                            Label(note.title, systemImage: "checkmark")
                        } else {
                            Text(note.title)
                        }
                    }
                }
                if !tabs.isEmpty {
                    Divider()
                    Button("Close Other Tabs") {
                        if let selection = store.selection { store.closeOtherTabs(keeping: selection) }
                    }
                    .disabled(store.selection == nil || tabs.count < 2)
                }
            } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .frame(width: 26)
            .padding(.trailing, 4)
            .help(tabs.count == 1 ? "1 open note" : "\(tabs.count) open notes")
            .accessibilityLabel("Open Notes")
        }
        .frame(height: 32)
        .background(.bar)
        .onAppear { watchWheel() }
        .onDisappear { unwatchWheel() }
    }

    private var tabs: [Note] {
        store.openNoteIDs.compactMap { id in store.notes.first { $0.id == id } }
    }

    /// A wheel over the bar walks along it. A mouse only sends vertical
    /// deltas, and a row of tabs is the one place that has to mean sideways.
    private func watchWheel() {
        guard wheelMonitor == nil else { return }
        wheelMonitor = NSEvent.addLocalMonitorForEvents(matching: [.scrollWheel]) { event in
            guard hovering else { return event }
            let delta = abs(event.scrollingDeltaX) > abs(event.scrollingDeltaY)
                ? event.scrollingDeltaX : event.scrollingDeltaY
            wheelTravel += delta
            // One tab per notch of the wheel, not one per pixel of the swipe.
            while abs(wheelTravel) >= 12 {
                step(wheelTravel > 0 ? -1 : 1)
                wheelTravel -= wheelTravel > 0 ? 12 : -12
            }
            return nil
        }
    }

    private func unwatchWheel() {
        if let wheelMonitor { NSEvent.removeMonitor(wheelMonitor) }
        wheelMonitor = nil
    }

    private func step(_ direction: Int) {
        let ids = tabs.map(\.id)
        guard !ids.isEmpty else { return }
        let current = focused ?? store.selection ?? ids[0]
        let index = ids.firstIndex(of: current) ?? 0
        let next = min(max(index + direction, 0), ids.count - 1)
        guard next != index || request == nil else { return }
        focused = ids[next]
        request = ScrollRequest(id: ids[next], token: (request?.token ?? 0) + 1)
    }

    private func tab(_ note: Note) -> some View {
        let isActive = store.selection == note.id
        return HStack(spacing: 5) {
            Text(note.title)
                .font(.system(size: 12, weight: isActive ? .semibold : .regular))
                .lineLimit(1)
            Button {
                store.closeTab(note.id)
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 8, weight: .bold))
                    .frame(width: 13, height: 13)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .foregroundStyle(.secondary)
            .help("Close this tab (⌘W)")
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .frame(maxWidth: 190)
        .background(isActive ? Color.accentColor.opacity(0.22) : Color.primary.opacity(0.06),
                    in: RoundedRectangle(cornerRadius: 5))
        .contentShape(Rectangle())
        .onTapGesture { store.selection = note.id }
        .background(MiddleClickCatcher { store.closeTab(note.id) })
        .contextMenu {
            Button("Close Tab") { store.closeTab(note.id) }
            Button("Close Other Tabs") { store.closeOtherTabs(keeping: note.id) }
            Divider()
            Button("Reveal in Finder") { NSWorkspace.shared.activateFileViewerSelecting([note.url]) }
        }
        .help(note.url.path)
    }
}

/// A middle click on a tab closes it, as in every browser (Sean, 2026-09-18).
/// SwiftUI has no middle-click gesture, and a middle click never reached an
/// AppKit view behind the tab either — the hosting view keeps its events. So
/// the view behind each tab only knows WHERE the tab is, and one monitor
/// watches for middle clicks and asks each of them: the view converts the
/// click into its own coordinates, which is exact, where SwiftUI's global
/// space and the window's do not agree on where the titlebar is.
private struct MiddleClickCatcher: NSViewRepresentable {
    let action: () -> Void

    func makeNSView(context: Context) -> CatcherView { CatcherView(action: action) }
    func updateNSView(_ view: CatcherView, context: Context) { view.action = action }

    final class CatcherView: NSView {
        var action: () -> Void

        private static let live = NSHashTable<CatcherView>.weakObjects()
        private static var monitor: Any?

        init(action: @escaping () -> Void) {
            self.action = action
            super.init(frame: .zero)
            Self.live.add(self)
            Self.watch()
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

        /// Never in the way of a left click.
        override func hitTest(_ point: NSPoint) -> NSView? { nil }

        private static func watch() {
            guard monitor == nil else { return }
            monitor = NSEvent.addLocalMonitorForEvents(matching: [.otherMouseDown]) { event in
                guard event.buttonNumber == 2, let window = event.window else { return event }
                for view in live.allObjects where view.window === window && !view.isHiddenOrHasHiddenAncestor {
                    let point = view.convert(event.locationInWindow, from: nil)
                    // visibleRect, not bounds: a tab scrolled off the end of
                    // the bar is not under the pointer just because its
                    // frame is.
                    if view.visibleRect.contains(point) {
                        view.action()
                        return nil
                    }
                }
                return event
            }
        }
    }
}
