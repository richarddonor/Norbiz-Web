import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { ToastProvider, ToastViewport, Toast, ToastTitle, ToastClose } from '@/components/ui/toast'

type ToastVariant = 'default' | 'success' | 'error'

interface ToastItem {
  id: number
  title: string
  variant: ToastVariant
}

interface ToastContextType {
  toast: (title: string, variant?: ToastVariant) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

let idCounter = 0

export function ToastContextProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const toast = useCallback((title: string, variant: ToastVariant = 'default') => {
    const id = ++idCounter
    setToasts(prev => [...prev, { id, title, variant }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
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

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastContextProvider')
  return ctx
}
