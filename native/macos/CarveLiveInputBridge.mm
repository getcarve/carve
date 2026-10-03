#import "CarveCapturedIdentity.h"
#include "CarveControlSensitivity.h"
#include <ApplicationServices/ApplicationServices.h>
#include <AppKit/AppKit.h>
#include <CommonCrypto/CommonDigest.h>
#include <Foundation/Foundation.h>
#include <node_api.h>

#include "CarveWindowFocusPolicy.hpp"

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <strings.h>
#include <cstdio>
#include <string>
#include <unistd.h>
#include <vector>

// The Window Server id of an AX window. Private, but stable since 10.x and
// what window managers rely on; the computer helper has used it since
// its first release. Chrome publishes no AXWindowNumber, and Chrome opens a new
// window at exactly the frame of the current one, so geometry alone cannot
// tell the person's new window from the one Carve works in.
extern "C" AXError _AXUIElementGetWindow(AXUIElementRef element, CGWindowID* identifier);

namespace {

bool axWindowServerId(AXUIElementRef element, CGWindowID* identifier) {
  CGWindowID value = 0;
  if (!element || _AXUIElementGetWindow(element, &value) != kAXErrorSuccess || value == 0) return false;
  *identifier = value;
  return true;
}

napi_value fail(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

bool jsonArgument(napi_env env, napi_callback_info info, NSDictionary** value) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return false;
  size_t size = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &size) != napi_ok || size > 32'000) return false;
  std::vector<char> input(size + 1, '\0');
  if (napi_get_value_string_utf8(env, argv[0], input.data(), input.size(), &size) != napi_ok) return false;
  NSData* data = [NSData dataWithBytes:input.data() length:size];
  NSError* error = nil;
  id parsed = [NSJSONSerialization JSONObjectWithData:data options:0 error:&error];
  if (error || ![parsed isKindOfClass:[NSDictionary class]]) return false;
  *value = static_cast<NSDictionary*>(parsed);
  return true;
}

bool number(NSDictionary* object, NSString* key, double* value) {
  id raw = object[key];
  if (![raw isKindOfClass:[NSNumber class]]) return false;
  const double result = [static_cast<NSNumber*>(raw) doubleValue];
  if (!std::isfinite(result)) return false;
  *value = result;
  return true;
}

bool text(NSDictionary* object, NSString* key, NSString** value) {
  id raw = object[key];
  if (![raw isKindOfClass:[NSString class]]) return false;
  *value = static_cast<NSString*>(raw);
  return true;
}

bool safeKey(NSString* key, CGKeyCode* code, CGEventFlags* flags) {
  NSString* normalized = [[key stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] uppercaseString];
  if (!normalized || normalized.length == 0 || normalized.length > 160) return false;
  if ([normalized isEqualToString:@"SELECT_ALL"]) normalized = @"CMD+A";
  NSArray<NSString*>* parts = [normalized componentsSeparatedByString:@"+"];
  *flags = 0;
  NSString* name = nil;
  for (NSString* rawPart in parts) {
    NSString* part = [rawPart stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]];
    if ([part isEqualToString:@"CMD"] || [part isEqualToString:@"COMMAND"] || [part isEqualToString:@"META"]) *flags |= kCGEventFlagMaskCommand;
    else if ([part isEqualToString:@"CTRL"] || [part isEqualToString:@"CONTROL"]) *flags |= kCGEventFlagMaskControl;
    else if ([part isEqualToString:@"ALT"] || [part isEqualToString:@"OPTION"]) *flags |= kCGEventFlagMaskAlternate;
    else if ([part isEqualToString:@"SHIFT"]) *flags |= kCGEventFlagMaskShift;
    else if (!name) name = part;
    else return false;
  }
  if (!name) return false;
  NSDictionary<NSString*, NSNumber*>* keys = @{
    @"RETURN": @36, @"ENTER": @36, @"TAB": @48, @"ESC": @53, @"ESCAPE": @53,
    @"SPACE": @49, @"BACKSPACE": @51, @"FORWARDDELETE": @117, @"DELETE": @51,
    @"HOME": @115, @"END": @119, @"PAGEUP": @116, @"PAGEDOWN": @121,
    @"UP": @126, @"ARROWUP": @126, @"DOWN": @125, @"ARROWDOWN": @125,
    @"LEFT": @123, @"ARROWLEFT": @123, @"RIGHT": @124, @"ARROWRIGHT": @124,
    @"F1": @122, @"F2": @120, @"F3": @99, @"F4": @118, @"F5": @96, @"F6": @97,
    @"F7": @98, @"F8": @100, @"F9": @101, @"F10": @109, @"F11": @103, @"F12": @111,
    @"A": @0, @"S": @1, @"D": @2, @"F": @3, @"H": @4, @"G": @5,
    @"Z": @6, @"X": @7, @"C": @8, @"V": @9, @"B": @11, @"Q": @12,
    @"W": @13, @"E": @14, @"R": @15, @"Y": @16, @"T": @17, @"1": @18,
    @"2": @19, @"3": @20, @"4": @21, @"6": @22, @"5": @23, @"=": @24,
    @"9": @25, @"7": @26, @"-": @27, @"8": @28, @"0": @29, @"]": @30,
    @"O": @31, @"U": @32, @"[": @33, @"I": @34, @"P": @35, @"L": @37,
    @"J": @38, @"'": @39, @"K": @40, @";": @41, @"\\": @42, @",": @43,
    @"/": @44, @"N": @45, @"M": @46, @".": @47, @"`": @50,
  };
  NSNumber* value = keys[name];
  if (!value) return false;
  *code = static_cast<CGKeyCode>(value.unsignedShortValue);
  return true;
}

bool actionModifiers(NSDictionary* action, CGEventFlags* flags) {
  *flags = 0;
  id raw = action[@"modifiers"];
  if (!raw || raw == [NSNull null]) return true;
  if (![raw isKindOfClass:[NSArray class]] || [static_cast<NSArray*>(raw) count] > 4) return false;
  for (id value in static_cast<NSArray*>(raw)) {
    if (![value isKindOfClass:[NSString class]]) return false;
    NSString* modifier = [static_cast<NSString*>(value) uppercaseString];
    if ([modifier isEqualToString:@"META"] || [modifier isEqualToString:@"CMD"] || [modifier isEqualToString:@"COMMAND"]) *flags |= kCGEventFlagMaskCommand;
    else if ([modifier isEqualToString:@"CTRL"] || [modifier isEqualToString:@"CONTROL"]) *flags |= kCGEventFlagMaskControl;
    else if ([modifier isEqualToString:@"ALT"] || [modifier isEqualToString:@"OPTION"]) *flags |= kCGEventFlagMaskAlternate;
    else if ([modifier isEqualToString:@"SHIFT"]) *flags |= kCGEventFlagMaskShift;
    else return false;
  }
  return true;
}

struct WindowDescription {
  pid_t ownerPid;
  CGRect bounds;
  int layer;
};

bool windowDescription(CGWindowID windowId, WindowDescription* result) {
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, windowId);
  if (!descriptions) return false;
  bool found = false;
  if (CFArrayGetCount(descriptions) == 1) {
    CFDictionaryRef description = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(descriptions, 0));
    CFNumberRef numberValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowNumber));
    CFNumberRef ownerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowOwnerPID));
    CFNumberRef layerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowLayer));
    CFDictionaryRef boundsValue = static_cast<CFDictionaryRef>(CFDictionaryGetValue(description, kCGWindowBounds));
    int64_t candidateNumber = 0;
    WindowDescription candidate{};
    found = numberValue && ownerValue && layerValue && boundsValue
      && CFGetTypeID(numberValue) == CFNumberGetTypeID()
      && CFGetTypeID(ownerValue) == CFNumberGetTypeID()
      && CFGetTypeID(layerValue) == CFNumberGetTypeID()
      && CFGetTypeID(boundsValue) == CFDictionaryGetTypeID()
      && CFNumberGetValue(numberValue, kCFNumberSInt64Type, &candidateNumber)
      && CFNumberGetValue(ownerValue, kCFNumberSInt32Type, &candidate.ownerPid)
      && CFNumberGetValue(layerValue, kCFNumberIntType, &candidate.layer)
      && CGRectMakeWithDictionaryRepresentation(boundsValue, &candidate.bounds)
      && candidateNumber == static_cast<int64_t>(windowId);
    if (found) *result = candidate;
  }
  CFRelease(descriptions);
  return found;
}

bool windowOwner(CGWindowID windowId, pid_t* ownerPid) {
  WindowDescription description{};
  if (!windowDescription(windowId, &description)) return false;
  *ownerPid = description.ownerPid;
  return true;
}

bool approximatelyEqual(double left, double right) {
  return std::abs(left - right) <= 2;
}

bool targetWindowIdentityMatches(CGWindowID windowId, pid_t ownerPid, CGRect expectedBounds) {
  WindowDescription description{};
  return windowDescription(windowId, &description)
    && description.ownerPid == ownerPid
    && description.layer == 0
    && approximatelyEqual(description.bounds.origin.x, expectedBounds.origin.x)
    && approximatelyEqual(description.bounds.origin.y, expectedBounds.origin.y)
    && approximatelyEqual(description.bounds.size.width, expectedBounds.size.width)
    && approximatelyEqual(description.bounds.size.height, expectedBounds.size.height);
}

/** A safe fallback for utility applications that expose controls through AX
 * but no matchable top-level AX window. Frontmost application identity is an
 * unambiguous selected-window proof only when Window Server reports exactly
 * one visible normal-sized layer-zero window for that process, and that one
 * is the immutable selected id with the expected bounds. */
bool soleNormalWindowMatches(CGWindowID windowId, pid_t ownerPid, CGRect expectedBounds) {
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(
    static_cast<CGWindowListOption>(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements),
    kCGNullWindowID
  );
  if (!descriptions) return false;
  int normalWindowCount = 0;
  bool selectedFound = false;
  const CFIndex count = CFArrayGetCount(descriptions);
  for (CFIndex index = 0; index < count; index += 1) {
    CFDictionaryRef description = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(descriptions, index));
    if (!description || CFGetTypeID(description) != CFDictionaryGetTypeID()) continue;
    CFNumberRef numberValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowNumber));
    CFNumberRef ownerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowOwnerPID));
    CFNumberRef layerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowLayer));
    CFDictionaryRef boundsValue = static_cast<CFDictionaryRef>(CFDictionaryGetValue(description, kCGWindowBounds));
    int64_t candidateNumber = 0;
    pid_t candidateOwner = 0;
    int candidateLayer = -1;
    CGRect candidateBounds{};
    if (!numberValue || !ownerValue || !layerValue || !boundsValue
        || CFGetTypeID(numberValue) != CFNumberGetTypeID()
        || CFGetTypeID(ownerValue) != CFNumberGetTypeID()
        || CFGetTypeID(layerValue) != CFNumberGetTypeID()
        || CFGetTypeID(boundsValue) != CFDictionaryGetTypeID()
        || !CFNumberGetValue(numberValue, kCFNumberSInt64Type, &candidateNumber)
        || !CFNumberGetValue(ownerValue, kCFNumberSInt32Type, &candidateOwner)
        || !CFNumberGetValue(layerValue, kCFNumberIntType, &candidateLayer)
        || !CGRectMakeWithDictionaryRepresentation(boundsValue, &candidateBounds)
        || candidateOwner != ownerPid || candidateLayer != 0
        || candidateBounds.size.width < 120 || candidateBounds.size.height < 80) continue;
    normalWindowCount += 1;
    if (candidateNumber == static_cast<int64_t>(windowId)
        && approximatelyEqual(candidateBounds.origin.x, expectedBounds.origin.x)
        && approximatelyEqual(candidateBounds.origin.y, expectedBounds.origin.y)
        && approximatelyEqual(candidateBounds.size.width, expectedBounds.size.width)
        && approximatelyEqual(candidateBounds.size.height, expectedBounds.size.height)) {
      selectedFound = true;
    }
  }
  CFRelease(descriptions);
  return normalWindowCount == 1 && selectedFound;
}

/** CGWindowList is a fresh front-to-back Window Server snapshot. Prefer it to
 * NSRunningApplication.active inside this synchronous N-API call: AppKit
 * deliberately caches time-varying NSRunningApplication properties until the
 * next main-run-loop turn, while this verifier performs bounded waits on that
 * same thread.
 *
 * Foreground application and exact-window focus are intentionally separate
 * facts. Chromium can briefly place a same-process autocomplete or transient
 * surface above its main window while the selected top-level window remains
 * AX focused/main. Requiring the selected window itself to be first in global
 * z-order mislabeled that healthy state as target_application_not_frontmost. */
bool targetApplicationIsFrontmostNormal(pid_t ownerPid, pid_t* actualOwner = nullptr) {
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(
    static_cast<CGWindowListOption>(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements),
    kCGNullWindowID
  );
  if (!descriptions) return false;
  bool matches = false;
  const CFIndex count = CFArrayGetCount(descriptions);
  for (CFIndex index = 0; index < count; index += 1) {
    CFDictionaryRef description = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(descriptions, index));
    if (!description || CFGetTypeID(description) != CFDictionaryGetTypeID()) continue;
    CFNumberRef ownerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowOwnerPID));
    CFNumberRef layerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowLayer));
    CFDictionaryRef boundsValue = static_cast<CFDictionaryRef>(CFDictionaryGetValue(description, kCGWindowBounds));
    pid_t candidateOwner = 0;
    int candidateLayer = -1;
    CGRect candidateBounds{};
    if (!ownerValue || !layerValue || !boundsValue
        || CFGetTypeID(ownerValue) != CFNumberGetTypeID()
        || CFGetTypeID(layerValue) != CFNumberGetTypeID()
        || CFGetTypeID(boundsValue) != CFDictionaryGetTypeID()
        || !CFNumberGetValue(ownerValue, kCFNumberSInt32Type, &candidateOwner)
        || !CFNumberGetValue(layerValue, kCFNumberIntType, &candidateLayer)
        || !CGRectMakeWithDictionaryRepresentation(boundsValue, &candidateBounds)
        || candidateLayer != 0 || candidateBounds.size.width < 120 || candidateBounds.size.height < 80) continue;
    if (actualOwner) *actualOwner = candidateOwner;
    matches = candidateOwner == ownerPid;
    break;
  }
  CFRelease(descriptions);
  return matches;
}

/** The window server's own answer to "is this the window the next click
 * reaches": the front normal window on screen is the target itself. AX can
 * report a window as focused a beat before the server makes it key; a click
 * posted in that beat only activates the window and never reaches the page
 * (a live run showed grey traffic lights under a hovered link). */
struct FrontOwnerWindow {
  CGWindowID id = 0;
  CGRect bounds{};
  bool uniqueBounds = true;
};

FrontOwnerWindow frontNormalWindowOfOwner(pid_t ownerPid) {
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(
    static_cast<CGWindowListOption>(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements),
    kCGNullWindowID
  );
  FrontOwnerWindow front{};
  if (!descriptions) return front;
  const CFIndex count = CFArrayGetCount(descriptions);
  for (CFIndex index = 0; index < count; index += 1) {
    CFDictionaryRef description = static_cast<CFDictionaryRef>(CFArrayGetValueAtIndex(descriptions, index));
    if (!description || CFGetTypeID(description) != CFDictionaryGetTypeID()) continue;
    CFNumberRef numberValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowNumber));
    CFNumberRef ownerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowOwnerPID));
    CFNumberRef layerValue = static_cast<CFNumberRef>(CFDictionaryGetValue(description, kCGWindowLayer));
    CFDictionaryRef boundsValue = static_cast<CFDictionaryRef>(CFDictionaryGetValue(description, kCGWindowBounds));
    int candidateNumber = 0;
    pid_t candidateOwner = 0;
    int candidateLayer = -1;
    CGRect candidateBounds{};
    if (!numberValue || !ownerValue || !layerValue || !boundsValue
        || CFGetTypeID(numberValue) != CFNumberGetTypeID()
        || CFGetTypeID(ownerValue) != CFNumberGetTypeID()
        || CFGetTypeID(layerValue) != CFNumberGetTypeID()
        || CFGetTypeID(boundsValue) != CFDictionaryGetTypeID()
        || !CFNumberGetValue(numberValue, kCFNumberIntType, &candidateNumber)
        || !CFNumberGetValue(ownerValue, kCFNumberSInt32Type, &candidateOwner)
        || !CFNumberGetValue(layerValue, kCFNumberIntType, &candidateLayer)
        || !CGRectMakeWithDictionaryRepresentation(boundsValue, &candidateBounds)
        || candidateOwner != ownerPid
        || (candidateLayer != 0 && candidateLayer != 3) || candidateBounds.size.width < 120 || candidateBounds.size.height < 80) continue;
    // Keep the front identity and reject ambiguous geometry aliases when AX
    // omits a sheet's window number. Same-owner overlap is not ownership.
    if (!front.id) { front.id = static_cast<CGWindowID>(candidateNumber); front.bounds = candidateBounds; }
    else if (approximatelyEqual(front.bounds.origin.x, candidateBounds.origin.x)
      && approximatelyEqual(front.bounds.origin.y, candidateBounds.origin.y)
      && approximatelyEqual(front.bounds.size.width, candidateBounds.size.width)
      && approximatelyEqual(front.bounds.size.height, candidateBounds.size.height)) front.uniqueBounds = false;
  }
  CFRelease(descriptions);
  return front;
}

bool consoleSessionIsLocked() {
  NSRunningApplication* frontmost = [[NSWorkspace sharedWorkspace] frontmostApplication];
  return frontmost.bundleIdentifier && [frontmost.bundleIdentifier isEqualToString:@"com.apple.loginwindow"];
}

/** Advisory overlay visibility only. The capsule is a floating-level window;
 * the first normal-level window underneath it must still be its exact target.
 * This deliberately does not change the input controller's focus admission. */
bool overlayTargetIsFrontmostNormal(CGWindowID windowId) {
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(
    static_cast<CGWindowListOption>(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements), kCGNullWindowID);
  if (!descriptions) return false;
  bool matches = false;
  for (CFIndex index = 0; index < CFArrayGetCount(descriptions); index += 1) {
    NSDictionary* entry = (__bridge NSDictionary*)CFArrayGetValueAtIndex(descriptions, index);
    NSNumber* layer = entry[(id)kCGWindowLayer];
    NSNumber* number = entry[(id)kCGWindowNumber];
    NSDictionary* rawBounds = entry[(id)kCGWindowBounds];
    CGRect bounds{};
    if (![layer isKindOfClass:[NSNumber class]] || ![number isKindOfClass:[NSNumber class]]
        || ![rawBounds isKindOfClass:[NSDictionary class]] || layer.intValue != 0
        || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)rawBounds, &bounds)
        || bounds.size.width < 120 || bounds.size.height < 80) continue;
    matches = number.unsignedIntValue == windowId;
    break;
  }
  CFRelease(descriptions);
  return matches;
}

bool axWindowMatches(AXUIElementRef window, CGWindowID windowId, CGRect expectedBounds) {
  CFTypeRef rawNumber = nullptr;
  if (AXUIElementCopyAttributeValue(window, CFSTR("AXWindowNumber"), &rawNumber) == kAXErrorSuccess && rawNumber) {
    int64_t candidate = 0;
    const bool numberMatches = CFGetTypeID(rawNumber) == CFNumberGetTypeID()
      && CFNumberGetValue(static_cast<CFNumberRef>(rawNumber), kCFNumberSInt64Type, &candidate)
      && candidate == static_cast<int64_t>(windowId);
    CFRelease(rawNumber);
    return steward::acceptsAXWindowIdentityEvidence({ true, numberMatches, false });
  }
  CGWindowID serverId = 0;
  if (axWindowServerId(window, &serverId)) return steward::acceptsAXWindowIdentityEvidence({ true, serverId == windowId, false });

  CFTypeRef rawPosition = nullptr;
  CFTypeRef rawSize = nullptr;
  CGPoint position{};
  CGSize size{};
  const bool hasPosition = AXUIElementCopyAttributeValue(window, kAXPositionAttribute, &rawPosition) == kAXErrorSuccess
    && rawPosition && CFGetTypeID(rawPosition) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawPosition), static_cast<AXValueType>(kAXValueCGPointType), &position);
  const bool hasSize = AXUIElementCopyAttributeValue(window, kAXSizeAttribute, &rawSize) == kAXErrorSuccess
    && rawSize && CFGetTypeID(rawSize) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawSize), static_cast<AXValueType>(kAXValueCGSizeType), &size);
  if (rawPosition) CFRelease(rawPosition);
  if (rawSize) CFRelease(rawSize);
  const bool geometryMatches = hasPosition && hasSize
    && std::abs(position.x - expectedBounds.origin.x) <= 2
    && std::abs(position.y - expectedBounds.origin.y) <= 2
    && std::abs(size.width - expectedBounds.size.width) <= 2
    && std::abs(size.height - expectedBounds.size.height) <= 2;
  return steward::acceptsAXWindowIdentityEvidence({ false, false, geometryMatches });
}

/** Only AXSheet/AXPopover descendants of the exact selected AX window can extend its
 * focus boundary. No app-name, dialog-title, main-window or geometry-only
 * inference grants ownership. Traversal is bounded and never crosses an AX
 * application or a sibling top-level window. */
template <typename Visitor>
bool visitOwnedAttachedSurfaces(AXUIElementRef selected, pid_t ownerPid, int depth, int& remaining, bool& complete, const Visitor& visitor) {
  if (!selected || depth >= 4 || remaining <= 0) { complete = false; return false; }
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(selected, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess
      || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    complete = false;
    return false;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  // AppKit publishes attached sheets and popovers under their parent window
  // or attached surface. Large/unexpected trees are refused rather than searched freely.
  bool owned = false;
  const CFIndex count = CFArrayGetCount(children);
  if (count > 32 || count > remaining) complete = false;
  if (count <= 32) for (CFIndex index = 0; index < count && !owned && remaining > 0; index++) {
    remaining--;
    CFTypeRef raw = CFArrayGetValueAtIndex(children, index);
    if (!raw || CFGetTypeID(raw) != AXUIElementGetTypeID()) continue;
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(raw));
    AXUIElementSetMessagingTimeout(child, 0.1f);
    pid_t pid = 0;
    CFTypeRef role = nullptr;
    const bool sheet = AXUIElementGetPid(child, &pid) == kAXErrorSuccess && pid == ownerPid
      && AXUIElementCopyAttributeValue(child, kAXRoleAttribute, &role) == kAXErrorSuccess
      && role && (CFEqual(role, kAXSheetRole) || CFEqual(role, CFSTR("AXPopover")));
    if (role) CFRelease(role);
    if (sheet) owned = visitor(child) || visitOwnedAttachedSurfaces(child, ownerPid, depth + 1, remaining, complete, visitor);
  }
  CFRelease(children);
  return owned;
}

bool ownsFrontAttachedSurface(AXUIElementRef selected, const FrontOwnerWindow& front, pid_t ownerPid, int depth, int& remaining) {
  if (!selected || !front.id || !front.uniqueBounds) return false;
  bool complete = true;
  return visitOwnedAttachedSurfaces(selected, ownerPid, depth, remaining, complete,
    [&](AXUIElementRef sheet) { return axWindowMatches(sheet, front.id, front.bounds); });
}

// A native popup may expose its content under both its own AX window and its
// document (Chromium Find/address suggestions do this). Shared AX identity is
// ownership evidence; matching titles, size or same-process membership are not.
bool containsNativeContent(AXUIElementRef parent, CFArrayRef popupChildren, pid_t ownerPid, int depth, int& remaining) {
  if (depth >= 4 || remaining <= 0) return false;
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(parent, kAXChildrenAttribute, &raw) != kAXErrorSuccess || !raw) return false;
  bool found = false;
  if (CFGetTypeID(raw) == CFArrayGetTypeID() && CFArrayGetCount(static_cast<CFArrayRef>(raw)) <= 32) {
    CFArrayRef children = static_cast<CFArrayRef>(raw);
    for (CFIndex i = 0; i < CFArrayGetCount(children) && !found && remaining > 0; i++) {
      remaining--;
      CFTypeRef child = CFArrayGetValueAtIndex(children, i);
      if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) continue;
      auto element = static_cast<AXUIElementRef>(const_cast<void*>(child));
      AXUIElementSetMessagingTimeout(element, 0.1f);
      pid_t pid = 0;
      if (AXUIElementGetPid(element, &pid) != kAXErrorSuccess || pid != ownerPid) continue;
      if (popupChildren && CFArrayContainsValue(popupChildren, CFRangeMake(0, CFArrayGetCount(popupChildren)), child)) { found = true; break; }
      CFTypeRef role = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role) == kAXErrorSuccess && role) {
        // Never cross web content, application roots or sibling AX windows.
        const bool container = CFEqual(role, kAXGroupRole) || CFEqual(role, kAXSheetRole) || CFEqual(role, kAXScrollAreaRole);
        if (!found && container)
          found = containsNativeContent(element, popupChildren, ownerPid, depth + 1, remaining);
        CFRelease(role);
      }
    }
  }
  CFRelease(raw);
  return found;
}

bool surfaceReceiversBelongTo(AXUIElementRef selected, CGRect bounds) {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementSetMessagingTimeout(system, 0.1f);
  bool owned = true;
  for (double ratio : {0.1, 0.5, 0.9}) {
    AXUIElementRef hit = nullptr;
    CFTypeRef window = nullptr;
    owned = AXUIElementCopyElementAtPosition(system, bounds.origin.x + ratio * bounds.size.width,
      bounds.origin.y + ratio * bounds.size.height, &hit) == kAXErrorSuccess && hit;
    if (owned) {
      AXUIElementSetMessagingTimeout(hit, 0.1f);
      owned = AXUIElementCopyAttributeValue(hit, kAXWindowAttribute, &window) == kAXErrorSuccess
        && window && CFEqual(window, selected);
    }
    if (window) CFRelease(window);
    if (hit) CFRelease(hit);
    if (!owned) break;
  }
  CFRelease(system);
  return owned;
}

// A detached native panel has no AX child link to its source document.
// Keep one short-lived causal observation: a panel must become visible after
// delivered input, acquire focus, and leave this exact document as main. The
// retained AX identities prevent window-number reuse from inheriting authority.
// This does not admit ordinary documents or cross-application destinations.
struct PanelTransition {
  CGWindowID root = 0, panel = 0;
  pid_t pid = 0;
  AXUIElementRef document = nullptr, surface = nullptr;
  std::vector<CGWindowID> visibleBefore;
  CFAbsoluteTime expires = 0;
  ~PanelTransition() { clear(); }
  void clear() {
    if (document) CFRelease(document);
    if (surface) CFRelease(surface);
    document = nullptr; surface = nullptr; root = panel = 0;
    visibleBefore.clear(); expires = 0;
  }
};
PanelTransition panelTransition;

std::vector<CGWindowID> visiblePanelBaseline(pid_t pid) {
  std::vector<CGWindowID> ids;
  CFArrayRef list = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly, kCGNullWindowID);
  if (!list || CFArrayGetCount(list) > 4096) { if (list) CFRelease(list); return ids; }
  for (NSDictionary* w in (__bridge NSArray*)list) {
    if ([w[(id)kCGWindowOwnerPID] intValue] == pid)
      ids.push_back([w[(id)kCGWindowNumber] unsignedIntValue]);
  }
  CFRelease(list);
  return ids;
}

// Bind while the root itself is the verified front/key window. Geometry can
// identify several stacked windows; their Window Server order plus the exact
// focused/main AX identity identifies the receiver before input opens a panel.
struct InputDocumentIdentity {
  AXUIElementRef value = nullptr;
  ~InputDocumentIdentity() { if (value) CFRelease(value); }
};
AXUIElementRef copyInputDocument(CGWindowID root, pid_t pid, CGRect bounds) {
  if (frontNormalWindowOfOwner(pid).id != root) return nullptr;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef main = nullptr, focused = nullptr;
  AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute, &main);
  AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &focused);
  // An order-front window can differ from the keyboard window. Confirm the
  // application-scoped hit receiver belongs to the same AX window; unrelated
  // desktop overlays do not participate in this application identity lookup.
  AXUIElementRef hit = nullptr;
  CFTypeRef hitWindow = nullptr;
  AXUIElementCopyElementAtPosition(app, CGRectGetMidX(bounds), CGRectGetMidY(bounds), &hit);
  if (hit) AXUIElementCopyAttributeValue(hit, kAXWindowAttribute, &hitWindow);
  const bool verified = main && focused && CFGetTypeID(main) == AXUIElementGetTypeID()
    && hitWindow && CFEqual(main, hitWindow) && CFEqual(main, focused) && axWindowMatches(static_cast<AXUIElementRef>(main), root, bounds)
    && [NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier == pid
    && frontNormalWindowOfOwner(pid).id == root;
  if (hitWindow) CFRelease(hitWindow);
  if (hit) CFRelease(hit);
  if (focused) CFRelease(focused);
  CFRelease(app);
  if (!verified) { if (main) CFRelease(main); return nullptr; }
  return static_cast<AXUIElementRef>(main);
}

void armPanelTransition(CGWindowID root, pid_t pid, AXUIElementRef document, const std::vector<CGWindowID>& baseline) {
  // Input inside an established preview cannot create a new root binding.
  if (!document || baseline.empty()) return;
  panelTransition.clear();
  panelTransition.root = root; panelTransition.pid = pid;
  panelTransition.document = document; CFRetain(document);
  panelTransition.visibleBefore = baseline;
  panelTransition.expires = CFAbsoluteTimeGetCurrent() + 5;
}

AXUIElementRef copyTransitionDocument(CGWindowID root, pid_t pid, CGRect bounds) {
  auto& t = panelTransition;
  if (t.root != root || t.pid != pid || !t.document
      || !axWindowMatches(t.document, root, bounds)) return nullptr;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef main = nullptr;
  AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute, &main);
  const bool same = main && CFEqual(main, t.document);
  if (main) CFRelease(main);
  CFRelease(app);
  if (!same) return nullptr;
  CFRetain(t.document);
  return t.document;
}

bool ownsCausalPanel(AXUIElementRef selected, const FrontOwnerWindow& front, pid_t pid, CGWindowID root) {
  auto& t = panelTransition;
  if (t.root != root || !t.document || t.pid != pid || !CFEqual(t.document, selected) || !front.uniqueBounds) return false;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef main = nullptr, focused = nullptr, subrole = nullptr;
  AXUIElementCopyAttributeValue(app, kAXMainWindowAttribute, &main);
  AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &focused);
  const bool sameMain = main && CFEqual(main, selected);
  const bool focusMatches = focused && CFGetTypeID(focused) == AXUIElementGetTypeID()
    && axWindowMatches(static_cast<AXUIElementRef>(focused), front.id, front.bounds);
  if (focusMatches) AXUIElementCopyAttributeValue(static_cast<AXUIElementRef>(focused), kAXSubroleAttribute, &subrole);
  // Quick Look publishes a native preview role and preserves its source as
  // main. Generic dialogs still require AX attachment/shared-content proof:
  // a global alert appearing after input is not a document relationship.
  const bool nativePanel = subrole && CFEqual(subrole, CFSTR("Quick Look"));
  const bool applicationFocused = [NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier == pid;
  bool owned = sameMain && focusMatches && nativePanel && applicationFocused;
  if (t.surface) owned = owned && t.panel == front.id && CFEqual(t.surface, focused);
  else owned = owned && CFAbsoluteTimeGetCurrent() <= t.expires
    && std::find(t.visibleBefore.begin(), t.visibleBefore.end(), front.id) == t.visibleBefore.end();
  if (owned && !t.surface) { t.surface = static_cast<AXUIElementRef>(focused); CFRetain(t.surface); t.panel = front.id; }
  // An established relationship ends on dismissal or a user focus change.
  if (!owned && t.surface) t.clear();
  if (subrole) CFRelease(subrole);
  if (focused) CFRelease(focused);
  if (main) CFRelease(main);
  CFRelease(app);
  return owned;
}

bool ownsFrontTransient(AXUIElementRef selected, const FrontOwnerWindow& front, pid_t ownerPid, CGRect selectedBounds, CGWindowID root) {
  if (ownsCausalPanel(selected, front, ownerPid, root)) return true;
  int remaining = 32;
  if (ownsFrontAttachedSurface(selected, front, ownerPid, 0, remaining)) return true;
  if (!selected || !front.id || !front.uniqueBounds) return false;
  AXUIElementRef app = AXUIElementCreateApplication(ownerPid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef rawWindows = nullptr;
  bool owned = false, frontIsAXWindow = false;
  if (AXUIElementCopyAttributeValue(app, kAXWindowsAttribute, &rawWindows) == kAXErrorSuccess
      && rawWindows && CFGetTypeID(rawWindows) == CFArrayGetTypeID()) {
    CFArrayRef windows = static_cast<CFArrayRef>(rawWindows);
    const CFIndex count = CFArrayGetCount(windows);
    const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.5;
    bool completeWindowScan = count <= 256;
    for (CFIndex i = 0; i < std::min<CFIndex>(count, 256) && !owned; i++) {
      if (CFAbsoluteTimeGetCurrent() > deadline) { completeWindowScan = false; break; }
      CFTypeRef candidate = CFArrayGetValueAtIndex(windows, i);
      if (!candidate || CFGetTypeID(candidate) != AXUIElementGetTypeID()) continue;
      auto popup = static_cast<AXUIElementRef>(const_cast<void*>(candidate));
      AXUIElementSetMessagingTimeout(popup, 0.1f);
      if (!axWindowMatches(popup, front.id, front.bounds)) continue;
      frontIsAXWindow = true;
      CFTypeRef subrole = nullptr, children = nullptr;
      // Ordinary top-level documents never extend another document's boundary.
      const bool transient = AXUIElementCopyAttributeValue(popup, kAXSubroleAttribute, &subrole) == kAXErrorSuccess
        && subrole && !CFEqual(subrole, kAXStandardWindowSubrole);
      // A floating palette of the same application (TextEdit's Fonts panel,
      // Preview's inspector) stays above every document at window layer 3
      // and never receives a document's input; the selected window must
      // still be the application's focused and main window, which the
      // caller checks separately. Previously such a panel blocked
      // every input to the application as a sibling in front.
      const bool palette = transient
        && (CFEqual(subrole, kAXFloatingWindowSubrole) || CFEqual(subrole, kAXSystemFloatingWindowSubrole));
      if (palette) owned = true;
      else if (transient && AXUIElementCopyAttributeValue(popup, kAXChildrenAttribute, &children) == kAXErrorSuccess
          && children && CFGetTypeID(children) == CFArrayGetTypeID()
          && CFArrayGetCount(static_cast<CFArrayRef>(children)) <= 16) {
        remaining = 32;
        owned = containsNativeContent(selected, static_cast<CFArrayRef>(children), ownerPid, 0, remaining);
      }
      if (subrole) CFRelease(subrole);
      if (children) CFRelease(children);
      break;
    }
    // AppKit can publish an embedded view's rendering surface as a layer-zero
    // CG window without an AX window (for example Find's dimmed text area).
    // Accept it only with an exhaustive bounded AX-window check, the exact
    // selected focused window, and hit-tested receivers inside that window.
    // Use receiver identity, not content size: scrolled AX text bounds include
    // offscreen content and cannot identify the rendered viewport reliably.
    // A real sibling AX window, even if aligned with that view, never qualifies.
    if (!owned && !frontIsAXWindow && completeWindowScan && CGRectContainsRect(selectedBounds, front.bounds)) {
      CFTypeRef focused = nullptr;
      if (AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &focused) == kAXErrorSuccess
          && focused && CFEqual(focused, selected)) {
        owned = surfaceReceiversBelongTo(selected, front.bounds);
      }
      if (focused) CFRelease(focused);
    }
  }
  if (rawWindows) CFRelease(rawWindows);
  CFRelease(app);
  return owned;
}

bool applicationWindowMatches(AXUIElementRef application, CFStringRef attribute, CGWindowID windowId, CGRect expectedBounds) {
  CFTypeRef rawWindow = nullptr;
  const bool copied = AXUIElementCopyAttributeValue(application, attribute, &rawWindow) == kAXErrorSuccess
    && rawWindow && CFGetTypeID(rawWindow) == AXUIElementGetTypeID();
  const bool matches = copied && axWindowMatches(static_cast<AXUIElementRef>(rawWindow), windowId, expectedBounds);
  if (rawWindow) CFRelease(rawWindow);
  return matches;
}

// Native sheets can leave AXFocusedWindow/AXMainWindow pointing at an older
// document while AXFocusedUIElement identifies the actual receiver. Follow its
// parent identities to the owning document; never infer ownership from titles
// or from another top-level window of the same application.
AXUIElementRef copyFocusedDocumentWindow(AXUIElementRef application) {
  CFTypeRef current = nullptr;
  if (AXUIElementCopyAttributeValue(application, kAXFocusedUIElementAttribute, &current) != kAXErrorSuccess || !current) return nullptr;
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.35;
  for (int depth = 0; current && depth < 16 && CFAbsoluteTimeGetCurrent() < deadline; depth++) {
    if (CFGetTypeID(current) != AXUIElementGetTypeID()) break;
    auto element = static_cast<AXUIElementRef>(current);
    AXUIElementSetMessagingTimeout(element, 0.1f);
    CFTypeRef role = nullptr;
    AXUIElementCopyAttributeValue(element, kAXRoleAttribute, &role);
    const bool document = role && CFEqual(role, kAXWindowRole);
    const bool applicationRoot = role && CFEqual(role, kAXApplicationRole);
    if (role) CFRelease(role);
    if (document) return element;
    if (applicationRoot) break;
    CFTypeRef parent = nullptr;
    AXUIElementCopyAttributeValue(element, kAXParentAttribute, &parent);
    CFRelease(current);
    current = parent;
  }
  if (current) CFRelease(current);
  return nullptr;
}

NSString* axStringAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess || !raw || CFGetTypeID(raw) != CFStringGetTypeID()) {
    if (raw) CFRelease(raw);
    return nil;
  }
  NSString* value = [(__bridge NSString*)raw copy];
  CFRelease(raw);
  return value;
}

AXUIElementRef findAXDescendant(AXUIElementRef root, NSString* wantedTitle, NSString* wantedRole, int depth, int* visited) {
  if (!root || depth > 6 || *visited >= 180) return nullptr;
  *visited += 1;
  NSString* title = axStringAttribute(root, kAXTitleAttribute);
  if (!title || title.length == 0) title = axStringAttribute(root, kAXDescriptionAttribute);
  NSString* role = axStringAttribute(root, kAXRoleAttribute);
  if ([title isEqualToString:wantedTitle] && (!wantedRole || [role isEqualToString:wantedRole])) {
    CFRetain(root);
    return root;
  }
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(root, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess
      || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    return nullptr;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  AXUIElementRef found = nullptr;
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 60);
  for (CFIndex index = 0; index < count && !found; index += 1) {
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
    if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) found = findAXDescendant(child, wantedTitle, wantedRole, depth + 1, visited);
  }
  CFRelease(rawChildren);
  return found;
}

bool postKey(CGKeyCode code, CGEventFlags flags);
AXUIElementRef findAXRoleDescendant(AXUIElementRef root, NSString* wantedRole, int depth, int* visited);

bool axElementEnabled(AXUIElementRef element) {
  CFTypeRef raw = nullptr;
  const bool copied = AXUIElementCopyAttributeValue(element, kAXEnabledAttribute, &raw) == kAXErrorSuccess && raw;
  const bool enabled = copied && CFGetTypeID(raw) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(raw));
  if (raw) CFRelease(raw);
  return enabled;
}

/** Execute one controller-defined command through the selected application's
 * Accessibility menu. Neither model-authored shortcuts nor arbitrary menu
 * strings cross this boundary. */
bool performSafeApplicationCommand(CGWindowID windowId, NSString* expectedBundleIdentifier, NSString* command, bool* changed = nullptr) {
  if (changed) *changed = false;
  if (![command isEqualToString:@"textedit.make_plain_text"] || ![expectedBundleIdentifier isEqualToString:@"com.apple.TextEdit"]) return false;
  WindowDescription description{};
  if (!windowDescription(windowId, &description) || description.layer != 0) return false;
  const pid_t ownerPid = description.ownerPid;
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:ownerPid];
  if (!running || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) return false;
  AXUIElementRef application = AXUIElementCreateApplication(ownerPid);
  if (!application) return false;
  AXUIElementSetMessagingTimeout(application, 0.5f);

  auto copySelectedAXWindow = [&]() -> AXUIElementRef {
    for (CFStringRef attribute : { kAXFocusedWindowAttribute, kAXMainWindowAttribute }) {
      CFTypeRef rawWindow = nullptr;
      if (AXUIElementCopyAttributeValue(application, attribute, &rawWindow) != kAXErrorSuccess
          || !rawWindow || CFGetTypeID(rawWindow) != AXUIElementGetTypeID()) {
        if (rawWindow) CFRelease(rawWindow);
        continue;
      }
      AXUIElementRef window = static_cast<AXUIElementRef>(rawWindow);
      if (axWindowMatches(window, windowId, description.bounds)) return window;
      CFRelease(rawWindow);
    }
    return nullptr;
  };

  AXUIElementRef selectedWindow = copySelectedAXWindow();
  if (!selectedWindow) {
    CFRelease(application);
    return false;
  }
  int visited = 0;
  AXUIElementRef richToolbar = findAXRoleDescendant(selectedWindow, @"AXToolbar", 0, &visited);
  CFRelease(selectedWindow);
  if (!richToolbar) {
    // TextEdit removes its character-formatting toolbar in plain-text mode.
    // Absence is state evidence, so the command is idempotently satisfied.
    CFRelease(application);
    return true;
  }
  CFRelease(richToolbar);

  // Shift-Command-T is TextEdit's fixed application command for toggling the
  // current document format. It is controller-owned, never model-authored,
  // and is used only after the exact fresh TextEdit window and visible rich
  // formatting state have both been proven.
  if (!postKey(17, kCGEventFlagMaskCommand | kCGEventFlagMaskShift)) {
    CFRelease(application);
    return false;
  }
  usleep(300'000);
  selectedWindow = copySelectedAXWindow();
  visited = 0;
  richToolbar = selectedWindow ? findAXRoleDescendant(selectedWindow, @"AXToolbar", 0, &visited) : nullptr;
  if (richToolbar) CFRelease(richToolbar);
  const bool converted = selectedWindow && !richToolbar;
  if (selectedWindow) CFRelease(selectedWindow);
  CFRelease(application);
  if (changed) *changed = converted;
  return converted;
}

struct WindowFocusResult {
  bool verified;
  const char* reason;
  NSDictionary* diagnostics = nil;
};

const char* rejectedFocusReason(const steward::WindowFocusEvidence& evidence) {
  if (!evidence.targetIdentityMatches) return "target_identity_changed";
  if (!evidence.targetApplicationFrontmost) return "target_application_not_frontmost";
  return "selected_window_not_focused_or_main";
}

void requestApplicationFocus(NSRunningApplication* running, AXUIElementRef application) {
  // On macOS 14+, a normal activation request is sufficient; the historical
  // "ignore other apps" flag is deprecated and intentionally unnecessary.
  // Some utility applications ignore LaunchServices activation while they are
  // backgrounded, so assert the standard Accessibility frontmost attribute on
  // the exact owner process as well. Verification below still decides whether
  // the request actually took effect before any input may be posted.
  if (@available(macOS 14.0, *)) {
    [[NSApplication sharedApplication] yieldActivationToApplication:running];
    [running activateFromApplication:[NSRunningApplication currentApplication]
                             options:static_cast<NSApplicationActivationOptions>(0)];
  } else {
    [running activateWithOptions:static_cast<NSApplicationActivationOptions>(0)];
  }
  AXUIElementSetAttributeValue(application, kAXFrontmostAttribute, kCFBooleanTrue);
}

void requestSelectedWindowFocus(NSRunningApplication* running, AXUIElementRef application, AXUIElementRef selected) {
  requestApplicationFocus(running, application);
  AXUIElementSetAttributeValue(application, kAXFocusedWindowAttribute, selected);
  AXUIElementSetAttributeValue(selected, kAXMainAttribute, kCFBooleanTrue);
  AXUIElementSetAttributeValue(selected, kAXFocusedAttribute, kCFBooleanTrue);
  AXUIElementPerformAction(selected, kAXRaiseAction);
}

bool inputApplicationHasFocus(pid_t ownerPid, pid_t* actualPid = nullptr, AXError* readError = nullptr) {
  // NSWorkspace.frontmostApplication is notification-cached in this process;
  // the synchronous input bridge must ask AX for the current system receiver.
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementSetMessagingTimeout(system, 0.1f);
  CFTypeRef application = nullptr;
  pid_t focusedPid = 0;
  const AXError error = AXUIElementCopyAttributeValue(system, kAXFocusedApplicationAttribute, &application);
  if (readError) *readError = error;
  const bool focused = error == kAXErrorSuccess
    && application && CFGetTypeID(application) == AXUIElementGetTypeID()
    && AXUIElementGetPid(static_cast<AXUIElementRef>(application), &focusedPid) == kAXErrorSuccess && focusedPid == ownerPid;
  if (actualPid) *actualPid = focusedPid;
  if (application) CFRelease(application);
  CFRelease(system);
  bool applicationFrontmost = false;
  if (error == kAXErrorNoValue) {
    // Some Chromium processes expose a current AXFrontmost value while the
    // system-wide AXFocusedApplication has no value. Read the exact owner;
    // do not substitute cached NSRunningApplication.active or mere z-order.
    AXUIElementRef owner = AXUIElementCreateApplication(ownerPid);
    AXUIElementSetMessagingTimeout(owner, 0.1f);
    CFTypeRef value = nullptr;
    applicationFrontmost = AXUIElementCopyAttributeValue(owner, kAXFrontmostAttribute, &value) == kAXErrorSuccess
      && value && CFGetTypeID(value) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(value));
    if (value) CFRelease(value);
    CFRelease(owner);
  }
  const auto global = focused ? steward::GlobalApplicationFocus::target
    : error == kAXErrorNoValue ? steward::GlobalApplicationFocus::noValue
    : error == kAXErrorSuccess && focusedPid > 0 ? steward::GlobalApplicationFocus::other
    : steward::GlobalApplicationFocus::error;
  return steward::acceptsApplicationFocusEvidence(global, applicationFrontmost);
}

/** Identity-only failure evidence. Never retain window titles or page text. */
NSDictionary* focusFailureEvidence(CGWindowID windowId, pid_t ownerPid) {
  pid_t focusedPid = 0, frontPid = 0;
  AXError error = kAXErrorSuccess;
  inputApplicationHasFocus(ownerPid, &focusedPid, &error);
  targetApplicationIsFrontmostNormal(ownerPid, &frontPid);
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementSetMessagingTimeout(system, 0.1f);
  CFTypeRef element = nullptr;
  const AXError elementError = AXUIElementCopyAttributeValue(system, kAXFocusedUIElementAttribute, &element);
  pid_t elementPid = 0;
  if (elementError == kAXErrorSuccess && element && CFGetTypeID(element) == AXUIElementGetTypeID())
    AXUIElementGetPid(static_cast<AXUIElementRef>(element), &elementPid);
  if (element) CFRelease(element);
  CFRelease(system);
  AXUIElementRef app = AXUIElementCreateApplication(ownerPid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef appFrontmost = nullptr;
  const AXError appError = AXUIElementCopyAttributeValue(app, kAXFrontmostAttribute, &appFrontmost);
  const bool appIsFrontmost = appFrontmost && CFGetTypeID(appFrontmost) == CFBooleanGetTypeID() && CFBooleanGetValue(static_cast<CFBooleanRef>(appFrontmost));
  if (appFrontmost) CFRelease(appFrontmost);
  CFRelease(app);
  return @{ @"windowId": @(windowId), @"ownerPid": @(ownerPid), @"focusedPid": @(focusedPid),
    @"frontNormalPid": @(frontPid), @"frontOwnerWindowId": @(frontNormalWindowOfOwner(ownerPid).id), @"focusedApplicationReadError": @(error),
    @"focusedElementPid": @(elementPid), @"focusedElementReadError": @(elementError),
    @"applicationFrontmost": @(appIsFrontmost), @"applicationFrontmostReadError": @(appError),
    @"workspaceFrontPid": @([NSWorkspace sharedWorkspace].frontmostApplication.processIdentifier),
    @"controllerPid": @(getpid()), @"mainThread": @([NSThread isMainThread]) };
}

NSString* focusFailureSuffix(const WindowFocusResult& focus) {
  if (!focus.diagnostics) return @"";
  NSData* data = [NSJSONSerialization dataWithJSONObject:focus.diagnostics options:NSJSONWritingSortedKeys error:nil];
  return data ? [@"; focus evidence: " stringByAppendingString:[[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding]] : @"";
}

// LaunchServices occasionally has no bundle identity during a window transition.
// Share one bounded read policy across capture and input; no mutation or inferred
// ownership is permitted when all reads fail.
NSRunningApplication* selectedWindowApplication(CGWindowID windowId, NSString* bundle,
    WindowDescription* description, const char** failure) {
  for (int attempt=0; attempt<4; attempt++) {
    if (attempt) usleep(120'000);
    WindowDescription current{};
    if (!windowDescription(windowId, &current)) { *failure="target_window_unavailable"; continue; }
    NSRunningApplication* candidate=[NSRunningApplication runningApplicationWithProcessIdentifier:current.ownerPid];
    if (candidate && candidate.bundleIdentifier && [candidate.bundleIdentifier isEqualToString:bundle]) {
      *description=current;
      return candidate;
    }
    *failure="target_owner_changed";
  }
  return nil;
}

WindowFocusResult focusSelectedWindow(CGWindowID windowId, CGRect expectedBounds, NSString* expectedBundleIdentifier) {
  WindowDescription description{};
  const char* identityFailure="target_window_unavailable";
  NSRunningApplication* running=selectedWindowApplication(windowId,expectedBundleIdentifier,&description,&identityFailure);
  if (!running) return {false,identityFailure};
  const pid_t ownerPid=description.ownerPid;
  // Never attempt to activate or send input through the macOS lock screen.
  // The caller surfaces this before model planning whenever possible.
  if (consoleSessionIsLocked()) return { false, "screen_locked" };
  AXUIElementRef application = AXUIElementCreateApplication(ownerPid);
  if (!application) return { false, "accessibility_application_unavailable" };
  // This whole function runs synchronously on Electron's main thread. A
  // browser with many windows can take seconds per accessibility answer, and
  // one unanswered call here froze the entire app — the checkpoint dialog,
  // its Allow button, every IPC — until the default timeout expired. Every
  // call below carries a short deadline; a slow answer is a refused focus,
  // never a frozen app.
  AXUIElementSetMessagingTimeout(application, 0.25f);

  // The selected window is nearly always the application's focused or main
  // window already. Ask for those two first; enumerating every window is
  // the fallback, and it is bounded.
  AXUIElementRef selected = copyTransitionDocument(windowId, ownerPid, expectedBounds);
  if (!selected) selected = copyFocusedDocumentWindow(application);
  if (selected && !axWindowMatches(selected, windowId, expectedBounds)) { CFRelease(selected); selected = nullptr; }
  for (CFStringRef attribute : { kAXFocusedWindowAttribute, kAXMainWindowAttribute }) {
    if (selected) break;
    CFTypeRef rawWindow = nullptr;
    if (AXUIElementCopyAttributeValue(application, attribute, &rawWindow) == kAXErrorSuccess && rawWindow && CFGetTypeID(rawWindow) == AXUIElementGetTypeID()) {
      AXUIElementRef candidate = static_cast<AXUIElementRef>(const_cast<void*>(rawWindow));
      AXUIElementSetMessagingTimeout(candidate, 0.25f);
      if (axWindowMatches(candidate, windowId, expectedBounds)) { selected = candidate; break; }
    }
    if (rawWindow) CFRelease(rawWindow);
  }
  if (!selected) {
    CFTypeRef rawWindows = nullptr;
    if (AXUIElementCopyAttributeValue(application, kAXWindowsAttribute, &rawWindows) != kAXErrorSuccess
        || !rawWindows || CFGetTypeID(rawWindows) != CFArrayGetTypeID()) {
      if (rawWindows) CFRelease(rawWindows);
      CFRelease(application);
      return { false, "accessibility_window_list_unavailable" };
    }
    CFArrayRef windows = static_cast<CFArrayRef>(rawWindows);
    const CFIndex count = std::min<CFIndex>(CFArrayGetCount(windows), 24);
    for (CFIndex index = 0; index < count; index += 1) {
      AXUIElementRef candidate = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(windows, index)));
      if (!candidate) continue;
      AXUIElementSetMessagingTimeout(candidate, 0.25f);
      if (axWindowMatches(candidate, windowId, expectedBounds)) {
        selected = candidate;
        CFRetain(selected);
        break;
      }
    }
    CFRelease(rawWindows);
  }
  const bool soleWindowFallback = !selected && soleNormalWindowMatches(windowId, ownerPid, expectedBounds);
  if (!selected && !soleWindowFallback) {
    CFRelease(application);
    return { false, "selected_accessibility_window_not_found" };
  }

  // Accessibility can report the selected window as
  // focused a beat before the window server makes it key, and a click posted
  // in that beat only activates the window: a live run captured grey traffic
  // lights under a hovered link after such a click. The window server's
  // z-order is therefore required evidence too, and a window that had to be
  // raised gets a short settle before any input.
  const auto initialFront = frontNormalWindowOfOwner(ownerPid);
  const bool initialSheet = selected && initialFront.id != windowId && ownsFrontTransient(selected, initialFront, ownerPid, expectedBounds, windowId);
  const bool alreadyFront = inputApplicationHasFocus(ownerPid)
    && targetApplicationIsFrontmostNormal(ownerPid) && (soleWindowFallback || initialFront.id == windowId || initialSheet);
  // Preserve the first responder when AX focus/main and server z-order agree.
  // Re-focusing an already-key window cancels native inline editing (Finder
  // rename is one example). Otherwise raise and verify the exact same target.
  const bool alreadyFocused = selected && (applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, expectedBounds)
    || applicationWindowMatches(application, kAXMainWindowAttribute, windowId, expectedBounds)
    || (initialSheet && applicationWindowMatches(application, kAXFocusedWindowAttribute, initialFront.id, initialFront.bounds)));
  if (!alreadyFront || !alreadyFocused) {
    if (initialSheet) { requestApplicationFocus(running, application); AXUIElementPerformAction(selected, kAXRaiseAction); }
    else if (selected) requestSelectedWindowFocus(running, application, selected);
    else requestApplicationFocus(running, application);
  }
  const int verificationAttempts = 6;
  const useconds_t verificationDelay = 90'000;
  // Nothing was requested when the window server and AX already agreed that
  // the exact window is front, key and focused: no activation is in flight,
  // so there is no beat to wait out. Every input paid 90 + 60 ms here twice
  // (the controller's focus handoff, then this same check inside execute),
  // about 0.3 s per input (measured in traces). The evidence is still read
  // once below before any input. STEWARD_NATIVE_FOCUS_FAST=off restores the waits.
  const char* fastSetting = getenv("STEWARD_NATIVE_FOCUS_FAST");
  const bool nothingRequested = alreadyFront && alreadyFocused
    && !(fastSetting && strcasecmp(fastSetting, "off") == 0);
  const useconds_t raisedSettleDelay = nothingRequested ? 0 : alreadyFront ? 60'000 : 220'000;
  const char* lastReason = "selected_window_not_focused_or_main";
  for (int attempt = 0; attempt < verificationAttempts; attempt += 1) {
    if (attempt > 0 || !nothingRequested) usleep(verificationDelay);
    // A sibling window of the same application in front of the target would
    // take the click: the server's z-order is required alongside AX focus.
    const auto frontWindow = frontNormalWindowOfOwner(ownerPid);
    const bool ownedSheet = selected && frontWindow.id != windowId && ownsFrontTransient(selected, frontWindow, ownerPid, expectedBounds, windowId);
    const bool front = soleWindowFallback || frontWindow.id == windowId || ownedSheet;
    const steward::WindowFocusEvidence evidence{
      targetWindowIdentityMatches(windowId, ownerPid, expectedBounds),
      targetApplicationIsFrontmostNormal(ownerPid) && inputApplicationHasFocus(ownerPid),
      selected && front && (applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, expectedBounds)
        || (ownedSheet && applicationWindowMatches(application, kAXFocusedWindowAttribute, frontWindow.id, frontWindow.bounds))),
      selected && front && applicationWindowMatches(application, kAXMainWindowAttribute, windowId, expectedBounds),
      soleWindowFallback && soleNormalWindowMatches(windowId, ownerPid, expectedBounds),
    };
    if (!front) lastReason = "selected_window_behind_sibling";
    if (steward::acceptsWindowFocusEvidence(evidence)) {
      if (selected) CFRelease(selected);
      CFRelease(application);
      if (raisedSettleDelay > 0) usleep(raisedSettleDelay);
      return { true, "verified" };
    }
    if (front) lastReason = rejectedFocusReason(evidence);
    // Window activation and AX z-order updates are asynchronous. Reassert the
    // exact same target during the bounded retry, but never substitute another
    // window or continue after its identity/bounds change.
    if (!evidence.targetIdentityMatches) break;
    if (attempt == 1 || attempt == 3) {
      if (ownedSheet) { requestApplicationFocus(running, application); AXUIElementPerformAction(selected, kAXRaiseAction); }
      else if (selected) requestSelectedWindowFocus(running, application, selected);
      else requestApplicationFocus(running, application);
    }
  }
  if (selected) CFRelease(selected);
  CFRelease(application);
  return { false, lastReason, focusFailureEvidence(windowId, ownerPid) };
}

// Synthesized input must be modifier-isolated: without an explicit flags
// field, posted events inherit whatever keys the PERSON is physically holding
// at that instant. A held ⌘ while multitasking turned the agent's plain click
// on an email row into ⌘-click — open in new window — and each bounded retry
// spawned another one. Zero the flags on every synthetic event.
bool postMouse(CGEventType type, CGPoint point, CGEventFlags flags = 0) {
  CGEventRef event = CGEventCreateMouseEvent(nullptr, type, point, kCGMouseButtonLeft);
  if (!event) return false;
  CGEventSetFlags(event, flags);
  CGEventPost(kCGHIDEventTap, event);
  CFRelease(event);
  return true;
}

// A synthesized click must look like a real one or Chromium-family apps
// intermittently ignore it: real clicks carry clickState 1 on both the down
// and the up, ride one event source, and have a human press duration. Without
// clickState the press is click-count zero, and with a zero-length press any
// concurrent physical mouse movement lands between down and up and turns the
// click into a micro-drag — hover registers, navigation never happens.
CGEventType mouseDownType(CGMouseButton button) {
  return button == kCGMouseButtonLeft ? kCGEventLeftMouseDown
    : button == kCGMouseButtonRight ? kCGEventRightMouseDown
    : kCGEventOtherMouseDown;
}

CGEventType mouseUpType(CGMouseButton button) {
  return button == kCGMouseButtonLeft ? kCGEventLeftMouseUp
    : button == kCGMouseButtonRight ? kCGEventRightMouseUp
    : kCGEventOtherMouseUp;
}

bool actionMouseButton(NSDictionary* action, CGMouseButton* button) {
  NSString* value = [action[@"mouseButton"] isKindOfClass:[NSString class]] ? [action[@"mouseButton"] lowercaseString] : @"left";
  if ([value isEqualToString:@"left"]) *button = kCGMouseButtonLeft;
  else if ([value isEqualToString:@"right"]) *button = kCGMouseButtonRight;
  else if ([value isEqualToString:@"wheel"]) *button = kCGMouseButtonCenter;
  else if ([value isEqualToString:@"back"]) *button = static_cast<CGMouseButton>(3);
  else if ([value isEqualToString:@"forward"]) *button = static_cast<CGMouseButton>(4);
  else return false;
  return true;
}

struct GestureDelivery {
  bool complete;
  bool released;
  int eventCount;
};

GestureDelivery postClick(CGPoint point, CGMouseButton button, int clickCount, CGEventFlags flags) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  int eventCount = 0;
  for (int index = 0; index < clickCount; index += 1) {
    CGEventRef down = CGEventCreateMouseEvent(source, mouseDownType(button), point, button);
    CGEventRef up = CGEventCreateMouseEvent(source, mouseUpType(button), point, button);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      if (source) CFRelease(source);
      return { false, true, eventCount };
    }
    const int state = index + 1;
    CGEventSetIntegerValueField(down, kCGMouseEventClickState, state);
    CGEventSetIntegerValueField(up, kCGMouseEventClickState, state);
    CGEventSetFlags(down, flags);
    CGEventSetFlags(up, flags);
    CGEventPost(kCGHIDEventTap, down);
    eventCount += 1;
    usleep(45'000);
    CGEventPost(kCGHIDEventTap, up);
    eventCount += 1;
    if (index + 1 < clickCount) usleep(90'000);
    CFRelease(down);
    CFRelease(up);
  }
  if (source) CFRelease(source);
  return { true, true, eventCount };
}

GestureDelivery postDrag(CGPoint start, CGPoint end, CGEventFlags flags = 0) {
  CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
  CGEventRef down = CGEventCreateMouseEvent(source, kCGEventLeftMouseDown, start, kCGMouseButtonLeft);
  if (!down) {
    if (source) CFRelease(source);
    return { false, true, 0 };
  }
  int eventCount = 0;
  CGEventSetFlags(down, flags);
  CGEventPost(kCGHIDEventTap, down);
  eventCount += 1;
  CFRelease(down);
  usleep(60'000);
  constexpr int steps = 12;
  for (int step = 1; step <= steps; step += 1) {
    const double progress = static_cast<double>(step) / steps;
    const CGPoint location = CGPointMake(start.x + (end.x - start.x) * progress, start.y + (end.y - start.y) * progress);
    CGEventRef moved = CGEventCreateMouseEvent(source, kCGEventLeftMouseDragged, location, kCGMouseButtonLeft);
    if (moved) {
      CGEventSetFlags(moved, flags);
      CGEventPost(kCGHIDEventTap, moved);
      eventCount += 1;
      CFRelease(moved);
    }
    usleep(16'000);
  }
  CGEventRef up = CGEventCreateMouseEvent(source, kCGEventLeftMouseUp, end, kCGMouseButtonLeft);
  if (!up) up = CGEventCreateMouseEvent(nullptr, kCGEventLeftMouseUp, end, kCGMouseButtonLeft);
  bool released = false;
  if (up) {
    CGEventSetFlags(up, flags);
    CGEventPost(kCGHIDEventTap, up);
    eventCount += 1;
    released = true;
    CFRelease(up);
  }
  if (source) CFRelease(source);
  return { released, released, eventCount };
}

bool performSemanticAction(AXUIElementRef element, NSString* requested) {
  if ([requested isEqualToString:@"focus"]) {
    Boolean settable = false;
    return AXUIElementIsAttributeSettable(element, kAXFocusedAttribute, &settable) == kAXErrorSuccess
      && settable
      && AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue) == kAXErrorSuccess;
  }
  NSArray* candidates = [requested isEqualToString:@"activate"]
    ? @[(__bridge NSString*)kAXPressAction, (__bridge NSString*)kAXPickAction, (__bridge NSString*)kAXConfirmAction]
    : [requested isEqualToString:@"increment"] ? @[(__bridge NSString*)kAXIncrementAction]
    : [requested isEqualToString:@"decrement"] ? @[(__bridge NSString*)kAXDecrementAction]
    : [requested isEqualToString:@"show_menu"] ? @[(__bridge NSString*)kAXShowMenuAction]
    : @[];
  if (candidates.count == 0) return false;
  CFArrayRef rawActions = nullptr;
  if (AXUIElementCopyActionNames(element, &rawActions) != kAXErrorSuccess || !rawActions) return false;
  bool performed = false;
  for (NSString* candidate in candidates) {
    if (CFArrayContainsValue(rawActions, CFRangeMake(0, CFArrayGetCount(rawActions)), (__bridge CFStringRef)candidate)
        && AXUIElementPerformAction(element, (__bridge CFStringRef)candidate) == kAXErrorSuccess) {
      performed = true;
      break;
    }
  }
  CFRelease(rawActions);
  return performed;
}

/** AXShowMenu and AXPick can be answered only after the application's menu
 * tracking returns. A short messaging timeout keeps the bridge responsive;
 * an unanswered request is delivery-uncertain, never success or refusal, and
 * the next fresh capture decides what happened. */
enum class SemanticOutcome { performed, refused, late };

SemanticOutcome performSemanticActionWithOutcome(AXUIElementRef element, NSString* requested) {
  if ([requested isEqualToString:@"focus"]) {
    Boolean settable = false;
    if (AXUIElementIsAttributeSettable(element, kAXFocusedAttribute, &settable) != kAXErrorSuccess || !settable) return SemanticOutcome::refused;
    const AXError set = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue);
    return set == kAXErrorSuccess ? SemanticOutcome::performed : set == kAXErrorCannotComplete ? SemanticOutcome::late : SemanticOutcome::refused;
  }
  NSArray* candidates = [requested isEqualToString:@"activate"]
    ? @[(__bridge NSString*)kAXPressAction, (__bridge NSString*)kAXPickAction, (__bridge NSString*)kAXConfirmAction]
    : [requested isEqualToString:@"show_menu"] ? @[(__bridge NSString*)kAXShowMenuAction]
    : @[];
  if (candidates.count == 0) return SemanticOutcome::refused;
  CFArrayRef rawActions = nullptr;
  if (AXUIElementCopyActionNames(element, &rawActions) != kAXErrorSuccess || !rawActions) return SemanticOutcome::refused;
  SemanticOutcome outcome = SemanticOutcome::refused;
  for (NSString* candidate in candidates) {
    if (!CFArrayContainsValue(rawActions, CFRangeMake(0, CFArrayGetCount(rawActions)), (__bridge CFStringRef)candidate)) continue;
    // One attempt only: a late answer may already have acted.
    const AXError performed = AXUIElementPerformAction(element, (__bridge CFStringRef)candidate);
    outcome = performed == kAXErrorSuccess ? SemanticOutcome::performed : performed == kAXErrorCannotComplete ? SemanticOutcome::late : SemanticOutcome::refused;
    break;
  }
  CFRelease(rawActions);
  return outcome;
}

/** Resolve the live element at a verified point and walk toward its semantic
 * parent until the requested generic capability is found. This is independent
 * of application names and labels, and it prevents a stale capture-time node
 * identity from being trusted at execution time. */
bool axElementMatchesExpectation(AXUIElementRef element, NSDictionary* expected, CGRect windowBounds);

bool performSemanticActionAtPoint(CGPoint point, pid_t expectedPid, NSString* requested, NSDictionary* expected, CGRect windowBounds) {
  AXUIElementRef system = AXUIElementCreateSystemWide();
  AXUIElementRef current = nullptr;
  const AXError copied = AXUIElementCopyElementAtPosition(system, point.x, point.y, &current);
  CFRelease(system);
  if (copied != kAXErrorSuccess || !current) return false;
  for (int depth = 0; depth < 10 && current; depth += 1) {
    pid_t candidatePid = 0;
    if (AXUIElementGetPid(current, &candidatePid) == kAXErrorSuccess
        && candidatePid == expectedPid
        && (!expected || axElementMatchesExpectation(current, expected, windowBounds))
        && performSemanticAction(current, requested)) {
      CFRelease(current);
      return true;
    }
    CFTypeRef rawParent = nullptr;
    AXUIElementRef parent = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &rawParent) == kAXErrorSuccess
        && rawParent && CFGetTypeID(rawParent) == AXUIElementGetTypeID()) {
      parent = static_cast<AXUIElementRef>(rawParent);
    } else if (rawParent) {
      CFRelease(rawParent);
    }
    CFRelease(current);
    current = parent;
  }
  if (current) CFRelease(current);
  return false;
}

bool postKey(CGKeyCode code, CGEventFlags flags) {
  CGEventRef down = CGEventCreateKeyboardEvent(nullptr, code, true);
  CGEventRef up = CGEventCreateKeyboardEvent(nullptr, code, false);
  if (!down || !up) {
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    return false;
  }
  CGEventSetFlags(down, flags);
  CGEventSetFlags(up, flags);
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  return true;
}

struct TextStroke {
  CGKeyCode code;
  CGEventFlags flags;
};

bool textStroke(unichar character, TextStroke* stroke) {
  stroke->flags = 0;
  unichar normalized = character;
  if (character >= 'A' && character <= 'Z') {
    normalized = static_cast<unichar>(character + ('a' - 'A'));
    stroke->flags = kCGEventFlagMaskShift;
  }
  switch (normalized) {
    case 'a': stroke->code = 0; return true;
    case 's': stroke->code = 1; return true;
    case 'd': stroke->code = 2; return true;
    case 'f': stroke->code = 3; return true;
    case 'h': stroke->code = 4; return true;
    case 'g': stroke->code = 5; return true;
    case 'z': stroke->code = 6; return true;
    case 'x': stroke->code = 7; return true;
    case 'c': stroke->code = 8; return true;
    case 'v': stroke->code = 9; return true;
    case 'b': stroke->code = 11; return true;
    case 'q': stroke->code = 12; return true;
    case 'w': stroke->code = 13; return true;
    case 'e': stroke->code = 14; return true;
    case 'r': stroke->code = 15; return true;
    case 'y': stroke->code = 16; return true;
    case 't': stroke->code = 17; return true;
    case '1': stroke->code = 18; return true;
    case '2': stroke->code = 19; return true;
    case '3': stroke->code = 20; return true;
    case '4': stroke->code = 21; return true;
    case '6': stroke->code = 22; return true;
    case '5': stroke->code = 23; return true;
    case '=': stroke->code = 24; return true;
    case '9': stroke->code = 25; return true;
    case '7': stroke->code = 26; return true;
    case '-': stroke->code = 27; return true;
    case '8': stroke->code = 28; return true;
    case '0': stroke->code = 29; return true;
    case ']': stroke->code = 30; return true;
    case 'o': stroke->code = 31; return true;
    case 'u': stroke->code = 32; return true;
    case '[': stroke->code = 33; return true;
    case 'i': stroke->code = 34; return true;
    case 'p': stroke->code = 35; return true;
    case 'l': stroke->code = 37; return true;
    case 'j': stroke->code = 38; return true;
    case '\'': stroke->code = 39; return true;
    case 'k': stroke->code = 40; return true;
    case ';': stroke->code = 41; return true;
    case '\\': stroke->code = 42; return true;
    case ',': stroke->code = 43; return true;
    case '/': stroke->code = 44; return true;
    case 'n': stroke->code = 45; return true;
    case 'm': stroke->code = 46; return true;
    case '.': stroke->code = 47; return true;
    case ' ': stroke->code = 49; return true;
    case '`': stroke->code = 50; return true;
    case '_': stroke->code = 27; stroke->flags = kCGEventFlagMaskShift; return true;
    case '+': stroke->code = 24; stroke->flags = kCGEventFlagMaskShift; return true;
    case '(': stroke->code = 25; stroke->flags = kCGEventFlagMaskShift; return true;
    case ')': stroke->code = 29; stroke->flags = kCGEventFlagMaskShift; return true;
    case '!': stroke->code = 18; stroke->flags = kCGEventFlagMaskShift; return true;
    case '@': stroke->code = 19; stroke->flags = kCGEventFlagMaskShift; return true;
    case '#': stroke->code = 20; stroke->flags = kCGEventFlagMaskShift; return true;
    case '$': stroke->code = 21; stroke->flags = kCGEventFlagMaskShift; return true;
    case '%': stroke->code = 23; stroke->flags = kCGEventFlagMaskShift; return true;
    case '^': stroke->code = 22; stroke->flags = kCGEventFlagMaskShift; return true;
    case '&': stroke->code = 26; stroke->flags = kCGEventFlagMaskShift; return true;
    case '*': stroke->code = 28; stroke->flags = kCGEventFlagMaskShift; return true;
    case ':': stroke->code = 41; stroke->flags = kCGEventFlagMaskShift; return true;
    case '"': stroke->code = 39; stroke->flags = kCGEventFlagMaskShift; return true;
    case '<': stroke->code = 43; stroke->flags = kCGEventFlagMaskShift; return true;
    case '>': stroke->code = 47; stroke->flags = kCGEventFlagMaskShift; return true;
    case '?': stroke->code = 44; stroke->flags = kCGEventFlagMaskShift; return true;
    case '{': stroke->code = 33; stroke->flags = kCGEventFlagMaskShift; return true;
    case '}': stroke->code = 30; stroke->flags = kCGEventFlagMaskShift; return true;
    case '|': stroke->code = 42; stroke->flags = kCGEventFlagMaskShift; return true;
    case '~': stroke->code = 50; stroke->flags = kCGEventFlagMaskShift; return true;
    default: return false;
  }
}

bool postKeycodeText(NSString* value, int* eventCount) {
  std::vector<TextStroke> strokes;
  strokes.reserve(value.length);
  for (NSUInteger index = 0; index < value.length; index += 1) {
    TextStroke stroke{};
    if (!textStroke([value characterAtIndex:index], &stroke)) return false;
    strokes.push_back(stroke);
  }
  for (const TextStroke& stroke : strokes) {
    if (!postKey(stroke.code, stroke.flags)) return false;
    *eventCount += 2;
    usleep(8'000);
  }
  return true;
}

bool postUnicodeGraphemes(NSString* value, int* eventCount) {
  NSUInteger index = 0;
  while (index < value.length) {
    const NSRange range = [value rangeOfComposedCharacterSequenceAtIndex:index];
    NSString* grapheme = [value substringWithRange:range];
    std::vector<UniChar> characters(grapheme.length);
    [grapheme getCharacters:characters.data() range:NSMakeRange(0, grapheme.length)];
    CGEventRef down = CGEventCreateKeyboardEvent(nullptr, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(nullptr, 0, false);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      return false;
    }
    CGEventKeyboardSetUnicodeString(down, static_cast<UniCharCount>(characters.size()), characters.data());
    CGEventKeyboardSetUnicodeString(up, static_cast<UniCharCount>(characters.size()), characters.data());
    CGEventSetFlags(down, 0);
    CGEventSetFlags(up, 0);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    *eventCount += 2;
    CFRelease(down);
    CFRelease(up);
    usleep(8'000);
    index = NSMaxRange(range);
  }
  return true;
}

NSString* axTextValue(AXUIElementRef element) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXValueAttribute, &raw) != kAXErrorSuccess || !raw) return nil;
  NSString* value = nil;
  if (CFGetTypeID(raw) == CFStringGetTypeID()) {
    value = [(__bridge NSString*)raw copy];
  } else if (CFGetTypeID(raw) == CFAttributedStringGetTypeID()) {
    value = [[(__bridge NSAttributedString*)raw string] copy];
  }
  CFRelease(raw);
  return value;
}

NSDictionary* accessibleTextFailure(NSString* code, NSString* stage, bool mayHaveMutated, AXError nativeCode = kAXErrorSuccess) {
  return @{ @"code": code, @"stage": stage, @"method": @"accessibility_value",
    @"mutation": mayHaveMutated ? @"possible" : @"none", @"nativeCode": @(nativeCode) };
}

bool sensitiveInputElement(AXUIElementRef element);

bool assignAccessibleTextValue(AXUIElementRef element, pid_t expectedPid, NSString* value, NSDictionary** failure = nullptr) {
  auto reject = [&](NSString* code, NSString* stage, bool mayHaveMutated, AXError nativeCode = kAXErrorSuccess) {
    if (failure) *failure = accessibleTextFailure(code, stage, mayHaveMutated, nativeCode);
    return false;
  };
  if (!element || !value) return reject(@"invalid_target", @"preflight", false);
  if (sensitiveInputElement(element)) return reject(@"sensitive_receiver", @"preflight", false);
  pid_t candidatePid = 0;
  NSString* role = axStringAttribute(element, kAXRoleAttribute);
  const bool textRole = [role isEqualToString:@"AXTextField"]
    || [role isEqualToString:@"AXTextArea"]
    || [role isEqualToString:@"AXSearchField"]
    || [role isEqualToString:@"AXComboBox"];
  Boolean settable = false;
  if (!textRole || AXUIElementGetPid(element, &candidatePid) != kAXErrorSuccess
      || candidatePid != expectedPid) return reject(@"invalid_receiver", @"preflight", false);
  AXError capability = AXUIElementIsAttributeSettable(element, kAXValueAttribute, &settable);
  if (capability != kAXErrorSuccess || !settable) return reject(@"value_not_settable", @"preflight", false, capability);
  AXError focus = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue);
  if (focus != kAXErrorSuccess) return reject(@"focus_rejected", @"focus", false, focus);
  AXError assignment = AXUIElementSetAttributeValue(element, kAXValueAttribute, (__bridge CFTypeRef)value);
  // Once assignment is invoked, a platform error (including a timeout) cannot
  // prove that the receiving process did not apply the value.
  if (assignment != kAXErrorSuccess) return reject(@"assignment_unconfirmed", @"assignment", true, assignment);
  // Observe asynchronous accessibility updates without repeating the write.
  for (int probe = 0; probe < 4; ++probe) {
    usleep(40'000);
    NSString* observed = axTextValue(element);
    if (observed && [observed isEqualToString:value]) return true;
  }
  return reject(@"readback_mismatch", @"readback", true);
}

// Multiline text is data, never Return key events or whole-document AX
// replacement. Preserve every readable clipboard flavor locally; never expose
// its contents to the model or overwrite a newer clipboard change.
bool pastePlainText(NSString* value, CGWindowID windowId, CGRect bounds,
                    NSString* bundle, int* eventCount, NSDictionary** failure) {
  auto reject = [&](NSString* code) {
    *failure = @{ @"code": code, @"stage": @"preflight", @"method": @"unicode_graphemes", @"mutation": @"none" };
    return false;
  };
  NSPasteboard* board = [NSPasteboard generalPasteboard];
  const NSInteger beforeChange = board.changeCount;
  NSArray<NSPasteboardItem*>* original = board.pasteboardItems;
  if (original.count > 32) return reject(@"clipboard_snapshot_too_large");
  NSMutableArray<NSPasteboardItem*>* saved = [NSMutableArray array];
  NSUInteger bytes = 0;
  for (NSPasteboardItem* item in original) {
    if (item.types.count > 64) return reject(@"clipboard_snapshot_too_large");
    NSPasteboardItem* copy = [[NSPasteboardItem alloc] init];
    for (NSPasteboardType type in item.types) {
      NSData* data = [item dataForType:type];
      if (!data) return reject(@"clipboard_snapshot_unavailable");
      bytes += data.length;
      if (bytes > 16 * 1024 * 1024) return reject(@"clipboard_snapshot_too_large");
      if (![copy setData:data forType:type]) return reject(@"clipboard_snapshot_unavailable");
    }
    [saved addObject:copy];
  }
  // Clipboard providers can take time. Revalidate the exact receiver after
  // materializing the snapshot, before making any clipboard or input change.
  if (!focusSelectedWindow(windowId, bounds, bundle).verified) return reject(@"selected_window_focus_unavailable");
  if (board.changeCount != beforeChange) return reject(@"clipboard_changed_before_input");
  NSPasteboardItem* item = [[NSPasteboardItem alloc] init];
  NSString* normalized = [[value stringByReplacingOccurrencesOfString:@"\r\n" withString:@"\n"] stringByReplacingOccurrencesOfString:@"\r" withString:@"\n"];
  if (![item setString:normalized forType:NSPasteboardTypeString]) return reject(@"clipboard_text_unavailable");
  NSString* token = NSUUID.UUID.UUIDString;
  NSString* tokenType = @"app.carve.input-paste";
  if (![item setString:token forType:tokenType]) return reject(@"clipboard_text_unavailable");
  const NSInteger clearedChange = [board clearContents];
  const bool written = [board writeObjects:@[item]];
  const NSInteger ownChange = board.changeCount;
  auto ownsClipboard = [&]() {
    return board.changeCount == ownChange && [[board stringForType:tokenType] isEqualToString:token];
  };
  bool posted = false;
  bool restored = true;
  @try {
    if (written && ownsClipboard()) {
      posted = postKey(9, kCGEventFlagMaskCommand); // Command-V, once.
      if (posted) *eventCount += 2;
      // Allow the receiver to consume the pasteboard. This acknowledges input
      // delivery, not document contents; the next model observation checks it.
      usleep(350'000);
    }
  } @finally {
    if (ownsClipboard() || (!written && board.changeCount == clearedChange)) {
      [board clearContents];
      if (saved.count) restored = [board writeObjects:saved];
    }
  }
  if (!restored) {
    *failure = @{ @"code": @"clipboard_restore_failed", @"stage": @"transport", @"method": @"unicode_graphemes", @"mutation": posted ? @"possible" : @"none" };
    return false;
  }
  if (!posted) return reject(written ? @"paste_key_unavailable" : @"clipboard_write_failed");
  return true;
}

/** Assign an exact value through the platform Accessibility contract. The
 * point was grounded against the approved selected-window frame; this method
 * rechecks that the live element belongs to the selected process, is a
 * non-secure text role, advertises a settable AXValue, and reads back exactly
 * before claiming delivery. */
bool setAccessibleTextAtPoint(CGPoint location, pid_t expectedPid, NSString* text, bool replaceExisting, NSDictionary** failure) {
  *failure = accessibleTextFailure(@"target_unavailable", @"preflight", false);
  AXUIElementRef systemWide = AXUIElementCreateSystemWide();
  if (!systemWide) return false;
  AXUIElementRef current = nullptr;
  const AXError hit = AXUIElementCopyElementAtPosition(systemWide, location.x, location.y, &current);
  CFRelease(systemWide);
  if (hit != kAXErrorSuccess || !current) return false;

  for (int depth = 0; current && depth < 10; depth += 1) {
    NSString* role = axStringAttribute(current, kAXRoleAttribute);
    const bool textRole = [role isEqualToString:@"AXTextField"]
      || [role isEqualToString:@"AXTextArea"]
      || [role isEqualToString:@"AXSearchField"]
      || [role isEqualToString:@"AXComboBox"];
    if (sensitiveInputElement(current)) {
      *failure = accessibleTextFailure(@"sensitive_receiver", @"preflight", false); CFRelease(current); return false;
    }
    if (textRole) {
      NSString* assigned = text;
      if (!replaceExisting) {
        NSString* existing = axTextValue(current);
        if (!existing) {
          CFRelease(current);
          return false;
        }
        assigned = [existing stringByAppendingString:text];
      }
      const bool verified = assignAccessibleTextValue(current, expectedPid, assigned, failure);
      CFRelease(current);
      return verified;
    }
    CFTypeRef rawParent = nullptr;
    AXUIElementRef parent = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &rawParent) == kAXErrorSuccess
        && rawParent && CFGetTypeID(rawParent) == AXUIElementGetTypeID()) {
      parent = static_cast<AXUIElementRef>(rawParent);
    } else if (rawParent) {
      CFRelease(rawParent);
    }
    CFRelease(current);
    current = parent;
  }
  if (current) CFRelease(current);
  return false;
}

AXUIElementRef findAXRoleDescendant(AXUIElementRef root, NSString* wantedRole, int depth, int* visited) {
  if (!root || depth > 8 || *visited >= 240) return nullptr;
  *visited += 1;
  NSString* role = axStringAttribute(root, kAXRoleAttribute);
  if ([role isEqualToString:wantedRole]) {
    CFRetain(root);
    return root;
  }
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(root, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess
      || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    return nullptr;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  AXUIElementRef found = nullptr;
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 80);
  for (CFIndex index = 0; index < count && !found; index += 1) {
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
    if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) found = findAXRoleDescendant(child, wantedRole, depth + 1, visited);
  }
  CFRelease(rawChildren);
  return found;
}

NSString* sha256Data(NSData* data) {
  if (!data) return nil;
  unsigned char digest[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, static_cast<CC_LONG>(data.length), digest);
  char encoded[CC_SHA256_DIGEST_LENGTH * 2 + 1];
  for (int index = 0; index < CC_SHA256_DIGEST_LENGTH; index += 1) {
    std::snprintf(encoded + index * 2, 3, "%02x", digest[index]);
  }
  encoded[CC_SHA256_DIGEST_LENGTH * 2] = '\0';
  return [NSString stringWithUTF8String:encoded];
}

NSString* sha256Text(NSString* value) {
  return value ? sha256Data([value dataUsingEncoding:NSUTF8StringEncoding]) : nil;
}

NSString* axDirectSemanticText(AXUIElementRef element) {
  return [NSString stringWithFormat:@"%@ %@ %@ %@ %@",
    axStringAttribute(element, kAXTitleAttribute) ?: @"",
    axStringAttribute(element, kAXDescriptionAttribute) ?: @"",
    axStringAttribute(element, kAXHelpAttribute) ?: @"",
    axStringAttribute(element, kAXPlaceholderValueAttribute) ?: @"",
    axStringAttribute(element, kAXIdentifierAttribute) ?: @""];
}

NSString* axSemanticText(AXUIElementRef element) {
  if (!element) return @"";
  NSString* linkedTitle = @"";
  CFTypeRef rawTitleElement = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXTitleUIElementAttribute, &rawTitleElement) == kAXErrorSuccess
      && rawTitleElement && CFGetTypeID(rawTitleElement) == AXUIElementGetTypeID()) {
    linkedTitle = axDirectSemanticText(static_cast<AXUIElementRef>(rawTitleElement));
  }
  if (rawTitleElement) CFRelease(rawTitleElement);
  // AppKit frequently exposes an NSSavePanel field with no own title while
  // linking it to the visible “Save As:” or “Tags:” AXStaticText. Preserve
  // that explicit label relationship instead of falling back to focus/value.
  return [[NSString stringWithFormat:@"%@ %@", axDirectSemanticText(element), linkedTitle] lowercaseString];
}

NSString* axGeometryKey(AXUIElementRef element) {
  CFTypeRef rawPosition = nullptr;
  CFTypeRef rawSize = nullptr;
  CGPoint position{};
  CGSize size{};
  const bool hasPosition = AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &rawPosition) == kAXErrorSuccess
    && rawPosition && CFGetTypeID(rawPosition) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawPosition), static_cast<AXValueType>(kAXValueCGPointType), &position);
  const bool hasSize = AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &rawSize) == kAXErrorSuccess
    && rawSize && CFGetTypeID(rawSize) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawSize), static_cast<AXValueType>(kAXValueCGSizeType), &size);
  if (rawPosition) CFRelease(rawPosition);
  if (rawSize) CFRelease(rawSize);
  return hasPosition && hasSize
    ? [NSString stringWithFormat:@"%.1f:%.1f:%.1f:%.1f", position.x, position.y, size.width, size.height]
    : @"unknown";
}

NSString* axStableIdentity(AXUIElementRef element, NSString* ancestry) {
  if (!element) return nil;
  return sha256Text([NSString stringWithFormat:@"%@|%@|%@|%@",
    ancestry ?: @"", axStringAttribute(element, kAXRoleAttribute) ?: @"",
    axSemanticText(element), axGeometryKey(element)]);
}

NSDictionary* operationIdentityEvidence(
  NSString* bundleIdentifier,
  pid_t ownerPid,
  CGWindowID windowId,
  CGRect windowBounds,
  AXUIElementRef container,
  AXUIElementRef element
) {
  NSString* applicationIdentity = sha256Text([NSString stringWithFormat:@"%@:%d", bundleIdentifier ?: @"", ownerPid]);
  NSString* windowIdentity = sha256Text([NSString stringWithFormat:@"%u:%d:%.1f:%.1f:%.1f:%.1f",
    windowId, ownerPid, windowBounds.origin.x, windowBounds.origin.y, windowBounds.size.width, windowBounds.size.height]);
  NSString* containerIdentity = container ? axStableIdentity(container, windowIdentity) : nil;
  NSString* elementIdentity = element ? axStableIdentity(element, containerIdentity ?: windowIdentity) : nil;
  return @{
    @"applicationSha256": applicationIdentity ?: @"",
    @"windowSha256": windowIdentity ?: @"",
    @"containerSha256": containerIdentity ?: [NSNull null],
    @"elementSha256": elementIdentity ?: [NSNull null],
  };
}

bool isSettableTextField(AXUIElementRef element, pid_t expectedPid) {
  if (!element) return false;
  pid_t candidatePid = 0;
  NSString* role = axStringAttribute(element, kAXRoleAttribute);
  NSString* subrole = axStringAttribute(element, kAXSubroleAttribute);
  Boolean settable = false;
  return [role isEqualToString:@"AXTextField"]
    && ![subrole isEqualToString:@"AXSearchField"]
    && AXUIElementGetPid(element, &candidatePid) == kAXErrorSuccess
    && candidatePid == expectedPid
    && AXUIElementIsAttributeSettable(element, kAXValueAttribute, &settable) == kAXErrorSuccess
    && settable;
}

/** Finder-style save browsers expose each visible file-list cell as a
 * value-settable AXTextField. The real Save As, Tags, and Go to Folder inputs
 * are form controls outside a selectable collection; row-label proxies are
 * descendants of a row/table/outline/browser container. Exclude those by
 * bounded structural evidence rather than transient focus or current value. */
bool hasSelectableCollectionAncestor(AXUIElementRef element, pid_t expectedPid) {
  AXUIElementRef current = element;
  CFRetain(current);
  bool found = false;
  for (int depth = 0; current && depth < 12 && !found; depth += 1) {
    CFTypeRef rawParent = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &rawParent) != kAXErrorSuccess
        || !rawParent || CFGetTypeID(rawParent) != AXUIElementGetTypeID()) {
      if (rawParent) CFRelease(rawParent);
      break;
    }
    AXUIElementRef parent = static_cast<AXUIElementRef>(rawParent);
    pid_t parentPid = 0;
    NSString* role = axStringAttribute(parent, kAXRoleAttribute);
    if (AXUIElementGetPid(parent, &parentPid) != kAXErrorSuccess || parentPid != expectedPid) {
      CFRelease(parent);
      break;
    }
    found = [@[@"AXRow", @"AXTable", @"AXOutline", @"AXBrowser", @"AXList", @"AXCell"] containsObject:role];
    const bool reachedContainer = [@[@"AXWindow", @"AXSheet", @"AXDialog"] containsObject:role];
    CFRelease(current);
    current = parent;
    if (reachedContainer) break;
  }
  if (current) CFRelease(current);
  return found;
}

void collectSettableTextFields(AXUIElementRef root, pid_t ownerPid, int depth, int* visited, std::vector<AXUIElementRef>* fields) {
  if (!root || depth > 9 || *visited >= 640 || fields->size() >= 12) return;
  struct PendingElement { AXUIElementRef element; int depth; };
  std::vector<PendingElement> pending;
  CFRetain(root);
  pending.push_back({ root, depth });
  size_t cursor = 0;
  // Breadth-first traversal reaches the shallow Save As/Tags form controls
  // before descending through hundreds of cells in the file browser. A
  // depth-first walk exhausted its node cap inside the first outline and
  // never observed the visible filename field.
  while (cursor < pending.size() && *visited < 640 && fields->size() < 12) {
    PendingElement item = pending[cursor++];
    AXUIElementRef element = item.element;
    *visited += 1;
    if (isSettableTextField(element, ownerPid) && !hasSelectableCollectionAncestor(element, ownerPid)) {
      const bool alreadyCollected = std::any_of(fields->begin(), fields->end(), [&](AXUIElementRef candidate) {
        return CFEqual(candidate, element);
      });
      if (!alreadyCollected) {
        CFRetain(element);
        fields->push_back(element);
      }
    }
    if (item.depth < 9 && pending.size() < 640) {
      CFTypeRef rawChildren = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess
          && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
        CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
        const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 100);
        for (CFIndex index = 0; index < count && pending.size() < 640; index += 1) {
          AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
          if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) {
            CFRetain(child);
            pending.push_back({ child, item.depth + 1 });
          }
        }
      }
      if (rawChildren) CFRelease(rawChildren);
    }
    CFRelease(element);
    item.element = nullptr;
  }
  for (; cursor < pending.size(); cursor += 1) CFRelease(pending[cursor].element);
}

void releaseElements(std::vector<AXUIElementRef>* elements) {
  for (AXUIElementRef element : *elements) CFRelease(element);
  elements->clear();
}

void collectExactButtons(AXUIElementRef root, NSString* title, int depth, int* visited, std::vector<AXUIElementRef>* buttons) {
  if (!root || depth > 9 || *visited >= 640 || buttons->size() >= 12) return;
  struct PendingButton { AXUIElementRef element; int depth; };
  std::vector<PendingButton> pending;
  CFRetain(root);
  pending.push_back({ root, depth });
  size_t cursor = 0;
  while (cursor < pending.size() && *visited < 640 && buttons->size() < 12) {
    PendingButton item = pending[cursor++];
    AXUIElementRef element = item.element;
    *visited += 1;
    NSString* role = axStringAttribute(element, kAXRoleAttribute);
    NSString* label = axStringAttribute(element, kAXTitleAttribute);
    if (!label || label.length == 0) label = axStringAttribute(element, kAXDescriptionAttribute);
    if ([role isEqualToString:@"AXButton"] && [label isEqualToString:title]) {
      CFRetain(element);
      buttons->push_back(element);
    }
    if (item.depth < 9 && pending.size() < 640) {
      CFTypeRef rawChildren = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess
          && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
        CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
        const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 100);
        for (CFIndex index = 0; index < count && pending.size() < 640; index += 1) {
          AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
          if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) {
            CFRetain(child);
            pending.push_back({ child, item.depth + 1 });
          }
        }
      }
      if (rawChildren) CFRelease(rawChildren);
    }
    CFRelease(element);
    item.element = nullptr;
  }
  for (; cursor < pending.size(); cursor += 1) CFRelease(pending[cursor].element);
}

AXUIElementRef copyUniqueEnabledButton(AXUIElementRef root, NSString* title, bool* ambiguous) {
  *ambiguous = false;
  int visited = 0;
  std::vector<AXUIElementRef> buttons;
  collectExactButtons(root, title, 0, &visited, &buttons);
  std::vector<AXUIElementRef> enabled;
  for (AXUIElementRef button : buttons) {
    if (axElementEnabled(button)) enabled.push_back(button);
  }
  AXUIElementRef result = nullptr;
  if (enabled.size() == 1) {
    result = enabled[0];
    CFRetain(result);
  } else if (enabled.size() > 1) {
    *ambiguous = true;
  }
  releaseElements(&buttons);
  return result;
}

bool textContainsAny(NSString* value, NSArray<NSString*>* terms) {
  NSString* normalized = [value lowercaseString];
  for (NSString* term in terms) {
    if ([normalized containsString:[term lowercaseString]]) return true;
  }
  return false;
}

/** AppKit may expose several AX proxy objects for one visible NSSavePanel
 * control. CFEqual does not reliably collapse those remote proxies. Role plus
 * exact observed geometry describes the physical hit target; candidates with
 * different hit targets remain ambiguous, and geometry-free candidates are
 * never collapsed. */
NSString* axObservableControlIdentity(AXUIElementRef element) {
  NSString* geometry = axGeometryKey(element);
  if ([geometry isEqualToString:@"unknown"]) return nil;
  return [NSString stringWithFormat:@"%@|%@", axStringAttribute(element, kAXRoleAttribute) ?: @"", geometry];
}

std::vector<AXUIElementRef> filenameFieldCandidates(const std::vector<AXUIElementRef>& fields) {
  std::vector<AXUIElementRef> semantic;
  for (AXUIElementRef field : fields) {
    // AppKit's stable identifiers are locale-independent but camel-cased;
    // Accessibility lowercases them to `saveasnametextfield` and exposes the
    // linked label as `namefieldlabel`, without the visible label's spaces.
    if (textContainsAny(axSemanticText(field), @[@"save as", @"file name", @"filename", @"saveasnametextfield", @"namefieldlabel"])) semantic.push_back(field);
  }
  return semantic;
}

std::vector<AXUIElementRef> destinationFieldCandidates(const std::vector<AXUIElementRef>& fields) {
  std::vector<AXUIElementRef> semantic;
  for (AXUIElementRef field : fields) {
    NSString* identity = axSemanticText(field);
    if (textContainsAny(identity, @[@"go to", @"folder", @"location", @"directory", @"path"])
        && !textContainsAny(identity, @[@"save as", @"file name", @"filename", @"saveasnametextfield", @"namefieldlabel"])) semantic.push_back(field);
  }
  return semantic;
}

AXUIElementRef copyUniqueObservableField(const std::vector<AXUIElementRef>& candidates, bool* ambiguous) {
  *ambiguous = false;
  NSMutableSet<NSString*>* identities = [NSMutableSet set];
  for (AXUIElementRef candidate : candidates) {
    NSString* identity = axObservableControlIdentity(candidate);
    // Without geometry there is no evidence that two remote objects share a
    // physical control, so preserve separate in-memory identities.
    [identities addObject:identity ?: [NSString stringWithFormat:@"unknown:%p", candidate]];
  }
  AXUIElementRef result = nullptr;
  if (candidates.size() > 0 && identities.count == 1) {
    result = candidates[0];
    CFRetain(result);
  } else if (identities.count > 1) {
    *ambiguous = true;
  }
  return result;
}

bool observableFieldAliasesReadBack(
  const std::vector<AXUIElementRef>& candidates,
  NSString* expected,
  bool* ambiguous
) {
  *ambiguous = false;
  if (candidates.empty()) return false;
  NSMutableSet<NSString*>* identities = [NSMutableSet set];
  for (AXUIElementRef candidate : candidates) {
    NSString* identity = axObservableControlIdentity(candidate);
    [identities addObject:identity ?: [NSString stringWithFormat:@"unknown:%p", candidate]];
  }
  if (identities.count != 1) {
    *ambiguous = identities.count > 1;
    return false;
  }
  // Collapsing proxy objects is safe only if they all expose the exact value
  // after mutation. Two stacked but distinct fields would diverge here and
  // stop before the Save commit.
  return std::all_of(candidates.begin(), candidates.end(), [&](AXUIElementRef candidate) {
    return [axTextValue(candidate) isEqualToString:expected];
  });
}

bool filenameFieldAliasesReadBack(AXUIElementRef panel, pid_t ownerPid, NSString* expected, bool* ambiguous) {
  int visited = 0;
  std::vector<AXUIElementRef> fields;
  collectSettableTextFields(panel, ownerPid, 0, &visited, &fields);
  const std::vector<AXUIElementRef> candidates = filenameFieldCandidates(fields);
  const bool matched = observableFieldAliasesReadBack(candidates, expected, ambiguous);
  releaseElements(&fields);
  return matched;
}

bool destinationFieldAliasesReadBack(AXUIElementRef dialog, pid_t ownerPid, NSString* expected, bool* ambiguous) {
  int visited = 0;
  std::vector<AXUIElementRef> fields;
  collectSettableTextFields(dialog, ownerPid, 0, &visited, &fields);
  const std::vector<AXUIElementRef> candidates = destinationFieldCandidates(fields);
  const bool matched = observableFieldAliasesReadBack(candidates, expected, ambiguous);
  releaseElements(&fields);
  return matched;
}

AXUIElementRef copyUniqueFilenameField(AXUIElementRef panel, pid_t ownerPid, bool* ambiguous) {
  *ambiguous = false;
  int visited = 0;
  std::vector<AXUIElementRef> fields;
  collectSettableTextFields(panel, ownerPid, 0, &visited, &fields);
  const std::vector<AXUIElementRef> candidates = filenameFieldCandidates(fields);
  AXUIElementRef result = copyUniqueObservableField(candidates, ambiguous);
  releaseElements(&fields);
  return result;
}

AXUIElementRef copyUniqueDestinationField(AXUIElementRef dialog, pid_t ownerPid, bool* ambiguous) {
  *ambiguous = false;
  int visited = 0;
  std::vector<AXUIElementRef> fields;
  collectSettableTextFields(dialog, ownerPid, 0, &visited, &fields);
  const std::vector<AXUIElementRef> candidates = destinationFieldCandidates(fields);
  AXUIElementRef result = copyUniqueObservableField(candidates, ambiguous);
  releaseElements(&fields);
  return result;
}

/** The same budgets as findAXDescendant (180 elements, depth 6, 60 children each), walked shallow-first. A dialog's
 * commit buttons sit near its top; the expanded Save panel's file browser holds hundreds of rows, and a depth-first walk
 * spent its whole budget there before reaching the Save button (dialog_not_found, e2e D01/D02/D03, 3 Oct: the button is
 * element 39 at depth 2 of a 900-element sheet). */
AXUIElementRef findAXDescendantBreadthFirst(AXUIElementRef root, NSString* wantedTitle, NSString* wantedRole) {
  if (!root) return nullptr;
  struct Pending { AXUIElementRef element; int depth; };
  std::vector<Pending> pending;
  CFRetain(root);
  pending.push_back({ root, 0 });
  AXUIElementRef found = nullptr;
  size_t cursor = 0;
  int visited = 0;
  while (cursor < pending.size() && visited < 180 && !found) {
    Pending item = pending[cursor++];
    visited += 1;
    NSString* title = axStringAttribute(item.element, kAXTitleAttribute);
    if (!title || title.length == 0) title = axStringAttribute(item.element, kAXDescriptionAttribute);
    NSString* role = axStringAttribute(item.element, kAXRoleAttribute);
    if ([title isEqualToString:wantedTitle] && (!wantedRole || [role isEqualToString:wantedRole])) {
      CFRetain(item.element);
      found = item.element;
      break;
    }
    if (item.depth >= 6) continue;
    CFTypeRef rawChildren = nullptr;
    if (AXUIElementCopyAttributeValue(item.element, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess
        || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
      if (rawChildren) CFRelease(rawChildren);
      continue;
    }
    CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
    const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 60);
    for (CFIndex index = 0; index < count; index += 1) {
      AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
      if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) { CFRetain(child); pending.push_back({ child, item.depth + 1 }); }
    }
    CFRelease(rawChildren);
  }
  for (const Pending& item : pending) CFRelease(item.element);
  return found;
}

bool transactionContainerMatches(AXUIElementRef root, NSString* buttonTitle, NSArray<NSString*>* semanticTerms) {
  NSString* role = axStringAttribute(root, kAXRoleAttribute);
  if (![role isEqualToString:@"AXWindow"] && ![role isEqualToString:@"AXSheet"] && ![role isEqualToString:@"AXDialog"]) return false;
  AXUIElementRef button = findAXDescendantBreadthFirst(root, buttonTitle, @"AXButton");
  if (!button) return false;
  CFRelease(button);
  return semanticTerms.count == 0 || textContainsAny(axSemanticText(root), semanticTerms);
}

void collectTransactionContainers(
  AXUIElementRef root,
  NSString* buttonTitle,
  NSArray<NSString*>* semanticTerms,
  int depth,
  int* visited,
  std::vector<AXUIElementRef>* containers,
  bool includeRoot
) {
  if (!root || depth > 9 || *visited >= 640 || containers->size() >= 6) return;
  struct PendingContainer { AXUIElementRef element; int depth; bool eligible; };
  std::vector<PendingContainer> pending;
  CFRetain(root);
  pending.push_back({ root, depth, includeRoot });
  size_t cursor = 0;
  // Save panels and their nested Go to Folder dialogs are shallow container
  // nodes. Breadth-first discovery prevents a deep file outline from
  // consuming the bounded walk before either dialog is observed.
  while (cursor < pending.size() && *visited < 640 && containers->size() < 6) {
    PendingContainer item = pending[cursor++];
    AXUIElementRef element = item.element;
    *visited += 1;
    const bool matched = item.eligible && transactionContainerMatches(element, buttonTitle, semanticTerms);
    if (matched) {
      CFRetain(element);
      containers->push_back(element);
    } else if (item.depth < 9 && pending.size() < 640) {
      CFTypeRef rawChildren = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess
          && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
        CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
        const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 100);
        for (CFIndex index = 0; index < count && pending.size() < 640; index += 1) {
          AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
          if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) {
            CFRetain(child);
            pending.push_back({ child, item.depth + 1, true });
          }
        }
      }
      if (rawChildren) CFRelease(rawChildren);
    }
    CFRelease(element);
    item.element = nullptr;
  }
  for (; cursor < pending.size(); cursor += 1) CFRelease(pending[cursor].element);
}

AXUIElementRef copyUniqueTransactionContainer(
  AXUIElementRef root,
  NSString* buttonTitle,
  NSArray<NSString*>* semanticTerms,
  bool includeRoot,
  bool* ambiguous
) {
  *ambiguous = false;
  int visited = 0;
  std::vector<AXUIElementRef> containers;
  collectTransactionContainers(root, buttonTitle, semanticTerms, 0, &visited, &containers, includeRoot);
  AXUIElementRef result = nullptr;
  if (containers.size() == 1) {
    result = containers[0];
    CFRetain(result);
  } else if (containers.size() > 1) {
    *ambiguous = true;
  }
  releaseElements(&containers);
  return result;
}

AXUIElementRef copySelectedAXWindow(AXUIElementRef application, CGWindowID windowId, CGRect bounds) {
  for (CFStringRef attribute : { kAXMainWindowAttribute, kAXFocusedWindowAttribute }) {
    CFTypeRef rawWindow = nullptr;
    if (AXUIElementCopyAttributeValue(application, attribute, &rawWindow) != kAXErrorSuccess
        || !rawWindow || CFGetTypeID(rawWindow) != AXUIElementGetTypeID()) {
      if (rawWindow) CFRelease(rawWindow);
      continue;
    }
    AXUIElementRef window = static_cast<AXUIElementRef>(rawWindow);
    if (axWindowMatches(window, windowId, bounds)) return window;
    CFRelease(rawWindow);
  }
  return nullptr;
}

bool authorizedWindowStillMatches(AXUIElementRef application, CGWindowID windowId, pid_t ownerPid, CGRect bounds) {
  return targetWindowIdentityMatches(windowId, ownerPid, bounds)
    && targetApplicationIsFrontmostNormal(ownerPid)
    && (applicationWindowMatches(application, kAXMainWindowAttribute, windowId, bounds)
      || applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, bounds));
}

AXUIElementRef copyTextEditSavePanelForWindow(
  AXUIElementRef application,
  CGWindowID windowId,
  CGRect bounds,
  bool* ambiguous
) {
  *ambiguous = false;
  AXUIElementRef selectedWindow = copySelectedAXWindow(application, windowId, bounds);
  if (!selectedWindow) return nullptr;
  AXUIElementRef panel = copyUniqueTransactionContainer(selectedWindow, @"Save", @[], false, ambiguous);
  CFRelease(selectedWindow);
  if (panel || *ambiguous) return panel;

  // NSSavePanel may be exposed as a separate focused AXWindow. Accept it only
  // while the exact authorized document remains the application's main window.
  if (!applicationWindowMatches(application, kAXMainWindowAttribute, windowId, bounds)) return nullptr;
  CFTypeRef rawFocused = nullptr;
  if (AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute, &rawFocused) != kAXErrorSuccess
      || !rawFocused || CFGetTypeID(rawFocused) != AXUIElementGetTypeID()) {
    if (rawFocused) CFRelease(rawFocused);
    return nullptr;
  }
  AXUIElementRef focused = static_cast<AXUIElementRef>(rawFocused);
  if (transactionContainerMatches(focused, @"Save", @[])) return focused;
  CFRelease(rawFocused);
  return nullptr;
}

AXUIElementRef copyGoToFolderDialog(AXUIElementRef savePanel, pid_t ownerPid, bool* ambiguous) {
  *ambiguous = false;
  // Current AppKit exposes the Go to Folder UI as a nested AXSheet with a
  // locale-independent PathTextField and no Go button. Bind the unique path
  // field first, then walk only its bounded parent chain to the first nested
  // transaction container. This cannot select the outer Save panel because
  // that exact object is explicitly excluded.
  AXUIElementRef field = copyUniqueDestinationField(savePanel, ownerPid, ambiguous);
  if (!field || *ambiguous) {
    if (field) CFRelease(field);
    return nullptr;
  }
  AXUIElementRef current = field;
  for (int depth = 0; current && depth < 10; depth += 1) {
    CFTypeRef rawParent = nullptr;
    if (AXUIElementCopyAttributeValue(current, kAXParentAttribute, &rawParent) != kAXErrorSuccess
        || !rawParent || CFGetTypeID(rawParent) != AXUIElementGetTypeID()) {
      if (rawParent) CFRelease(rawParent);
      CFRelease(current);
      return nullptr;
    }
    AXUIElementRef parent = static_cast<AXUIElementRef>(rawParent);
    NSString* role = axStringAttribute(parent, kAXRoleAttribute);
    const bool isSavePanel = CFEqual(parent, savePanel);
    const bool isContainer = [role isEqualToString:@"AXWindow"]
      || [role isEqualToString:@"AXSheet"]
      || [role isEqualToString:@"AXDialog"];
    CFRelease(current);
    current = parent;
    if (isSavePanel) {
      CFRelease(current);
      return nullptr;
    }
    if (isContainer) return current;
  }
  if (current) CFRelease(current);
  return nullptr;
}

void collectRoleElements(AXUIElementRef root, NSString* wantedRole, int depth, int* visited, std::vector<AXUIElementRef>* elements) {
  if (!root || depth > 9 || *visited >= 320 || elements->size() >= 12) return;
  *visited += 1;
  if ([axStringAttribute(root, kAXRoleAttribute) isEqualToString:wantedRole]) {
    CFRetain(root);
    elements->push_back(root);
  }
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(root, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess
      || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    return;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 100);
  for (CFIndex index = 0; index < count; index += 1) {
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
    if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) collectRoleElements(child, wantedRole, depth + 1, visited, elements);
  }
  CFRelease(rawChildren);
}

AXUIElementRef copyUniqueRoleElement(AXUIElementRef root, NSString* role, bool* ambiguous) {
  *ambiguous = false;
  int visited = 0;
  std::vector<AXUIElementRef> elements;
  collectRoleElements(root, role, 0, &visited, &elements);
  AXUIElementRef result = nullptr;
  if (elements.size() == 1) {
    result = elements[0];
    CFRetain(result);
  } else if (elements.size() > 1) {
    *ambiguous = true;
  }
  releaseElements(&elements);
  return result;
}

struct SaveTransactionState {
  NSString* transactionId;
  NSString* parameterBindingsSha256;
  NSString* targetSha256;
  NSString* bundleIdentifier;
  NSString* currentPhase;
  NSString* expectedContentSha256;
  NSString* priorOutputState;
  NSString* outputKind;
  NSString* outputContentSha256;
  NSMutableArray<NSDictionary*>* phases;
  long long startedAtMs;
  NSInteger outputByteLength;
  NSInteger observations;
  bool preconditionsEstablished;
  bool commitAttempted;
  bool commitAccepted;
  bool postconditionSatisfied;
  bool metadataAfterStart;
};

void recordSavePhase(
  SaveTransactionState* transaction,
  NSString* phase,
  NSString* mutation,
  NSString* state,
  NSDictionary* identity,
  NSString* readback
) {
  transaction->currentPhase = phase;
  [transaction->phases addObject:@{
    @"phase": phase,
    @"observation": @(transaction->observations),
    @"mutation": mutation,
    @"state": state,
    @"identity": identity,
    @"readbackSha256": readback ? sha256Text(readback) : [NSNull null],
  }];
}

NSString* saveRetryEligibility(NSString* code, bool commitAttempted, bool effectMayHaveOccurred) {
  if (commitAttempted || effectMayHaveOccurred) return [code isEqualToString:@"authority_safety_violation"] ? @"none" : @"observe_only";
  if ([code isEqualToString:@"authority_safety_violation"] || [code isEqualToString:@"provider_failure"]) return @"none";
  NSSet<NSString*>* retryable = [NSSet setWithArray:@[
    @"precondition_not_established", @"authorized_window_lost", @"dialog_not_found",
    @"dialog_identity_ambiguous", @"element_identity_ambiguous", @"field_mutation_rejected",
    @"field_readback_mismatch", @"commit_not_attempted", @"environment_unavailable",
  ]];
  return [retryable containsObject:code] ? @"safe_phase_retry" : @"handoff";
}

NSDictionary* saveTransactionReceipt(
  SaveTransactionState* transaction,
  CGWindowID windowId,
  NSDictionary* identity,
  NSString* status,
  NSString* failureCode,
  NSString* failureMessage
) {
  const bool effectMayHaveOccurred = transaction->commitAccepted;
  NSString* retry = failureCode ? saveRetryEligibility(failureCode, transaction->commitAttempted, effectMayHaveOccurred) : @"none";
  NSDictionary* failure = failureCode ? @{
    @"code": failureCode,
    @"phase": transaction->currentPhase,
    @"message": failureMessage ?: @"The application operation failed.",
    @"fingerprint": sha256Text([NSString stringWithFormat:@"%@:%@:%ld", failureCode, transaction->currentPhase, transaction->observations]),
    @"retryEligibility": retry,
  } : nil;
  if (failureCode) recordSavePhase(transaction, @"failed", @"none", [failureCode containsString:@"ambiguous"] ? @"ambiguous" : @"rejected", identity, nil);
  return @{
    @"version": @1,
    @"transactionId": transaction->transactionId,
    @"operationId": @"text_document.save_new",
    @"adapterId": @"macos.textedit.save_new",
    @"adapterVersion": @1,
    @"capability": @"text_document.save_new",
    @"status": status,
    @"phase": failureCode ? @"failed" : @"completed",
    @"parameterBindingsSha256": transaction->parameterBindingsSha256,
    @"authorizedEffect": @{
      @"kind": @"local_write", @"targetSha256": transaction->targetSha256, @"overwriteAuthorized": @NO,
    },
    @"target": @{
      @"bundleIdentifierSha256": sha256Text(transaction->bundleIdentifier),
      @"windowId": @(windowId),
      @"identity": identity,
    },
    @"preconditions": @{
      @"established": @(transaction->preconditionsEstablished),
      @"outputPriorState": transaction->priorOutputState,
      @"expectedContentSha256": transaction->expectedContentSha256 ?: [NSNull null],
      @"startedAtMs": @(transaction->startedAtMs),
    },
    @"phases": transaction->phases,
    @"commit": @{
      @"attempted": @(transaction->commitAttempted),
      @"accepted": @(transaction->commitAccepted),
      @"attemptCount": @(transaction->commitAttempted ? 1 : 0),
      @"effectMayHaveOccurred": @(effectMayHaveOccurred),
    },
    @"idempotency": @{
      @"keySha256": sha256Text([NSString stringWithFormat:@"%@:%@", transaction->transactionId, transaction->targetSha256]),
      @"duplicateEffectRisk": effectMayHaveOccurred && !transaction->postconditionSatisfied ? @"possible" : @"none",
      @"replayAllowed": @([retry isEqualToString:@"safe_phase_retry"]),
    },
    @"postcondition": @{
      @"kind": @"exact_new_file",
      @"satisfied": @(transaction->postconditionSatisfied),
      @"observations": @(transaction->observations),
      @"targetSha256": transaction->targetSha256,
      @"outputKind": transaction->outputKind,
      @"contentSha256": transaction->outputContentSha256 ?: [NSNull null],
      @"byteLength": transaction->outputByteLength >= 0 ? @(transaction->outputByteLength) : [NSNull null],
      @"metadataAfterStart": transaction->outputKind && ![transaction->outputKind isEqualToString:@"absent"] ? @(transaction->metadataAfterStart) : [NSNull null],
    },
    @"failure": failure ?: [NSNull null],
  };
}

/** Save one fresh TextEdit document through the shared transactional adapter
 * contract. Every mutation is followed by an Accessibility or filesystem
 * read-back. A retry may revisit pre-commit UI, but this function presses the
 * commit control at most once and becomes observation-only afterward. */
NSDictionary* performTextEditSaveDocument(
  CGWindowID windowId,
  NSString* expectedBundleIdentifier,
  NSString* filePath,
  NSDictionary* authorization,
  int* eventCount,
  NSString** failureReason
) {
  NSString* transactionId = [authorization[@"transactionId"] isKindOfClass:[NSString class]] ? authorization[@"transactionId"] : nil;
  NSString* operationId = [authorization[@"operationId"] isKindOfClass:[NSString class]] ? authorization[@"operationId"] : nil;
  NSString* parameterBindingsSha256 = [authorization[@"parameterBindingsSha256"] isKindOfClass:[NSString class]] ? authorization[@"parameterBindingsSha256"] : nil;
  NSString* authorizedTargetSha256 = [authorization[@"targetSha256"] isKindOfClass:[NSString class]] ? authorization[@"targetSha256"] : nil;
  NSNumber* overwriteAuthorized = [authorization[@"overwriteAuthorized"] isKindOfClass:[NSNumber class]] ? authorization[@"overwriteAuthorized"] : nil;
  NSString* computedTargetSha256 = sha256Text(filePath);
  if (!transactionId || ![operationId isEqualToString:@"text_document.save_new"]
      || parameterBindingsSha256.length != 64 || authorizedTargetSha256.length != 64
      || ![authorizedTargetSha256 isEqualToString:computedTargetSha256]
      || !overwriteAuthorized || overwriteAuthorized.boolValue) {
    if (failureReason) *failureReason = @"The native operation authorization is invalid";
    return nil;
  }

  SaveTransactionState transaction{
    transactionId, parameterBindingsSha256, authorizedTargetSha256, expectedBundleIdentifier,
    @"prepared", nil, @"unknown", @"absent", nil, [NSMutableArray array],
    static_cast<long long>(std::floor([[NSDate date] timeIntervalSince1970] * 1000.0)),
    -1, 0, false, false, false, false, false,
  };
  NSFileManager* manager = [NSFileManager defaultManager];
  WindowDescription description{};
  pid_t ownerPid = 0;
  if (!windowDescription(windowId, &description) || description.layer != 0) {
    transaction.currentPhase = @"prepared";
    NSDictionary* identity = operationIdentityEvidence(expectedBundleIdentifier, 0, windowId, CGRectZero, nullptr, nullptr);
    return saveTransactionReceipt(&transaction, windowId, identity, @"failed", @"authorized_window_lost", @"The authorized window is no longer available.");
  }
  ownerPid = description.ownerPid;
  NSDictionary* baseIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, nullptr, nullptr);
  recordSavePhase(&transaction, @"prepared", @"none", @"established", baseIdentity, nil);

  auto failTransaction = [&](NSString* code, NSString* message, NSDictionary* identity = nil) -> NSDictionary* {
    if (failureReason) *failureReason = message;
    return saveTransactionReceipt(
      &transaction,
      windowId,
      identity ?: baseIdentity,
      transaction.commitAccepted ? @"uncertain" : @"failed",
      code,
      message
    );
  };
  // A Save sheet wider than its document window makes macOS move the window so the sheet fits (3 Oct: a 586-wide window
  // moved 107 pt right when the 800-wide Save sheet opened), and the identity checks below, which compare bounds,
  // reported the dialog missing or the window changed (e2e D01/D02/D03). The same window id and owner at the same size
  // and a new origin is still the authorized window; a resize, another window or another owner still fails.
  auto followMovedWindow = [&]() {
    WindowDescription now{};
    if (!windowDescription(windowId, &now) || now.ownerPid != ownerPid || now.layer != 0) return;
    if (CGSizeEqualToSize(now.bounds.size, description.bounds.size) && !CGPointEqualToPoint(now.bounds.origin, description.bounds.origin)) description.bounds = now.bounds;
  };

  if (![expectedBundleIdentifier isEqualToString:@"com.apple.TextEdit"] || !filePath || filePath.length == 0 || filePath.length > 1'000
      || ![filePath isAbsolutePath] || ![[filePath stringByStandardizingPath] isEqualToString:filePath]
      || ![[filePath.pathExtension lowercaseString] isEqualToString:@"txt"] || [filePath.lastPathComponent hasPrefix:@"."]) {
    return failTransaction(@"authority_safety_violation", @"The save path failed native authority validation.");
  }
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:ownerPid];
  if (!running || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) {
    return failTransaction(@"authorized_window_lost", @"The authorized window is no longer owned by TextEdit.");
  }
  BOOL isDirectory = NO;
  NSString* directory = [filePath stringByDeletingLastPathComponent];
  if ([manager fileExistsAtPath:filePath isDirectory:&isDirectory]) {
    transaction.priorOutputState = isDirectory ? @"directory" : @"present";
    transaction.outputKind = isDirectory ? @"directory" : @"regular_file";
    return failTransaction(@"authority_safety_violation", @"The exact output path already exists and overwrite is not authorized.");
  }
  if (![manager fileExistsAtPath:directory isDirectory:&isDirectory] || !isDirectory) {
    return failTransaction(@"precondition_not_established", @"The authorized destination directory is unavailable.");
  }
  NSString* resolvedDirectory = [directory stringByResolvingSymlinksInPath];
  NSArray<NSString*>* protectedPrefixes = @[@"/System", @"/Library", @"/Applications", @"/usr", @"/bin", @"/sbin", @"/etc", @"/private/etc", @"/private/var/db"];
  for (NSString* prefix in protectedPrefixes) {
    if ([resolvedDirectory isEqualToString:prefix] || [resolvedDirectory hasPrefix:[prefix stringByAppendingString:@"/"]]) {
      return failTransaction(@"authority_safety_violation", @"The save destination is protected.");
    }
  }
  for (NSString* part in resolvedDirectory.pathComponents) {
    if ([@[@".ssh", @".gnupg", @".aws", @".config"] containsObject:part]) {
      return failTransaction(@"authority_safety_violation", @"The save destination is protected.");
    }
  }

  AXUIElementRef application = AXUIElementCreateApplication(ownerPid);
  if (!application) return failTransaction(@"environment_unavailable", @"TextEdit's Accessibility root is unavailable.");
  AXUIElementSetMessagingTimeout(application, 0.5f);
  AXUIElementRef selectedWindow = copySelectedAXWindow(application, windowId, description.bounds);
  bool contentAmbiguous = false;
  AXUIElementRef documentArea = selectedWindow ? copyUniqueRoleElement(selectedWindow, @"AXTextArea", &contentAmbiguous) : nullptr;
  NSString* expectedContent = documentArea ? axTextValue(documentArea) : nil;
  if (documentArea) CFRelease(documentArea);
  if (selectedWindow) CFRelease(selectedWindow);
  if (!authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds)) {
    CFRelease(application);
    return failTransaction(@"authorized_window_lost", @"The authorized TextEdit window changed before save.");
  }
  if (contentAmbiguous || !expectedContent) {
    CFRelease(application);
    return failTransaction(contentAmbiguous ? @"element_identity_ambiguous" : @"precondition_not_established", @"The authorized document content could not be read uniquely before save.");
  }
  transaction.preconditionsEstablished = true;
  transaction.expectedContentSha256 = sha256Text(expectedContent);
  transaction.currentPhase = @"preconditions_established";
  recordSavePhase(&transaction, @"preconditions_established", @"none", @"established", baseIdentity, expectedContent);

  CGKeyCode code = 0;
  CGEventFlags flags = 0;
  bool panelAmbiguous = false;
  int saveWaitPolls = 0;
  bool saveWaitWindowLost = false;
  NSString* saveWaitMismatch = @"";
  AXUIElementRef panel = copyTextEditSavePanelForWindow(application, windowId, description.bounds, &panelAmbiguous);
  if (!panel && !panelAmbiguous) {
    // Command-S goes to TextEdit's focused window. "Main or focused" (authorizedWindowStillMatches) let it reach another
    // document when the two differed: no Save dialog appeared on the authorized window (dialog_not_found, e2e D01/D02/D03,
    // 3 Oct) and a stray Save sheet was left on another document. The authorized window must be the focused one.
    if (!applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, description.bounds)) {
      AXUIElementRef focusTarget = copySelectedAXWindow(application, windowId, description.bounds);
      if (focusTarget) { requestSelectedWindowFocus(running, application, focusTarget); CFRelease(focusTarget); }
      for (int attempt = 0; attempt < 10 && !applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, description.bounds); attempt += 1) usleep(100'000);
      transaction.observations += 1;
      if (!applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, description.bounds)) {
        CFRelease(application);
        return failTransaction(@"precondition_not_established", @"The authorized document window is not TextEdit's focused window, so Save was not requested.");
      }
    }
    if (!safeKey(@"CMD+S", &code, &flags) || !postKey(code, flags)) {
      CFRelease(application);
      transaction.currentPhase = @"effect_ui_requested";
      return failTransaction(@"commit_not_attempted", @"TextEdit rejected the request to open its Save dialog.");
    }
    *eventCount += 2;
    recordSavePhase(&transaction, @"effect_ui_requested", @"pre_commit", @"changed", baseIdentity, nil);
    for (int attempt = 0; attempt < 30 && !panel && !panelAmbiguous; attempt += 1) {
      saveWaitPolls = attempt + 1;
      // While the Save sheet animates in, the window slides to fit it and the identity checks can fail for a moment.
      // A mismatch here only skips this poll; the check after the wait still refuses a window that is really gone.
      followMovedWindow();
      if (!authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds)) {
        saveWaitWindowLost = true;
        saveWaitMismatch = !targetWindowIdentityMatches(windowId, ownerPid, description.bounds) ? @"window server identity"
          : !targetApplicationIsFrontmostNormal(ownerPid) ? @"frontmost application"
          : @"accessibility main or focused window";
        usleep(100'000);
        continue;
      }
      panel = (followMovedWindow(), copyTextEditSavePanelForWindow(application, windowId, description.bounds, &panelAmbiguous));
      transaction.observations += 1;
      if (!panel && !panelAmbiguous) usleep(100'000);
    }
  } else {
    // A safe phase retry may begin with the still-open panel; do not post the
    // Save shortcut again just to recreate already-proven pre-commit state.
    recordSavePhase(&transaction, @"effect_ui_requested", @"none", @"established", baseIdentity, nil);
  }
  transaction.currentPhase = @"effect_ui_identified";
  if (!(followMovedWindow(), authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds))) {
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"authorized_window_lost", @"The authorized TextEdit window changed while opening Save.");
  }
  if (panelAmbiguous || !panel) {
    CFRelease(application);
    return failTransaction(panelAmbiguous ? @"dialog_identity_ambiguous" : @"dialog_not_found", panelAmbiguous
      ? @"More than one Save dialog matched the authorized document."
      : [NSString stringWithFormat:@"No uniquely identifiable Save dialog appeared (%d checks%@).", saveWaitPolls,
          saveWaitWindowLost ? [NSString stringWithFormat:@"; the authorized window did not match at some checks (%@)", saveWaitMismatch] : @""]);
  }
  NSDictionary* panelIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, panel, nullptr);
  recordSavePhase(&transaction, @"effect_ui_identified", @"none", @"established", panelIdentity, nil);

  bool nameAmbiguous = false;
  AXUIElementRef nameField = copyUniqueFilenameField(panel, ownerPid, &nameAmbiguous);
  transaction.currentPhase = @"primary_field_identified";
  if (nameAmbiguous || !nameField) {
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(nameAmbiguous ? @"element_identity_ambiguous" : @"precondition_not_established", @"The Save As filename field was not uniquely identifiable.", panelIdentity);
  }
  NSDictionary* nameIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, panel, nameField);
  recordSavePhase(&transaction, @"primary_field_identified", @"none", @"established", nameIdentity, nil);
  transaction.currentPhase = @"primary_field_verified";
  if (!assignAccessibleTextValue(nameField, ownerPid, filePath.lastPathComponent)) {
    CFRelease(nameField);
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"field_mutation_rejected", @"The Save As field rejected the controller-owned filename.", nameIdentity);
  }
  NSString* filenameReadback = axTextValue(nameField);
  bool filenameAliasesAmbiguous = false;
  const bool filenameAliasesMatch = filenameFieldAliasesReadBack(
    panel, ownerPid, filePath.lastPathComponent, &filenameAliasesAmbiguous
  );
  if (!filenameAliasesMatch) {
    CFRelease(nameField);
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(
      filenameAliasesAmbiguous ? @"element_identity_ambiguous" : @"field_readback_mismatch",
      filenameAliasesAmbiguous
        ? @"The Save As field identity changed during exact read-back."
        : @"Every observable Save As field alias did not read back the exact filename.",
      nameIdentity
    );
  }
  recordSavePhase(&transaction, @"primary_field_verified", @"pre_commit", @"matched", nameIdentity, filenameReadback);
  CFRelease(nameField);

  transaction.currentPhase = @"destination_ui_requested";
  if (!safeKey(@"CMD+SHIFT+G", &code, &flags) || !postKey(code, flags)) {
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"commit_not_attempted", @"TextEdit rejected the destination chooser request.", panelIdentity);
  }
  *eventCount += 2;
  recordSavePhase(&transaction, @"destination_ui_requested", @"pre_commit", @"changed", panelIdentity, nil);
  bool folderDialogAmbiguous = false;
  AXUIElementRef folderDialog = nullptr;
  for (int attempt = 0; attempt < 30 && !folderDialog && !folderDialogAmbiguous; attempt += 1) {
    if (!(followMovedWindow(), authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds))) break;
    // Reacquire the panel because AppKit may rebuild its subtree after the
    // shortcut; no CF object identity is treated as durable state.
    if (panel) CFRelease(panel);
    panel = (followMovedWindow(), copyTextEditSavePanelForWindow(application, windowId, description.bounds, &panelAmbiguous));
    if (panel && !panelAmbiguous) folderDialog = copyGoToFolderDialog(panel, ownerPid, &folderDialogAmbiguous);
    transaction.observations += 1;
    if (!folderDialog && !folderDialogAmbiguous) usleep(100'000);
  }
  transaction.currentPhase = @"destination_ui_identified";
  if (!(followMovedWindow(), authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds))) {
    if (folderDialog) CFRelease(folderDialog);
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"authorized_window_lost", @"The authorized TextEdit window changed during destination selection.");
  }
  if (panelAmbiguous || folderDialogAmbiguous || !folderDialog) {
    if (folderDialog) CFRelease(folderDialog);
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(panelAmbiguous || folderDialogAmbiguous ? @"dialog_identity_ambiguous" : @"dialog_not_found", @"The destination dialog was not uniquely identifiable.");
  }
  NSDictionary* folderDialogIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, folderDialog, nullptr);
  recordSavePhase(&transaction, @"destination_ui_identified", @"none", @"established", folderDialogIdentity, nil);
  bool folderFieldAmbiguous = false;
  AXUIElementRef folderField = copyUniqueDestinationField(folderDialog, ownerPid, &folderFieldAmbiguous);
  if (folderFieldAmbiguous || !folderField) {
    if (folderField) CFRelease(folderField);
    CFRelease(folderDialog);
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(folderFieldAmbiguous ? @"element_identity_ambiguous" : @"precondition_not_established", @"The destination field was not uniquely identifiable.", folderDialogIdentity);
  }
  NSDictionary* folderFieldIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, folderDialog, folderField);
  transaction.currentPhase = @"destination_field_verified";
  if (!assignAccessibleTextValue(folderField, ownerPid, directory)) {
    CFRelease(folderField);
    CFRelease(folderDialog);
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"field_mutation_rejected", @"The destination field rejected the controller-owned directory.", folderFieldIdentity);
  }
  NSString* directoryReadback = axTextValue(folderField);
  bool destinationAliasesAmbiguous = false;
  const bool destinationAliasesMatch = destinationFieldAliasesReadBack(
    folderDialog, ownerPid, directory, &destinationAliasesAmbiguous
  );
  if (!destinationAliasesMatch) {
    CFRelease(folderField);
    CFRelease(folderDialog);
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(
      destinationAliasesAmbiguous ? @"element_identity_ambiguous" : @"field_readback_mismatch",
      destinationAliasesAmbiguous
        ? @"The destination field identity changed during exact read-back."
        : @"Every observable destination field alias did not read back the exact directory.",
      folderFieldIdentity
    );
  }
  recordSavePhase(&transaction, @"destination_field_verified", @"pre_commit", @"matched", folderFieldIdentity, directoryReadback);
  // AXConfirm opens AppKit's path suggestions but does not accept the folder.
  // Focus the exact, already-read-back PathTextField and post the standard
  // Return confirmation inside this native call, before any other focus
  // preflight can redirect the key away from the nested sheet.
  const bool destinationAccepted = performSemanticAction(folderField, @"focus")
    && safeKey(@"RETURN", &code, &flags)
    && postKey(code, flags);
  CFRelease(folderField);
  CFRelease(folderDialog);
  if (!destinationAccepted) {
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"commit_not_attempted", @"The exact destination field rejected its focused Return confirmation.", folderDialogIdentity);
  }
  *eventCount += 2;

  // Prove the nested destination dialog disappeared and independently
  // reidentify the Save panel. Nil focus is not sufficient evidence for either.
  if (panel) CFRelease(panel);
  panel = nullptr;
  for (int attempt = 0; attempt < 40 && !panel && !panelAmbiguous; attempt += 1) {
    if (!(followMovedWindow(), authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds))) break;
    panel = (followMovedWindow(), copyTextEditSavePanelForWindow(application, windowId, description.bounds, &panelAmbiguous));
    bool nestedAmbiguous = false;
    AXUIElementRef nested = panel ? copyGoToFolderDialog(panel, ownerPid, &nestedAmbiguous) : nullptr;
    if (nested) {
      CFRelease(nested);
      CFRelease(panel);
      panel = nullptr;
    }
    if (nestedAmbiguous) panelAmbiguous = true;
    transaction.observations += 1;
    if (!panel && !panelAmbiguous) usleep(100'000);
  }
  transaction.currentPhase = @"effect_ui_restored";
  if (!(followMovedWindow(), authorizedWindowStillMatches(application, windowId, ownerPid, description.bounds))) {
    if (panel) CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"authorized_window_lost", @"The authorized TextEdit window changed after destination selection.");
  }
  if (panelAmbiguous || !panel) {
    CFRelease(application);
    return failTransaction(panelAmbiguous ? @"dialog_identity_ambiguous" : @"dialog_not_found", @"The Save dialog did not return uniquely after destination selection.");
  }
  panelIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, panel, nullptr);
  nameAmbiguous = false;
  nameField = copyUniqueFilenameField(panel, ownerPid, &nameAmbiguous);
  if (nameAmbiguous || !nameField) {
    if (nameField) CFRelease(nameField);
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(nameAmbiguous ? @"element_identity_ambiguous" : @"precondition_not_established", @"The restored Save dialog did not expose one filename field.", panelIdentity);
  }
  filenameReadback = axTextValue(nameField);
  nameIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, panel, nameField);
  filenameAliasesAmbiguous = false;
  if (!filenameFieldAliasesReadBack(panel, ownerPid, filePath.lastPathComponent, &filenameAliasesAmbiguous)) {
    CFRelease(nameField);
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(
      filenameAliasesAmbiguous ? @"element_identity_ambiguous" : @"field_readback_mismatch",
      filenameAliasesAmbiguous
        ? @"The restored Save As field identity was ambiguous."
        : @"The exact filename was not preserved across every field alias after destination selection.",
      nameIdentity
    );
  }
  recordSavePhase(&transaction, @"effect_ui_restored", @"none", @"matched", nameIdentity, filenameReadback);
  CFRelease(nameField);

  // A colliding path that appeared during the pre-commit UI could belong to a
  // stale window or another process. Stop without pressing Save.
  isDirectory = NO;
  if ([manager fileExistsAtPath:filePath isDirectory:&isDirectory]) {
    transaction.outputKind = isDirectory ? @"directory" : @"regular_file";
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(@"authority_safety_violation", @"The exact output path appeared before commit; overwrite is not authorized.", panelIdentity);
  }
  bool saveButtonAmbiguous = false;
  AXUIElementRef saveButton = copyUniqueEnabledButton(panel, @"Save", &saveButtonAmbiguous);
  transaction.currentPhase = @"commit_revalidated";
  if (saveButtonAmbiguous || !saveButton) {
    if (saveButton) CFRelease(saveButton);
    CFRelease(panel);
    CFRelease(application);
    return failTransaction(saveButtonAmbiguous ? @"element_identity_ambiguous" : @"commit_not_attempted", @"The Save commit control could not be uniquely revalidated.", panelIdentity);
  }
  NSDictionary* commitIdentity = operationIdentityEvidence(expectedBundleIdentifier, ownerPid, windowId, description.bounds, panel, saveButton);
  recordSavePhase(&transaction, @"commit_revalidated", @"none", @"established", commitIdentity, nil);
  transaction.commitAttempted = true;
  transaction.currentPhase = @"commit_attempted";
  const AXError commitResult = AXUIElementPerformAction(saveButton, kAXPressAction);
  transaction.commitAccepted = commitResult == kAXErrorSuccess;
  recordSavePhase(&transaction, @"commit_attempted", @"commit", transaction.commitAccepted ? @"changed" : @"rejected", commitIdentity, nil);
  CFRelease(saveButton);
  CFRelease(panel);
  if (!transaction.commitAccepted) {
    CFRelease(application);
    return failTransaction(@"commit_rejected", @"The revalidated Save control rejected activation.", commitIdentity);
  }
  *eventCount += 1;

  // After the commit point this loop is observation-only. Success requires
  // the exact path, regular-file type, exact pre-save document bytes, fresh
  // metadata, dismissal of the Save panel, and the same window's title change.
  for (int attempt = 0; attempt < 60; attempt += 1) {
    transaction.observations += 1;
    isDirectory = NO;
    const bool outputExists = [manager fileExistsAtPath:filePath isDirectory:&isDirectory];
    transaction.outputKind = !outputExists ? @"absent" : isDirectory ? @"directory" : @"regular_file";
    recordSavePhase(&transaction, @"commit_observed", @"post_commit_observe", outputExists ? @"changed" : @"absent", baseIdentity, nil);
    if (outputExists && isDirectory) {
      CFRelease(application);
      transaction.currentPhase = @"commit_observed";
      return failTransaction(@"exact_postcondition_failed", @"The exact output path became a directory, not a regular file.");
    }
    if (outputExists) {
      NSData* outputData = [NSData dataWithContentsOfFile:filePath options:NSDataReadingMappedIfSafe error:nil];
      NSString* outputText = outputData ? [[NSString alloc] initWithData:outputData encoding:NSUTF8StringEncoding] : nil;
      transaction.outputByteLength = outputData ? static_cast<NSInteger>(outputData.length) : -1;
      transaction.outputContentSha256 = outputData ? sha256Data(outputData) : nil;
      NSDictionary<NSFileAttributeKey, id>* attributes = [manager attributesOfItemAtPath:filePath error:nil];
      NSDate* created = attributes[NSFileCreationDate];
      NSDate* modified = attributes[NSFileModificationDate];
      const NSTimeInterval threshold = static_cast<NSTimeInterval>(transaction.startedAtMs) / 1000.0 - 1.0;
      transaction.metadataAfterStart = (created && created.timeIntervalSince1970 >= threshold)
        || (modified && modified.timeIntervalSince1970 >= threshold);
      bool saveStillAmbiguous = false;
      AXUIElementRef remainingPanel = (followMovedWindow(), copyTextEditSavePanelForWindow(application, windowId, description.bounds, &saveStillAmbiguous));
      if (remainingPanel) CFRelease(remainingPanel);
      AXUIElementRef currentWindow = (followMovedWindow(), copySelectedAXWindow(application, windowId, description.bounds));
      NSString* currentTitle = currentWindow ? axStringAttribute(currentWindow, kAXTitleAttribute) : nil;
      if (currentWindow) CFRelease(currentWindow);
      const bool sameContent = outputText && [outputText isEqualToString:expectedContent]
        && [transaction.outputContentSha256 isEqualToString:transaction.expectedContentSha256];
      const bool selectedWindowNamed = currentTitle && [currentTitle containsString:filePath.lastPathComponent];
      if (!sameContent || !transaction.metadataAfterStart) {
        CFRelease(application);
        transaction.currentPhase = @"postcondition_verified";
        return failTransaction(@"exact_postcondition_failed", @"The exact output file failed content or transaction-time metadata verification.");
      }
      if (!remainingPanel && !saveStillAmbiguous && selectedWindowNamed) {
        transaction.postconditionSatisfied = true;
        transaction.currentPhase = @"postcondition_verified";
        recordSavePhase(&transaction, @"postcondition_verified", @"post_commit_observe", @"matched", baseIdentity, outputText);
        recordSavePhase(&transaction, @"completed", @"none", @"established", baseIdentity, nil);
        CFRelease(application);
        return saveTransactionReceipt(&transaction, windowId, baseIdentity, @"completed", nil, nil);
      }
    }
    usleep(100'000);
  }
  CFRelease(application);
  transaction.currentPhase = @"commit_observed";
  return failTransaction(@"effect_may_have_occurred_unverified", @"Save was committed once, but the exact authorized output never became verifiable.");
}

napi_value isTrusted(napi_env env, napi_callback_info) {
  napi_value result;
  napi_get_boolean(env, AXIsProcessTrusted(), &result);
  return result;
}

napi_value requestTrust(napi_env env, napi_callback_info) {
  const void* keys[] = { kAXTrustedCheckOptionPrompt };
  const void* values[] = { kCFBooleanTrue };
  CFDictionaryRef options = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  const bool trusted = AXIsProcessTrustedWithOptions(options);
  CFRelease(options);
  napi_value result;
  napi_get_boolean(env, trusted, &result);
  return result;
}

napi_value jsonResult(napi_env env, NSDictionary* value) {
  NSError* error = nil;
  NSData* data = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
  if (error || !data) return fail(env, "Live window state could not be encoded");
  napi_value result;
  if (napi_create_string_utf8(env, static_cast<const char*>(data.bytes), data.length, &result) != napi_ok) {
    return fail(env, "Live window state could not be returned");
  }
  return result;
}

/** Read-only companion to the governed input method. It lets Electron place a
 * passive click-through frame only while the exact selected window remains the
 * focused or main window, and supplies current bounds after moves/resizes. */
// A short-lived AX reference acquired while the exact selected window is
// visible. Minimized windows can disappear from Window Server enumeration.
// Never reacquire an off-screen window by title or approximate geometry.
AXUIElementRef lifecycleWindow = nullptr;
CGWindowID lifecycleWindowId = 0;
pid_t lifecycleOwner = 0;
std::string lifecycleBundle;
double lifecycleExpiresAt = 0;
uint64_t lifecycleExternalInputCount = 0;
uint64_t externalInputCount = 0;
// Escape pressed by the person (never by Carve's own synthesized input) is the
// keyboard's universal "stop". Electron polls this count while live work runs
// and stops at once when it advances. The tap stays listen-only, so the
// selected app still receives the Escape it was owed.
uint64_t externalEscapeCount = 0;
// The person's own hands, for the turn-taking gate: when they last touched
// the keyboard or mouse (moves included), and how many commands (clicks,
// keys, scrolls) they have issued. Carve's own synthesized events carry this
// process's pid and never count, unlike CGEventSourceSecondsSinceLastEventType,
// which cannot tell the two apart.
CFAbsoluteTime lastPersonInputAt = 0;
uint64_t personCommandCount = 0;
constexpr int64_t kEscapeKeycode = 53;  // kVK_Escape
CFMachPortRef recoveryInputTap = nullptr;
CGEventRef observeRecoveryIntervention(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    ++externalInputCount;
    if (recoveryInputTap) CGEventTapEnable(recoveryInputTap, true);
  } else if (event && CGEventGetIntegerValueField(event, kCGEventSourceUnixProcessID) != getpid()) {
    // Count only. No key values, text, coordinates, or events are retained;
    // the one comparison made is whether a key-down is the Escape key.
    if (type == kCGEventKeyDown && CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode) == kEscapeKeycode) ++externalEscapeCount;
    lastPersonInputAt = CFAbsoluteTimeGetCurrent();
    // A pointer move is presence, not a command: it keeps Carve waiting but
    // never counts as the person choosing another window.
    if (type == kCGEventMouseMoved || type == kCGEventLeftMouseDragged || type == kCGEventRightMouseDragged) return event;
    ++personCommandCount;
    ++externalInputCount;
  }
  return event;
}
bool ensureRecoveryInputMonitor() {
  if (recoveryInputTap) return CGEventTapIsEnabled(recoveryInputTap);
  CGEventMask mask = 0;
  for (CGEventType type : { kCGEventLeftMouseDown, kCGEventRightMouseDown, kCGEventOtherMouseDown, kCGEventKeyDown, kCGEventScrollWheel,
      kCGEventMouseMoved, kCGEventLeftMouseDragged, kCGEventRightMouseDragged }) mask |= CGEventMaskBit(type);
  recoveryInputTap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, mask, observeRecoveryIntervention, nullptr);
  if (!recoveryInputTap) return false;
  CFRunLoopSourceRef source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, recoveryInputTap, 0);
  if (!source) { CFRelease(recoveryInputTap); recoveryInputTap = nullptr; return false; }
  CFRunLoopAddSource(CFRunLoopGetMain(), source, kCFRunLoopCommonModes);
  CFRelease(source);
  return true;
}

/** Arms the listen-only input monitor and reports how many times the person
 * has pressed Escape. `monitoring` is false without Accessibility trust or
 * when the tap could not be created; Electron then relies on the chord. */
napi_value escapeStopMonitor(napi_env env, napi_callback_info) {
  const bool monitoring = AXIsProcessTrusted() && ensureRecoveryInputMonitor();
  return jsonResult(env, @{ @"monitoring": @(monitoring), @"count": @(externalEscapeCount) });
}

/** The person's own input, never Carve's: how long since they last touched
 * the keyboard or mouse, and a running count of their clicks, keys and
 * scrolls. Counts and ages only; nothing about what was pressed or where. */
napi_value personActivity(napi_env env, napi_callback_info) {
  const bool monitoring = AXIsProcessTrusted() && ensureRecoveryInputMonitor();
  const double idleMs = lastPersonInputAt > 0 ? std::max(0.0, (CFAbsoluteTimeGetCurrent() - lastPersonInputAt) * 1000.0) : 86400000.0;
  return jsonResult(env, @{ @"monitoring": @(monitoring), @"commandCount": @(personCommandCount), @"idleMs": @(idleMs) });
}

napi_value windowLifecycle(napi_env env, napi_callback_info info) {
  if (!AXIsProcessTrusted()) return jsonResult(env, @{ @"state": @"unknown" });
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Invalid window lifecycle request");
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  double rawId = 0;
  NSString* bundle = nil;
  if (!target || !number(target, @"windowId", &rawId) || rawId < 1 || rawId > UINT32_MAX || std::floor(rawId) != rawId
      || !text(target, @"bundleIdentifier", &bundle) || bundle.length == 0 || bundle.length > 240) return fail(env, "Invalid exact window identity");
  const auto windowId = static_cast<CGWindowID>(rawId);
  const double now = NSProcessInfo.processInfo.systemUptime;
  const bool restoring = [request[@"restore"] isEqual:@YES];
  WindowDescription description{};
  const bool described = windowDescription(windowId, &description) && description.layer == 0;
  bool leased = lifecycleWindow && lifecycleWindowId == windowId && lifecycleBundle == bundle.UTF8String && now <= lifecycleExpiresAt;
  if (leased && described && description.ownerPid != lifecycleOwner) leased = false;
  if (!described && !leased) return jsonResult(env, @{ @"state": @"unavailable" });
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:leased ? lifecycleOwner : description.ownerPid];
  if (!running || running.terminated || ![running.bundleIdentifier isEqualToString:bundle]) return jsonResult(env, @{ @"state": @"unavailable" });
  AXUIElementRef selected = leased ? lifecycleWindow : nullptr;
  if (selected) CFRetain(selected);
  if (!selected && !restoring && described && running.active) {
    AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
    AXUIElementSetMessagingTimeout(application, 0.15f);
    CFTypeRef rawWindows = nullptr;
    if (AXUIElementCopyAttributeValue(application, kAXWindowsAttribute, &rawWindows) == kAXErrorSuccess
        && rawWindows && CFGetTypeID(rawWindows) == CFArrayGetTypeID()) {
      CFArrayRef windows = static_cast<CFArrayRef>(rawWindows);
      unsigned matches = 0;
      for (CFIndex i = 0; i < CFArrayGetCount(windows); ++i) {
        AXUIElementRef window = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(windows, i)));
        if (CFGetTypeID(window) != AXUIElementGetTypeID() || !axWindowMatches(window, windowId, description.bounds)) continue;
        ++matches;
        if (!selected) { selected = window; CFRetain(selected); }
      }
      if (matches != 1 && selected) { CFRelease(selected); selected = nullptr; }
    }
    if (rawWindows) CFRelease(rawWindows);
    CFRelease(application);
  }
  NSString* state = @"unknown";
  if (selected) {
    CFTypeRef value = nullptr;
    pid_t axOwner = 0;
    if (AXUIElementGetPid(selected, &axOwner) == kAXErrorSuccess && axOwner == running.processIdentifier
        && AXUIElementCopyAttributeValue(selected, kAXMinimizedAttribute, &value) == kAXErrorSuccess
        && value && CFGetTypeID(value) == CFBooleanGetTypeID()) {
      const bool minimized = CFBooleanGetValue(static_cast<CFBooleanRef>(value));
      state = minimized ? @"minimized" : (running.hidden ? @"unknown" : @"visible");
      if (!restoring && !minimized && described && running.active) {
        if (lifecycleWindow) CFRelease(lifecycleWindow);
        lifecycleWindow = selected; CFRetain(lifecycleWindow);
        lifecycleWindowId = windowId; lifecycleOwner = running.processIdentifier;
        lifecycleBundle = bundle.UTF8String; lifecycleExpiresAt = now + 5.0;
        lifecycleExternalInputCount = externalInputCount;
        if (!ensureRecoveryInputMonitor()) lifecycleExpiresAt = 0;
      }
      if (restoring && minimized && leased && running.active && recoveryInputTap && CGEventTapIsEnabled(recoveryInputTap) && externalInputCount == lifecycleExternalInputCount) {
        // Consume the lease: one recovery attempt, never a restore loop.
        lifecycleExpiresAt = 0;
        if (AXUIElementSetAttributeValue(selected, kAXMinimizedAttribute, kCFBooleanFalse) == kAXErrorSuccess) {
          state = @"restoring";
          CFTypeRef readback = nullptr;
          if (AXUIElementCopyAttributeValue(selected, kAXMinimizedAttribute, &readback) == kAXErrorSuccess
              && readback && CFGetTypeID(readback) == CFBooleanGetTypeID() && !CFBooleanGetValue(static_cast<CFBooleanRef>(readback))) state = @"visible";
          if (readback) CFRelease(readback);
        }
      }
    } else state = @"unavailable";
    if (value) CFRelease(value);
    CFRelease(selected);
  }
  return jsonResult(env, @{ @"state": state });
}

napi_value windowState(napi_env env, napi_callback_info info) {
  if (!AXIsProcessTrusted()) return jsonResult(env, @{ @"available": @NO, @"focused": @NO, @"bounds": [NSNull null] });
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Live window state request is invalid");
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  if (!target) return fail(env, "Live window state requires a selected-window identity");
  double rawWindowId = 0;
  NSString* expectedBundleIdentifier = nil;
  if (!number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId
      || !text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
    return fail(env, "Selected-window identity is invalid");
  }

  const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
  WindowDescription description{};
  if (!windowDescription(windowId, &description) || description.layer != 0) {
    return jsonResult(env, @{ @"available": @NO, @"focused": @NO, @"bounds": [NSNull null] });
  }
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:description.ownerPid];
  if (!running || !running.bundleIdentifier || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) {
    return jsonResult(env, @{ @"available": @NO, @"focused": @NO, @"bounds": [NSNull null] });
  }

  bool focusedWindowMatches = false;
  bool mainWindowMatches = false;
  // This runs on Electron's main thread every 200 ms. An application that is
  // not active cannot own the focused window, so it is never asked; an active
  // one is asked with a short deadline. A busy accessibility server (a
  // browser mid-load, or one answering the helper's element walk) must never
  // hold that thread: a slow answer is treated as no evidence, and the next
  // tick asks again.
  const bool applicationHasFocus = inputApplicationHasFocus(description.ownerPid);
  AXUIElementRef application = applicationHasFocus ? AXUIElementCreateApplication(description.ownerPid) : nullptr;
  if (application) {
    AXUIElementSetMessagingTimeout(application, 0.1f);
    focusedWindowMatches = applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, description.bounds);
    mainWindowMatches = applicationWindowMatches(application, kAXMainWindowAttribute, windowId, description.bounds);
    CFRelease(application);
  }
  const bool focused = steward::acceptsWindowFocusEvidence({
    true,
    applicationHasFocus && targetApplicationIsFrontmostNormal(description.ownerPid),
    focusedWindowMatches,
    mainWindowMatches,
    soleNormalWindowMatches(windowId, description.ownerPid, description.bounds),
  });
  NSDictionary* bounds = @{
    @"x": @(description.bounds.origin.x),
    @"y": @(description.bounds.origin.y),
    @"width": @(description.bounds.size.width),
    @"height": @(description.bounds.size.height),
  };
  // Query event age only. No event tap, key value, text, screenshot, or input
  // history is collected. Any user interaction retires an advisory pointer.
  double inputAge = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown);
  for (CGEventType type : { kCGEventRightMouseDown, kCGEventScrollWheel, kCGEventKeyDown }) {
    inputAge = std::min(inputAge, CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, type));
  }
  return jsonResult(env, @{ @"available": @YES, @"focused": @(focused), @"frontmostNormal": @(overlayTargetIsFrontmostNormal(windowId)), @"bounds": bounds, @"inputAgeMs": @(inputAge * 1000.0) });
}

napi_value supportsKeycodeText(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok || argc != 1) return fail(env, "Text is required");
  size_t size = 0;
  if (napi_get_value_string_utf8(env, argv[0], nullptr, 0, &size) != napi_ok || size > 4'000) return fail(env, "Text is invalid");
  std::vector<char> input(size + 1, '\0');
  if (napi_get_value_string_utf8(env, argv[0], input.data(), input.size(), &size) != napi_ok) return fail(env, "Text is invalid");
  NSString* value = [[NSString alloc] initWithBytes:input.data() length:size encoding:NSUTF8StringEncoding];
  bool supported = value != nil;
  for (NSUInteger index = 0; supported && index < value.length; index += 1) {
    TextStroke stroke{};
    supported = textStroke([value characterAtIndex:index], &stroke);
  }
  napi_value result;
  napi_get_boolean(env, supported, &result);
  return result;
}

/** Raise the exact selected work window without posting mouse or keyboard
 * input. Window selection is the person's explicit handoff from Carve's
 * full console to the compact capsule, so this operation verifies the same
 * immutable identity and bounds contract as every later input action. */
napi_value focusWindow(napi_env env, napi_callback_info info) {
  panelTransition.clear();
  if (!AXIsProcessTrusted()) return fail(env, "Accessibility is not granted to Carve");
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Live window focus request is invalid");
  NSDictionary* bounds = [request[@"bounds"] isKindOfClass:[NSDictionary class]] ? request[@"bounds"] : nil;
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  if (!bounds || !target) return fail(env, "Live window focus requires a selected-window identity and verified bounds");

  double x = 0, y = 0, width = 0, height = 0;
  if (!number(bounds, @"x", &x) || !number(bounds, @"y", &y) || !number(bounds, @"width", &width) || !number(bounds, @"height", &height) || width < 1 || height < 1) {
    return fail(env, "Verified window bounds are invalid");
  }
  double rawWindowId = 0;
  if (!number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId) {
    return fail(env, "Selected window identity is invalid");
  }
  NSString* expectedBundleIdentifier = nil;
  if (!text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
    return fail(env, "Selected application identity is invalid");
  }

  const WindowFocusResult focus = focusSelectedWindow(
    static_cast<CGWindowID>(rawWindowId),
    CGRectMake(x, y, width, height),
    expectedBundleIdentifier
  );
  if (!focus.verified) {
    NSString* message = [NSString stringWithFormat:@"The exact selected window could not be raised for the Work Capsule (reason: %s)%@", focus.reason, focusFailureSuffix(focus)];
    return fail(env, message.UTF8String);
  }
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

/** Use the same receiver classification as the observation helper. */
bool sensitiveInputElement(AXUIElementRef element) {
  NSString* name = axStringAttribute(element, kAXTitleAttribute);
  if (!name.length) name = axStringAttribute(element, kAXDescriptionAttribute);
  NSString* label = [NSString stringWithFormat:@"%@ %@ %@", name ?: @"",
    axStringAttribute(element, kAXPlaceholderValueAttribute) ?: @"", axStringAttribute(element, kAXIdentifierAttribute) ?: @""];
  return CarveControlIsSensitive(axStringAttribute(element, kAXRoleAttribute).UTF8String,
    axStringAttribute(element, kAXSubroleAttribute).UTF8String, label.UTF8String);
}

// The exact target is already focused. Missing receiver evidence is a clean
// preflight rejection, not evidence that a synthetic key was left pressed.
NSString* textReceiverIssue(CGWindowID windowId) {
  pid_t owner = 0;
  if (!windowOwner(windowId, &owner)) return @"keyboard_receiver_unavailable";
  AXUIElementRef app = AXUIElementCreateApplication(owner);
  AXUIElementSetMessagingTimeout(app, 0.25f);
  CFTypeRef raw = nullptr;
  const bool copied = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &raw) == kAXErrorSuccess
    && raw && CFGetTypeID(raw) == AXUIElementGetTypeID();
  CFRelease(app);
  NSString* issue = !copied ? @"keyboard_receiver_unavailable"
    : sensitiveInputElement(static_cast<AXUIElementRef>(raw)) ? @"sensitive_receiver" : nil;
  if (raw) CFRelease(raw);
  return issue;
}

napi_value rejectInput(napi_env env, NSString* code, NSString* stage = @"preflight") {
  return jsonResult(env, @{ @"deliveryProgress": @"none", @"contentDelivery": @"none",
    @"eventCount": @0, @"pressedInputsReleased": @YES,
    @"failure": @{ @"code": code, @"stage": stage, @"method": @"input", @"mutation": @"none" } });
}

AXUIElementRef copyElementByIdentity(CGWindowID windowId, pid_t pid, CGRect windowBounds, NSDictionary* expected, int* reason);

/** A combobox keeps DOM focus while one of its options is the
 * aria-activedescendant, and Chrome then reports that option as the focused
 * element (a flight-search page's origin box). The expected text
 * receiver, found by its capture path and fingerprint chain, is still the
 * receiver when its own AXOwns list holds the focused element or one of its
 * ancestors: the platform's ownership link, never geometry or a label. */
bool activeDescendantOwnerMatches(CGWindowID windowId, pid_t owner, CGRect windowBounds, AXUIElementRef focused, NSDictionary* expected) {
  if (![expected[@"axPath"] isKindOfClass:[NSArray class]]) return false;
  NSString* focusedRole = axStringAttribute(focused, kAXRoleAttribute) ?: @"";
  NSSet* textRoles = [NSSet setWithArray:@[@"AXTextField", @"AXTextArea", @"AXComboBox", @"AXSearchField"]];
  if ([textRoles containsObject:focusedRole] || sensitiveInputElement(focused)) return false;
  int reason = 0;
  AXUIElementRef field = copyElementByIdentity(windowId, owner, windowBounds, expected, &reason);
  if (!field) return false;
  bool matches = false;
  if ([textRoles containsObject:axStringAttribute(field, kAXRoleAttribute) ?: @""] && !sensitiveInputElement(field)) {
    CFTypeRef rawOwned = nullptr;
    if (AXUIElementCopyAttributeValue(field, CFSTR("AXOwns"), &rawOwned) == kAXErrorSuccess && rawOwned && CFGetTypeID(rawOwned) == CFArrayGetTypeID()) {
      CFArrayRef owned = static_cast<CFArrayRef>(rawOwned);
      const CFIndex count = std::min<CFIndex>(CFArrayGetCount(owned), 8);
      CFTypeRef cursor = CFRetain(focused);
      for (int level = 0; cursor && level < 12 && !matches; level++) {
        for (CFIndex i = 0; i < count && !matches; i++) matches = CFEqual(CFArrayGetValueAtIndex(owned, i), cursor);
        if (matches || CFGetTypeID(cursor) != AXUIElementGetTypeID()) break;
        AXUIElementSetMessagingTimeout(static_cast<AXUIElementRef>(cursor), 0.1f);
        CFTypeRef parent = nullptr;
        AXUIElementCopyAttributeValue(static_cast<AXUIElementRef>(cursor), kAXParentAttribute, &parent);
        CFRelease(cursor);
        cursor = parent && CFGetTypeID(parent) == AXUIElementGetTypeID() ? parent : nullptr;
        if (parent && !cursor) CFRelease(parent);
      }
      if (cursor) CFRelease(cursor);
    }
    if (rawOwned) CFRelease(rawOwned);
  }
  CFRelease(field);
  return matches;
}

/** Recheck the observed receiver before each chunk; never rely on app names. */
bool keyboardReceiverMatches(CGWindowID windowId, CGRect windowBounds, NSDictionary* expected) {
  pid_t owner = 0;
  if (!windowOwner(windowId, &owner)) return false;
  AXUIElementRef app = AXUIElementCreateApplication(owner);
  AXUIElementSetMessagingTimeout(app, 0.25f);
  CFTypeRef raw = nullptr;
  const bool copied = AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute, &raw) == kAXErrorSuccess
    && raw && CFGetTypeID(raw) == AXUIElementGetTypeID();
  CFRelease(app);
  if (!copied) { if (raw) CFRelease(raw); return false; }
  AXUIElementRef receiver = static_cast<AXUIElementRef>(raw);
  AXUIElementSetMessagingTimeout(receiver, 0.25f);
  NSString* role = [expected[@"role"] isKindOfClass:[NSString class]] ? expected[@"role"] : nil;
  NSString* identifier = [expected[@"identifier"] isKindOfClass:[NSString class]] ? expected[@"identifier"] : nil;
  NSString* name = [expected[@"name"] isKindOfClass:[NSString class]] ? expected[@"name"] : nil;
  NSString* actualName = CarveCapturedIdentity(axStringAttribute(receiver, kAXTitleAttribute), 120, 240);
  if (!actualName.length) actualName = CarveCapturedIdentity(axStringAttribute(receiver, kAXDescriptionAttribute), 120, 240);
  bool matches = role && [role isEqualToString:axStringAttribute(receiver, kAXRoleAttribute)]
    && !sensitiveInputElement(receiver);
  if (identifier.length) matches = matches && [identifier isEqualToString:CarveCapturedIdentity(axStringAttribute(receiver, kAXIdentifierAttribute), 160, 160)];
  else if (name.length) matches = matches && [name isEqualToString:actualName];
  NSDictionary* bounds = [expected[@"bounds"] isKindOfClass:[NSDictionary class]] ? expected[@"bounds"] : nil;
  if (matches && bounds) {
    double bx = 0, by = 0, bw = 0, bh = 0;
    matches = number(bounds, @"x", &bx) && number(bounds, @"y", &by) && number(bounds, @"width", &bw) && number(bounds, @"height", &bh);
    CFTypeRef position = nullptr; CFTypeRef size = nullptr;
    CGPoint p{}; CGSize d{};
    const bool geometry = AXUIElementCopyAttributeValue(receiver, kAXPositionAttribute, &position) == kAXErrorSuccess
      && AXUIElementCopyAttributeValue(receiver, kAXSizeAttribute, &size) == kAXErrorSuccess
      && position && size && CFGetTypeID(position) == AXValueGetTypeID() && CFGetTypeID(size) == AXValueGetTypeID()
      && AXValueGetValue(static_cast<AXValueRef>(position), static_cast<AXValueType>(kAXValueCGPointType), &p)
      && AXValueGetValue(static_cast<AXValueRef>(size), static_cast<AXValueType>(kAXValueCGSizeType), &d);
    // A growing composer moves while it receives text: a chat assistant's box widened
    // and rose a full line as the typed reply wrapped, the old and new frames
    // merely touched, and typing stopped mid-answer twice. The
    // focused receiver must still match role and name; its frame may drift by
    // about one line of growth, never to an unrelated part of the window.
    const CGFloat drift = std::max<CGFloat>(24, std::min<CGFloat>(bh, 48));
    if (geometry) matches = matches && CGRectIntersectsRect(CGRectInset(CGRectMake(windowBounds.origin.x + bx, windowBounds.origin.y + by, bw, bh), -drift, -drift), CGRectMake(p.x, p.y, d.width, d.height));
    else matches = false;
    if (position) CFRelease(position);
    if (size) CFRelease(size);
  }
  if (!matches) matches = activeDescendantOwnerMatches(windowId, owner, windowBounds, receiver, expected);
  CFRelease(raw);
  return matches;
}

// Implemented beside the bounded AX surface reader below.
NSDictionary* tableDestinationIdentity(CGWindowID windowId);
bool pasteVerifiedTable(NSDictionary* payload, CGWindowID windowId, int* eventCount);

// A screenshot can include a sheet extending outside its parent. Only a
// currently proven owned front transient can receive such an outside point.
AXUIElementRef copyAXWindowByIdentity(AXUIElementRef application, CGWindowID windowId, CGRect bounds);
AXUIElementRef copyElementByIdentity(CGWindowID windowId, pid_t pid, CGRect windowBounds, NSDictionary* expected, int* reason = nullptr);
bool pointInActiveMenu(CGWindowID windowId, CGRect parent, CGPoint point);
bool pointInSelectedSurface(CGWindowID windowId, CGRect parent, CGPoint point) {
  if (CGRectContainsPoint(parent, point) || pointInActiveMenu(windowId, parent, point)) return true;
  pid_t pid = 0;
  if (!windowOwner(windowId, &pid)) return false;
  const auto front = frontNormalWindowOfOwner(pid);
  if (!front.id || front.id == windowId || !CGRectContainsPoint(front.bounds, point)) return false;
  AXUIElementRef application = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(application, 0.15f);
  AXUIElementRef selected = copyTransitionDocument(windowId, pid, parent);
  if (!selected) selected = copyFocusedDocumentWindow(application);
  if (selected && !axWindowMatches(selected, windowId, parent)) { CFRelease(selected); selected = nullptr; }
  if (!selected) selected = copyAXWindowByIdentity(application, windowId, parent);
  CFRelease(application);
  const bool owned = selected && ownsFrontTransient(selected, front, pid, parent, windowId);
  if (selected) CFRelease(selected);
  return owned;
}

napi_value execute(napi_env env, napi_callback_info info) {
  if (!AXIsProcessTrusted()) return rejectInput(env, @"accessibility_not_granted");
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return rejectInput(env, @"invalid_input_request");
  NSDictionary* action = [request[@"action"] isKindOfClass:[NSDictionary class]] ? request[@"action"] : nil;
  NSDictionary* bounds = [request[@"bounds"] isKindOfClass:[NSDictionary class]] ? request[@"bounds"] : nil;
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  if (!action || !bounds || !target) return rejectInput(env, @"input_preflight_rejected");

  double x = 0, y = 0, width = 0, height = 0;
  if (!number(bounds, @"x", &x) || !number(bounds, @"y", &y) || !number(bounds, @"width", &width) || !number(bounds, @"height", &height) || width < 1 || height < 1) {
    return rejectInput(env, @"input_preflight_rejected");
  }
  double rawWindowId = 0;
  if (!number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId) {
    return rejectInput(env, @"input_preflight_rejected");
  }
  const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
  NSString* expectedBundleIdentifier = nil;
  if (!text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
    return rejectInput(env, @"input_preflight_rejected");
  }
  NSDictionary* captured = [action[@"captureBounds"] isKindOfClass:[NSDictionary class]] ? action[@"captureBounds"] : nil;
  if (captured) {
    double cx=0,cy=0,cw=0,ch=0;
    if (!number(captured,@"x",&cx) || !number(captured,@"y",&cy) || !number(captured,@"width",&cw) || !number(captured,@"height",&ch)
        || !approximatelyEqual(x,cx) || !approximatelyEqual(y,cy) || !approximatelyEqual(width,cw) || !approximatelyEqual(height,ch))
      return rejectInput(env, @"capture_surface_changed");
  }
  const WindowFocusResult focus = focusSelectedWindow(windowId, CGRectMake(x, y, width, height), expectedBundleIdentifier);
  if (!focus.verified) {
    return rejectInput(env, @"window_focus_unconfirmed", @"focus");
  }
  // Check the decision frame before delivering any event. A newly opened,
  // dismissed or moved panel ends this batch; it is not an input failure.
  NSArray* capturedSurfaces = [action[@"captureWindows"] isKindOfClass:[NSArray class]] ? action[@"captureWindows"] : nil;
  if (capturedSurfaces) {
    pid_t pid = 0; windowOwner(windowId, &pid);
    const auto visible = visiblePanelBaseline(pid);
    const auto front = frontNormalWindowOfOwner(pid);
    bool valid = capturedSurfaces.count > 0 && capturedSurfaces.count <= 65;
    bool includesFront = false;
    for (NSDictionary* member in capturedSurfaces) {
      double raw = 0, bx = 0, by = 0, bw = 0, bh = 0;
      NSDictionary* bounds = [member isKindOfClass:[NSDictionary class]] ? member[@"bounds"] : nil;
      if (![bounds isKindOfClass:[NSDictionary class]] || !number(member,@"windowId",&raw)
          || raw <= 0 || raw > UINT32_MAX || std::floor(raw) != raw
          || !number(bounds,@"x",&bx) || !number(bounds,@"y",&by)
          || !number(bounds,@"width",&bw) || !number(bounds,@"height",&bh)) { valid = false; break; }
      const auto memberId = static_cast<CGWindowID>(raw);
      WindowDescription live{};
      valid = valid && std::find(visible.begin(),visible.end(),memberId) != visible.end()
        && windowDescription(memberId,&live) && live.ownerPid == pid;
      if ([action[@"point"] isKindOfClass:[NSDictionary class]] || [action[@"endPoint"] isKindOfClass:[NSDictionary class]])
        valid = valid && CGRectEqualToRect(live.bounds,CGRectMake(bx,by,bw,bh));
      includesFront = includesFront || memberId == front.id;
    }
    if (!valid || !includesFront) return jsonResult(env, @{
      @"deliveryProgress": @"none", @"contentDelivery": @"none", @"pressedInputsReleased": @YES, @"eventCount": @0,
      @"failure": @{ @"code": @"capture_surface_changed", @"stage": @"preflight", @"method": @"input", @"mutation": @"none" }
    });
  }
  NSString* kind = nil;
  if (!text(action, @"kind", &kind)) return rejectInput(env, @"invalid_action_kind");
  NSDictionary* receiver = [action[@"inputReceiver"] isKindOfClass:[NSDictionary class]] ? action[@"inputReceiver"] : nil;
  if (receiver && ([kind isEqualToString:@"type"] || [kind isEqualToString:@"keypress"])
      && !keyboardReceiverMatches(windowId, CGRectMake(x, y, width, height), receiver)) {
    return rejectInput(env, @"keyboard_receiver_changed");
  }
  pid_t transitionPid = 0;
  windowOwner(windowId, &transitionPid);
  const auto panelBaseline = visiblePanelBaseline(transitionPid);
  const InputDocumentIdentity inputDocument{copyInputDocument(windowId, transitionPid, CGRectMake(x, y, width, height))};
  int eventCount = 0;
  bool pressedInputsReleased = true;
  bool deliveryComplete = true;
  NSString* verifiedEffect = nil;
  NSDictionary* operationTransaction = nil;

  if ([kind isEqualToString:@"invoke_safe_command"]) {
    NSString* command = nil;
    NSString* filePath = nil;
    NSString* commandFailure = nil;
    bool formatChanged = false;
    bool applied = text(action, @"command", &command);
    if (applied && [command isEqualToString:@"textedit.make_plain_text"]) {
      applied = performSafeApplicationCommand(windowId, expectedBundleIdentifier, command, &formatChanged);
    } else if (applied && [command isEqualToString:@"textedit.save_document"] && text(action, @"filePath", &filePath)) {
      // A .txt transaction owns its file-format precondition. This is
      // idempotent for an already-plain document and prevents TextEdit from
      // raising an ambiguous rich-text extension confirmation after Save.
      applied = performSafeApplicationCommand(windowId, expectedBundleIdentifier, @"textedit.make_plain_text", &formatChanged);
      if (!applied) commandFailure = @"TextEdit could not establish plain-text format before saving the .txt file";
      NSDictionary* authorization = [action[@"operationAuthorization"] isKindOfClass:[NSDictionary class]]
        ? action[@"operationAuthorization"] : nil;
      if (applied && authorization) {
        operationTransaction = performTextEditSaveDocument(
          windowId, expectedBundleIdentifier, filePath, authorization, &eventCount, &commandFailure
        );
        applied = operationTransaction != nil;
      } else if (applied) {
        applied = false;
        commandFailure = @"The native operation authorization is unavailable";
      }
    } else {
      applied = false;
    }
    if (!applied) {
      return fail(env, commandFailure ? commandFailure.UTF8String : "The selected application no longer exposes that safe semantic command");
    }
    if ([command isEqualToString:@"textedit.make_plain_text"]) {
      eventCount = formatChanged ? 1 : 0;
      verifiedEffect = @"text_document.plain_text";
    } else if ([command isEqualToString:@"textedit.save_document"]) {
      if (formatChanged) eventCount += 1;
      if ([operationTransaction[@"status"] isEqualToString:@"completed"]) {
        verifiedEffect = @"text_document.saved_new_file";
      }
    }
  } else if ([kind isEqualToString:@"element_action"] && [action[@"targetIdentity"] isKindOfClass:[NSDictionary class]]
      && [action[@"targetIdentity"][@"axPath"] isKindOfClass:[NSArray class]]) {
    // By identity: the exact observed element, found by its recorded child
    // path and fingerprint chain in this verified window. No point is needed
    // (a 1-px select or a control under an overlay has no usable one); the
    // window identity and focus checks above still apply.
    NSString* requested = nil;
    pid_t ownerPid = 0;
    if (!text(action, @"elementAction", &requested) || !windowOwner(windowId, &ownerPid)
        || !([requested isEqualToString:@"show_menu"] || [requested isEqualToString:@"activate"] || [requested isEqualToString:@"focus"])) {
      return rejectInput(env, @"invalid_element_action");
    }
    int reason = 0;
    AXUIElementRef element = copyElementByIdentity(windowId, ownerPid, CGRectMake(x, y, width, height), action[@"targetIdentity"], &reason);
    if (!element) return jsonResult(env, @{ @"deliveryProgress": @"none", @"contentDelivery": @"none", @"eventCount": @0, @"pressedInputsReleased": @YES,
      @"failure": @{ @"code": @"identity_not_found", @"stage": @"preflight", @"method": @"input", @"mutation": @"none", @"nativeCode": @(reason) } });
    AXUIElementSetMessagingTimeout(element, 0.3f);
    const SemanticOutcome outcome = performSemanticActionWithOutcome(element, requested);
    CFRelease(element);
    if (outcome == SemanticOutcome::refused) return rejectInput(env, @"ax_action_refused");
    eventCount = 1;
    if (outcome == SemanticOutcome::late) {
      armPanelTransition(windowId, transitionPid, inputDocument.value, panelBaseline);
      return jsonResult(env, @{ @"deliveryProgress": @"partial", @"pressedInputsReleased": @YES, @"eventCount": @1,
        @"failure": @{ @"code": @"ax_action_unconfirmed", @"stage": @"transport", @"method": @"input", @"mutation": @"possible" } });
    }
  } else if ([kind isEqualToString:@"move"] || [kind isEqualToString:@"click"] || [kind isEqualToString:@"drag"] || [kind isEqualToString:@"element_action"]) {
    CGEventFlags flags = 0;
    if (!actionModifiers(action, &flags)) return fail(env, "Pointer action modifiers are invalid");
    NSDictionary* point = [action[@"point"] isKindOfClass:[NSDictionary class]] ? action[@"point"] : nil;
    double pointX = 0, pointY = 0;
    if (!point || !number(point, @"x", &pointX) || !number(point, @"y", &pointY) || !pointInSelectedSurface(windowId, CGRectMake(x,y,width,height), CGPointMake(x+pointX,y+pointY))) {
      return fail(env, "Pointer action lies outside the selected window");
    }
    const CGPoint location = CGPointMake(x + pointX, y + pointY);
    if ([kind isEqualToString:@"element_action"]) {
      NSString* requested = nil;
      pid_t ownerPid = 0;
      if (!text(action, @"elementAction", &requested)
          || !windowOwner(windowId, &ownerPid)
          || !performSemanticActionAtPoint(location, ownerPid, requested, [action[@"targetIdentity"] isKindOfClass:[NSDictionary class]] ? action[@"targetIdentity"] : nil, CGRectMake(x, y, width, height))) {
        return fail(env, "The selected element no longer exposes the requested semantic capability");
      }
      eventCount = 1;
    } else if ([kind isEqualToString:@"drag"]) {
      NSDictionary* endPoint = [action[@"endPoint"] isKindOfClass:[NSDictionary class]] ? action[@"endPoint"] : nil;
      double endX = 0, endY = 0;
      if (!endPoint || !number(endPoint, @"x", &endX) || !number(endPoint, @"y", &endY)
          || !pointInSelectedSurface(windowId, CGRectMake(x,y,width,height), CGPointMake(x+endX,y+endY))) {
        return fail(env, "Drag destination lies outside the selected window");
      }
      if (!postMouse(kCGEventMouseMoved, location, flags)) return fail(env, "Could not create pointer movement event");
      eventCount += 1;
      usleep(60'000);
      const GestureDelivery delivery = postDrag(location, CGPointMake(x + endX, y + endY), flags);
      eventCount += delivery.eventCount;
      deliveryComplete = delivery.complete;
      pressedInputsReleased = delivery.released;
    } else {
      if (!postMouse(kCGEventMouseMoved, location, flags)) return fail(env, "Could not create pointer movement event");
      eventCount += 1;
    }
    if ([kind isEqualToString:@"click"]) {
      // Let hover hit-testing settle on the moved-to element before pressing.
      usleep(60'000);
      CGMouseButton button = kCGMouseButtonLeft;
      double rawClickCount = 1;
      if (!actionMouseButton(action, &button)) return fail(env, "Pointer action mouse button is invalid");
      if (action[@"clickCount"] && (!number(action, @"clickCount", &rawClickCount) || (rawClickCount != 1 && rawClickCount != 2))) {
        return fail(env, "Pointer action click count is invalid");
      }
      const GestureDelivery delivery = postClick(location, button, static_cast<int>(rawClickCount), flags);
      eventCount += delivery.eventCount;
      deliveryComplete = delivery.complete;
      pressedInputsReleased = delivery.released;
    }
  } else if ([kind isEqualToString:@"scroll"]) {
    double scrollY = 0, scrollX = 0;
    if (!number(action, @"scrollY", &scrollY) || (action[@"scrollX"] && !number(action, @"scrollX", &scrollX))
        || (std::abs(scrollY) < 1 && std::abs(scrollX) < 1) || std::abs(scrollY) > 100'000 || std::abs(scrollX) > 100'000) {
      return fail(env, "Scroll amount is outside the safe range");
    }
    CGEventFlags flags = 0;
    if (!actionModifiers(action, &flags)) return fail(env, "Scroll action modifiers are invalid");

    // Scroll events are routed to the surface below the pointer. The approval
    // click leaves the pointer over Carve, even after the target application
    // becomes frontmost, so first move the visible virtual pointer well inside
    // the freshly verified window. Carve's model-facing convention is the
    // web convention (positive means down); Quartz wheel values use the
    // opposite sign. Several small line ticks are more reliable than one large
    // pixel event across browsers and trackpad scrolling preferences.
    double localX = width * 0.5, localY = height * 0.5;
    NSDictionary* scrollPoint = [action[@"point"] isKindOfClass:[NSDictionary class]] ? action[@"point"] : nil;
    if (scrollPoint && (!number(scrollPoint, @"x", &localX) || !number(scrollPoint, @"y", &localY)
        || !pointInSelectedSurface(windowId, CGRectMake(x,y,width,height), CGPointMake(x+localX,y+localY)))) {
      return fail(env, "Scroll point lies outside the selected window");
    }
    const CGPoint location = CGPointMake(x + localX, y + localY);
    if (!postMouse(kCGEventMouseMoved, location, flags)) return fail(env, "Could not create pointer movement event");
    eventCount += 1;
    usleep(80'000);
    const double magnitude = std::max(std::abs(scrollY), std::abs(scrollX));
    const int pulses = std::clamp(static_cast<int>(std::ceil(magnitude / 240.0)), 1, 12);
    const int32_t vertical = std::abs(scrollY) < 1 ? 0 : scrollY > 0 ? -6 : 6;
    const int32_t horizontal = std::abs(scrollX) < 1 ? 0 : scrollX > 0 ? -6 : 6;
    CGEventSourceRef source = CGEventSourceCreate(kCGEventSourceStateCombinedSessionState);
    for (int pulse = 0; pulse < pulses; pulse += 1) {
      CGEventRef event = CGEventCreateScrollWheelEvent(source, kCGScrollEventUnitLine, 2, vertical, horizontal);
      if (!event) {
        if (source) CFRelease(source);
        deliveryComplete = false;
        break;
      }
      CGEventSetLocation(event, location);
      CGEventSetFlags(event, flags);
      CGEventPost(kCGHIDEventTap, event);
      eventCount += 1;
      CFRelease(event);
      usleep(30'000);
    }
    if (source) CFRelease(source);
  } else if ([kind isEqualToString:@"type"]) {
    NSString* value = nil;
    const bool table = [action[@"textDelivery"] isEqualToString:@"clipboard_table"];
    const bool unicode = [action[@"textDelivery"] isEqualToString:@"unicode_graphemes"];
    // A code editor auto-closes brackets and quotes and auto-indents typed
    // keys (JSONLint's Monaco turned {"a": 1,} into {"a": 1,}} twelve times,
    // in testing). Its own paste inserts the text literally. The person's
    // clipboard is saved and restored exactly as for multi-line text.
    const bool clipboardText = [action[@"textDelivery"] isEqualToString:@"clipboard_text"];
    // Match the computer-use action protocol's 20K text bound. A large paste
    // is one input: splitting it changes selection semantics in spreadsheets.
    if (!text(action, @"text", &value) || (!table && value.length == 0) || value.length > (table ? 12'000 : (unicode || clipboardText) ? 20'000 : 1'000)) return rejectInput(env, @"invalid_text_request");
    if (!receiver && ![action[@"textDelivery"] isEqualToString:@"accessibility_value"]) {
      NSString* issue = textReceiverIssue(windowId);
      if (issue) return rejectInput(env, issue);
    }
    NSString* delivery = [action[@"textDelivery"] isKindOfClass:[NSString class]] ? action[@"textDelivery"] : @"keycodes";
    bool posted = false;
    if ([delivery isEqualToString:@"clipboard_table"]) {
      NSDictionary* payload = [action[@"tablePayload"] isKindOfClass:[NSDictionary class]] ? action[@"tablePayload"] : nil;
      posted = payload && pasteVerifiedTable(payload, windowId, &eventCount);
    } else if ([delivery isEqualToString:@"accessibility_value"]) {
      NSDictionary* point = [action[@"point"] isKindOfClass:[NSDictionary class]] ? action[@"point"] : nil;
      double pointX = 0, pointY = 0;
      NSNumber* rawReplaceExisting = [action[@"replaceExisting"] isKindOfClass:[NSNumber class]] ? action[@"replaceExisting"] : nil;
      pid_t ownerPid = 0;
      if (!point || !number(point, @"x", &pointX) || !number(point, @"y", &pointY)
          || pointX < 0 || pointY < 0 || pointX > width || pointY > height
          || !rawReplaceExisting || !windowOwner(windowId, &ownerPid)) {
        return rejectInput(env, @"invalid_text_receiver");
      }
      NSDictionary* assignmentFailure = nil;
      posted = setAccessibleTextAtPoint(
        CGPointMake(x + pointX, y + pointY),
        ownerPid,
        value,
        rawReplaceExisting.boolValue,
        &assignmentFailure
      );
      if (!posted) {
        const bool possible = [assignmentFailure[@"mutation"] isEqualToString:@"possible"];
        return jsonResult(env, @{ @"deliveryProgress": possible ? @"partial" : @"none",
          @"contentDelivery": possible ? @"unknown" : @"none", @"eventCount": @0,
          @"pressedInputsReleased": @YES, @"failure": assignmentFailure });
      }
      // AX assignment posts no keyboard events. Exact readback is the proof;
      // eventCount is telemetry, never an inference about mutation.
      eventCount = 0;
    } else if (clipboardText || (unicode && (value.length > 1'000 || [value rangeOfCharacterFromSet:[NSCharacterSet newlineCharacterSet]].location != NSNotFound))) {
      NSDictionary* assignmentFailure = nil;
      posted = pastePlainText(value, windowId, CGRectMake(x, y, width, height), expectedBundleIdentifier, &eventCount, &assignmentFailure);
      if (!posted) {
        const bool possible = [assignmentFailure[@"mutation"] isEqualToString:@"possible"];
        return jsonResult(env, @{ @"deliveryProgress": possible ? @"partial" : @"none",
          @"contentDelivery": possible ? @"unknown" : @"none", @"eventCount": @(eventCount),
          @"pressedInputsReleased": @YES, @"failure": assignmentFailure ?: accessibleTextFailure(@"multiline_delivery_unavailable", @"preflight", false) });
      }
    } else {
      posted = [delivery isEqualToString:@"keycodes"] ? postKeycodeText(value, &eventCount)
        : [delivery isEqualToString:@"unicode_graphemes"] ? postUnicodeGraphemes(value, &eventCount)
        : false;
    }
    if (!posted) deliveryComplete = false;
  } else if ([kind isEqualToString:@"keypress"]) {
    NSString* key = nil;
    CGKeyCode code = 0;
    CGEventFlags flags = 0;
    if (!text(action, @"key", &key) || !safeKey(key, &code, &flags)) return fail(env, "Keypress is not allowed");
    if (!postKey(code, flags)) deliveryComplete = false;
    else eventCount = 2;
  } else {
    return fail(env, "Live input action is not allowed");
  }

  if (deliveryComplete && eventCount > 0) armPanelTransition(windowId, transitionPid, inputDocument.value, panelBaseline);
  NSString* progress = deliveryComplete ? @"complete" : eventCount > 0 ? @"partial" : @"none";
  return jsonResult(env, @{
    @"deliveryProgress": progress,
    @"pressedInputsReleased": @(pressedInputsReleased),
    @"eventCount": @(eventCount),
    @"verifiedEffect": verifiedEffect ?: [NSNull null],
    @"operationTransaction": operationTransaction ?: [NSNull null],
  });
}

/** The application that owns the menu bar right now. The hotkey resolver
 * probes that application's windows first, so the person's frontmost window
 * is found regardless of how many other windows are open or how the helper
 * happens to order its listing. */
napi_value frontmostApplication(napi_env env, napi_callback_info) {
  NSRunningApplication* application = [[NSWorkspace sharedWorkspace] frontmostApplication];
  if (!application) return jsonResult(env, @{ @"bundleIdentifier": [NSNull null], @"pid": @0 });
  return jsonResult(env, @{
    @"bundleIdentifier": application.bundleIdentifier ?: [NSNull null],
    @"pid": @(application.processIdentifier),
  });
}

/* ---------------------------------------------------------------------------
 * Surface tracking for attachments.
 *
 * `surfaceStates` answers, for every attached window at once, whether it is
 * still present, on screen, focused, and which parts of it are not covered by
 * other normal-level windows. It takes one Window Server snapshot per call so
 * the 200 ms overlay tick costs the same with one attachment or twelve. It is
 * advisory presence evidence: it never changes the governed input path.
 *
 * `surfaceIdentity` reads the document a window shows (a browser tab's URL or
 * a file-based document) and returns only a SHA-256 fingerprint plus a short
 * display title. The raw URL or path never leaves this process boundary.
 * ------------------------------------------------------------------------- */

struct SnapshotWindow {
  CGWindowID number;
  pid_t owner;
  int layer;
  CGRect bounds;
  double alpha;
  NSString* name;
};

std::vector<SnapshotWindow> onScreenWindowSnapshot() {
  std::vector<SnapshotWindow> result;
  CFArrayRef descriptions = CGWindowListCopyWindowInfo(
    static_cast<CGWindowListOption>(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements), kCGNullWindowID);
  if (!descriptions) return result;
  for (CFIndex index = 0; index < CFArrayGetCount(descriptions); index += 1) {
    NSDictionary* entry = (__bridge NSDictionary*)CFArrayGetValueAtIndex(descriptions, index);
    NSNumber* number = entry[(id)kCGWindowNumber];
    NSNumber* owner = entry[(id)kCGWindowOwnerPID];
    NSNumber* layer = entry[(id)kCGWindowLayer];
    NSNumber* alpha = entry[(id)kCGWindowAlpha];
    NSDictionary* rawBounds = entry[(id)kCGWindowBounds];
    id name = entry[(id)kCGWindowName];
    CGRect bounds{};
    if (![number isKindOfClass:[NSNumber class]] || ![owner isKindOfClass:[NSNumber class]] || ![layer isKindOfClass:[NSNumber class]]
        || ![rawBounds isKindOfClass:[NSDictionary class]]
        || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)rawBounds, &bounds)) continue;
    result.push_back({
      number.unsignedIntValue,
      static_cast<pid_t>(owner.intValue),
      layer.intValue,
      bounds,
      [alpha isKindOfClass:[NSNumber class]] ? alpha.doubleValue : 1.0,
      [name isKindOfClass:[NSString class]] ? static_cast<NSString*>(name) : nil,
    });
  }
  CFRelease(descriptions);
  return result;
}

bool snapshotWindowCovers(const SnapshotWindow& window) {
  return window.layer == 0 && window.alpha > 0.05 && window.bounds.size.width >= 120 && window.bounds.size.height >= 80;
}

/** The parts of `rect` not covered by `covers`, bounded so a deep stack of
 * windows cannot produce an unbounded clip path. Presence only. */
std::vector<CGRect> subtractRects(CGRect rect, const std::vector<CGRect>& covers) {
  std::vector<CGRect> pieces{ rect };
  for (const CGRect& cover : covers) {
    std::vector<CGRect> next;
    for (const CGRect& piece : pieces) {
      const double left = std::max(CGRectGetMinX(piece), CGRectGetMinX(cover));
      const double top = std::max(CGRectGetMinY(piece), CGRectGetMinY(cover));
      const double right = std::min(CGRectGetMaxX(piece), CGRectGetMaxX(cover));
      const double bottom = std::min(CGRectGetMaxY(piece), CGRectGetMaxY(cover));
      if (right <= left || bottom <= top) { next.push_back(piece); continue; }
      if (top > CGRectGetMinY(piece)) next.push_back(CGRectMake(piece.origin.x, piece.origin.y, piece.size.width, top - CGRectGetMinY(piece)));
      if (bottom < CGRectGetMaxY(piece)) next.push_back(CGRectMake(piece.origin.x, bottom, piece.size.width, CGRectGetMaxY(piece) - bottom));
      if (left > CGRectGetMinX(piece)) next.push_back(CGRectMake(piece.origin.x, top, left - CGRectGetMinX(piece), bottom - top));
      if (right < CGRectGetMaxX(piece)) next.push_back(CGRectMake(right, top, CGRectGetMaxX(piece) - right, bottom - top));
    }
    pieces.clear();
    for (const CGRect& piece : next) if (piece.size.width >= 1 && piece.size.height >= 1) pieces.push_back(piece);
    if (pieces.size() > 24) { pieces.resize(24); return pieces; }
    if (pieces.empty()) return pieces;
  }
  return pieces;
}

NSDictionary* rectDictionary(CGRect rect) {
  return @{ @"x": @(rect.origin.x), @"y": @(rect.origin.y), @"width": @(rect.size.width), @"height": @(rect.size.height) };
}

double combinedInputAgeMs() {
  double inputAge = CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, kCGEventLeftMouseDown);
  for (CGEventType type : { kCGEventRightMouseDown, kCGEventScrollWheel, kCGEventKeyDown }) {
    inputAge = std::min(inputAge, CGEventSourceSecondsSinceLastEventType(kCGEventSourceStateCombinedSessionState, type));
  }
  return inputAge * 1000.0;
}

napi_value surfaceStates(napi_env env, napi_callback_info info) {
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Surface state request is invalid");
  NSArray* targets = [request[@"targets"] isKindOfClass:[NSArray class]] ? request[@"targets"] : nil;
  if (!targets || targets.count > 16) return fail(env, "Surface state request needs up to sixteen window identities");
  const bool trusted = AXIsProcessTrusted();
  const std::vector<SnapshotWindow> snapshot = onScreenWindowSnapshot();

  NSDictionary* frontmost = nil;
  for (const SnapshotWindow& window : snapshot) {
    if (!snapshotWindowCovers(window)) continue;
    NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:window.owner];
    frontmost = @{
      @"windowId": @(window.number),
      @"pid": @(window.owner),
      @"bundleIdentifier": running.bundleIdentifier ?: [NSNull null],
      @"application": running.localizedName ?: [NSNull null],
      @"bounds": rectDictionary(window.bounds),
      @"title": window.name ?: [NSNull null],
    };
    break;
  }

  NSMutableArray* states = [NSMutableArray array];
  NSMutableDictionary<NSNumber*, NSNumber*>* focusByOwner = [NSMutableDictionary dictionary];
  for (id rawTarget in targets) {
    NSDictionary* target = [rawTarget isKindOfClass:[NSDictionary class]] ? rawTarget : nil;
    double rawWindowId = 0;
    NSString* expectedBundleIdentifier = nil;
    NSDictionary* unavailable = @{ @"available": @NO, @"focused": @NO, @"frontmostNormal": @NO, @"onScreen": @NO, @"bounds": [NSNull null], @"title": [NSNull null], @"visible": @[] };
    if (!target || !number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId
        || !text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
      [states addObject:unavailable];
      continue;
    }
    const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
    WindowDescription description{};
    if (!windowDescription(windowId, &description) || description.layer != 0) { [states addObject:unavailable]; continue; }
    NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:description.ownerPid];
    if (!running || !running.bundleIdentifier || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) { [states addObject:unavailable]; continue; }

    size_t position = snapshot.size();
    for (size_t index = 0; index < snapshot.size(); index += 1) if (snapshot[index].number == windowId) { position = index; break; }
    const bool onScreen = position < snapshot.size();
    NSMutableArray* visible = [NSMutableArray array];
    bool frontmostNormal = false;
    bool applicationFrontmost = false;
    bool soleNormal = false;
    if (onScreen) {
      std::vector<CGRect> covers;
      bool firstNormalSeen = false;
      int ownerNormalWindows = 0;
      for (size_t index = 0; index < snapshot.size(); index += 1) {
        const SnapshotWindow& window = snapshot[index];
        if (!snapshotWindowCovers(window)) continue;
        if (!firstNormalSeen) { firstNormalSeen = true; frontmostNormal = window.number == windowId; applicationFrontmost = window.owner == description.ownerPid; }
        if (window.owner == description.ownerPid) ownerNormalWindows += 1;
        if (index < position) covers.push_back(window.bounds);
      }
      soleNormal = ownerNormalWindows == 1;
      for (const CGRect& piece : subtractRects(description.bounds, covers)) [visible addObject:rectDictionary(piece)];
    }
    bool focusedWindowMatches = false;
    bool mainWindowMatches = false;
    NSNumber* ownerFocus = focusByOwner[@(description.ownerPid)];
    if (!ownerFocus) {
      ownerFocus = @(trusted && inputApplicationHasFocus(description.ownerPid));
      focusByOwner[@(description.ownerPid)] = ownerFocus;
    }
    const bool applicationHasFocus = ownerFocus.boolValue;
    if (applicationHasFocus) {
      AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
      if (application) {
        AXUIElementSetMessagingTimeout(application, 0.1f);
        focusedWindowMatches = applicationWindowMatches(application, kAXFocusedWindowAttribute, windowId, description.bounds);
        mainWindowMatches = applicationWindowMatches(application, kAXMainWindowAttribute, windowId, description.bounds);
        CFRelease(application);
      }
    }
    // A floating capsule does not alter normal-window z-order. Even a sole
    // browser window is unfocused while that capsule owns keyboard input.
    const bool focused = steward::acceptsWindowFocusEvidence({ true, applicationHasFocus && applicationFrontmost, focusedWindowMatches, mainWindowMatches, soleNormal && frontmostNormal });
    NSString* title = onScreen ? snapshot[position].name : nil;
    [states addObject:@{
      @"available": @YES,
      @"focused": @(focused),
      @"frontmostNormal": @(frontmostNormal),
      @"onScreen": @(onScreen),
      @"bounds": rectDictionary(description.bounds),
      @"title": title ?: [NSNull null],
      @"visible": visible,
    }];
  }
  return jsonResult(env, @{ @"states": states, @"frontmost": frontmost ?: [NSNull null], @"inputAgeMs": @(combinedInputAgeMs()) });
}

NSString* axURLLikeAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess || !raw) return nil;
  NSString* value = nil;
  if (CFGetTypeID(raw) == CFURLGetTypeID()) value = [(__bridge NSURL*)raw absoluteString];
  else if (CFGetTypeID(raw) == CFStringGetTypeID()) value = [(__bridge NSString*)raw copy];
  CFRelease(raw);
  return value.length > 0 && value.length <= 4000 ? value : nil;
}

AXUIElementRef copyAXWindowByIdentity(AXUIElementRef application, CGWindowID windowId, CGRect bounds) {
  AXUIElementRef selected = copySelectedAXWindow(application, windowId, bounds);
  if (selected) return selected;
  CFTypeRef rawWindows = nullptr;
  if (AXUIElementCopyAttributeValue(application, kAXWindowsAttribute, &rawWindows) != kAXErrorSuccess || !rawWindows || CFGetTypeID(rawWindows) != CFArrayGetTypeID()) {
    if (rawWindows) CFRelease(rawWindows);
    return nullptr;
  }
  CFArrayRef windows = static_cast<CFArrayRef>(rawWindows);
  AXUIElementRef found = nullptr;
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(windows), 40);
  for (CFIndex index = 0; index < count && !found; index += 1) {
    AXUIElementRef window = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(windows, index)));
    if (window && CFGetTypeID(window) == AXUIElementGetTypeID() && axWindowMatches(window, windowId, bounds)) { CFRetain(window); found = window; }
  }
  CFRelease(rawWindows);
  return found;
}

/** One bounded breadth-first walk for the two facts that identify a browser
 * tab: the web area's URL and the position of the selected tab in the tab
 * strip. Browsers nest both a few groups deep; the walk is bounded in depth,
 * breadth, and wall-clock time, and never descends into page content. */
struct SurfaceWalkResult {
  NSString* webURL;
  int tabIndex;
  int tabCount;
};

bool axBoolAttribute(AXUIElementRef element, CFStringRef attribute) {
  CFTypeRef raw = nullptr;
  if (AXUIElementCopyAttributeValue(element, attribute, &raw) != kAXErrorSuccess || !raw) return false;
  bool value = false;
  if (CFGetTypeID(raw) == CFBooleanGetTypeID()) value = CFBooleanGetValue(static_cast<CFBooleanRef>(raw));
  else if (CFGetTypeID(raw) == CFNumberGetTypeID()) { int number = 0; CFNumberGetValue(static_cast<CFNumberRef>(raw), kCFNumberIntType, &number); value = number != 0; }
  CFRelease(raw);
  return value;
}

void readTabGroup(AXUIElementRef group, SurfaceWalkResult* result) {
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(group, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    return;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  int count = 0;
  int selected = -1;
  const CFIndex total = std::min<CFIndex>(CFArrayGetCount(children), 200);
  for (CFIndex index = 0; index < total; index += 1) {
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
    if (!child || CFGetTypeID(child) != AXUIElementGetTypeID()) continue;
    NSString* role = axStringAttribute(child, kAXRoleAttribute);
    NSString* subrole = axStringAttribute(child, kAXSubroleAttribute);
    const bool tabLike = [role isEqualToString:@"AXRadioButton"] || [role isEqualToString:@"AXTab"] || [subrole isEqualToString:@"AXTabButton"];
    if (!tabLike) continue;
    if (selected < 0 && (axBoolAttribute(child, kAXValueAttribute) || axBoolAttribute(child, kAXSelectedAttribute))) selected = count;
    count += 1;
  }
  CFRelease(rawChildren);
  if (count > 0 && selected >= 0) { result->tabIndex = selected; result->tabCount = count; }
}

SurfaceWalkResult walkSurface(AXUIElementRef window, NSDate* deadline) {
  SurfaceWalkResult result{ nil, -1, 0 };
  std::vector<AXUIElementRef> frontier{ window };
  CFRetain(window);
  int visited = 0;
  bool tabGroupSeen = false;
  for (int depth = 0; depth <= 10 && !frontier.empty() && !(result.webURL && tabGroupSeen); depth += 1) {
    std::vector<AXUIElementRef> next;
    for (AXUIElementRef element : frontier) {
      if ((result.webURL && tabGroupSeen) || visited >= 600 || [deadline timeIntervalSinceNow] < 0) break;
      visited += 1;
      NSString* role = axStringAttribute(element, kAXRoleAttribute);
      if ([role isEqualToString:@"AXWebArea"]) {
        if (!result.webURL) result.webURL = axURLLikeAttribute(element, kAXURLAttribute) ?: axURLLikeAttribute(element, kAXDocumentAttribute);
        continue;  // Page content is never walked.
      }
      if ([role isEqualToString:@"AXTabGroup"] && !tabGroupSeen) {
        readTabGroup(element, &result);
        if (result.tabCount > 0) tabGroupSeen = true;
      }
      CFTypeRef rawChildren = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
        CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
        const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 80);
        for (CFIndex index = 0; index < count; index += 1) {
          AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
          if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) { CFRetain(child); next.push_back(child); }
        }
      }
      if (rawChildren) CFRelease(rawChildren);
    }
    for (AXUIElementRef element : frontier) CFRelease(element);
    frontier = next;
  }
  for (AXUIElementRef element : frontier) CFRelease(element);
  return result;
}

/** Identity without payload: scheme, host, and path for the web; the path for
 * a file. Query strings and fragments carry data and are dropped. */
NSDictionary* documentFingerprint(NSString* webURL, NSString* documentURL) {
  for (NSString* candidate in @[ webURL ?: @"", documentURL ?: @"" ]) {
    if (candidate.length == 0) continue;
    NSURL* url = [NSURL URLWithString:candidate];
    if (!url || !url.scheme) continue;
    NSString* scheme = url.scheme.lowercaseString;
    if ([scheme isEqualToString:@"http"] || [scheme isEqualToString:@"https"]) {
      NSString* host = url.host.lowercaseString ?: @"";
      NSString* path = url.path.length > 0 ? url.path : @"/";
      NSNumber* port = url.port;
      const bool defaultPort = !port || ([scheme isEqualToString:@"https"] && port.intValue == 443) || ([scheme isEqualToString:@"http"] && port.intValue == 80);
      NSString* authority = defaultPort ? host : [NSString stringWithFormat:@"%@:%@", host, port];
      NSString* origin = [NSString stringWithFormat:@"%@://%@", scheme, authority];
      return @{ @"kind": @"web", @"fingerprint": sha256Text([NSString stringWithFormat:@"web:%@%@", origin, path]), @"origin": origin };
    }
    if ([scheme isEqualToString:@"file"] && url.path.length > 0) {
      return @{ @"kind": @"file", @"fingerprint": sha256Text([NSString stringWithFormat:@"file:%@", url.path]) };
    }
  }
  return nil;
}

NSString* tableServiceForURL(NSString* raw) {
  NSURLComponents* url = [NSURLComponents componentsWithString:raw ?: @""];
  if (![url.scheme isEqualToString:@"https"] || ![url.host isEqualToString:@"docs.google.com"] || url.port || url.user || url.password) return nil;
  for (NSArray* rule in @[@[@"^/spreadsheets/(?:u/[0-9]+/)?d/[A-Za-z0-9_-]+/edit$", @"google_sheets"],
                           @[@"^/document/(?:u/[0-9]+/)?d/[A-Za-z0-9_-]+/edit$", @"google_docs"]]) {
    NSRegularExpression* pattern = [NSRegularExpression regularExpressionWithPattern:rule[0] options:0 error:nil];
    if ([pattern numberOfMatchesInString:url.path options:0 range:NSMakeRange(0, url.path.length)] == 1) return rule[1];
  }
  return nil;
}

NSDictionary* tableDestinationIdentity(CGWindowID windowId) {
  WindowDescription description{};
  if (!windowDescription(windowId, &description)) return nil;
  AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
  if (!application) return nil;
  AXUIElementSetMessagingTimeout(application, 0.15f);
  AXUIElementRef window = copyAXWindowByIdentity(application, windowId, description.bounds);
  NSString* raw = nil;
  if (window) { raw = walkSurface(window, [NSDate dateWithTimeIntervalSinceNow:0.4]).webURL; CFRelease(window); }
  CFRelease(application);
  NSString* service = tableServiceForURL(raw);
  if (!service) return nil;
  // Include sheet/tab query state; switching sheets invalidates a pending paste.
  return @{ @"service": service, @"fingerprint": sha256Text(raw) };
}

NSString* tableHTMLEscape(NSString* value) {
  return [[[[value stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"]
    stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"]
    stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"]
    stringByReplacingOccurrencesOfString:@"\"" withString:@"&quot;"];
}

bool pasteVerifiedTable(NSDictionary* payload, CGWindowID windowId, int* eventCount) {
  NSArray* rows = [payload[@"cells"] isKindOfClass:[NSArray class]] ? payload[@"cells"] : nil;
  NSString* expected = [payload[@"destinationFingerprint"] isKindOfClass:[NSString class]] ? payload[@"destinationFingerprint"] : nil;
  if (!rows || rows.count == 0 || rows.count > 101 || !expected) return false;
  NSInteger width = [rows[0] isKindOfClass:[NSArray class]] ? [rows[0] count] : 0;
  if (width < 1 || width > 20 || rows.count * width > 200) return false;
  NSMutableString* html = [NSMutableString stringWithString:@"<html><body><table><tbody>"];
  NSMutableArray* plainRows = [NSMutableArray array];
  NSUInteger length = 0;
  for (id rawRow in rows) {
    if (![rawRow isKindOfClass:[NSArray class]] || [rawRow count] != width) return false;
    NSMutableArray* plain = [NSMutableArray array];
    [html appendString:@"<tr>"];
    for (id rawCell in rawRow) {
      if (![rawCell isKindOfClass:[NSString class]] || [rawCell length] > 240) return false;
      NSString* cell = rawCell;
      length += cell.length;
      if (length > 12'000) return false;
      NSData* json = [NSJSONSerialization dataWithJSONObject:@{@"1": @2, @"2": cell} options:0 error:nil];
      NSString* literal = [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding];
      [html appendFormat:@"<td data-sheets-value=\"%@\" style=\"white-space:pre-wrap;mso-number-format:'\\@'\">%@</td>", tableHTMLEscape(literal), tableHTMLEscape(cell)];
      // TSV is a fallback flavor only; quote tabs/newlines/quotes without changing values.
      [plain addObject:[NSString stringWithFormat:@"\"%@\"", [cell stringByReplacingOccurrencesOfString:@"\"" withString:@"\"\""]]];
    }
    [html appendString:@"</tr>"];
    [plainRows addObject:[plain componentsJoinedByString:@"\t"]];
  }
  [html appendString:@"</tbody></table></body></html>"];
  NSDictionary* destination = tableDestinationIdentity(windowId);
  if (!destination || ![destination[@"fingerprint"] isEqualToString:expected]) return false;
  NSPasteboard* board = [NSPasteboard generalPasteboard];
  // Retain all clipboard flavors locally and restore only if still ours.
  NSMutableArray* saved = [NSMutableArray array];
  for (NSPasteboardItem* item in board.pasteboardItems) {
    NSPasteboardItem* copy = [[NSPasteboardItem alloc] init];
    for (NSPasteboardType type in item.types) { NSData* data = [item dataForType:type]; if (data) [copy setData:data forType:type]; }
    [saved addObject:copy];
  }
  [board clearContents];
  NSPasteboardItem* item = [[NSPasteboardItem alloc] init];
  [item setString:html forType:NSPasteboardTypeHTML];
  [item setString:[plainRows componentsJoinedByString:@"\n"] forType:NSPasteboardTypeString];
  if (![board writeObjects:@[item]]) { [board clearContents]; if (saved.count) [board writeObjects:saved]; return false; }
  const NSInteger ownChange = board.changeCount;
  *eventCount += 2; // Conservative if acknowledgement is lost after key-down.
  const bool posted = postKey(9, kCGEventFlagMaskCommand); // Command-V, once.
  // This acknowledges delivery only. The controller's destination verifier
  // must inspect table shape and values; native input never declares success.
  usleep(350'000);
  if (board.changeCount == ownChange) { [board clearContents]; if (saved.count) [board writeObjects:saved]; }
  return posted;
}

napi_value surfaceIdentity(napi_env env, napi_callback_info info) {
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Surface identity request is invalid");
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  double rawWindowId = 0;
  NSString* expectedBundleIdentifier = nil;
  if (!target || !number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId
      || !text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
    return fail(env, "Selected-window identity is invalid");
  }
  const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
  WindowDescription description{};
  if (!windowDescription(windowId, &description) || description.layer != 0) return jsonResult(env, @{ @"available": @NO });
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:description.ownerPid];
  if (!running || !running.bundleIdentifier || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) return jsonResult(env, @{ @"available": @NO });

  NSString* title = nil;
  for (const SnapshotWindow& window : onScreenWindowSnapshot()) if (window.number == windowId) { title = window.name; break; }
  NSString* webURL = nil;
  NSString* documentURL = nil;
  int tabIndex = -1;
  int tabCount = 0;
  bool accessibilityRead = false;
  if (AXIsProcessTrusted()) {
    AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
    if (application) {
      AXUIElementSetMessagingTimeout(application, 0.15f);
      AXUIElementRef window = copyAXWindowByIdentity(application, windowId, description.bounds);
      if (window) {
        accessibilityRead = true;
        AXUIElementSetMessagingTimeout(window, 0.15f);
        if (!title || title.length == 0) title = axStringAttribute(window, kAXTitleAttribute);
        documentURL = axURLLikeAttribute(window, kAXDocumentAttribute);
        const SurfaceWalkResult walked = walkSurface(window, [NSDate dateWithTimeIntervalSinceNow:0.4]);
        webURL = walked.webURL;
        tabIndex = walked.tabIndex;
        tabCount = walked.tabCount;
        CFRelease(window);
      }
      CFRelease(application);
    }
  }
  NSDictionary* fingerprint = documentFingerprint(webURL, documentURL);
  NSString* displayTitle = title.length > 120 ? [title substringToIndex:120] : (title ?: @"");
  return jsonResult(env, @{
    @"available": @YES,
    @"accessibilityRead": @(accessibilityRead),
    @"kind": fingerprint ? fingerprint[@"kind"] : @"titled",
    @"fingerprint": fingerprint ? fingerprint[@"fingerprint"] : @"",
    @"displayTitle": displayTitle,
    @"tab": tabCount > 0 && tabIndex >= 0 ? @{ @"index": @(tabIndex), @"count": @(tabCount) } : [NSNull null],
    @"tableService": tableServiceForURL(webURL) ?: [NSNull null],
    @"tableFingerprint": tableServiceForURL(webURL) ? sha256Text(webURL) : [NSNull null],
    // The origin and classified capability. The document path is disclosed
    // only for a local file, and only to the controller in this process, which
    // reads the saved file back to prove a write; it never reaches a model.
    @"origin": fingerprint && fingerprint[@"origin"] ? fingerprint[@"origin"] : [NSNull null],
    @"documentPath": (documentURL && [documentURL hasPrefix:@"file://"] && [NSURL URLWithString:documentURL].path.length > 0) ? [NSURL URLWithString:documentURL].path : [NSNull null],
  });
}

/* ---------------------------------------------------------------------------
 * Hit test for actionability. Reports which element would receive a click at
 * a window-relative point, whether that is the intended target (or one of
 * its descendants), and the nearest dialog-like surface in front of it. It
 * also samples the hit element's frame twice so a control that is still
 * moving is reported as unstable. Advisory only: the governed input path
 * verifies focus and identity again before posting anything.
 * ------------------------------------------------------------------------- */

bool axElementFrame(AXUIElementRef element, CGRect* frame) {
  CFTypeRef rawPosition = nullptr;
  CFTypeRef rawSize = nullptr;
  CGPoint position{};
  CGSize size{};
  const bool hasPosition = AXUIElementCopyAttributeValue(element, kAXPositionAttribute, &rawPosition) == kAXErrorSuccess
    && rawPosition && CFGetTypeID(rawPosition) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawPosition), static_cast<AXValueType>(kAXValueCGPointType), &position);
  const bool hasSize = AXUIElementCopyAttributeValue(element, kAXSizeAttribute, &rawSize) == kAXErrorSuccess
    && rawSize && CFGetTypeID(rawSize) == AXValueGetTypeID()
    && AXValueGetValue(static_cast<AXValueRef>(rawSize), static_cast<AXValueType>(kAXValueCGSizeType), &size);
  if (rawPosition) CFRelease(rawPosition);
  if (rawSize) CFRelease(rawSize);
  if (!hasPosition || !hasSize) return false;
  *frame = CGRectMake(position.x, position.y, size.width, size.height);
  return true;
}

NSDictionary* hitElementDescription(AXUIElementRef element, CGRect windowBounds) {
  NSString* role = axStringAttribute(element, kAXRoleAttribute) ?: @"";
  NSString* subrole = axStringAttribute(element, kAXSubroleAttribute);
  NSString* name = axStringAttribute(element, kAXTitleAttribute);
  if (!name || name.length == 0) name = axStringAttribute(element, kAXDescriptionAttribute) ?: @"";
  if (name.length > 120) name = [name substringToIndex:120];
  CGRect frame{};
  NSDictionary* bounds = axElementFrame(element, &frame)
    ? @{ @"x": @(frame.origin.x - windowBounds.origin.x), @"y": @(frame.origin.y - windowBounds.origin.y), @"width": @(frame.size.width), @"height": @(frame.size.height) }
    : nil;
  return @{ @"role": role, @"subrole": subrole ?: [NSNull null], @"name": name, @"bounds": bounds ?: [NSNull null] };
}

bool axElementIsDialogLike(AXUIElementRef element) {
  NSString* role = axStringAttribute(element, kAXRoleAttribute);
  NSString* subrole = axStringAttribute(element, kAXSubroleAttribute);
  if ([role isEqualToString:@"AXSheet"]) return true;
  if ([subrole isEqualToString:@"AXDialog"] || [subrole isEqualToString:@"AXApplicationDialog"] || [subrole isEqualToString:@"AXSystemDialog"]) return true;
  return axBoolAttribute(element, CFSTR("AXModal"));
}

// Reproduce the capture helper's identity only for unnamed controls, which
// cannot bind through an AX identifier or label. Never substitute geometry
// alone for identity. The root and sibling path must still match the capture.
/** One node's part of the capture helper's identity chain: role, identifier
 * and label as the helper bounds them (blanked for a sensitive control), plus
 * its sibling index. The helper hashes [parent, role, identifier, name,
 * sibling] from "window" down; both directions below reproduce it. */
NSString* capturedIdentityPrefix(NSString* value, NSUInteger limit) {
  if (!value || [[value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] length] == 0) return @"";
  __block NSUInteger count = 0, end = 0;
  [value enumerateSubstringsInRange:NSMakeRange(0, value.length) options:NSStringEnumerationByComposedCharacterSequences
    usingBlock:^(__unused NSString* part, NSRange range, __unused NSRange enclosing, BOOL* stop) {
      end = NSMaxRange(range); if (++count >= limit) *stop = YES;
    }];
  return [value substringToIndex:end];
}

NSArray<NSString*>* capturedIdentityPart(AXUIElementRef node, NSString* sibling, NSString** roleOut = nullptr) {
  NSString* role = capturedIdentityPrefix(axStringAttribute(node, kAXRoleAttribute), 80);
  NSString* name = capturedIdentityPrefix(axStringAttribute(node, kAXTitleAttribute), 120);
  if (!name.length) name = capturedIdentityPrefix(axStringAttribute(node, kAXDescriptionAttribute), 120);
  NSString* identifier = capturedIdentityPrefix(axStringAttribute(node, kAXIdentifierAttribute), 160);
  NSString* placeholder = capturedIdentityPrefix(axStringAttribute(node, kAXPlaceholderValueAttribute), 160);
  NSString* combined = [NSString stringWithFormat:@"%@ %@ %@", name, placeholder, identifier];
  bool sensitive = CarveControlIsSensitive(role.UTF8String, axStringAttribute(node, kAXSubroleAttribute).UTF8String, combined.UTF8String);
  if (roleOut) *roleOut = role;
  return @[role, sensitive ? @"" : identifier, sensitive ? @"" : name, sibling];
}

NSString* chainedIdentity(NSString* parent, NSArray<NSString*>* part) {
  NSData* data = [NSJSONSerialization dataWithJSONObject:@[parent, part[0], part[1], part[2], part[3]] options:0 error:nil];
  return data ? sha256Data(data) : nil;
}

NSString* capturedElementFingerprint(AXUIElementRef element, CGRect windowBounds) {
  NSMutableArray<NSArray<NSString*>*>* path = [NSMutableArray array];
  AXUIElementRef cursor = element;
  CFRetain(cursor);
  bool foundRoot = false;
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.2;
  for (int depth = 0; depth <= 40 && cursor && CFAbsoluteTimeGetCurrent() < deadline; depth++) {
    AXUIElementSetMessagingTimeout(cursor, 0.05f);
    NSString* role = nil;
    NSArray<NSString*>* rootPart = capturedIdentityPart(cursor, @"0", &role);
    CGRect frame{};
    if ([role isEqualToString:@"AXWindow"] && axElementFrame(cursor, &frame) && CGRectEqualToRect(frame, windowBounds)) {
      [path addObject:rootPart];
      foundRoot = true;
      break;
    }
    CFTypeRef rawParent = nullptr, rawChildren = nullptr;
    if (AXUIElementCopyAttributeValue(cursor, kAXParentAttribute, &rawParent) != kAXErrorSuccess
        || !rawParent || CFGetTypeID(rawParent) != AXUIElementGetTypeID()) { if (rawParent) CFRelease(rawParent); break; }
    AXUIElementRef parent = static_cast<AXUIElementRef>(rawParent);
    // Chromium's AXParent chain can include an ignored scroll wrapper that
    // AXChildren flattens away. Follow the same exposed child path as capture,
    // and skip a wrapper only when its parent directly lists this very node.
    for (int skipped = 0; skipped < 4; skipped++) {
      AXUIElementSetMessagingTimeout(parent, 0.05f);
      CFTypeRef rawGrandparent = nullptr, rawSiblings = nullptr;
      if (AXUIElementCopyAttributeValue(parent, kAXParentAttribute, &rawGrandparent) != kAXErrorSuccess
          || !rawGrandparent || CFGetTypeID(rawGrandparent) != AXUIElementGetTypeID()) { if (rawGrandparent) CFRelease(rawGrandparent); break; }
      AXUIElementRef grandparent = static_cast<AXUIElementRef>(rawGrandparent);
      AXUIElementSetMessagingTimeout(grandparent, 0.05f);
      bool listsParent = false, listsCursor = false;
      if (AXUIElementCopyAttributeValue(grandparent, kAXChildrenAttribute, &rawSiblings) == kAXErrorSuccess
          && rawSiblings && CFGetTypeID(rawSiblings) == CFArrayGetTypeID()) {
        CFArrayRef siblings = static_cast<CFArrayRef>(rawSiblings);
        for (CFIndex index = 0; index < std::min<CFIndex>(400, CFArrayGetCount(siblings)); index++) {
          listsParent |= CFEqual(CFArrayGetValueAtIndex(siblings, index), parent);
          listsCursor |= CFEqual(CFArrayGetValueAtIndex(siblings, index), cursor);
        }
      }
      if (rawSiblings) CFRelease(rawSiblings);
      if (listsParent || !listsCursor) { CFRelease(grandparent); break; }
      CFRelease(parent);
      parent = grandparent;
    }
    AXUIElementSetMessagingTimeout(parent, 0.05f);
    CFIndex sibling = -1;
    if (AXUIElementCopyAttributeValue(parent, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess
        && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
      CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
      for (CFIndex index = 0; index < std::min<CFIndex>(400, CFArrayGetCount(children)); index++) {
        if (CFEqual(CFArrayGetValueAtIndex(children, index), cursor)) { sibling = index; break; }
      }
    }
    if (rawChildren) CFRelease(rawChildren);
    if (sibling < 0) { CFRelease(parent); break; }
    [path addObject:@[rootPart[0], rootPart[1], rootPart[2], [@(sibling) stringValue]]];
    CFRelease(cursor);
    cursor = parent;
  }
  if (cursor) CFRelease(cursor);
  if (!foundRoot) return nil;
  NSString* fingerprint = @"window";
  for (NSArray<NSString*>* part in path.reverseObjectEnumerator) {
    fingerprint = chainedIdentity(fingerprint, part);
    if (!fingerprint) return nil;
  }
  return fingerprint;
}

/* The capture helper bounds a label to its first 120 characters and the
 * controller then trims it. A long label whose 120th character is a space
 * (image alt text on a card link) therefore reaches the
 * expectation one character shorter than a raw 120-unit prefix, and the link
 * never matched itself: its own image read as an obstruction. Compare the
 * same normalized form on both sides: composed-character prefix, then trim. */
NSString* expectationComparableText(NSString* value, NSUInteger limit) {
  if (!value) return @"";
  __block NSUInteger count = 0, end = 0;
  [value enumerateSubstringsInRange:NSMakeRange(0, value.length) options:NSStringEnumerationByComposedCharacterSequences | NSStringEnumerationSubstringNotRequired
    usingBlock:^(__unused NSString* part, NSRange range, __unused NSRange enclosing, BOOL* stop) {
      end = NSMaxRange(range); if (++count >= limit) *stop = YES;
    }];
  return [[value substringToIndex:end] stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
}

bool axElementMatchesExpectation(AXUIElementRef element, NSDictionary* expected, CGRect windowBounds) {
  if (!expected) return false;
  NSString* role = axStringAttribute(element, kAXRoleAttribute) ?: @"";
  NSString* expectedRole = nil;
  if (!text(expected, @"role", &expectedRole) || ![role isEqualToString:expectedRole]) return false;
  NSString* name = axStringAttribute(element, kAXTitleAttribute);
  if (!name || [name stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet].length == 0) name = axStringAttribute(element, kAXDescriptionAttribute) ?: @"";
  name = expectationComparableText(name, 120);
  NSString* identifier = axStringAttribute(element, kAXIdentifierAttribute);
  if (identifier.length > 160) identifier = [identifier substringToIndex:160];
  NSString* expectedName = nil;
  NSString* expectedIdentifier = nil;
  text(expected, @"name", &expectedName);
  text(expected, @"identifier", &expectedIdentifier);
  expectedName = expectationComparableText(expectedName, 120);
  NSString* expectedFingerprint = nil;
  text(expected, @"fingerprint", &expectedFingerprint);
  const bool identityMatches = expectedIdentifier.length > 0
    ? identifier && [identifier isEqualToString:expectedIdentifier]
    : expectedName.length > 0 ? [name isEqualToString:expectedName]
      : expectedFingerprint.length == 64 && name.length == 0 && identifier.length == 0
        && [capturedElementFingerprint(element, windowBounds) isEqualToString:expectedFingerprint];
  if (!identityMatches) return false;
  NSDictionary* expectedBounds = [expected[@"bounds"] isKindOfClass:[NSDictionary class]] ? expected[@"bounds"] : nil;
  if (!expectedBounds) return true;
  double x = 0, y = 0, width = 0, height = 0;
  if (!number(expectedBounds, @"x", &x) || !number(expectedBounds, @"y", &y) || !number(expectedBounds, @"width", &width) || !number(expectedBounds, @"height", &height)) return true;
  CGRect frame{};
  if (!axElementFrame(element, &frame)) return true;
  const CGRect relative = CGRectMake(frame.origin.x - windowBounds.origin.x, frame.origin.y - windowBounds.origin.y, frame.size.width, frame.size.height);
  return CGRectIntersectsRect(relative, CGRectMake(x - 4, y - 4, width + 8, height + 8));
}

/** The element the capture helper observed at `expected.axPath`: start from
 * the selected AX window, descend kAXChildren by the recorded sibling
 * indices, recompute the helper's fingerprint chain on the way, and accept
 * only when the final hash equals the expected fingerprint and the ordinary
 * expectation (role, label or identifier, bounds) still holds. Any break is
 * "not found": never a geometric fallback. v1 supports the window root only. */
/** Why an identity lookup failed, reported as the failure's nativeCode:
 * 1 request, 2 window, 3 path broken, 4 fingerprint chain differs,
 * 5 role/label/bounds expectation differs, 6 another process. */
AXUIElementRef copyElementByIdentity(CGWindowID windowId, pid_t pid, CGRect windowBounds, NSDictionary* expected, int* reason) {
  int ignored = 0;
  int& why = reason ? *reason : ignored;
  why = 1;
  if (!expected) return nullptr;
  NSArray* path = [expected[@"axPath"] isKindOfClass:[NSArray class]] ? expected[@"axPath"] : nil;
  NSString* root = [expected[@"axRoot"] isKindOfClass:[NSString class]] ? expected[@"axRoot"] : @"window";
  NSString* expectedFingerprint = nil;
  if (!path || path.count > 64 || ![root isEqualToString:@"window"] || !text(expected, @"fingerprint", &expectedFingerprint) || expectedFingerprint.length != 64) return nullptr;
  for (id index in path) {
    if (![index isKindOfClass:[NSNumber class]] || [index doubleValue] < 0 || [index doubleValue] >= 400 || std::floor([index doubleValue]) != [index doubleValue]) return nullptr;
  }
  AXUIElementRef application = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(application, 0.15f);
  AXUIElementRef cursor = copyAXWindowByIdentity(application, windowId, windowBounds);
  CFRelease(application);
  why = 2;
  if (!cursor) return nullptr;
  why = 3;
  AXUIElementSetMessagingTimeout(cursor, 0.15f);
  NSString* fingerprint = chainedIdentity(@"window", capturedIdentityPart(cursor, @"0"));
  const CFAbsoluteTime deadline = CFAbsoluteTimeGetCurrent() + 0.6;
  for (NSNumber* raw in path) {
    if (!fingerprint || CFAbsoluteTimeGetCurrent() > deadline) { CFRelease(cursor); return nullptr; }
    const CFIndex index = static_cast<CFIndex>(raw.integerValue);
    CFTypeRef rawChildren = nullptr;
    AXUIElementRef child = nullptr;
    if (AXUIElementCopyAttributeValue(cursor, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess
        && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID() && index < CFArrayGetCount(static_cast<CFArrayRef>(rawChildren))) {
      const void* value = CFArrayGetValueAtIndex(static_cast<CFArrayRef>(rawChildren), index);
      if (value && CFGetTypeID(value) == AXUIElementGetTypeID()) {
        child = static_cast<AXUIElementRef>(const_cast<void*>(value));
        CFRetain(child);
      }
    }
    if (rawChildren) CFRelease(rawChildren);
    CFRelease(cursor);
    if (!child) return nullptr;
    cursor = child;
    AXUIElementSetMessagingTimeout(cursor, 0.15f);
    fingerprint = chainedIdentity(fingerprint, capturedIdentityPart(cursor, [raw stringValue]));
  }
  if (!fingerprint || ![fingerprint isEqualToString:expectedFingerprint]) { why = 4; CFRelease(cursor); return nullptr; }
  if (!axElementMatchesExpectation(cursor, expected, windowBounds)) { why = 5; CFRelease(cursor); return nullptr; }
  pid_t owner = 0;
  if (AXUIElementGetPid(cursor, &owner) != kAXErrorSuccess || owner != pid) { why = 6; CFRelease(cursor); return nullptr; }
  why = 0;
  return cursor;
}

// Depth-first search, a few levels down, for the expected element: whether an
// ancestor of a hit also holds the target in its own subtree. Bounded by depth
// and node count so a miss costs a handful of AX messages.
static bool axSubtreeHoldsExpectation(AXUIElementRef element, NSDictionary* expected, CGRect windowBounds, int depth, int maxDepth, int* visited, int maxVisited, int* foundDepth) {
  if (depth > maxDepth || *visited >= maxVisited) return false;
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess || !rawChildren) return false;
  if (CFGetTypeID(rawChildren) != CFArrayGetTypeID()) { CFRelease(rawChildren); return false; }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  const CFIndex count = CFArrayGetCount(children);
  bool found = false;
  for (CFIndex index = 0; index < count && !found && *visited < maxVisited; index += 1) {
    const void* raw = CFArrayGetValueAtIndex(children, index);
    if (!raw || CFGetTypeID(raw) != AXUIElementGetTypeID()) continue;
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(raw));
    AXUIElementSetMessagingTimeout(child, 0.15f);
    *visited += 1;
    if (axElementMatchesExpectation(child, expected, windowBounds)) { *foundDepth = depth; found = true; break; }
    found = axSubtreeHoldsExpectation(child, expected, windowBounds, depth + 1, maxDepth, visited, maxVisited, foundDepth);
  }
  CFRelease(rawChildren);
  return found;
}

napi_value hitTest(napi_env env, napi_callback_info info) {
  if (!AXIsProcessTrusted()) return jsonResult(env, @{ @"available": @NO });
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Hit test request is invalid");
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  NSDictionary* point = [request[@"point"] isKindOfClass:[NSDictionary class]] ? request[@"point"] : nil;
  NSDictionary* expected = [request[@"expected"] isKindOfClass:[NSDictionary class]] ? request[@"expected"] : nil;
  double rawWindowId = 0, pointX = 0, pointY = 0;
  NSString* expectedBundleIdentifier = nil;
  if (!target || !point || !number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId
      || !text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240
      || !number(point, @"x", &pointX) || !number(point, @"y", &pointY)) {
    return fail(env, "Hit test needs a selected-window identity and a window-relative point");
  }
  const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
  WindowDescription description{};
  if (!windowDescription(windowId, &description) || description.layer != 0) return jsonResult(env, @{ @"available": @NO });
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:description.ownerPid];
  if (!running || !running.bundleIdentifier || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) return jsonResult(env, @{ @"available": @NO });
  if (pointX < 0 || pointY < 0 || pointX > description.bounds.size.width || pointY > description.bounds.size.height) {
    return jsonResult(env, @{ @"available": @YES, @"relation": @"none", @"hit": [NSNull null], @"obstruction": [NSNull null], @"stable": @NO });
  }
  AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
  if (!application) return jsonResult(env, @{ @"available": @NO });
  AXUIElementSetMessagingTimeout(application, 0.15f);
  AXUIElementRef hit = nullptr;
  const float screenX = static_cast<float>(description.bounds.origin.x + pointX);
  const float screenY = static_cast<float>(description.bounds.origin.y + pointY);
  const AXError hitError = AXUIElementCopyElementAtPosition(application, screenX, screenY, &hit);
  if (hitError != kAXErrorSuccess || !hit) {
    CFRelease(application);
    return jsonResult(env, @{ @"available": @YES, @"relation": @"none", @"hit": [NSNull null], @"obstruction": [NSNull null], @"stable": @NO });
  }
  AXUIElementSetMessagingTimeout(hit, 0.15f);
  // Chromium answers a position query from its cached tree first and only
  // then runs the renderer's hit test, so the first answer can name the
  // image under a just-opened overlay (fixture: the first query
  // returned the covered image, the next ones the "Newsletter" overlay). Ask
  // again; when the answers disagree, ask a third time and use it, and call
  // the result stable only when the last two agree.
  bool hitAgrees = true;
  for (int requery = 0; requery < 2; requery += 1) {
    usleep(requery == 0 ? 20'000 : 50'000);
    AXUIElementRef again = nullptr;
    if (AXUIElementCopyElementAtPosition(application, screenX, screenY, &again) != kAXErrorSuccess || !again) { hitAgrees = false; break; }
    AXUIElementSetMessagingTimeout(again, 0.15f);
    hitAgrees = CFEqual(again, hit);
    CFRelease(hit);
    hit = again;
    if (hitAgrees) break;
  }
  NSString* relation = @"other";
  NSDictionary* obstruction = nil;
  AXUIElementRef cursor = hit;
  CFRetain(cursor);
  for (int level = 0; level < 16 && cursor; level += 1) {
    if (axElementMatchesExpectation(cursor, expected, description.bounds)) { relation = level == 0 ? @"target" : @"descendant"; break; }
    if (!obstruction && axElementIsDialogLike(cursor)) obstruction = hitElementDescription(cursor, description.bounds);
    CFTypeRef rawParent = nullptr;
    AXUIElementRef parent = nullptr;
    if (AXUIElementCopyAttributeValue(cursor, kAXParentAttribute, &rawParent) == kAXErrorSuccess && rawParent && CFGetTypeID(rawParent) == AXUIElementGetTypeID()) {
      parent = static_cast<AXUIElementRef>(const_cast<void*>(rawParent));
    } else if (rawParent) CFRelease(rawParent);
    CFRelease(cursor);
    cursor = parent;
  }
  if (cursor) CFRelease(cursor);
  // The click reaches the target: whatever dialog encloses both is not in the way.
  if ([relation isEqualToString:@"target"] || [relation isEqualToString:@"descendant"]) obstruction = nil;
  // Same-widget evidence: an editor paints its text on a layer beside a hidden
  // input receiver (Monaco view-lines beside its edit context, Ace, CodeMirror
  // 5; JSONLint, refused 3/3). Look a few levels up from the hit
  // for a non-dialog ancestor whose own subtree, a few levels down, holds the
  // expected element. Evidence only: the controller decides. 3 up, 3 down, 48 nodes.
  NSDictionary* shared = nil;
  if ([relation isEqualToString:@"other"] && !obstruction && expected) {
    AXUIElementRef ancestor = hit;
    CFRetain(ancestor);
    for (int up = 1; up <= 3 && ancestor && !shared; up += 1) {
      CFTypeRef rawParent = nullptr;
      AXUIElementRef parent = nullptr;
      if (AXUIElementCopyAttributeValue(ancestor, kAXParentAttribute, &rawParent) == kAXErrorSuccess && rawParent && CFGetTypeID(rawParent) == AXUIElementGetTypeID()) {
        parent = static_cast<AXUIElementRef>(const_cast<void*>(rawParent));
      } else if (rawParent) CFRelease(rawParent);
      CFRelease(ancestor);
      ancestor = parent;
      if (!ancestor) break;
      AXUIElementSetMessagingTimeout(ancestor, 0.15f);
      if (axElementIsDialogLike(ancestor)) break;
      CFTypeRef rawRole = nullptr;
      NSString* role = @"";
      if (AXUIElementCopyAttributeValue(ancestor, kAXRoleAttribute, &rawRole) == kAXErrorSuccess && rawRole && CFGetTypeID(rawRole) == CFStringGetTypeID()) role = [(__bridge NSString*)rawRole copy];
      if (rawRole) CFRelease(rawRole);
      if ([role isEqualToString:@"AXWebArea"] || [role isEqualToString:@"AXWindow"] || [role isEqualToString:@"AXApplication"]) break;
      int visited = 0, down = 0;
      if (axSubtreeHoldsExpectation(ancestor, expected, description.bounds, 1, 3, &visited, 48, &down)) {
        NSMutableDictionary* found = [hitElementDescription(ancestor, description.bounds) mutableCopy];
        found[@"levelsAboveHit"] = @(up);
        found[@"levelsAboveTarget"] = @(down);
        shared = found;
      }
    }
    if (ancestor) CFRelease(ancestor);
  }
  CGRect first{}, second{};
  const bool hasFirst = axElementFrame(hit, &first);
  usleep(33'000);
  const bool hasSecond = axElementFrame(hit, &second);
  const bool stable = hitAgrees && hasFirst && hasSecond && CGRectEqualToRect(first, second);
  NSDictionary* hitDescription = hitElementDescription(hit, description.bounds);
  CFRelease(hit);
  CFRelease(application);
  return jsonResult(env, @{
    @"available": @YES,
    @"relation": relation,
    @"hit": hitDescription,
    @"obstruction": obstruction ?: [NSNull null],
    @"shared": shared ?: [NSNull null],
    @"stable": @(stable),
  });
}

// Native menus are application-scoped: AppKit may publish no AXParent or
// AXWindow for them. Admit only actual AXMenu surfaces while the exact selected
// document is frontmost AND AX focused. Same-process floating windows are not
// menus. Both capture and outside-parent input use this fresh, bounded proof.
std::vector<SnapshotWindow> activeMenus(CGWindowID windowId, CGRect parent, pid_t pid) {
  std::vector<SnapshotWindow> menus;
  const auto snapshot = onScreenWindowSnapshot();
  std::vector<SnapshotWindow> candidates;
  for (const auto& window : snapshot) if (window.owner == pid && window.layer > 0 && window.alpha > 0
      && window.bounds.size.width > 0 && window.bounds.size.height > 0) candidates.push_back(window);
  if (candidates.empty() || candidates.size() > 8 || snapshot.size() > 4096) return menus;
  const auto front = frontNormalWindowOfOwner(pid);
  if (front.id != windowId || !front.uniqueBounds || !overlayTargetIsFrontmostNormal(windowId)) return menus;
  AXUIElementRef app = AXUIElementCreateApplication(pid);
  AXUIElementSetMessagingTimeout(app, 0.1f);
  CFTypeRef focused = nullptr;
  CFTypeRef frontmost = nullptr;
  const bool selected = AXUIElementCopyAttributeValue(app, kAXFrontmostAttribute, &frontmost) == kAXErrorSuccess
    && frontmost && CFEqual(frontmost, kCFBooleanTrue)
    && AXUIElementCopyAttributeValue(app, kAXFocusedWindowAttribute, &focused) == kAXErrorSuccess
    && focused && CFGetTypeID(focused) == AXUIElementGetTypeID()
    && axWindowMatches(static_cast<AXUIElementRef>(focused), windowId, parent);
  if (focused) CFRelease(focused);
  if (frontmost) CFRelease(frontmost);
  const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(300);
  if (selected) for (const auto& candidate : candidates) {
    if (std::chrono::steady_clock::now() >= deadline) break;
    // AX frames identify a Window Server surface only when unambiguous.
    if (std::any_of(snapshot.begin(), snapshot.end(), [&](const SnapshotWindow& other) {
      return other.number != candidate.number && other.owner == pid && CGRectEqualToRect(other.bounds, candidate.bounds);
    })) continue;
    AXUIElementRef element = nullptr;
    AXUIElementCopyElementAtPosition(app, CGRectGetMidX(candidate.bounds), CGRectGetMidY(candidate.bounds), &element);
    bool menu = false;
    for (int depth = 0; element && depth < 8 && std::chrono::steady_clock::now() < deadline; depth++) {
      AXUIElementSetMessagingTimeout(element, 0.05f);
      pid_t owner = 0;
      if (AXUIElementGetPid(element, &owner) != kAXErrorSuccess || owner != pid) break;
      NSString* role = axStringAttribute(element, kAXRoleAttribute);
      if ([role isEqualToString:@"AXMenu"]) {
        CGRect frame{};
        menu = axElementFrame(element, &frame) && CGRectEqualToRect(frame, candidate.bounds);
        break;
      }
      // Follow menu items/groups, never an arbitrary document tree.
      if (![role isEqualToString:@"AXMenuItem"] && ![role isEqualToString:@"AXGroup"]) break;
      CFTypeRef next = nullptr;
      AXUIElementCopyAttributeValue(element, kAXParentAttribute, &next);
      CFRelease(element);
      element = next && CFGetTypeID(next) == AXUIElementGetTypeID() ? static_cast<AXUIElementRef>(next) : nullptr;
      if (next && !element) CFRelease(next);
    }
    if (element) CFRelease(element);
    if (menu) menus.push_back(candidate);
  }
  CFRelease(app);
  return menus;
}

bool pointInActiveMenu(CGWindowID windowId, CGRect parent, CGPoint point) {
  pid_t pid = 0;
  if (!windowOwner(windowId, &pid)) return false;
  const auto menus = activeMenus(windowId, parent, pid);
  return std::any_of(menus.begin(), menus.end(), [&](const SnapshotWindow& menu) { return CGRectContainsPoint(menu.bounds, point); });
}

// Read-only membership for a capture viewport. Use the same native ownership
// evidence as input focus, never application-wide capture or title heuristics.
napi_value windowGroup(napi_env env, napi_callback_info info) {
  NSDictionary* payload = nil;
  if (!jsonArgument(env, info, &payload)) return fail(env, "Invalid window-group request");
  NSDictionary* target = [payload[@"target"] isKindOfClass:[NSDictionary class]] ? payload[@"target"] : nil;
  double rawId = 0;
  NSString* bundle = nil;
  if (!target || !number(target, @"windowId", &rawId) || rawId <= 0 || rawId > UINT32_MAX || std::floor(rawId) != rawId
      || !text(target, @"bundleIdentifier", &bundle)) return fail(env, "Invalid window-group identity");
  const CGWindowID windowId = static_cast<CGWindowID>(rawId);
  WindowDescription description{};
  const char* identityFailure="target_window_unavailable";
  if (!selectedWindowApplication(windowId,bundle,&description,&identityFailure)) return fail(env,identityFailure);
  if (description.layer != 0) return fail(env,"Selected window unavailable");
  if (!AXIsProcessTrusted()) return fail(env,"Accessibility unavailable for window-group ownership");
  const auto front = frontNormalWindowOfOwner(description.ownerPid);
  AXUIElementRef app = AXUIElementCreateApplication(description.ownerPid);
  AXUIElementSetMessagingTimeout(app, 0.15f);
  AXUIElementRef selected = copyTransitionDocument(windowId, description.ownerPid, description.bounds);
  if (!selected) selected = copyFocusedDocumentWindow(app);
  if (selected && !axWindowMatches(selected, windowId, description.bounds)) { CFRelease(selected); selected = nullptr; }
  if (!selected) selected = copyAXWindowByIdentity(app, windowId, description.bounds);
  CFRelease(app);
  if (!selected) return fail(env, "Selected accessibility window unavailable");
  const auto snapshot = onScreenWindowSnapshot();
  NSMutableArray* ids = [NSMutableArray arrayWithObject:@(windowId)];
  NSMutableArray* windows = [NSMutableArray array];
  // Traverse only the selected sheet hierarchy once. Repeating AX calls for
  // every unrelated application window made capture fail in busy applications.
  struct SheetIdentity { int64_t id; bool numbered; CGRect frame; };
  std::vector<SheetIdentity> sheets;
  bool complete = true;
  int remaining = 32;
  visitOwnedAttachedSurfaces(selected, description.ownerPid, 0, remaining, complete, [&](AXUIElementRef sheet) {
    SheetIdentity identity{};
    CFTypeRef raw = nullptr;
    CGWindowID sheetServerId = 0;
    if (AXUIElementCopyAttributeValue(sheet, CFSTR("AXWindowNumber"), &raw) == kAXErrorSuccess && raw) {
      identity.numbered = true;
      if (CFGetTypeID(raw) != CFNumberGetTypeID() || !CFNumberGetValue(static_cast<CFNumberRef>(raw),kCFNumberSInt64Type,&identity.id)) complete = false;
    } else if (axWindowServerId(sheet, &sheetServerId)) {
      identity.numbered = true;
      identity.id = static_cast<int64_t>(sheetServerId);
    }
    if (raw) CFRelease(raw);
    if (!axElementFrame(sheet,&identity.frame)) complete = false;
    sheets.push_back(identity);
    return false;
  });
  CFTypeRef axNumber = nullptr;
  CGWindowID selectedServerId = 0;
  const bool numbered = (AXUIElementCopyAttributeValue(selected, CFSTR("AXWindowNumber"), &axNumber) == kAXErrorSuccess && axNumber)
    || (axWindowServerId(selected, &selectedServerId) && selectedServerId == windowId);
  if (axNumber) CFRelease(axNumber);
  // A pre-input root binding survives a proven preview transition even when
  // another real Finder window has the same bounds. The sibling is never added
  // to capture membership. Without that identity proof, ambiguity still stops.
  const bool boundPreview = panelTransition.root == windowId
    && ownsCausalPanel(selected, front, description.ownerPid, windowId);
  // The on-screen snapshot is ordered front to back. A twin with identical
  // bounds can only receive input, or be mistaken for the selected window's
  // accessibility tree, when it sits above the selected window; a twin
  // beneath it is covered. Three stacked Chromium windows at one rectangle
  // with a Find bar open stopped a session for this reason.
  size_t selectedIndex = snapshot.size();
  for (size_t index = 0; index < snapshot.size(); index++) if (snapshot[index].number == windowId) { selectedIndex = index; break; }
  if (!numbered && !boundPreview && (!sheets.empty() || front.id != windowId)) for (size_t index = 0; index < snapshot.size(); index++) {
    const auto& candidate = snapshot[index];
    if (candidate.number != windowId && candidate.owner == description.ownerPid && candidate.layer == 0
        && CGRectEqualToRect(candidate.bounds, description.bounds) && (selectedIndex == snapshot.size() || index < selectedIndex)) {
      CFRelease(selected);
      return fail(env, "Selected window ownership is ambiguous because another window has identical bounds");
    }
  }
  if (snapshot.size() > 4096) complete = false;
  if (complete) for (const auto& candidate : snapshot) {
    if (candidate.owner != description.ownerPid || (candidate.layer != 0 && candidate.layer != 3) || candidate.number == windowId
        || candidate.bounds.size.width < 120 || candidate.bounds.size.height < 80) continue;
    bool unique = true;
    for (const auto& other : snapshot) if (other.owner == candidate.owner && (other.layer == 0 || other.layer == 3) && other.number != candidate.number
        && CGRectEqualToRect(other.bounds, candidate.bounds)) { unique = false; break; }
    const bool sheet = unique && std::any_of(sheets.begin(),sheets.end(),[&](const SheetIdentity& identity) {
      if (identity.numbered) return identity.id == candidate.number;
      return std::abs(identity.frame.origin.x-candidate.bounds.origin.x)<=2 && std::abs(identity.frame.origin.y-candidate.bounds.origin.y)<=2
        && std::abs(identity.frame.size.width-candidate.bounds.size.width)<=2 && std::abs(identity.frame.size.height-candidate.bounds.size.height)<=2;
    });
    const FrontOwnerWindow surface{candidate.number,candidate.bounds,unique};
    if (sheet || (candidate.number == front.id && ownsFrontTransient(selected,surface,description.ownerPid,description.bounds,windowId)))
      [ids addObject:@(candidate.number)];
  }
  CFRelease(selected);
  for (const auto& menu : activeMenus(windowId, description.bounds, description.ownerPid)) [ids addObject:@(menu.number)];
  if (!complete) return fail(env, "Owned sheet hierarchy was incomplete or exceeded its bound");
  for (NSNumber* identifier in ids) {
    WindowDescription member{};
    if (!windowDescription(identifier.unsignedIntValue, &member) || member.ownerPid != description.ownerPid)
      return fail(env, "Window group changed during inspection");
    [windows addObject:@{ @"windowId": identifier, @"bounds": @{
      @"x": @(member.bounds.origin.x), @"y": @(member.bounds.origin.y),
      @"width": @(member.bounds.size.width), @"height": @(member.bounds.size.height) } }];
  }
  return jsonResult(env, @{ @"windowIds": ids, @"windows": windows });
}

/** The first web document under the window (breadth-first, bounded), retained; null when none. */
AXUIElementRef copyWebArea(AXUIElementRef window, NSDate* deadline) {
  std::vector<AXUIElementRef> frontier{ window };
  CFRetain(window);
  AXUIElementRef found = nullptr;
  int visited = 0;
  for (int depth = 0; depth <= 12 && !frontier.empty() && !found; depth += 1) {
    std::vector<AXUIElementRef> next;
    for (AXUIElementRef element : frontier) {
      if (found || visited >= 800 || [deadline timeIntervalSinceNow] < 0) break;
      visited += 1;
      if ([axStringAttribute(element, kAXRoleAttribute) isEqualToString:@"AXWebArea"]) { CFRetain(element); found = element; break; }
      CFTypeRef rawChildren = nullptr;
      if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) == kAXErrorSuccess && rawChildren && CFGetTypeID(rawChildren) == CFArrayGetTypeID()) {
        CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
        const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 80);
        for (CFIndex index = 0; index < count; index += 1) {
          AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
          if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) { CFRetain(child); next.push_back(child); }
        }
      }
      if (rawChildren) CFRelease(rawChildren);
    }
    for (AXUIElementRef element : frontier) CFRelease(element);
    frontier = next;
  }
  for (AXUIElementRef element : frontier) CFRelease(element);
  return found;
}

/** Whole-document text through the text-marker API: one call, no side effects. */
NSString* markerDocumentText(AXUIElementRef area) {
  CFTypeRef range = nullptr;
  if (AXUIElementCopyParameterizedAttributeValue(area, CFSTR("AXTextMarkerRangeForUIElement"), area, &range) != kAXErrorSuccess || !range) return nil;
  CFTypeRef raw = nullptr;
  const AXError status = AXUIElementCopyParameterizedAttributeValue(area, CFSTR("AXStringForTextMarkerRange"), range, &raw);
  CFRelease(range);
  if (status != kAXErrorSuccess || !raw) return nil;
  NSString* value = CFGetTypeID(raw) == CFStringGetTypeID() ? [(__bridge NSString*)raw copy] : nil;
  CFRelease(raw);
  return value;
}

/** Depth-first, document order: static text and non-secure field values, one per line. */
void walkText(AXUIElementRef element, int depth, NSDate* deadline, NSMutableString* out, NSUInteger limit, int* visited, bool* truncated) {
  if (depth > 60 || *visited >= 40'000 || out.length >= limit) { *truncated = true; return; }
  if ([deadline timeIntervalSinceNow] < 0) { *truncated = true; return; }
  *visited += 1;
  NSString* role = axStringAttribute(element, kAXRoleAttribute);
  if ([role isEqualToString:@"AXSecureTextField"]) return;
  if ([role isEqualToString:@"AXStaticText"] || [role isEqualToString:@"AXTextArea"] || [role isEqualToString:@"AXTextField"]) {
    NSString* value = axStringAttribute(element, kAXValueAttribute);
    if (value.length > 0) { [out appendString:value]; [out appendString:@"\n"]; }
    if ([role isEqualToString:@"AXStaticText"]) return;
  }
  CFTypeRef rawChildren = nullptr;
  if (AXUIElementCopyAttributeValue(element, kAXChildrenAttribute, &rawChildren) != kAXErrorSuccess || !rawChildren || CFGetTypeID(rawChildren) != CFArrayGetTypeID()) {
    if (rawChildren) CFRelease(rawChildren);
    return;
  }
  CFArrayRef children = static_cast<CFArrayRef>(rawChildren);
  const CFIndex count = std::min<CFIndex>(CFArrayGetCount(children), 4'000);
  for (CFIndex index = 0; index < count && !*truncated; index += 1) {
    AXUIElementRef child = static_cast<AXUIElementRef>(const_cast<void*>(CFArrayGetValueAtIndex(children, index)));
    if (child && CFGetTypeID(child) == AXUIElementGetTypeID()) walkText(child, depth + 1, deadline, out, limit, visited, truncated);
  }
  CFRelease(rawChildren);
}

/** Read-only: the selected window's whole document as text, including content
 * scrolled out of view, in one call. The capture walk keeps only what is on
 * screen (200 elements), so reading a listing took one scroll and one model
 * turn per screenful (a clothing retailer's listing: 14 s per screen). */
napi_value pageText(napi_env env, napi_callback_info info) {
  NSDictionary* request = nil;
  if (!jsonArgument(env, info, &request)) return fail(env, "Page text request is invalid");
  NSDictionary* target = [request[@"target"] isKindOfClass:[NSDictionary class]] ? request[@"target"] : nil;
  double rawWindowId = 0, rawLimit = 0;
  NSString* expectedBundleIdentifier = nil;
  if (!target || !number(target, @"windowId", &rawWindowId) || rawWindowId < 1 || rawWindowId > UINT32_MAX || std::floor(rawWindowId) != rawWindowId
      || !text(target, @"bundleIdentifier", &expectedBundleIdentifier) || expectedBundleIdentifier.length == 0 || expectedBundleIdentifier.length > 240) {
    return fail(env, "Selected-window identity is invalid");
  }
  const NSUInteger limit = number(request, @"limit", &rawLimit) && rawLimit >= 1'000 && rawLimit <= 400'000 ? static_cast<NSUInteger>(rawLimit) : 120'000;
  const CGWindowID windowId = static_cast<CGWindowID>(rawWindowId);
  WindowDescription description{};
  if (!windowDescription(windowId, &description) || description.layer != 0 || !AXIsProcessTrusted()) return jsonResult(env, @{ @"available": @NO });
  NSRunningApplication* running = [NSRunningApplication runningApplicationWithProcessIdentifier:description.ownerPid];
  if (!running || ![running.bundleIdentifier isEqualToString:expectedBundleIdentifier]) return jsonResult(env, @{ @"available": @NO });
  NSDate* started = [NSDate date];
  AXUIElementRef application = AXUIElementCreateApplication(description.ownerPid);
  if (!application) return jsonResult(env, @{ @"available": @NO });
  AXUIElementSetMessagingTimeout(application, 1.0f);
  AXUIElementRef window = copyAXWindowByIdentity(application, windowId, description.bounds);
  if (!window) { CFRelease(application); return jsonResult(env, @{ @"available": @NO }); }
  AXUIElementRef area = copyWebArea(window, [NSDate dateWithTimeIntervalSinceNow:0.5]);
  NSString* url = area ? (axURLLikeAttribute(area, kAXURLAttribute) ?: axURLLikeAttribute(area, kAXDocumentAttribute)) : nil;
  NSString* method = @"text_marker";
  NSString* body = area ? markerDocumentText(area) : nil;
  bool truncated = false;
  if (body.length < 40) {
    method = area ? @"walk_document" : @"walk_window";
    NSMutableString* out = [NSMutableString string];
    int visited = 0;
    walkText(area ?: window, 0, [NSDate dateWithTimeIntervalSinceNow:2.5], out, limit, &visited, &truncated);
    body = out;
  }
  if (body.length > limit) { body = [body substringToIndex:limit]; truncated = true; }
  if (area) CFRelease(area);
  CFRelease(window);
  CFRelease(application);
  return jsonResult(env, @{ @"available": @YES, @"text": body ?: @"", @"method": method, @"truncated": @(truncated),
    @"url": url ?: [NSNull null], @"elapsedMs": @(static_cast<int>(-[started timeIntervalSinceNow] * 1000)) });
}

napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor methods[] = {
    { "frontmostApplication", nullptr, frontmostApplication, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "surfaceStates", nullptr, surfaceStates, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "surfaceIdentity", nullptr, surfaceIdentity, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "pageText", nullptr, pageText, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "windowGroup", nullptr, windowGroup, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "hitTest", nullptr, hitTest, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "isTrusted", nullptr, isTrusted, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "requestTrust", nullptr, requestTrust, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "windowLifecycle", nullptr, windowLifecycle, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "escapeStopMonitor", nullptr, escapeStopMonitor, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "personActivity", nullptr, personActivity, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "windowState", nullptr, windowState, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "focusWindow", nullptr, focusWindow, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "supportsKeycodeText", nullptr, supportsKeycodeText, nullptr, nullptr, nullptr, napi_default, nullptr },
    { "execute", nullptr, execute, nullptr, nullptr, nullptr, napi_default, nullptr },
  };
  napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
  return exports;
}

}  // namespace

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)
