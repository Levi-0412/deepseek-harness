/**
 * RD-Agent trace panel plugin, browser half: one `sidebar.footer.action`
 * entry (beside Settings at the sidebar foot) that toggles a right-side
 * drawer rendering the trace browser. The panel reads `dsh-rdagent-bridge`
 * over same-origin fetch; no store, no projections, no event listeners.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer action entry).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RdagentTrigger } from './RdagentTrigger.tsx'
import { en, zh, type RdagentKey } from './locales.ts'

export { RdagentTrigger } from './RdagentTrigger.tsx'
export { RdagentPanel } from './RdagentPanel.tsx'
export type { TraceSummary, TraceMessage, TraceData } from './RdagentPanel.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The RD-Agent traces panel copy. */
    rdagent: RdagentKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'rdagent'

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
      // Locale-following thunk: the shell resolves action labels at read time.
      label: () => ctx.locale.bind(NS)('label'),
    }, RdagentTrigger),
  )
}
