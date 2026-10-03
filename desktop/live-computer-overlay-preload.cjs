const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stewardLiveOverlay', Object.freeze({
  onState(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:live-overlay-state', (_event, state) => listener(state))
  },
  onVoice(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:live-overlay-voice', (_event, payload) => listener(payload))
  },
  onDictation(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:live-overlay-dictation', (_event, payload) => listener(payload))
  },
  onNotice(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:live-overlay-notice', (_event, payload) => listener(payload))
  },
  onFocusSteering(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:live-overlay-focus-steering', () => listener())
  },
  // The single outbound channel. Payloads are plain declarations of user
  // intent (pointer engagement, expand/dismiss, ask or follow-up text, a
  // hash-bound plan approval, one dictation clip); the main process validates
  // every command and acts only in the capsule states that offer controls.
  command(payload) {
    if (!payload || typeof payload !== 'object') return
    ipcRenderer.send('steward:live-overlay-command', payload)
  },
}))
