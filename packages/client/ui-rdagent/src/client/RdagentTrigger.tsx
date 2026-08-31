/**
 * RD-Agent sidebar action: the footer button that toggles the trace drawer.
 * The drawer is a right-side floating panel over a dimmed backdrop (the same
 * modal pattern the settings shell uses); open state is component-local.
 */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { NS } from './locales.ts'
import { RdagentPanel } from './RdagentPanel.tsx'
import styles from './RdagentTrigger.module.css'

/** Full props for the RD-Agent traces footer action: column state plus its copy seat. */
export type RdagentTriggerProps = SidebarFooterActionOwnerProps & PropsLocale<typeof NS>

/**
 * The RD-Agent traces footer action: trigger row plus the drawer it owns.
 * @param props - sidebar footer action owner share (column state) and the `rdagent` copy seat.
 */
export function RdagentTrigger({ wide, t }: RdagentTriggerProps) {
  const [open, setOpen] = useState(false)

  // Close the drawer on Escape, matching the settings modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open])

  return (
    <>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => { setOpen(v => !v) }}
        aria-expanded={open}
        title={t('title.traces')}
      >
        <span className={styles.icon} aria-hidden="true">▦</span>
        {wide && <span className={styles.label}>{t('label')}</span>}
      </button>
      {open && (
        <div className={styles.backdrop} onClick={() => { setOpen(false) }}>
          <div className={styles.drawer} role="dialog" aria-label={t('title.traces')} onClick={(e) => { e.stopPropagation() }}>
            <RdagentPanel onClose={() => { setOpen(false) }} t={t} />
          </div>
        </div>
      )}
    </>
  )
}
