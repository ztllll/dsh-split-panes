/**
 * Pane render host: the {@link SlotRendererHost} one pane runs the vendored
 * core renderer against.
 *
 * Since dsh 0.2.2-rc.3 the host contract carries Factory machinery
 * (`factoryOf`, `factoryStoreOf`, occurrence retention, …) and store
 * resolution bound to the registry's own instance axis. Re-implementing that
 * would fork core state, so a pane host is an OVERLAY on the registry's own
 * host face: every member is delegated except the five pane decisions —
 *
 *   entriesOf/entriesOfSlot('root') → the synthetic PaneRoot entry
 *   entriesOf*(other)               → the live ledger minus this plugin's own
 *                                     conversation shadow (so the stock root wins)
 *   reportEntryError                → pane-local abdication (a pane crash must
 *                                     not retire the entry for the main view)
 *   subscribe/getVersion            → ledger + pane-local abdication bumps
 *   scope('session'|'session-maybe')→ THIS pane's binding source
 */
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  HostObservable, SessionAreaProps, SlotRendererHost, SlotScopeAdapter, StandardSourceBinding,
} from '@deepseek-ai/dsh-client-ui-slots'
import { PaneRoot } from './PaneRoot.tsx'

/** Options one pane host is built from. */
export interface PaneHostOptions {
  /** The registry's own host face (delegation target). */
  readonly base: SlotRendererHost
  /** The installed session scope adapter. */
  readonly adapter: SlotScopeAdapter
  /** This pane's binding source (a retained Session, or the absent projection). */
  readonly binding: HostObservable<StandardSourceBinding>
  /**
   * Entries this pane must never elect (the plugin's own conversation shadow —
   * dropping it is what makes the stock ConversationRoot the winner).
   */
  readonly excluded?: ((entry: StoredEntry) => boolean) | undefined
  /** Diagnostic hook for pane-side occupant crashes. */
  readonly onCrash?: ((key: string, entry: StoredEntry, error: unknown) => void) | undefined
}

/** The synthetic 'root' occupant: a one-line dispatch into 'main.conversation'. */
const PANE_ROOT_ENTRY: StoredEntry = {
  component: PaneRoot,
  options: { id: 'panes.root' },
  children: { 'main.conversation': { kind: 'single', scope: 'session-maybe' } },
}

/** The built-in 'root' spec (SlotCore seeds it; a pane host must answer for it). */
const ROOT_SPEC = { kind: 'single', scope: 'root' } as const

/**
 * Read the registry's host face. `hostFace()` is TypeScript-private on
 * SlotRegistry but is the very object the core renderer receives; the pane
 * renderer must see the same Factory and store axes.
 * @param slots - the `ctx.slots` SlotRegistry.
 * @returns the registry host face.
 * @throws when this core build exposes no host face.
 */
export function registryHostFace(slots: unknown): SlotRendererHost {
  const face = (slots as { hostFace?: () => SlotRendererHost }).hostFace
  if (typeof face !== 'function') {
    throw new Error('[dsh-split-panes] this dsh core exposes no slot host face (unsupported core version)')
  }
  return face.call(slots)
}

/** The cell one entry occupies under its slot's kind (mirrors SlotCore). */
function cellOf(kind: string, entry: StoredEntry): string {
  if (kind === 'keyed') return entry.options.key ?? ''
  if (kind === 'list') return entry.options.id ?? ''
  return ''
}

/**
 * Build the render host for one pane.
 * @param options - base host, adapter, pane binding, exclusion.
 * @returns the renderer host for this pane.
 */
export function createPaneHost(options: PaneHostOptions): SlotRendererHost {
  const { base, adapter, binding } = options
  const excluded = options.excluded ?? (() => false)

  /** Entries retired by a pane-local abdicating crash. */
  const abdicated = new WeakSet<StoredEntry>()
  const localVersions = new Map<string, number>()
  const localListeners = new Map<string, Set<() => void>>()

  const bump = (key: string): void => {
    localVersions.set(key, (localVersions.get(key) ?? 0) + 1)
    for (const listener of [...(localListeners.get(key) ?? [])]) {
      try {
        listener()
      } catch (error) {
        console.error('[dsh-split-panes] pane ledger subscriber failed:', error)
      }
    }
  }

  /** Elect one winner per cell over the raw ledger, honouring pane exclusions. */
  const winnersOf = (key: string): readonly StoredEntry[] => {
    const all = base.entriesOf(key)
    const hidden = (entry: StoredEntry): boolean => abdicated.has(entry) || excluded(entry)
    // Fast path: nothing pane-specific applies, so the core's own election stands.
    if (!all.some(hidden)) return base.entriesOfSlot(key)
    const kind = base.specOf(key)?.kind ?? 'single'
    if (kind === 'chain') return all.filter(entry => !hidden(entry))
    const order = new Map<StoredEntry, number>()
    all.forEach((entry, index) => { order.set(entry, index) })
    const best = new Map<string, StoredEntry>()
    for (const entry of all) {
      if (hidden(entry)) continue
      const cell = cellOf(kind, entry)
      const incumbent = best.get(cell)
      if (incumbent === undefined) {
        best.set(cell, entry)
        continue
      }
      const challenger = entry.options.priority ?? 0
      const holding = incumbent.options.priority ?? 0
      if (challenger < holding
        || (challenger === holding && (order.get(entry) ?? 0) < (order.get(incumbent) ?? 0))) {
        best.set(cell, entry)
      }
    }
    return [...best.values()]
  }

  const paneScope: SlotScopeAdapter = {
    current: binding,
    bindingSource: target => adapter.bindingSource(target),
    ...(adapter.renderArea === undefined
      ? {}
      : { renderArea: (value: StandardSourceBinding, props: SessionAreaProps) => adapter.renderArea!(value, props) }),
  }

  // Delegate everything, then override the pane decisions. A getter keeps
  // `locale` live (the core swaps the face under HMR).
  const host: SlotRendererHost = Object.create(base, {
    locale: { get: () => base.locale, enumerable: true },
  })
  return Object.assign(host, {
    subscribe(key: string, fn: () => void): () => void {
      let set = localListeners.get(key)
      if (set === undefined) {
        set = new Set()
        localListeners.set(key, set)
      }
      set.add(fn)
      const disposeBase = base.subscribe(key, fn)
      return () => {
        set?.delete(fn)
        disposeBase()
      }
    },
    getVersion: (key: string): number => base.getVersion(key) + (localVersions.get(key) ?? 0),
    entriesOf: (key: string): readonly StoredEntry[] => {
      if (key === 'root') return [PANE_ROOT_ENTRY]
      const all = base.entriesOf(key)
      return all.some(excluded) ? all.filter(entry => !excluded(entry)) : all
    },
    entriesOfSlot: (key: string): readonly StoredEntry[] => {
      if (key === 'root') return [PANE_ROOT_ENTRY]
      return winnersOf(key)
    },
    isLive: (entry: StoredEntry): boolean => entry === PANE_ROOT_ENTRY || base.isLive(entry),
    reportEntryError(key: string, entry: StoredEntry, error: unknown, info: { abdicate: boolean }): void {
      console.error(`[dsh-split-panes] pane occupant crashed in '${key}':`, error)
      options.onCrash?.(key, entry, error)
      if (!info.abdicate) return
      abdicated.add(entry)
      bump(key)
    },
    specOf: (key: string) => (key === 'root' ? ROOT_SPEC : base.specOf(key)) as ReturnType<SlotRendererHost['specOf']>,
    storeOf: (entry: StoredEntry, scopeBinding: Parameters<SlotRendererHost['storeOf']>[1]) =>
      entry === PANE_ROOT_ENTRY ? undefined : base.storeOf(entry, scopeBinding),
    scope: (scope: Parameters<SlotRendererHost['scope']>[0]) =>
      (scope === 'session' || scope === 'session-maybe' ? paneScope : base.scope(scope)),
  })
}

/** The synthetic root entry a pane host answers for (exposed for tests). */
export const PANE_ROOT_SLOT_ENTRY = PANE_ROOT_ENTRY
