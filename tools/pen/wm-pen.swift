// wm-pen: the Mac's tablet reader for WriteMind (apps/desktop/src/main/pen/macPenBackend.ts starts it).
//
// THE WACOM DRIVER CANNOT BE ASKED TO LET GO OF THE POINTER on a Mac (measured by the Swift WriteMind, 2026-10-02:
// its Apple Event interface answers reads and ignores every write, and CGAssociateMouseAndMouseCursorPosition does
// nothing). So while the Tablet sheet is in front, this opens the tablet's HID device with
// kIOHIDOptionsTypeSeizeDevice — a seized device delivers nothing to the driver or WindowServer, so the pointer stays
// where the trackpad left it — and writes the pen's raw reports to stdout. Ending the process (stdin closed, SIGTERM)
// closes the device and gives the pen back; the kernel does that too if the process dies any other way.
//
// Opening a pointer-class HID device needs INPUT MONITORING, which macOS attributes to WriteMind.app (this helper's
// responsible process). Undecided: macOS's question is put up once. Denied: says so and exits 3.
//
// One JSON object per line on stdout:
//   {"k":"access","v":"granted"|"denied"|"undecided"}
//   {"k":"device","name":…,"pid":…,"maxX":…,"maxY":…,"maxP":…}   the tablet about to be seized
//   {"k":"opened"} | {"k":"refused","why":…}                        exit 2 after a refusal, 4 when there is no tablet
//   {"k":"p","f":flags,"x":…,"y":…,"p":…}                            one pen report (the Bamboo-pen layout below)
//   {"k":"raw","hex":…}                                              the first reports that are not that, for pen.log
//   {"k":"log","m":…}
//
// THE REPORT (the One by Wacom / Bamboo-pen class, its layout as the Linux driver's `wacom_bpt_pen` reads it):
//   byte 0 the report id, 2 · byte 1 flags: 0x80 in range, 0x40 x/y good, 0x20 tip/switches/pressure good,
//   0x08 eraser, 0x04 upper switch, 0x02 lower switch, 0x01 tip · bytes 2–3 x LE · 4–5 y LE (down) · 6–7 pressure LE.

import Foundation
import IOKit
import IOKit.hid

let wacomVendor = 0x056A
setvbuf(stdout, nil, _IOLBF, 0)

func say(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}
func log(_ message: String) { say(["k": "log", "m": message]) }

func number(_ device: IOHIDDevice, _ key: String) -> Int {
    (IOHIDDeviceGetProperty(device, key as CFString) as? NSNumber)?.intValue ?? 0
}
func text(_ device: IOHIDDevice, _ key: String) -> String {
    (IOHIDDeviceGetProperty(device, key as CFString) as? String) ?? ""
}
func hex(_ code: IOReturn) -> String { String(format: "0x%08x", UInt32(bitPattern: code)) }

// ---- the tablet's HID devices (the pointer's first)

func devices() -> [IOHIDDevice] {
    let matching = IOServiceMatching(kIOHIDDeviceKey) as NSMutableDictionary
    matching[kIOHIDVendorIDKey] = wacomVendor
    var iterator: io_iterator_t = 0
    guard IOServiceGetMatchingServices(kIOMainPortDefault, matching, &iterator) == KERN_SUCCESS else { return [] }
    defer { IOObjectRelease(iterator) }
    var found: [IOHIDDevice] = []
    while case let service = IOIteratorNext(iterator), service != 0 {
        defer { IOObjectRelease(service) }
        if let device = IOHIDDeviceCreate(kCFAllocatorDefault, service) { found.append(device) }
    }
    // A tablet that moves the pointer (usage page 1, usage 2) first; the rest of the same product after it.
    return found.sorted {
        let a = number($0, kIOHIDPrimaryUsagePageKey) == 1 && number($0, kIOHIDPrimaryUsageKey) == 2
        let b = number($1, kIOHIDPrimaryUsagePageKey) == 1 && number($1, kIOHIDPrimaryUsageKey) == 2
        return a && !b
    }
}

/** The largest logical maximum of an input element with this usage, in report 2. */
func logicalMax(_ device: IOHIDDevice, page: Int, usage: Int) -> Int {
    guard let elements = IOHIDDeviceCopyMatchingElements(device, nil, IOOptionBits(kIOHIDOptionsTypeNone)) as? [IOHIDElement] else { return 0 }
    var best = 0
    for element in elements where Int(IOHIDElementGetUsagePage(element)) == page && Int(IOHIDElementGetUsage(element)) == usage {
        if IOHIDElementGetReportID(element) == 2 { best = max(best, IOHIDElementGetLogicalMax(element)) }
    }
    return best
}

let all = devices()
guard let pointer = all.first else {
    say(["k": "refused", "why": "no Wacom tablet is plugged in"])
    exit(4)
}

// Asked only once there is a tablet to take: a Mac with none plugged in never sees macOS's question.
func access() -> String {
    switch IOHIDCheckAccess(kIOHIDRequestTypeListenEvent) {
    case kIOHIDAccessTypeGranted: return "granted"
    case kIOHIDAccessTypeDenied: return "denied"
    default: return "undecided"
    }
}
var answer = access()
if answer == "undecided" {
    answer = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent) ? "granted" : access()
}
say(["k": "access", "v": answer])
if answer != "granted" { exit(3) }

let productID = number(pointer, kIOHIDProductIDKey)
let mine = all.filter { number($0, kIOHIDProductIDKey) == productID }
// The One by Wacom small (CTL-472) as the Swift app measured it, when the descriptor says nothing usable.
let knownX = 15200, knownY = 9500
let maxX = logicalMax(pointer, page: 1, usage: 0x30), maxY = logicalMax(pointer, page: 1, usage: 0x31)
let maxP = logicalMax(pointer, page: 0x0D, usage: 0x30)
say(["k": "device", "name": text(pointer, kIOHIDProductKey).isEmpty ? "Wacom tablet" : text(pointer, kIOHIDProductKey),
     "pid": productID, "maxX": maxX > 1000 && maxX < 65536 ? maxX : knownX, "maxY": maxY > 1000 && maxY < 65536 ? maxY : knownY, "maxP": maxP > 0 ? maxP : 2047])

// ---- seize

final class Held {
    let device: IOHIDDevice
    let buffer: UnsafeMutablePointer<UInt8>
    let size: Int
    var modeBefore: UInt8?
    init(_ device: IOHIDDevice, size: Int) { self.device = device; self.size = size; buffer = .allocate(capacity: size) }
}
var held: [Held] = []
let seize = IOOptionBits(kIOHIDOptionsTypeSeizeDevice)
let modeReport: UInt8 = 2, penMode: UInt8 = 2
var unknown = 0

for device in mine {
    let status = IOHIDDeviceOpen(device, seize)
    log("HID usage page 0x\(String(number(device, kIOHIDPrimaryUsagePageKey), radix: 16)) usage 0x\(String(number(device, kIOHIDPrimaryUsageKey), radix: 16)) seized: \(hex(status))")
    if status == kIOReturnSuccess {
        held.append(Held(device, size: max(number(device, kIOHIDMaxInputReportSizeKey), 64)))
    } else if status == kIOReturnExclusiveAccess {
        IOHIDDeviceClose(device, seize)
    }
}
let pointerHeld = held.contains { $0.device === pointer }
if !pointerHeld {
    for one in held { IOHIDDeviceClose(one.device, seize) }
    say(["k": "refused", "why": "the tablet could not be taken from the Wacom driver (another app may hold it)"])
    exit(2)
}

func release() {
    for one in held {
        if let before = one.modeBefore {
            let back = [modeReport, before]
            _ = IOHIDDeviceSetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), back, back.count)
        }
        IOHIDDeviceClose(one.device, seize)
    }
    held = []
}

// With no driver the tablet is a plain mouse until told to send pen reports: read the mode, set the pen's if it is not.
for one in held where one.device === pointer {
    var now = [UInt8](repeating: 0, count: 2)
    var length = CFIndex(now.count)
    let read = IOHIDDeviceGetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), &now, &length)
    let was: UInt8? = read == kIOReturnSuccess && length >= 2 ? now[1] : nil
    if was != penMode {
        let wanted = [modeReport, penMode]
        let set = IOHIDDeviceSetReport(one.device, kIOHIDReportTypeFeature, CFIndex(modeReport), wanted, wanted.count)
        log("mode report \(was.map { String($0) } ?? "unread") set to \(penMode): \(hex(set))")
        if set == kIOReturnSuccess { one.modeBefore = was }
    }
}

for one in held {
    IOHIDDeviceRegisterInputReportCallback(one.device, one.buffer, one.size, { _, _, _, _, _, report, length in
        let bytes = UnsafeBufferPointer(start: report, count: length)
        if length == 10 && bytes[0] == 2 {
            say(["k": "p", "f": Int(bytes[1]),
                 "x": Int(bytes[2]) | Int(bytes[3]) << 8,
                 "y": Int(bytes[4]) | Int(bytes[5]) << 8,
                 "p": Int(bytes[6]) | Int(bytes[7]) << 8])
        } else if unknown < 8 {
            unknown += 1
            say(["k": "raw", "hex": bytes.map { String(format: "%02x", $0) }.joined(separator: " ")])
        }
    }, nil)
    IOHIDDeviceScheduleWithRunLoop(one.device, CFRunLoopGetMain(), CFRunLoopMode.defaultMode.rawValue)
}
say(["k": "opened"])

// ---- the way out: stdin closing (WriteMind gone or done), SIGTERM, SIGINT, or the tablet unplugged

func quit() -> Never { release(); exit(0) }
signal(SIGTERM, SIG_IGN); signal(SIGINT, SIG_IGN)
let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
term.setEventHandler { quit() }; term.resume()
let int = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
int.setEventHandler { quit() }; int.resume()
let input = DispatchSource.makeReadSource(fileDescriptor: STDIN_FILENO, queue: .main)
input.setEventHandler {
    var buffer = [UInt8](repeating: 0, count: 256)
    if read(STDIN_FILENO, &buffer, buffer.count) <= 0 { quit() }
}
input.resume()
IOHIDDeviceRegisterRemovalCallback(pointer, { _, _, _ in
    say(["k": "refused", "why": "the tablet was unplugged"])
    release(); exit(5)
}, nil)
CFRunLoopRun()
