import { Slot } from "@radix-ui/react-slot";
import * as React from "react";
import { cn } from "@/lib/utils";

export interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "glass" | "soft" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}

const VARIANT: Record<NonNullable<BtnProps["variant"]>, string> = {
  primary:
    "bg-gradient-primary text-primary-foreground shadow-glow hover:brightness-105 active:scale-[0.98]",
  glass:
    "glass-strong text-foreground border border-glass-border hover:bg-accent active:scale-[0.98]",
  soft:
    "bg-primary/12 text-primary border border-primary/25 hover:bg-primary/20 active:scale-[0.98]",
  ghost:
    "text-muted-foreground hover:bg-accent hover:text-foreground active:scale-[0.98]",
  danger:
    "bg-debit text-white shadow-sm hover:brightness-105 active:scale-[0.98]",
};

const SIZE: Record<NonNullable<BtnProps["size"]>, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-lg [&_svg]:size-3.5",
  md: "h-10 px-4 text-sm gap-2 rounded-xl [&_svg]:size-4",
  lg: "h-11 px-5 text-base gap-2 rounded-xl [&_svg]:size-4",
};

export const Btn = React.forwardRef<HTMLButtonElement, BtnProps>(
  ({ className, variant = "glass", size = "md", asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-all disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
          VARIANT[variant],
          SIZE[size],
          className
        )}
        {...props}
      />
    );
  }
);
Btn.displayName = "Btn";
