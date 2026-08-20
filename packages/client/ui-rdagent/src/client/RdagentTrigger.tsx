/**
 * RD-Agent sidebar action: the footer button that toggles the trace drawer.
 * The drawer is a right-side floating panel over a dimmed backdrop (the same
 * modal pattern the settings shell uses); open state is component-local.
 */
import { useEffect, useState } from 'react'
import type { SidebarFooterActionOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { RdagentPanel } from './RdagentPanel.tsx'
import styles from './RdagentTrigger.module.css'

/**
 * The RD-Agent traces footer action: trigger row plus the drawer it owns.
 * @param props - sidebar footer action owner share (column state).
 */
export function RdagentTrigger({ wide }: SidebarFooterActionOwnerProps) {
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
        title="RD-Agent Traces"
      >
        <span className={styles.icon} aria-hidden="true">▦</span>
        {wide && <span className={styles.label}>RD-Agent</span>}
      </button>
      {open && (
        <div className={styles.backdrop} onClick={() => { setOpen(false) }}>
          <div className={styles.drawer} role="dialog" aria-label="RD-Agent Traces" onClick={(e) => { e.stopPropagation() }}>
            <RdagentPanel onClose={() => { setOpen(false) }} />
          </div>
        </div>
      )}
    </>
  )
}
