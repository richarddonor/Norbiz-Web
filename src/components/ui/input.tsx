import * as React from 'react'
import { cn } from '@/lib/utils'
import { useInDocCell } from '@/components/ui/doc-cell-context'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    const inCell = useInDocCell()
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-[hsl(var(--input))] bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))] disabled:cursor-not-allowed disabled:opacity-50',
          inCell && 'h-8 rounded-none border-0 bg-transparent px-0 shadow-none focus-visible:ring-0',
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = 'Input'

export { Input }
