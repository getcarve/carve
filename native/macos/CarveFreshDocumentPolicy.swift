import Foundation

/// Local creation evidence, issued before a document can become an owned target.
struct FreshDocumentReceipt: Encodable {
    let version = 1
    let windowId: UInt32
    let inventoryScope = "all"
    let excludedWindowIds: [UInt32]
    let creationMethod = "explicit_new_document"
    let blankBodyVerified = true
}

enum FreshDocumentPolicy {
    static func receipt(windowId: UInt32, excluded: Set<UInt32>, newDocumentRequested: Bool,
                        exactFocusedWindow: Bool, documentLocationAbsent: Bool,
                        complete: Bool, editableBodies: [String?]) -> FreshDocumentReceipt? {
        guard windowId != 0, !excluded.contains(windowId), newDocumentRequested,
              exactFocusedWindow, documentLocationAbsent, complete,
              editableBodies.count == 1, editableBodies[0] == "" else { return nil }
        return FreshDocumentReceipt(windowId: windowId, excludedWindowIds: excluded.sorted())
    }
}
