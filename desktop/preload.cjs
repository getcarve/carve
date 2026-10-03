const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stewardDesktop', Object.freeze({
  platform: process.platform,
  invoke(command) {
    return ipcRenderer.invoke('steward:command', command)
  },
  onVoiceSettings(listener) {
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:voice-settings', receive)
    return () => ipcRenderer.removeListener('steward:voice-settings', receive)
  },
  onVoicePreview(listener) {
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:voice-preview', receive)
    return () => ipcRenderer.removeListener('steward:voice-preview', receive)
  },
  onStateChanged(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:state-changed', receive)
    return () => ipcRenderer.removeListener('steward:state-changed', receive)
  },
  onDictationState(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:dictation-state', receive)
    return () => ipcRenderer.removeListener('steward:dictation-state', receive)
  },
  onNotice(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:notice', receive)
    return () => ipcRenderer.removeListener('steward:notice', receive)
  },
  showCapsule() { ipcRenderer.send('steward:show-capsule') },
  onOpenSettings(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:open-settings', receive)
    return () => ipcRenderer.removeListener('steward:open-settings', receive)
  },
  onOpenActiveWork(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:open-active-work', receive)
    return () => ipcRenderer.removeListener('steward:open-active-work', receive)
  },
  onOpenWork(listener) {
    if (typeof listener !== 'function') return () => {}
    const receive = (_event, payload) => listener(payload)
    ipcRenderer.on('steward:open-work', receive)
    return () => ipcRenderer.removeListener('steward:open-work', receive)
  },
}))
