/**
 * Session access for panes on dsh 0.2.2-rc.3.
 *
 * rc.3 removed the old selection surface (`sessions.list.current`,
 * `sessions.open()`, `uiSession.adapter.resolve(id)`). The replacements are:
 *
 *   selection   → the Session whose `retainedBy.mainView` count is positive
 *                 (the same rule ui-workspace's tree uses)
 *   navigation  → `ctx.uiWorkspace.openSession(id)`
 *   pane window → `ctx.sessions.retain(id, { source: 'splitPane' })`, which
 *                 starts the history opening and yields a SessionReference
 *                 that `adapter.bindingSource(reference)` turns into the
 *                 pane's standard-source binding
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A split pane pinned to one Session. */
    splitPane: unknown
  }
}

/** Minimal Session-list row shape this plugin reads. */
interface SummaryLike {
  readonly id: string
  readonly retainedBy?: Readonly<Record<string, number | undefined>>
}

/** Minimal Session-list snapshot shape this plugin reads. */
export interface SessionListLike {
  readonly ids?: readonly string[]
  readonly byId: Readonly<Record<string, SummaryLike & { readonly blank?: boolean; readonly displayTitle?: string }>>
}

/**
 * The Session the main view currently shows.
 * @param list - Session-list snapshot.
 * @returns the main-view Session id, or undefined when nothing is selected.
 */
export function mainSessionId(list: SessionListLike): SessionId | undefined {
  for (const summary of Object.values(list.byId)) {
    if ((summary.retainedBy?.['mainView'] ?? 0) > 0) return summary.id as SessionId
  }
  return undefined
}

/**
 * Select a Session in the main view through ui-workspace navigation.
 * @param ctx - client root context.
 * @param sessionId - Session to show.
 */
export function openMainSession(ctx: Context, sessionId: SessionId): void {
  const navigation = ctx.get('uiWorkspace') as { openSession?: (id: SessionId) => void } | undefined
  if (typeof navigation?.openSession !== 'function') {
    console.error('[dsh-split-panes] uiWorkspace.openSession is unavailable; cannot select', sessionId)
    return
  }
  navigation.openSession(sessionId)
}

/** An owned pane reference to one Session. */
export interface PaneSessionReference {
  readonly sessionId: SessionId
  /** Opaque rc.3 SessionReference handed to `adapter.bindingSource`. */
  readonly reference: unknown
  release(): void
}

/**
 * Retain one Session for a pane: starts its history opening and keeps its
 * Client generation alive until released.
 * @param ctx - client root context.
 * @param sessionId - Session the pane shows.
 * @returns the owned reference, or undefined when retention is unavailable.
 */
export function retainPaneSession(ctx: Context, sessionId: SessionId): PaneSessionReference | undefined {
  const sessions = ctx.get('sessions') as
    | { retain?: (target: SessionId, options: { source: string }) => { sessionId: SessionId; release(): void } }
    | undefined
  if (typeof sessions?.retain !== 'function') return undefined
  try {
    const reference = sessions.retain(sessionId, { source: 'splitPane' })
    return { sessionId: reference.sessionId, reference, release: () => { reference.release() } }
  } catch (error) {
    console.error('[dsh-split-panes] could not retain pane session:', sessionId, error)
    return undefined
  }
}
