import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { default: 'bg-zinc-900 text-white hover:bg-zinc-700', outline: 'border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50', ghost: 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900' }, size: { default: 'h-10 px-4', sm: 'h-9 px-3', icon: 'size-9' } }, defaultVariants: { variant: 'default', size: 'default' } })
function Button({ className, variant, size, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) { const Comp = asChild ? Slot : 'button'; return <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} /> }
export { Button, buttonVariants }
