/**
 * PaneConversation: ONE pane's native conversation, rendered by the core's
 * own slot renderer running against a pane-scoped host.
 *
 * The renderer instance is the vendored core `createSlotRenderer()` product
 * (see `vendor/renderer/README.md`); the host is `createPaneHost`, an overlay
 * on the registry's own host face whose session scope is this pane's binding.
 * The renderer's root outlet dispatches 'main.conversation', which elects the
 * STOCK ConversationRoot (the pane host filters this plugin's own main-panel
 * shadow out) — so the native header, Conversation content Factory, composer
 * and hero render here exactly as they do in an unmodified shell.
 *
 * rc.3: a pane owns a SessionReference (`sessions.retain`) for its Session;
 * `adapter.bindingSource(reference)` turns it into the pane's binding source.
 * The reference is released when the pane switches Session or unmounts.
 */
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  HostObservable, SlotRendererHost, StandardSourceBinding, StoredEntry,
} from '@deepseek-ai/dsh-client-ui-slots'
import { createPaneHost } from './pane-host.ts'
import { mainSessionId, retainPaneSession } from './pane-session.ts'
import { createSlotRenderer } from './vendor/renderer/scoped-slots.tsx'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The renderer product, created once (it is stateless between renders). */
const RENDERER = createSlotRenderer()

/** Everything a pane needs that is shared across panes of one plugin load. */
export interface PaneRenderDeps {
  /** Client root context (slots / uiSession / sessions). */
  readonly ctx: Context
  /** The registry's host face, read lazily (installed after plugin apply). */
  readonly baseHost: () => SlotRendererHost
  /** Entries never elected in a pane (this plugin's own conversation shadow). */
  readonly excluded: (entry: StoredEntry) => boolean
  /** A pane's hero opened `sessionId`: bind it back to that pane. */
  readonly onPaneSessionOpened: (paneId: string, sessionId: SessionId) => void
}

/**
 * Report the Session a pane's hero `selectWorkspace` opened — including a
 * REUSED blank, which leaves the global selection unchanged and so is
 * invisible to the selection-routing effect.
 */
export function paneFactoryInject(
  ctx: Context,
  paneId: string,
  report: PaneRenderDeps['onPaneSessionOpened'],
): (name: string, face: Record<string, unknown>) => Record<string, unknown> {
  return (name, face) => {
    const selectWorkspace = face['selectWorkspace']
    if (name !== 'conversation.content' || typeof selectWorkspace !== 'function') return face
    return {
      ...face,
      // On resolve, ui-workspace's replaceMain has retained the opened Session
      // as the main view (new or reused), so the main Session IS the result.
      selectWorkspace: async (workspaceId: unknown) => {
        const result: unknown = await (selectWorkspace as (id: unknown) => Promise<unknown>)(workspaceId)
        const opened = mainSessionId(ctx.sessions.list.getSnapshot())
        if (opened !== undefined) report(paneId, opened)
        return result
      },
    }
  }
}

/** One pane's props. */
export interface PaneConversationProps {
  readonly deps: PaneRenderDeps
  /** Pane session; undefined renders the native new-conversation surface. */
  readonly sessionId: string | undefined
  /** Pane identity (stable across session switches of the same pane). */
  readonly paneId: string
}

/**
 * Hold a SessionReference for the pane's Session while it is shown.
 * Retained in an effect, so React StrictMode double-invocation releases the
 * first reference before taking the second.
 */
function usePaneReference(ctx: Context, sessionId: string | undefined): SessionReference | undefined {
  const [reference, setReference] = useState<SessionReference | undefined>(undefined)
  useEffect(() => {
    if (sessionId === undefined) {
      setReference(undefined)
      return
    }
    const owned = retainPaneSession(ctx, sessionId as SessionId)
    setReference(owned)
    return () => { owned?.release() }
  }, [ctx, sessionId])
  return reference?.sessionId === sessionId ? reference : undefined
}

/**
 * Render one pane's native conversation.
 * @param props - deps + pane identity + session.
 * @returns the pane's conversation subtree.
 */
export const PaneConversation = memo(function PaneConversation({
  deps, sessionId, paneId,
}: PaneConversationProps): ReactNode {
  const { ctx } = deps
  const reference = usePaneReference(ctx, sessionId)
  const adapter = ctx.uiSession.adapter

  const binding: HostObservable<StandardSourceBinding> = useMemo(
    () => adapter.bindingSource(reference),
    [adapter, reference],
  )

  const host = useMemo(() => createPaneHost({
    base: deps.baseHost(),
    adapter,
    binding,
    excluded: deps.excluded,
    wrapFactoryInject: paneFactoryInject(ctx, paneId, deps.onPaneSessionOpened),
    onCrash: (key, entry, error) => {
      console.error(`[dsh-split-panes] pane ${paneId} occupant crashed in '${key}':`, error, entry.options)
    },
  }), [deps, adapter, binding, paneId])

  // A pane whose Session is still being retained renders nothing for one
  // commit rather than flashing the absent (hero) projection.
  if (sessionId !== undefined && reference === undefined) return null
  return RENDERER.renderRoot(host, {})
})
