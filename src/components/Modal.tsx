import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  maxWidth?: string
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className={`bg-black border border-border w-full ${maxWidth} max-h-[90vh] flex flex-col`}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-raleway font-semibold text-white uppercase tracking-widest text-sm">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-muted hover:text-white transition-colors text-xl leading-none"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {children}
        </div>
      </div>
    </div>
  )
}
