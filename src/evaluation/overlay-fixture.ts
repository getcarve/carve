import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** setContent fixtures have no file origin. Inline the same local assets that
 * Electron loads, preserving their order and the inert controller installed
 * by the test. This is not a second implementation of the renderer. */
export function liveOverlayFixtureHtml(): string {
  return readFileSync(resolve('desktop/live-computer-overlay.html'), 'utf8')
    .replace("<script type=\"module\">\n      import { parseResultBlocks } from '../src/result-blocks.js'",
      () => '<script>' + ts.transpileModule(readFileSync(resolve('src/result-blocks.ts'), 'utf8').replace(/^export /gmu, ''), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.None } }).outputText)
    .replace('<link rel="stylesheet" href="window-presence.css" />',
      () => `<style>${readFileSync(resolve('desktop/window-presence.css'), 'utf8')}</style>`)
    .replace('<link rel="stylesheet" href="capsule-pages.css" />', () => `<style>${readFileSync(resolve('desktop/capsule-pages.css'), 'utf8')}</style>`)
    .replace('<script src="capsule-pages.cjs"></script>',
      () => `<script>${readFileSync(resolve('desktop/capsule-pages.cjs'), 'utf8')}</script>`)
    .replace('<script src="capsule-position.cjs"></script>',
      () => `<script>${readFileSync(resolve('desktop/capsule-position.cjs'), 'utf8')}</script>`)
    .replace('<script src="window-presence.cjs"></script>',
      () => `<script>${readFileSync(resolve('desktop/window-presence.cjs'), 'utf8')}</script>`)
}
