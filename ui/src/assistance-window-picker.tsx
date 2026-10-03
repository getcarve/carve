import { useEffect, useRef, useState } from 'react'
import { AppWindow, ArrowUpRight, Check, RefreshCw, Search, X } from 'lucide-react'
import type { LiveComputerTarget } from '../../src/types'

export function AssistanceWindowPicker({ targets, current, loading, disabled, choose, close, reload, requested = false }: {
  requested?: boolean
  targets: LiveComputerTarget[]; current: LiveComputerTarget | null; loading: boolean; disabled: boolean
  choose: (target: LiveComputerTarget) => void; close: () => void; reload: () => void
}) {
  const [search, setSearch] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  const query = search.trim().toLocaleLowerCase()
  const matches = targets.filter(target => `${target.application} ${target.title}`.toLocaleLowerCase().includes(query))
  const groups = new Map<string, LiveComputerTarget[]>()
  for (const target of matches) {
    const key = target.bundleIdentifier || target.application
    groups.set(key, [...(groups.get(key) ?? []), target])
  }
  return <section className="window-picker" aria-label="Choose a window" aria-busy={loading} onKeyDown={event => {
    if (event.key === 'Escape') { event.stopPropagation(); close() }
  }}>
    <header className="window-picker__header"><div><strong>{requested ? 'Which window should Carve use?' : 'Choose a window'}</strong><span>{requested ? 'Your request is saved below. Choose a window, then send when you’re ready.' : 'Which window would you like help with?'}</span></div><button type="button" className="window-picker__icon-button" aria-label="Close window picker" onClick={close}><X size={17} /></button></header>
    <div className="window-picker__search"><Search size={17} aria-hidden="true" /><input ref={input} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search apps or window titles…" aria-label="Search apps or window titles" />{search ? <button type="button" className="window-picker__icon-button" aria-label="Clear window search" onClick={() => { setSearch(''); input.current?.focus() }}><X size={14} /></button> : <kbd>esc</kbd>}</div>
    <div className="window-picker__results">
      {loading ? <p className="window-picker__empty" role="status">Finding open windows…</p> : groups.size ? [...groups.entries()].map(([key, windows]) => <section className="window-picker__group" key={key} aria-label={windows[0]!.application}>
        <header><span className="window-picker__app-icon" aria-hidden="true">{windows[0]!.iconDataUrl ? <img src={windows[0]!.iconDataUrl!} alt="" draggable={false} /> : <AppWindow size={21} />}</span><strong>{windows[0]!.application}</strong><span className="window-picker__count">{windows.length}</span></header>
        <div>{windows.map(target => {
          const selected = current?.bundleIdentifier === target.bundleIdentifier && current?.windowId === target.windowId
          return <button type="button" className={`window-picker__window${selected ? ' is-selected' : ''}`} key={`${target.bundleIdentifier}:${target.windowId}`} disabled={disabled} aria-current={selected ? 'true' : undefined} title={target.title || 'Untitled window'} onClick={() => choose(target)}><span>{target.title || 'Untitled window'}</span>{selected ? <Check size={16} aria-label="Current window" /> : <ArrowUpRight size={15} aria-hidden="true" />}</button>
        })}</div>
      </section>) : <div className="window-picker__empty"><AppWindow size={24} aria-hidden="true" /><strong>{query ? 'No matching windows' : 'No windows available'}</strong><span>{query ? 'Try another app name or window title.' : 'Open the app you want help with, then refresh.'}</span></div>}
    </div>
    <footer className="window-picker__footer"><span role="status">{loading ? 'Checking your apps' : `${matches.length} ${matches.length === 1 ? 'window' : 'windows'}${query ? ' found' : ' available'}`}</span><button type="button" disabled={loading || disabled} onClick={reload}><RefreshCw size={13} />Refresh</button></footer>
  </section>
}
