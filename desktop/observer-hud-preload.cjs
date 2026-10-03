const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('stewardObserver', Object.freeze({
  stop() {
    ipcRenderer.send('steward:observer-stop')
  },
}))
