// A `.wm` note's ZIP container, read for a preview (docs/SPEC-WM.md section 1). The reading half of
// apps/desktop/src/main/zip.ts, in Swift, because a Quick Look extension has no Node: the same refusals in the same
// order, and nothing else.
//
// - Entries are found through the central directory, never by scanning local headers (1.2). Methods STORE and
//   DEFLATE (the Compression framework's raw DEFLATE) only; an encrypted entry, another method, a multi-disk archive,
//   a second end record in the comment, a directory that holds more or fewer entries than it counts: refused (1.3).
// - THE STRUCTURE IS VETTED BEFORE ANYTHING IS INFLATED: the limits of 1.6 (each entry, the sum, the sum against the
//   file's own size), every local header against the directory (name and method), no two entries sharing bytes and none
//   reaching into the directory. Only then is an entry inflated - never past the size it declares - and its CRC checked.
// - Names: the bytes must be UTF-8 here; whether a NAME is acceptable (`..`, `/abs`, a backslash, a control character,
//   twice) is the core's rule (`readNamesError`), which the extension asks through the script before it inflates a
//   byte. A name is only ever a key here: nothing is written to the file system under it.
// - The file is mapped, not read: a 2 GB note costs a preview its central directory and the entries it shows.
//
// Every failure is a `WmArchiveError` whose text the preview shows; nothing here traps on a hostile file (every read
// is bounds-checked first).

import Compression
import Foundation

struct WmArchiveError: Error, CustomStringConvertible {
    let description: String
    init(_ description: String) { self.description = description }
}

struct WmEntry {
    let name: String
    let method: UInt16
    let crc: UInt32
    let compressedSize: Int
    let size: Int
    /// Where its local header is.
    let offset: Int
    /// Where its compressed bytes start (from the local header, checked against the directory).
    var dataStart: Int = 0
    var isDirectory: Bool { name.hasSuffix("/") }
}

/// The limits of SPEC-WM 1.6, as `LIMITS` in main/zip.ts.
enum WmLimits {
    static let entries = 20_000
    static let text = 256 * 1024 * 1024
    static let other = 2 * 1024 * 1024 * 1024
    static let total = 8 * 1024 * 1024 * 1024
    static let ratio = 1000
    static let ratioFrom = 16 * 1024 * 1024
    static let ratioSlack = 16 * 1024 * 1024
    static let textEntries: Set<String> = ["note.mdwm", "drawing.json", "manifest.json"]
}

final class WmArchive {
    private let data: Data
    /// Every entry, in the central directory's order.
    let entries: [WmEntry]
    private let byName: [String: WmEntry]

    var names: [String] { entries.map(\.name) }

    convenience init(url: URL) throws {
        let data: Data
        do { data = try Data(contentsOf: url, options: [.alwaysMapped]) } catch {
            throw WmArchiveError("the file could not be read (\(error.localizedDescription))")
        }
        try self.init(data: data)
    }

    init(data: Data) throws {
        self.data = data
        let place = try WmArchive.directoryPlace(data)
        guard place.offset >= 0, place.size >= 0, place.offset <= data.count, place.size <= data.count - place.offset else {
            throw WmArchiveError("a damaged central directory")
        }
        var list = try WmArchive.parseDirectory(data, from: place.offset, size: place.size, count: place.count)
        try WmArchive.vet(data, &list, directoryAt: place.offset)
        entries = list
        var map: [String: WmEntry] = [:]
        for entry in list where !entry.isDirectory { map[entry.name] = entry }
        byName = map
    }

    func entry(_ name: String) -> WmEntry? { byName[name] }

    // MARK: - Reading little-endian numbers, bounds-checked

    private static func u16(_ d: Data, _ at: Int) throws -> Int {
        guard at >= 0, at + 2 <= d.count else { throw WmArchiveError("this archive is damaged: a record runs past the end of the file") }
        return d.withUnsafeBytes { Int($0.loadUnaligned(fromByteOffset: at, as: UInt16.self).littleEndian) }
    }

    private static func u32(_ d: Data, _ at: Int) throws -> Int {
        guard at >= 0, at + 4 <= d.count else { throw WmArchiveError("this archive is damaged: a record runs past the end of the file") }
        return d.withUnsafeBytes { Int($0.loadUnaligned(fromByteOffset: at, as: UInt32.self).littleEndian) }
    }

    private static func u64(_ d: Data, _ at: Int) throws -> Int {
        guard at >= 0, at + 8 <= d.count else { throw WmArchiveError("this archive is damaged: a record runs past the end of the file") }
        let value = d.withUnsafeBytes { $0.loadUnaligned(fromByteOffset: at, as: UInt64.self).littleEndian }
        guard value <= UInt64(Int.max / 2) else { throw WmArchiveError("this archive is damaged: a size is out of range") }
        return Int(value)
    }

    private static let sigLocal = 0x0403_4b50
    private static let sigCentral = 0x0201_4b50
    private static let sigEnd = 0x0605_4b50
    private static let sigEnd64 = 0x0606_4b50
    private static let sigLoc64 = 0x0706_4b50

    // MARK: - The directory (zip.ts findEnd, directoryPlace, parseDirectory)

    /// Where the end record is: the one record whose comment runs to the end of the file; a second one is refused.
    private static func findEnd(_ d: Data) throws -> Int {
        let start = max(0, d.count - (65_535 + 22))
        var found = -1
        var at = d.count - 22
        while at >= start {
            if d[d.startIndex + at] == 0x50, try u32(d, at) == sigEnd, try at + 22 + u16(d, at + 20) == d.count {
                if found >= 0 {
                    throw WmArchiveError("this archive has two end records (one inside the other's comment), so it does not say which directory is meant")
                }
                found = at
            }
            at -= 1
        }
        return found
    }

    private static func directoryPlace(_ d: Data) throws -> (offset: Int, size: Int, count: Int) {
        let end = try findEnd(d)
        guard end >= 0 else { throw WmArchiveError("this is not a ZIP archive (no end record)") }
        guard try u16(d, end + 4) == 0, try u16(d, end + 6) == 0 else { throw WmArchiveError("a multi-disk archive") }
        var count = try u16(d, end + 10)
        var size = try u32(d, end + 12)
        var offset = try u32(d, end + 16)
        guard try u16(d, end + 8) == count else { throw WmArchiveError("a multi-disk archive") }
        if count == 0xffff || size == 0xffff_ffff || offset == 0xffff_ffff {
            let loc = end - 20
            guard loc >= 0, try u32(d, loc) == sigLoc64 else { throw WmArchiveError("a ZIP64 archive with no ZIP64 locator") }
            guard try u32(d, loc + 4) == 0, try u32(d, loc + 16) <= 1 else { throw WmArchiveError("a multi-disk archive") }
            let at = try u64(d, loc + 8)
            guard at + 56 <= d.count, try u32(d, at) == sigEnd64 else { throw WmArchiveError("a damaged ZIP64 end record") }
            count = try u64(d, at + 32)
            size = try u64(d, at + 40)
            offset = try u64(d, at + 48)
        }
        return (offset, size, count)
    }

    private static func parseDirectory(_ d: Data, from base: Int, size: Int, count: Int) throws -> [WmEntry] {
        guard count <= WmLimits.entries else { throw WmArchiveError("more than \(WmLimits.entries) entries (the limit)") }
        let stopAt = base + size
        var out: [WmEntry] = []
        out.reserveCapacity(count)
        var at = base
        for _ in 0 ..< count {
            guard at + 46 <= stopAt, try u32(d, at) == sigCentral else { throw WmArchiveError("a damaged central directory") }
            let flags = try u16(d, at + 8)
            let method = try u16(d, at + 10)
            let crc = try u32(d, at + 16)
            var compressedSize = try u32(d, at + 20)
            var entrySize = try u32(d, at + 24)
            let nameLength = try u16(d, at + 28)
            let extraLength = try u16(d, at + 30)
            let commentLength = try u16(d, at + 32)
            let disk = try u16(d, at + 34)
            var offset = try u32(d, at + 42)
            let next = at + 46 + nameLength + extraLength + commentLength
            guard next <= stopAt else { throw WmArchiveError("a damaged central directory") }
            let nameBytes = d.subdata(in: d.startIndex + at + 46 ..< d.startIndex + at + 46 + nameLength)
            guard let name = String(data: nameBytes, encoding: .utf8), name.utf8.count == nameLength else {
                throw WmArchiveError("an entry name is not UTF-8")
            }
            if flags & 1 != 0 || flags & 0x40 != 0 { throw WmArchiveError("“\(name)” is encrypted") }
            guard method == 0 || method == 8 else {
                throw WmArchiveError("“\(name)” uses a compression method this reader does not have (\(method))")
            }
            guard disk == 0 else { throw WmArchiveError("a multi-disk archive") }
            if entrySize == 0xffff_ffff || compressedSize == 0xffff_ffff || offset == 0xffff_ffff {
                // ZIP64 extra field (id 1): the fields that did not fit, in this order.
                var e = at + 46 + nameLength
                let stop = e + extraLength
                var found = false
                while e + 4 <= stop {
                    let id = try u16(d, e)
                    let length = try u16(d, e + 2)
                    if id == 1 {
                        var p = e + 4
                        let need = (entrySize == 0xffff_ffff ? 8 : 0) + (compressedSize == 0xffff_ffff ? 8 : 0) + (offset == 0xffff_ffff ? 8 : 0)
                        guard length >= need, e + 4 + length <= stop else {
                            throw WmArchiveError("“\(name)” has a ZIP64 extra field that is too short")
                        }
                        if entrySize == 0xffff_ffff { entrySize = try u64(d, p); p += 8 }
                        if compressedSize == 0xffff_ffff { compressedSize = try u64(d, p); p += 8 }
                        if offset == 0xffff_ffff { offset = try u64(d, p); p += 8 }
                        found = true
                        break
                    }
                    e += 4 + length
                }
                guard found else { throw WmArchiveError("“\(name)” has no ZIP64 sizes") }
            }
            out.append(WmEntry(name: name, method: UInt16(method), crc: UInt32(crc), compressedSize: compressedSize,
                               size: entrySize, offset: offset))
            at = next
        }
        guard at == stopAt else { throw WmArchiveError("the central directory holds more than its end record counts") }
        return out
    }

    // MARK: - Vetting (zip.ts vet), before a byte is inflated

    private static func overLimit(_ entry: WmEntry, running: Int) -> String? {
        let limit = WmLimits.textEntries.contains(entry.name) ? WmLimits.text : WmLimits.other
        if entry.size > limit { return "“\(entry.name)” is larger than the \(limit / 1_048_576) MiB limit" }
        if running + entry.size > WmLimits.total { return "the note is larger than the 8 GiB limit" }
        if entry.size > WmLimits.ratioFrom, entry.compressedSize > 0, entry.size / entry.compressedSize > WmLimits.ratio {
            return "“\(entry.name)” is compressed more than \(WmLimits.ratio):1"
        }
        return nil
    }

    /// Where an entry's compressed bytes start, from its local header - which must name it and pack it as the directory does.
    private static func dataStart(_ d: Data, _ entry: WmEntry) throws -> Int {
        let at = entry.offset
        guard at >= 0, at + 30 <= d.count, try u32(d, at) == sigLocal else { throw WmArchiveError("“\(entry.name)” has a damaged header") }
        let nameLength = try u16(d, at + 26)
        let start = try at + 30 + nameLength + u16(d, at + 28)
        guard start <= d.count else { throw WmArchiveError("“\(entry.name)” has a damaged header") }
        let local = d.subdata(in: d.startIndex + at + 30 ..< d.startIndex + at + 30 + nameLength)
        guard local == Data(entry.name.utf8) else {
            throw WmArchiveError("“\(entry.name)” is named differently in its own header than in the directory")
        }
        guard try u16(d, at + 8) == Int(entry.method) else {
            throw WmArchiveError("“\(entry.name)” has another method in its own header than in the directory")
        }
        guard entry.compressedSize <= d.count - start else { throw WmArchiveError("“\(entry.name)” is cut short") }
        return start
    }

    private static func vet(_ d: Data, _ entries: inout [WmEntry], directoryAt: Int) throws {
        var running = 0
        for entry in entries {
            if let why = overLimit(entry, running: running) { throw WmArchiveError(why) }
            running += entry.size
        }
        if running > WmLimits.ratio * d.count + WmLimits.ratioSlack {
            throw WmArchiveError("the entries declare \(running / 1_048_576) MiB, more than a thousand times the file's own size: a bomb")
        }
        for index in entries.indices { entries[index].dataStart = try dataStart(d, entries[index]) }
        let spans = entries.map { (name: $0.name, from: $0.offset, to: $0.dataStart + $0.compressedSize) }.sorted { $0.from < $1.from }
        var end = 0
        for span in spans {
            guard span.from >= end else { throw WmArchiveError("“\(span.name)” shares bytes with another entry") }
            end = span.to
        }
        guard end <= directoryAt else { throw WmArchiveError("an entry's data reaches into the central directory") }
    }

    // MARK: - An entry's bytes

    /// The entry's bytes, inflated (never past its declared size) and checked against its CRC. `limit`: refuse a larger one.
    func bytes(_ entry: WmEntry, limit: Int) throws -> Data {
        guard entry.size <= limit else { throw WmArchiveError("“\(entry.name)” is too large for a preview") }
        let start = data.startIndex + entry.dataStart
        let packed = data.subdata(in: start ..< start + entry.compressedSize)
        let out: Data
        if entry.method == 0 {
            guard entry.compressedSize == entry.size else { throw WmArchiveError("“\(entry.name)” has two sizes") }
            out = packed
        } else if entry.size == 0 {
            out = Data()
        } else {
            // One byte of room past the declared size: filling it means the entry holds more than it says.
            var buffer = Data(count: entry.size + 1)
            let written = buffer.withUnsafeMutableBytes { (dst: UnsafeMutableRawBufferPointer) -> Int in
                packed.withUnsafeBytes { (src: UnsafeRawBufferPointer) -> Int in
                    guard let d = dst.bindMemory(to: UInt8.self).baseAddress, let s = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                    return compression_decode_buffer(d, entry.size + 1, s, entry.compressedSize, nil, COMPRESSION_ZLIB)
                }
            }
            if written > entry.size { throw WmArchiveError("“\(entry.name)” holds more than its declared size") }
            guard written == entry.size else { throw WmArchiveError("“\(entry.name)” cannot be unpacked") }
            buffer.count = written
            out = buffer
        }
        guard Crc32.of(out) == entry.crc else { throw WmArchiveError("“\(entry.name)” does not match its checksum") }
        return out
    }

    /// `name`'s bytes, or nil when there is no such entry.
    func bytes(named name: String, limit: Int) throws -> Data? {
        guard let entry = byName[name] else { return nil }
        return try bytes(entry, limit: limit)
    }
}

/// CRC-32 (IEEE 802.3, the ZIP one), table-driven.
enum Crc32 {
    private static let table: [UInt32] = (0 ..< 256).map { n -> UInt32 in
        var c = UInt32(n)
        for _ in 0 ..< 8 { c = c & 1 != 0 ? 0xEDB8_8320 ^ (c >> 1) : c >> 1 }
        return c
    }

    static func of(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for byte in raw { crc = table[Int((crc ^ UInt32(byte)) & 0xFF)] ^ (crc >> 8) }
        }
        return crc ^ 0xFFFF_FFFF
    }
}
