import AVFoundation
import CoreImage
import Combine
import Foundation

struct CameraDevice: Identifiable, Hashable {
    let id: String      // AVCaptureDevice.uniqueID
    let name: String
}

/// Discovers video input devices and runs the capture session behind the right-hand pane.
@MainActor
final class CameraController: ObservableObject {
    enum Status: Equatable {
        case idle
        case starting
        case running
        case denied
        case failed(String)
    }

    static let shared = CameraController()

    @Published private(set) var devices: [CameraDevice] = []
    @Published private(set) var selectedDeviceID: String?
    @Published private(set) var status: Status = .idle

    let session = AVCaptureSession()

    private let sessionQueue = DispatchQueue(label: "com.seancheren.WriteMind.camera")
    private var currentInput: AVCaptureDeviceInput?
    /// Keeps the newest frame so a capture is the frame that is on screen,
    /// not a photo taken a beat later with the lens refocusing.
    private let frames = FrameKeeper()
    private let frameOutput = AVCaptureVideoDataOutput()
    private var observers: [NSObjectProtocol] = []
    private static let lastDeviceKey = "lastCameraDeviceID"

    private init() {
        session.sessionPreset = .high
        frameOutput.alwaysDiscardsLateVideoFrames = true
        // The camera's own pixel format, whatever it is: asking for BGRA made
        // AVFoundation convert every frame at the camera's full size, thirty
        // times a second, and the preview crawled (Sean, 2026-09-18: "camera
        // just generally seems slower"). Core Image and Vision read the
        // native buffers as they come.
        frameOutput.setSampleBufferDelegate(frames, queue: DispatchQueue(label: "com.seancheren.WriteMind.frames"))
        if session.canAddOutput(frameOutput) { session.addOutput(frameOutput) }
        refreshDevices()
        observeDeviceChanges()

        // Only reconnect a camera the user already picked, so a first launch
        // does not fire the system permission prompt unasked — and never
        // while hosting the unit tests, which have no use for a camera.
        if !TestHost.isActive,
           let remembered = UserDefaults.standard.string(forKey: Self.lastDeviceKey),
           devices.contains(where: { $0.id == remembered }) {
            select(deviceID: remembered)
        }
    }

    // MARK: - Devices

    func refreshDevices() {
        var types: [AVCaptureDevice.DeviceType] = [.builtInWideAngleCamera, .external]
        if #available(macOS 14.0, *) {
            types.append(contentsOf: [.continuityCamera, .deskViewCamera])
        }
        let discovery = AVCaptureDevice.DiscoverySession(
            deviceTypes: types, mediaType: .video, position: .unspecified)

        devices = discovery.devices.map { CameraDevice(id: $0.uniqueID, name: $0.localizedName) }

        // The active camera was unplugged.
        if let selectedDeviceID, !devices.contains(where: { $0.id == selectedDeviceID }) {
            turnOff()
        }
    }

    private func observeDeviceChanges() {
        for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
            let token = NotificationCenter.default.addObserver(
                forName: name, object: nil, queue: .main
            ) { [weak self] _ in
                Task { @MainActor in self?.refreshDevices() }
            }
            observers.append(token)
        }
    }

    // MARK: - Selection

    func select(deviceID: String) {
        guard let device = AVCaptureDevice(uniqueID: deviceID) else {
            status = .failed("That camera is no longer available.")
            refreshDevices()
            return
        }

        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configure(device: device)
        case .notDetermined:
            status = .starting
            AVCaptureDevice.requestAccess(for: .video) { granted in
                Task { @MainActor in
                    if granted { self.configure(device: device) } else { self.status = .denied }
                }
            }
        case .denied, .restricted:
            status = .denied
        @unknown default:
            status = .denied
        }
    }

    func turnOff() {
        let session = self.session
        let input = currentInput
        currentInput = nil
        selectedDeviceID = nil
        status = .idle
        UserDefaults.standard.removeObject(forKey: Self.lastDeviceKey)

        sessionQueue.async {
            if session.isRunning { session.stopRunning() }
            if let input {
                session.beginConfiguration()
                session.removeInput(input)
                session.commitConfiguration()
            }
        }
    }

    private func configure(device: AVCaptureDevice) {
        let session = self.session
        let previous = currentInput
        selectedDeviceID = device.uniqueID
        status = .starting
        UserDefaults.standard.set(device.uniqueID, forKey: Self.lastDeviceKey)

        sessionQueue.async {
            do {
                let input = try AVCaptureDeviceInput(device: device)
                session.beginConfiguration()
                if let previous { session.removeInput(previous) }
                guard session.canAddInput(input) else {
                    session.commitConfiguration()
                    Task { @MainActor in self.status = .failed("This Mac cannot open \(device.localizedName).") }
                    return
                }
                session.addInput(input)
                session.commitConfiguration()
                if !session.isRunning { session.startRunning() }
                Task { @MainActor in
                    self.currentInput = input
                    self.status = .running
                }
            } catch {
                Task { @MainActor in self.status = .failed(error.localizedDescription) }
            }
        }
    }

    var selectedDeviceName: String? {
        devices.first { $0.id == selectedDeviceID }?.name
    }

    /// The frame on screen right now, or nil when there is no camera running.
    func currentFrame() -> CIImage? {
        guard status == .running else { return nil }
        return frames.latest()
    }
}

/// Holds on to the last frame the camera delivered. Lives off the main actor
/// because the frames arrive on the capture queue.
final class FrameKeeper: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    private let lock = NSLock()
    private var image: CIImage?

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer,
                       from connection: AVCaptureConnection) {
        guard let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let frame = CIImage(cvPixelBuffer: buffer)
        lock.lock()
        image = frame
        lock.unlock()
    }

    func latest() -> CIImage? {
        lock.lock()
        defer { lock.unlock() }
        return image
    }
}
