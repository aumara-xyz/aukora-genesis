import Foundation
import CryptoKit
import LocalAuthentication
import Security
import Darwin

// CryptoKit's Digest overload signs this SHA-256 digest directly, without hashing it again.
// Verifiers use ECDSA/SHA-256 over approvalSigningBytes(request), not over these hex bytes.
struct ApprovalDigest: Digest {
    static let byteCount = 32
    let bytes: [UInt8]
    func withUnsafeBytes<R>(_ body: (UnsafeRawBufferPointer) throws -> R) rethrows -> R {
        try bytes.withUnsafeBytes(body)
    }
    func makeIterator() -> Array<UInt8>.Iterator { bytes.makeIterator() }
}

enum Failure: Error { case unavailable(String) }
func fail(_ reason: String) throws -> Never { throw Failure.unavailable(reason) }
func digest(_ hex: String) throws -> ApprovalDigest {
    guard hex.count == 64, hex.allSatisfy({ "0123456789abcdef".contains($0) }) else {
        try fail("digest must be 64 lowercase hexadecimal characters")
    }
    let chars = Array(hex)
    return ApprovalDigest(bytes: stride(from: 0, to: 64, by: 2).map {
        UInt8(String(chars[$0...($0 + 1)]), radix: 16)!
    })
}
func oneLine(_ text: String, limit: Int) -> String {
    let clean = String(text.unicodeScalars.map { scalar -> Character in
        if CharacterSet.controlCharacters.contains(scalar) || CharacterSet.whitespacesAndNewlines.contains(scalar)
            || scalar.properties.generalCategory == .format { return " " }
        return Character(scalar)
    })
    return String(clean.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ").prefix(limit))
}
func freshContext(_ reason: String = "Enroll AUKORA presence") -> LAContext {
    let context = LAContext()
    context.touchIDAuthenticationAllowableReuseDuration = 0
    context.localizedReason = reason
    context.localizedFallbackTitle = ""
    return context
}
func requireTouchID(_ context: LAContext) throws {
    var error: NSError?
    guard SecureEnclave.isAvailable,
          context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error),
          context.biometryType == .touchID else { try fail("Touch ID unavailable") }
}

// Stable shared enrollment location. Only CryptoKit's enclave-wrapped representation is persisted;
// it is NOT raw private key material. The public file is an independent local trust anchor, never
// accepted from a receipt. Same-UID replacement is not prevented; this is not remote attestation.
let support = ProcessInfo.processInfo.environment["AUKORA_SUPPORT_ROOT"]
    ?? NSHomeDirectory() + "/Library/Application Support/AUKORA"
let directory = URL(fileURLWithPath: support).appendingPathComponent("state/home/aumlok-presence")
let wrappedURL = directory.appendingPathComponent("enclave-key.data")
let publicURL = directory.appendingPathComponent("presence-public.pem")
let fm = FileManager.default
func present(_ url: URL) -> Bool { (try? url.checkResourceIsReachable()) == true }
func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }

// A durable public-key fingerprint outside the key directory. It confers no authority;
// same-UID replacement remains possible. Migration only reads the public key, never Keychain.
let history = directory.deletingLastPathComponent().appendingPathComponent("aura-presence")
let enrollmentURL = history.appendingPathComponent("enrollment.json")
func persistEnrollment(_ publicDER: Data) throws {
    let record: [String: String] = ["kind": "aukora:presence-enrollment:v1",
                                  "publicKeyDigest": hex(Data(SHA256.hash(data: publicDER)))]
    try fm.createDirectory(at: history, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    var metadata = stat()
    guard lstat(history.path, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFDIR,
          metadata.st_mode & 0o022 == 0, metadata.st_uid == getuid() else { try fail("presence history unsafe") }
    let fd = open(enrollmentURL.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    if fd < 0 {
        guard errno == EEXIST else { try fail("presence history unwritable") }
        let existing = open(enrollmentURL.path, O_RDONLY | O_NOFOLLOW | O_NONBLOCK)
        guard existing >= 0 else { try fail("presence history unreadable") }
        defer { close(existing) }
        guard fstat(existing, &metadata) == 0, metadata.st_mode & S_IFMT == S_IFREG,
              metadata.st_mode & 0o022 == 0, metadata.st_uid == getuid(), metadata.st_size <= 4096 else {
            try fail("presence history unsafe")
        }
        var buffer = [UInt8](repeating: 0, count: 4097)
        let count = read(existing, &buffer, buffer.count)
        guard count >= 0, count <= 4096,
              let previous = try JSONSerialization.jsonObject(with: Data(buffer.prefix(count))) as? [String: Any],
              Set(previous.keys) == Set(record.keys), previous["kind"] as? String == record["kind"],
              previous["publicKeyDigest"] as? String == record["publicKeyDigest"] else { try fail("presence history differs; refusing replacement") }
        return
    }
    defer { close(fd) }
    var bytes = try JSONSerialization.data(withJSONObject: record, options: [.sortedKeys])
    bytes.append(0x0a)
    try bytes.withUnsafeBytes { buffer in
        guard write(fd, buffer.baseAddress!, buffer.count) == buffer.count, fsync(fd) == 0 else {
            try fail("presence history write failed")
        }
    }
    for folder in [history, history.deletingLastPathComponent()] {
        let parent = open(folder.path, O_RDONLY | O_NOFOLLOW)
        guard parent >= 0 else { try fail("presence history directory unreadable") }
        defer { close(parent) }
        guard fsync(parent) == 0 else { try fail("presence history directory flush failed") }
    }
}

do {
    let args = Array(CommandLine.arguments.dropFirst())
    guard let command = args.first else { try fail("usage: touchid status | create | migrate | sign digest-hex kind reason | pubkey") }
    if command == "status", args.count == 1 {
        let context = freshContext()
        defer { context.invalidate() }
        try requireTouchID(context)
        print("available") // No authentication and no writes.
    } else if command == "pubkey", args.count == 1 {
        print(try String(contentsOf: publicURL, encoding: .utf8), terminator: "")
    } else if command == "migrate", args.count == 1 {
        let trusted = try P256.Signing.PublicKey(pemRepresentation: String(contentsOf: publicURL, encoding: .utf8))
        try persistEnrollment(trusted.derRepresentation)
        print("enrolled")
    } else if command == "create", args.count == 1 {
        guard !present(directory), !present(wrappedURL), !present(publicURL), !present(enrollmentURL) else { try fail("enrollment already exists or is incomplete; refusing replacement") }
        guard SecureEnclave.isAvailable else { try fail("Secure Enclave unavailable") }
        let context = freshContext()
        defer { context.invalidate() }
        try requireTouchID(context)
        var accessError: Unmanaged<CFError>?
        guard let access = SecAccessControlCreateWithFlags(nil, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
                [.privateKeyUsage, .biometryCurrentSet], &accessError) else { try fail("access control unavailable") }
        let key = try SecureEnclave.P256.Signing.PrivateKey(accessControl: access, authenticationContext: context)
        // Enrollment proves the new key can authenticate a fresh random challenge. It never
        // signs an approval digest; every approval needs its own later `sign` invocation.
        var nonce = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, nonce.count, &nonce) == errSecSuccess else { try fail("random failed") }
        let challenge = ApprovalDigest(bytes: Array(SHA256.hash(data: Data(nonce))))
        let signature = try key.signature(for: challenge)
        guard key.publicKey.isValidSignature(signature, for: challenge) else { try fail("enrollment signature failed") }
        umask(0o077)
        let parent = directory.deletingLastPathComponent()
        try fm.createDirectory(at: parent, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
        let staging = parent.appendingPathComponent(".aumlok-presence-" + UUID().uuidString)
        try fm.createDirectory(at: staging, withIntermediateDirectories: false, attributes: [.posixPermissions: 0o700])
        // O_EXCL refuses concurrent enrollment and never overwrites an existing trust anchor.
        func writeNew(_ data: Data, _ url: URL) throws {
            let fd = open(url.path, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
            guard fd >= 0 else { try fail("enrollment file already exists or is unwritable") }
            defer { close(fd) }
            try data.withUnsafeBytes { buffer in
                guard write(fd, buffer.baseAddress!, buffer.count) == buffer.count, fsync(fd) == 0 else {
                    try fail("enrollment write failed")
                }
            }
        }
        try writeNew(key.dataRepresentation, staging.appendingPathComponent("enclave-key.data"))
        let publicPEM = key.publicKey.pemRepresentation.trimmingCharacters(in: .whitespacesAndNewlines) + "\n"
        try writeNew(Data(publicPEM.utf8), staging.appendingPathComponent("presence-public.pem"))
        // Persist history BEFORE publication: a crash cannot publish an unrecorded enrollment.
        try persistEnrollment(key.publicKey.derRepresentation)
        // Publish the whole pair atomically, without replacing another enrollment. Interrupted
        // staging remains private and never looks like enrollment to readers. No key is deleted.
        guard renameatx_np(AT_FDCWD, staging.path, AT_FDCWD, directory.path, UInt32(RENAME_EXCL)) == 0 else {
            try fail("enrollment directory already exists or cannot be published")
        }
        print(key.publicKey.pemRepresentation)
    } else if command == "sign", args.count == 4 {
        let value = try digest(args[1])
        let trusted = try P256.Signing.PublicKey(pemRepresentation: String(contentsOf: publicURL, encoding: .utf8))
        try persistEnrollment(trusted.derRepresentation)
        // Any same-user process may ask this helper to sign and choose the prompt text.
        // Touch proves presence, not what was approved; the desktop derives these words
        // from the verified operation witness but that convention is not enforced here.
        let kind = oneLine(args[2], limit: 64)
        let reason = oneLine(args[3], limit: 160)
        let context = freshContext("AUKORA \(kind): \(reason) [\(args[1].prefix(12))]")
        defer { context.invalidate() }
        try requireTouchID(context)
        let key = try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: Data(contentsOf: wrappedURL), authenticationContext: context)
        guard key.publicKey.derRepresentation == trusted.derRepresentation else { try fail("enrollment key mismatch") }
        print(hex(try key.signature(for: value).derRepresentation))
    } else { try fail("usage: touchid status | create | migrate | sign digest-hex kind reason | pubkey") }
} catch {
    // Capability, entitlement, enrollment and authentication failures all mean missing evidence.
    FileHandle.standardError.write(Data("touchid: unavailable: \(error)\n".utf8))
    exit(3)
}
