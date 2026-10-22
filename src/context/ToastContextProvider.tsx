import { useState, useCallback, type ReactNode } from 'react'
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastClose } from '@/components/ui/toast'
import { ToastContext, type ToastVariant } from '@/context/ToastContext'

interface ToastItem {
  id: number
  title: string
  variant: ToastVariant
}

let idCounter = 0

export function ToastContextProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((title: string, variant: ToastVariant = 'default') => {
    const id = ++idCounter
    setToasts(prev => [...prev, { id, title, variant }])
    // ~60ms per character so longer explanations (e.g. why a delete was blocked) stay readable.
    const duration = Math.min(10000, Math.max(4000, title.length * 60))
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), duration)
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastProvider>
        {children}
        {toasts.map(t => (
          <Toast key={t.id} variant={t.variant} open>
            <ToastTitle>{t.title}</ToastTitle>
            <ToastClose onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))} />
          </Toast>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  )
}
