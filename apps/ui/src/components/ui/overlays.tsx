import * as React from "react";
import { DropdownMenu as RMenu, Tooltip as RTooltip } from "radix-ui";
import { cn } from "@/lib/cn";

/* ---------------- Tooltip ---------------- */

export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <RTooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </RTooltip.Provider>
  );
}

export function Tooltip({ content, children, side = "top", align = "center" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right"; align?: "start" | "center" | "end" }) {
  if (!content) return <>{children}</>;
  return (
    <RTooltip.Root>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content side={side} align={align} sideOffset={6} className="z-[60] max-w-64 animate-in rounded-md bg-ink px-2.5 py-1.5 text-xs leading-4.5 text-paper shadow-lift">
          {content}
          <RTooltip.Arrow className="fill-ink" width={8} height={4} />
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}

/* ---------------- Dropdown menu ---------------- */

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ className, children, align = "end", sideOffset = 4, ...props }: React.ComponentProps<typeof RMenu.Content>) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 min-w-44 overflow-hidden rounded-lg border border-line bg-white p-1 shadow-pop data-[state=closed]:animate-out data-[state=open]:animate-in", className)}
        {...props}
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({ className, destructive, icon, children, ...props }: React.ComponentProps<typeof RMenu.Item> & { destructive?: boolean; icon?: React.ReactNode }) {
  return (
    <RMenu.Item
      className={cn(
        "flex cursor-pointer select-none items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors duration-(--duration-micro) data-[disabled]:pointer-events-none data-[highlighted]:bg-paper-deep data-[disabled]:text-ink-50",
        destructive ? "text-deny data-[highlighted]:bg-deny-soft" : "text-ink",
        className,
      )}
      {...props}
    >
      {icon && <span className="flex size-4 items-center justify-center text-ink-50 [&>svg]:size-3.5">{icon}</span>}
      <span className="flex-1">{children}</span>
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px bg-line-soft" />;
}
