/**
 * RD-Agent trace panel plugin, browser half: one `sidebar.footer.action`
 * entry (beside Settings at the sidebar foot) that toggles a right-side
 * drawer rendering the trace browser. The panel reads `dsh-rdagent-bridge`
 * over same-origin fetch; no store, no projections, no event listeners.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the renderer's Context merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer action entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RdagentTrigger } from './RdagentTrigger.tsx'
import { en, NS, zh, type RdagentKey } from './locales.ts'

export { RdagentTrigger } from './RdagentTrigger.tsx'
export { RdagentPanel } from './RdagentPanel.tsx'
export type { TraceSummary, TraceMessage, TraceData } from './RdagentPanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The RD-Agent traces panel copy. */
    rdagent: RdagentKey
  }
}

/** Required services: slots for the footer action, locale for copy. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: the RD-Agent traces sidebar action with its drawer.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-rdagent: dictionaries')

  ctx.slots.inject('sidebar.footer.action', () =>
    ctx.slots.register({
      name: 'sidebar.footer.action',
      id: 'rdagent',
      order: 10,
      locale: NS,
      // Locale-following thunk: the shell resolves action labels at read time.
      label: () => ctx.locale.bind(NS)('label'),
    }, RdagentTrigger),
  )
}
