import * as React from "react";
import {
  Checkbox as RCheckbox,
  Label as RLabel,
  RadioGroup as RRadio,
  Select as RSelect,
  Switch as RSwitch,
} from "radix-ui";
import { Check, ChevronDown, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.ComponentProps<typeof RLabel.Root>>(function Label(
  { className, ...props },
  ref,
) {
  return <RLabel.Root ref={ref} className={cn("text-sm font-medium text-ink", className)} {...props} />;
});

export function Hint({ className, children }: { className?: string | undefined; children: React.ReactNode }) {
  return <p className={cn("text-xs leading-4.5 text-ink-50", className)}>{children}</p>;
}

export function FieldError({ children }: { children?: React.ReactNode | undefined }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-xs leading-4.5 text-deny">
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  className,
  inline,
}: {
  label?: React.ReactNode | undefined;
  hint?: React.ReactNode | undefined;
  error?: React.ReactNode | undefined;
  htmlFor?: string | undefined;
  children: React.ReactNode;
  className?: string | undefined;
  inline?: boolean | undefined;
}) {
  return (
    <div className={cn("flex gap-1.5", inline ? "flex-row items-center justify-between gap-4" : "flex-col", className)}>
      {(label || hint) && (
        <div className={cn("flex flex-col gap-0.5", inline && "min-w-0")}>
          {label && <Label htmlFor={htmlFor}>{label}</Label>}
          {hint && <Hint>{hint}</Hint>}
        </div>
      )}
      {children}
      <FieldError>{error}</FieldError>
    </div>
  );
}

const inputBase =
  "w-full rounded-md border border-line-control bg-white px-3 text-base text-ink placeholder:text-ink-50 transition-[border-color,box-shadow] duration-(--duration-micro) hover:border-line-strong focus:border-green focus:outline-none focus:ring-2 focus:ring-green/20 disabled:bg-paper disabled:text-ink-50 aria-invalid:border-deny aria-invalid:focus:ring-deny/20";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { mono?: boolean | undefined }
>(function Input({ className, mono, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(inputBase, "h-9", mono && "font-mono text-sm tracking-wide", className)}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(inputBase, "min-h-20 resize-y py-2 leading-5.5", className)} {...props} />;
  },
);

/* ---------------- Switch ---------------- */

export const Switch = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof RSwitch.Root>>(function Switch(
  { className, ...props },
  ref,
) {
  return (
    <RSwitch.Root
      ref={ref}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-line-control transition-colors duration-(--duration-micro) data-[state=checked]:bg-green disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RSwitch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(22,33,27,0.3)] transition-transform duration-(--duration-micro) ease-(--ease-out) data-[state=checked]:translate-x-4.5" />
    </RSwitch.Root>
  );
});

/* ---------------- Checkbox ---------------- */

export const Checkbox = React.forwardRef<HTMLButtonElement, React.ComponentProps<typeof RCheckbox.Root>>(
  function Checkbox({ className, ...props }, ref) {
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
          {props.checked === "indeterminate" ? (
            <Minus className="size-3" strokeWidth={3} />
          ) : (
            <Check className="size-3" strokeWidth={3} />
          )}
        </RCheckbox.Indicator>
      </RCheckbox.Root>
    );
  },
);

/* ---------------- Radio ---------------- */

export const RadioGroup = RRadio.Root;

export function RadioItem({ value, id, className, ...props }: React.ComponentProps<typeof RRadio.Item>) {
  return (
    <RRadio.Item
      id={id}
      value={value}
      className={cn(
        "flex size-4 shrink-0 items-center justify-center rounded-full border border-line-control bg-white transition-colors duration-(--duration-micro) hover:border-ink-50 data-[state=checked]:border-green disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RRadio.Indicator className="size-2 rounded-full bg-green" />
    </RRadio.Item>
  );
}

/** A large selectable option card driven by a RadioGroup. */
export function RadioCard({
  value,
  title,
  description,
  meta,
  disabled,
  children,
  className,
}: {
  value: string;
  title: React.ReactNode;
  description?: React.ReactNode | undefined;
  meta?: React.ReactNode | undefined;
  disabled?: boolean | undefined;
  children?: React.ReactNode | undefined;
  className?: string | undefined;
}) {
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

/* ---------------- Select ---------------- */

export interface SelectOption {
  value: string;
  label: React.ReactNode;
  description?: React.ReactNode | undefined;
  disabled?: boolean | undefined;
}

export function Select({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  disabled,
  size = "md",
  id,
  "aria-label": ariaLabel,
}: {
  value: string | undefined;
  onValueChange: (v: string) => void;
  options: SelectOption[];
  placeholder?: string | undefined;
  className?: string | undefined;
  disabled?: boolean | undefined;
  size?: "sm" | "md";
  id?: string | undefined;
  "aria-label"?: string;
}) {
  return (
    <RSelect.Root value={value ?? ""} onValueChange={onValueChange} disabled={disabled}>
      <RSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-line-control bg-white px-3 text-left text-base text-ink transition-[border-color,box-shadow] duration-(--duration-micro) hover:border-line-strong focus:border-green focus:outline-none focus:ring-2 focus:ring-green/20 data-[placeholder]:text-ink-50 disabled:bg-paper disabled:text-ink-50",
          size === "sm" ? "h-8 text-sm" : "h-9",
          className,
        )}
      >
        <span className="truncate">
          <RSelect.Value placeholder={placeholder} />
        </span>
        <RSelect.Icon>
          <ChevronDown className="size-3.5 text-ink-50" />
        </RSelect.Icon>
      </RSelect.Trigger>
      <RSelect.Portal>
        <RSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 min-w-(--radix-select-trigger-width) overflow-hidden rounded-lg border border-line bg-white p-1 shadow-pop data-[state=open]:animate-in data-[state=closed]:animate-out"
        >
          <RSelect.Viewport>
            {options.map((o) => (
              <RSelect.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer select-none flex-col gap-0.5 rounded-sm py-1.5 pl-7 pr-2 text-sm text-ink outline-none data-[highlighted]:bg-paper-deep data-[disabled]:pointer-events-none data-[disabled]:text-ink-50"
              >
                <RSelect.ItemIndicator className="absolute left-2 top-2 text-green">
                  <Check className="size-3.5" />
                </RSelect.ItemIndicator>
                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                {o.description && <span className="text-xs text-ink-50">{o.description}</span>}
              </RSelect.Item>
            ))}
          </RSelect.Viewport>
        </RSelect.Content>
      </RSelect.Portal>
    </RSelect.Root>
  );
}
