// THE SECURE ENCLAVE ATTENDANCE HELPER — SOURCE ONLY, AND IT DOES NOT BUILD ON THIS MAC TODAY.
//
// WHY IT IS HERE UNBUILT. Measured 2026-09-24 in ~/aukora-private/se-spike: an AD-HOC-SIGNED helper is
// refused `errSecMissingEntitlement (-34018)` when it tries to create a Secure Enclave key, because an SE
// key lives in the data-protection keychain and needs an `application-identifier` /
// `keychain-access-groups` entitlement. The same process created a SOFTWARE P-256 key without complaint,
// so the refusal is the enclave and not keychain access. `/Applications/AUKORA.app` is ad-hoc signed with
// `TeamIdentifier=not set` and no entitlements, and this Mac has NO signing identity at all
// (`security find-identity -v -p codesigning` -> 0 valid identities).
//
// WHEN PETER HAS A TEAM ID, THE ONLY THING THAT CHANGES IS SIGNING:
//
//   xcrun swiftc -O -o attendance-se-helper attendance-se-helper.swift \
//     -framework Security -framework LocalAuthentication
//   codesign --force --sign "Developer ID Application: …" --entitlements entitlements.plist attendance-se-helper
//
// with entitlements.plist carrying `keychain-access-groups` = ["<TEAMID>.com.aukora.attendance"]. No line
// of this file needs to change, which is the point of writing it now: the Team ID becomes a signing
// change and not a design one.
//
// `sign` READS THE PREIMAGE ON STDIN and writes ONE JSON LINE. It holds no authority and chooses nothing:
// it signs the bytes it is handed, and the `--reason` travels into the OS dialog so the person is told
// what the enclave is being asked about (see `attendanceLocalizedReason` for how little that narrows).
import Foundation
import Security
import LocalAuthentication

let arguments = CommandLine.arguments
guard arguments.count >= 2, arguments[1] == "sign" else {
    FileHandle.standardError.write("usage: attendance-se-helper sign --reason <text>\n".data(using: .utf8)!)
    exit(64)
}
var reason = "AUKORA: approve an operation"
if let index = arguments.firstIndex(of: "--reason"), index + 1 < arguments.count {
    reason = arguments[index + 1]
}

let tag = "com.aukora.attendance.se".data(using: .utf8)!
var accessError: Unmanaged<CFError>?
guard let access = SecAccessControlCreateWithFlags(
    kCFAllocatorDefault, kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    [.privateKeyUsage, .biometryCurrentSet], &accessError) else {
    FileHandle.standardError.write("access control refused: \(accessError!.takeRetainedValue())\n".data(using: .utf8)!)
    exit(1)
}
// THE KEY IS FOUND, NEVER CREATED HERE. Enrolment is a separate, deliberate act; a signer that minted a
// key on demand would produce a signature under a key nobody enrolled.
let lookup: [String: Any] = [
    kSecClass as String: kSecClassKey,
    kSecAttrApplicationTag as String: tag,
    kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
    kSecReturnRef as String: true,
]
var found: CFTypeRef?
let status = SecItemCopyMatching(lookup as CFDictionary, &found)
guard status == errSecSuccess, let privateKey = found as! SecKey? else {
    FileHandle.standardError.write("no enrolled attendance key (status \(status))\n".data(using: .utf8)!)
    exit(3)
}

let preimage = FileHandle.standardInput.readDataToEndOfFile()
let context = LAContext()
context.localizedReason = reason
var signError: Unmanaged<CFError>?
guard let signature = SecKeyCreateSignature(privateKey, .ecdsaSignatureMessageX962SHA256,
                                            preimage as CFData, &signError) as Data? else {
    let error = signError!.takeRetainedValue()
    FileHandle.standardError.write("signing refused: \(error)\n".data(using: .utf8)!)
    // -128 IS THE USER CANCELLING, and `attendance-signer.mjs` maps it to `aumlok:attendance-refused`.
    exit(2)
}
guard let publicKey = SecKeyCopyPublicKey(privateKey),
      let raw = SecKeyCopyExternalRepresentation(publicKey, &signError) as Data? else {
    FileHandle.standardError.write("no public half\n".data(using: .utf8)!)
    exit(1)
}
let out: [String: Any] = [
    "rawPointHex": raw.map { String(format: "%02x", $0) }.joined(),
    "signatureHex": signature.map { String(format: "%02x", $0) }.joined(),
]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out, options: [.sortedKeys]))
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
