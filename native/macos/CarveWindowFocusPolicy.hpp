#pragma once

namespace steward {

enum class GlobalApplicationFocus { target, other, noValue, error };

// A missing system-wide AX value is not evidence of another receiver. Use
// fresh per-application AXFrontmost only for this missing-value case. A
// conflicting receiver or a failed read never inherits the fallback. Window
// Server ordering and exact selected-window identity remain separate gates.
constexpr bool acceptsApplicationFocusEvidence(GlobalApplicationFocus global, bool applicationFrontmost) {
  return global == GlobalApplicationFocus::target
    || (global == GlobalApplicationFocus::noValue && applicationFrontmost);
}

struct WindowFocusEvidence {
  bool targetIdentityMatches;
  bool targetApplicationFrontmost;
  bool focusedWindowMatches;
  bool mainWindowMatches;
  // Some single-window utility applications do not publish a matchable AX
  // window. The controller may use Window Server identity as the focus proof
  // only when this target is the process's sole visible normal window.
  bool soleNormalWindowMatches = false;
};

struct AXWindowIdentityEvidence {
  bool windowNumberAvailable;
  bool windowNumberMatches;
  bool geometryMatches;
};

// An explicit AXWindowNumber is stronger than geometry. A different window id
// must never be reinterpreted as the selected window merely because two
// Chromium windows or aliases occupy the same rectangle.
constexpr bool acceptsAXWindowIdentityEvidence(const AXWindowIdentityEvidence& evidence) {
  return evidence.windowNumberAvailable
    ? evidence.windowNumberMatches
    : evidence.geometryMatches;
}

// A transient menu, autocomplete panel, or other child surface may temporarily
// become the accessibility-focused window while the user-selected top-level
// window remains the application's main window. Accept that state without
// weakening the selected-window boundary: identity and frontmost-application
// checks still have to pass, and a different top-level sibling matches neither
// the focused nor main window.
constexpr bool acceptsWindowFocusEvidence(const WindowFocusEvidence& evidence) {
  return evidence.targetIdentityMatches
    && evidence.targetApplicationFrontmost
    && (evidence.focusedWindowMatches || evidence.mainWindowMatches || evidence.soleNormalWindowMatches);
}

} // namespace steward
