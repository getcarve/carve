# Architecture

Carve is a local macOS application: an Electron shell, a TypeScript control plane that runs in the same process,
and small native helpers that hold the system permissions.

## Processes

| Part | Where | Role |
|---|---|---|
| Desktop shell | `desktop/main.ts` | Windows, the menu-bar item, global shortcuts, the capsule overlay, permission prompts |
| Control plane | `src/` (entry `src/app.ts`, `src/server.ts`) | Tasks, policy, supervision, audit, storage, model calls. Serves the interface on a loopback port |
| Interface | `ui/` | The React app shown in the main window |
| Capsule | `desktop/live-computer-overlay.html` | The small panel that follows the selected window: progress, approvals, the result |
| Capture helper | `native/macos/CarveCaptureHelper.swift` | ScreenCaptureKit capture and on-device text recognition |
| Computer helper | `native/macos/CarveComputerHelper.swift` | Accessibility tree of the selected window; delivers input |
| Input bridge | `native/macos/CarveLiveInputBridge.mm` | Low-level input and focus checks, loaded into the shell |
| Keychain and authentication helpers | `native/macos/` | Credential storage and device-owner authentication |

The loopback interface is protected by a per-process capability, a same-site session cookie, origin checks on every
mutation and a CSRF proof. It is not reachable from other machines.

## A task, end to end

1. **Summon.** ⌥D or ⌥G on the frontmost window. The shell records which window was selected; that choice is fixed
   for the task.
2. **Decide the method.** `src/task-method.ts` and `src/computer-use/engine-router.ts` decide whether the request
   is a question about what is on screen, a public lookup, or work to be done in the window, and which engine runs.
3. **Loop.** `runUniversalComputerUse` in `src/computer-use/universal.ts` runs the cycle: capture, model proposal,
   compilation to effects, approval where required, input, read back.
4. **Finish.** A final check compares the result with the window, and the capsule shows the outcome with a
   receipt.

The rules applied inside that loop are described in [security-model.md](security-model.md).

## Engines

| Engine | Used for |
|---|---|
| Router (default) | Chooses per task between the compact and thin engines |
| Compact | Web pages: the model addresses controls by reference from a compact page description |
| Thin | Screenshot-led control for surfaces the compact description cannot cover. Needs a provider with a stateful computer-use session |
| Structured (`CARVE_EXPERIENCE=workbench`) | The plan-based engine: a compiled plan, validated action by action |

## Models

`src/providers/` holds one adapter per provider behind a common interface (`src/providers/types.ts`): OpenAI,
Anthropic, AWS Bedrock, Azure OpenAI, OpenRouter, a local OpenAI-compatible server, and a deterministic mock. The registry in
`src/providers/registry.ts` selects one from `STEWARD_PROVIDER`.

`src/cloud/` is the client for Carve's hosted plan. It is inactive unless a cloud address is configured.

## Storage

One local SQLite database (`src/db.ts`): tasks, plans, receipts, settings and the audit log
(`src/audit.ts`, append-only and hash-chained). In a source build it lives in `./data`; in a packaged app, in the
app's Application Support folder.

## Building

```bash
npm run build         # interface, control plane, desktop assets, native helpers
npm run desktop       # build, then start the Electron shell
npm run package:mac   # an ad-hoc signed app bundle in release/
```

Signing and notarization are driven by environment variables read in `scripts/package-macos.ts`.
