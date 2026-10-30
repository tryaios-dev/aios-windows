import * as React from "react";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "destructive" | "link" | "outline";
export type ButtonSize = "sm" | "md" | "lg";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-green text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] hover:bg-green-deep active:bg-green-dark disabled:bg-green/50",
  secondary: "bg-paper-raised text-ink border border-line hover:bg-white hover:border-line-strong active:bg-paper-deep disabled:text-ink-50",
  outline: "bg-transparent text-green border border-green/70 hover:bg-green-wash hover:border-green active:bg-green-soft disabled:text-ink-50",
  ghost: "bg-transparent text-ink-soft hover:bg-ink-6 hover:text-ink active:bg-ink-12 disabled:text-ink-50",
  destructive: "bg-deny text-white hover:bg-deny-deep active:bg-deny-dark disabled:bg-deny/50",
  link: "bg-transparent text-green underline-offset-4 hover:underline px-0 h-auto disabled:text-ink-50",
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-sm gap-1.5 rounded-sm",
  md: "h-8.5 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-10 px-4 text-base gap-2 rounded-md",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean | undefined;
  asChild?: boolean;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, asChild, leading, trailing, children, disabled, type = "button", ...props },
  ref,
) {
  const Comp: React.ElementType = asChild ? Slot.Root : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      disabled={disabled || loading}
      data-variant={variant}
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-(--duration-micro) ease-(--ease-out) active:translate-y-px disabled:cursor-not-allowed disabled:active:translate-y-0",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : leading}
      {children}
      {trailing}
    </Comp>
  );
});

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: "sm" | "md";
  variant?: "ghost" | "secondary";
  active?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, label, size = "md", variant = "ghost", active, type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md text-ink-soft transition-colors duration-(--duration-micro) ease-(--ease-out) hover:text-ink disabled:text-ink-50 disabled:hover:bg-transparent",
        variant === "ghost" ? "hover:bg-ink-6 active:bg-ink-12" : "border border-line bg-paper-raised hover:bg-white",
        size === "sm" ? "size-7 [&>svg]:size-3.5" : "size-8 [&>svg]:size-4",
        active && "bg-ink-6 text-ink",
        className,
      )}
      {...props}
    />
  );
});
