import type { ReactNode } from "react";
import { TabsList, TabsTrigger } from "./components/ui/tabs";

export const listTabTriggerClass = "h-11 flex-none rounded-none border-x-0 border-t-0 border-b-2 px-1 shadow-none data-[state=active]:text-primary after:hidden";

export function ListTabHeader({ label, tabs, actions }: { label: string; tabs: ReactNode; actions?: ReactNode }) {
  return <div className="list-tab-header flex min-h-11 items-center justify-between gap-3 border-b">
    <TabsList variant="line" aria-label={label} className="h-11 min-w-0 shrink justify-start gap-2 overflow-x-auto overflow-y-hidden p-0 [scrollbar-width:none] sm:gap-5 [&::-webkit-scrollbar]:hidden">{tabs}</TabsList>
    {actions}
  </div>;
}

export function ListTab({ value, children, count }: { value: string; children: ReactNode; count?: number | undefined }) {
  return <TabsTrigger value={value} className={listTabTriggerClass}>
    {children}{count !== undefined && <span className="tab-count tabular-nums">{count}</span>}
  </TabsTrigger>;
}
