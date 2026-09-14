import * as React from "react";
import { Select as SelectPrimitive } from "radix-ui";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return <SelectPrimitive.Trigger data-slot="select-trigger" className={cn("flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:truncate", className)} {...props}>
    {children}<SelectPrimitive.Icon asChild><ChevronDown className="size-4 shrink-0 text-muted-foreground" /></SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>;
}
function SelectContent({ className, children, position = "popper", ...props }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return <SelectPrimitive.Portal><SelectPrimitive.Content data-slot="select-content" position={position} sideOffset={4} className={cn("relative z-50 max-h-[var(--radix-select-content-available-height)] min-w-[8rem] overflow-y-auto rounded-md border bg-popover text-popover-foreground shadow-md", className)} {...props}>
    <SelectPrimitive.ScrollUpButton className="flex items-center justify-center py-1"><ChevronUp className="size-4" /></SelectPrimitive.ScrollUpButton>
    <SelectPrimitive.Viewport className="w-full min-w-[var(--radix-select-trigger-width)] p-1">{children}</SelectPrimitive.Viewport>
    <SelectPrimitive.ScrollDownButton className="flex items-center justify-center py-1"><ChevronDown className="size-4" /></SelectPrimitive.ScrollDownButton>
  </SelectPrimitive.Content></SelectPrimitive.Portal>;
}
function SelectItem({ className, children, ...props }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return <SelectPrimitive.Item data-slot="select-item" className={cn("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50", className)} {...props}>
    <span className="absolute right-2 flex size-4 items-center justify-center"><SelectPrimitive.ItemIndicator><Check className="size-4" /></SelectPrimitive.ItemIndicator></span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>;
}
export { Select, SelectValue, SelectTrigger, SelectContent, SelectItem };
