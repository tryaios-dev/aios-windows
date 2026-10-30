import * as React from "react";
import { Checkbox as RCheckbox, Label as RLabel, RadioGroup as RRadio } from "radix-ui";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<typeof RLabel.Root>>(function Label({ className, ...props }, ref) {
  return <RLabel.Root ref={ref} className={cn("text-sm font-medium text-ink", className)} {...props} />;
});

/* ---------------- Checkbox ---------------- */

export const Checkbox = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof RCheckbox.Root>>(function Checkbox({ className, ...props }, ref) {
  return (
    <RCheckbox.Root
      ref={ref}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-xs border border-line-control bg-white transition-colors duration-(--duration-micro) hover:border-ink-50 data-[state=checked]:border-green data-[state=checked]:bg-green data-[state=indeterminate]:border-green data-[state=indeterminate]:bg-green disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RCheckbox.Indicator className="text-white">
        {props.checked === "indeterminate" ? <Minus className="size-3" strokeWidth={3} /> : <Check className="size-3" strokeWidth={3} />}
      </RCheckbox.Indicator>
    </RCheckbox.Root>
  );
});

/* ---------------- Radio ---------------- */

export const RadioGroup = RRadio.Root;

/** A large selectable option card driven by a RadioGroup. */
export function RadioCard({ value, title, description, meta, disabled = false, children, className }: { value: string; title: React.ReactNode; description?: React.ReactNode; meta?: React.ReactNode; disabled?: boolean; children?: React.ReactNode; className?: string }) {
  return (
    <RRadio.Item
      value={value}
      disabled={disabled}
      className={cn(
        "group flex w-full items-start gap-3 rounded-lg border border-line bg-paper-raised p-3.5 text-left transition-[border-color,background-color,box-shadow] duration-(--duration-micro) hover:border-line-strong hover:bg-white data-[state=checked]:border-green data-[state=checked]:bg-white data-[state=checked]:shadow-[0_0_0_1px_var(--color-green)] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border border-line-strong bg-white group-data-[state=checked]:border-green">
        <RRadio.Indicator className="size-2 rounded-full bg-green" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-3">
          <span className="text-base font-medium text-ink">{title}</span>
          {meta && <span className="shrink-0 text-xs text-ink-50">{meta}</span>}
        </span>
        {description && <span className="text-sm text-ink-soft">{description}</span>}
        {children}
      </span>
    </RRadio.Item>
  );
}
