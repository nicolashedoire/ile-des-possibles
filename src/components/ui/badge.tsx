import { cn } from '@/lib/utils'
function Badge({ className, ...props }: React.ComponentProps<'span'>) { return <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium', className)} {...props} /> }
export { Badge }
