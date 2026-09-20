import Foundation

/// A line in /tmp/writemind-debug.log. NSLog from a launched app is redacted
/// as <private> in the unified log, so what has to be read back goes here.
enum DebugLog {
    static let path = "/tmp/writemind-debug.log"

    static func write(_ message: String) {
        let line = "\(Date()) \(message)\n"
        if let handle = FileHandle(forWritingAtPath: path) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            handle.closeFile()
        } else {
            FileManager.default.createFile(atPath: path, contents: Data(line.utf8))
        }
    }
}
