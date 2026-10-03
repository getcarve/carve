const { contextBridge, ipcRenderer } = require('electron')

// The presence overlay is decorative and inbound-only: it draws frames around
// windows Carve is attached to but not currently interacting with. It exposes
// no command channel at all, so nothing drawn here can ever send input,
// approve anything, or reach the control plane.
contextBridge.exposeInMainWorld('stewardPresenceOverlay', Object.freeze({
  onState(listener) {
    if (typeof listener !== 'function') return
    ipcRenderer.on('steward:presence-state', (_event, state) => listener(state))
  },
}))
