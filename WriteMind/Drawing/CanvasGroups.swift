import Foundation

/// Holding several things on the drawing layer as one (Sean, 2026-09-20:
/// "pointer select mode which draws rectangles that can select drawn (or
/// captured) stuff for grouping, deleting, ungrouping... toggle grouping
/// with the button on the screen or ctrl+g").
///
/// A group is nothing but a shared id on the objects in it. It changes what
/// a CLICK picks up and what a marquee brings with it; it does not move,
/// resize or reparent anything, which is why ungrouping leaves the page
/// looking exactly as it did. Moving, scaling and rotating already work
/// over a whole selection, so they needed nothing — the group only has to
/// make sure the selection is whole in the first place.
///
/// Every rule lives here and the canvas holds none of its own, the same way
/// the cells' rules live in `CellSelection`.
enum CanvasGroups {
    /// The selection grown to whole groups: pick one member and you have
    /// them all. Objects in no group are themselves alone.
    static func whole(_ picked: Set<UUID>, in items: [CanvasItem]) -> Set<UUID> {
        guard !picked.isEmpty else { return picked }
        let groups = Set(items.filter { picked.contains($0.id) }.compactMap(\.group))
        guard !groups.isEmpty else { return picked }
        return picked.union(items.filter { $0.group.map(groups.contains) == true }.map(\.id))
    }

    /// What ⌃G (and the button beside the selection) would do next.
    enum Toggle: Equatable {
        /// Put these in a new group.
        case group
        /// Take this group apart.
        case ungroup
        /// Nothing to do: one loose object, or nothing picked.
        case nothing
    }

    /// One toggle, the way Sean asked for it: two or more objects that are
    /// not already one whole group become a group; a selection that IS
    /// exactly one whole group comes apart.
    ///
    /// A selection spanning two groups therefore GROUPS — it becomes one
    /// group of everything in both, which is the answer that lets you build
    /// a bigger group out of smaller ones without taking them apart first.
    static func toggle(_ picked: Set<UUID>, in items: [CanvasItem]) -> Toggle {
        let members = items.filter { picked.contains($0.id) }
        guard members.count > 1 else {
            // One object already in a group is the way OUT of a group of
            // one — which cannot be made, but can be left behind by a
            // delete. Anything else alone has nothing to toggle.
            if members.count == 1, members[0].group != nil { return .ungroup }
            return .nothing
        }
        let groups = Set(members.compactMap(\.group))
        // One group, and nothing outside it is picked, and nothing picked
        // is outside it: that is the whole group, so it comes apart.
        if groups.count == 1, members.allSatisfy({ $0.group != nil }),
           items.filter({ $0.group == groups.first }).count == members.count {
            return .ungroup
        }
        return .group
    }

    /// `items` with everything picked put into one new group. Anything
    /// already in another group is taken out of it and into this one, so
    /// the object is in exactly one group at a time.
    static func grouped(_ picked: Set<UUID>, in items: [CanvasItem], id: UUID = UUID()) -> [CanvasItem] {
        guard toggle(picked, in: items) == .group else { return items }
        // The groups being swallowed whole, so a member that was not itself
        // picked still comes along rather than being left in a group whose
        // other half has gone.
        let swallowed = Set(items.filter { picked.contains($0.id) }.compactMap(\.group))
        return items.map { item in
            var item = item
            guard picked.contains(item.id) || item.group.map(swallowed.contains) == true else { return item }
            // A connector carries no group; setting one is a no-op there.
            item.group = id
            return item
        }
    }

    /// `items` with the picked group taken apart. Only the groups actually
    /// picked are undone; anything else keeps its own.
    static func ungrouped(_ picked: Set<UUID>, in items: [CanvasItem]) -> [CanvasItem] {
        let groups = Set(items.filter { picked.contains($0.id) }.compactMap(\.group))
        guard !groups.isEmpty else { return items }
        return items.map { item in
            var item = item
            guard item.group.map(groups.contains) == true else { return item }
            item.group = nil
            return item
        }
    }

    /// The one step the canvas calls: the items after ⌃G, and nil when the
    /// toggle had nothing to do — so a no-op never lands on the undo stack.
    static func toggled(_ picked: Set<UUID>, in items: [CanvasItem], id: UUID = UUID()) -> [CanvasItem]? {
        switch toggle(picked, in: items) {
        case .group: return grouped(picked, in: items, id: id)
        case .ungroup: return ungrouped(picked, in: items)
        case .nothing: return nil
        }
    }
}
