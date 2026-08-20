/** `rdagent` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  label: 'RD-Agent',
} satisfies Record<string, string>

/** The rdagent namespace key union. */
export type RdagentKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  label: 'RD-Agent',
} satisfies Record<RdagentKey, string>
