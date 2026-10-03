import { copyFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

for (const asset of [
  'preload.cjs',
  'observer-hud.html',
  'observer-hud-preload.cjs',
  'live-computer-overlay.html',
  'live-computer-overlay-preload.cjs',
  'presence-overlay.html',
  'window-presence.css',
  'capsule-pages.css',
  'capsule-pages.cjs',
  'capsule-position.cjs',
  'window-presence.cjs',
  'presence-overlay-preload.cjs',
]) {
  const source = resolve(process.cwd(), 'desktop', asset)
  const target = resolve(process.cwd(), 'dist/desktop', asset)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
}

// Package the approved identity alongside the desktop runtime.
for (const [sourceName, targetName] of [
  ['mark-template-18.png', 'tray.png'],
  ['mark-template-36.png', 'tray@2x.png'],
  ['app-icon-512.png', 'app-icon.png'],
]) {
  const target = resolve(process.cwd(), 'dist/desktop/brand', targetName!)
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(resolve(process.cwd(), 'brand/carve', sourceName!), target)
}
