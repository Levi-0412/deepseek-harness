/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-rdagent`.
 * @module @deepseek-ai/dsh-client-ui-rdagent/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-rdagent'

/** Cordis companion plugin name. */
export const name = 'client-ui-rdagent-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the single `settings.section` registration whose
 * disposal is proven by the HMR-safety spec — the plugin owns no store,
 * emits no cordis events, and holds no cross-plugin mutable state (the panel
 * reads the bridge over fetch and keeps only component-local state).
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
