/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-rdagent-bridge`.
 * @module @deepseek-ai/dsh-rdagent-bridge/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-rdagent-bridge'

/** Cordis companion plugin name. */
export const name = 'rdagent-bridge-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the single `/rdagent` route registration is proven
 * symmetric by the webserver package's own invariant (its disposer removes the
 * route, and our fiber's lifecycle is exactly that disposer) — the plugin owns
 * no other mutable state and emits no cordis events.
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
