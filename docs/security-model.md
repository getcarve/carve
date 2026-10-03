# Security model

Carve holds two macOS permissions, Screen Recording and Accessibility. macOS grants both to the whole app. Every
limit described here is therefore Carve's own code, which is why that code is published. This page says what each
limit is, where it lives, and where the limits end.

## What Carve is trying to prevent

1. Acting outside the window the person chose.
2. Taking a consequential action the person did not approve.
3. Being steered by text on the screen into doing something the person did not ask for.
4. Reporting success that did not happen.
5. Leaving no record of what it did.

## The path an action takes

In the default experience a model never sends input itself. It proposes a small batch of actions, and the
controller decides what happens to each one.

1. **Capture.** The Swift helper captures the selected window and its accessibility tree. Other windows are not
   captured. (`native/macos/CarveComputerHelper.swift`, `native/macos/CarveCaptureHelper.swift`)
2. **Proposal.** The model returns actions: click here, type this, press these keys.
3. **Compilation to effects.** `compileUniversalComputerBatchPreflight` in `src/computer-use/effects.ts` matches
   each action against the current accessibility frame. A coordinate is useful for input, but it is not authority:
   an action is authorized only when the frame identifies a single, non-sensitive control with a known effect.
   Each action is given an effect class: read only, safe local, reversible local write, external write,
   communication, submission, financial, destructive, authentication, installation, privilege escalation,
   confidential disclosure.
4. **The boundary for consequential effects.** `src/action-effects.ts` lists the protected classes: communication,
   submission, financial, destructive, authentication, installation, privilege escalation, confidential disclosure,
   legal acceptance, high-impact decision, and any control that could not be classified. In
   `src/supervision-policy.ts` every supervision preset, including the fastest, sets the protected boundary to
   "immediate approval or hand back" and the unknown boundary to "resolve or hand back".
5. **Scope review.** A second model call, separate from the one proposing actions, judges whether a step is within
   what the person asked. This is a model's judgment, not a guarantee.
6. **Input.** `src/computer-use/selected-window-backend.ts` delivers input to the selected window. A point outside
   the window, a control that changed since it was observed, a covered or ambiguous target, or a text field that
   has not proven focus are each refused with no input sent.
7. **Verification.** After input, the controller reads the result back from the window. A final check, again a
   separate model call, compares the answer with what the page shows before Carve reports "done".
   (`src/computer-use/completion-review.ts`, `src/computer-use/verification-policy.ts`)
8. **Record.** Each step is appended to a hash-chained audit log in the local database, and the task ends with a
   receipt. (`src/audit.ts`, `src/receipt.ts`)

The person can stop at any point: Escape in the capsule, ⌘⇧. from anywhere, or by starting to type.

## Tasks that need more than one window

A task such as "read these pages and save a summary" runs as a hand-off (`src/application-handoff.ts`): a chain of
stages, each bound to exactly one window. The chain waits for the person's consent before it starts. Source stages
are read-only: the backend accepts viewing and scrolling there and refuses any other input. Writing happens in the
last stage, in a document window. Each stage is given one window and is held to the same input rules as any other
task.

## The plan-based engine

`CARVE_EXPERIENCE=workbench` runs an older engine in which a task is compiled into a plan and each action is
validated against it by `validateAction` in `src/live-computer.ts`. Its gates are stricter: typed text must be
grounded in the approved plan or in verified evidence, text that reads as an instruction is refused, credential-like
text is never typed, and only windows authorized for the session can be switched to.

`npm run eval:injection` tests those gates directly. It does not exercise the default engine.

## What is not covered

- **The model provider sees the selected window.** Screenshots and the control description are sent to the provider
  you configured.
- **Reading can be misled.** A hostile page can state false things, and Carve may report them. The final check
  compares the answer with the page; it cannot know the page is lying.
- **Classification can be wrong.** Effect classes come from accessibility roles and labels, and a page chooses
  both. A role alone never makes a control harmless: a checkbox or switch whose label names a purchase, message,
  grant of access, agreement, sign-in or deletion keeps that class. A control with a misleading *label* (a Send
  button named "Search") can still be classified as harmless. Unlabeled and ambiguous controls fall on the safe side.
- **The reviews are models.** Scope review and the final check reduce errors; they do not eliminate them.
- **Prompt-injection tests are small.** `npm run eval:injection` runs 17 attacks and 5 legitimate controls through
  the default engine's classifier, gate and window delivery, and 8 + 2 through the plan-based engine, with no
  model in the loop. Its first run on 0.1.7 found the checkbox-role bypass fixed in 0.1.8. More cases, especially
  ones that get past it, are the most useful contribution anyone could make.
- **Other software on the Mac.** Anything else with Accessibility permission can do what Carve can. Carve does not
  defend against a compromised machine.

## Local data

History, receipts, the audit log and settings live in a local SQLite database. Secrets recognized in on-screen text
are redacted before storage. Export and full deletion require device-owner authentication.

## Reporting

See [SECURITY.md](../SECURITY.md).
