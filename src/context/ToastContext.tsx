import { createContext, useContext } from 'react'

export type ToastVariant = 'default' | 'success' | 'error'

interface ToastContextType {
  toast: (title: string, variant?: ToastVariant) => void
}

export const ToastContext = createContext<ToastContextType | null>(null)

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastContextProvider')
  return ctx
}
