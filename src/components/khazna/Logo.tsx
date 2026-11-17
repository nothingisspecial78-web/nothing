import { cn } from "@/lib/utils";

export function Logo({
  size = "md",
  tagline,
  className,
}: {
  size?: "sm" | "md" | "lg";
  tagline?: string;
  className?: string;
}) {
  const iconCls = size === "lg" ? "size-10 rounded-2xl text-lg" : size === "sm" ? "size-7 rounded-lg text-xs" : "size-8 rounded-xl text-sm";
  const textCls = size === "lg" ? "text-xl" : size === "sm" ? "text-sm" : "text-base";

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span
        className={cn(
          "grid place-items-center bg-gradient-primary font-display font-bold text-primary-foreground shadow-glow",
          iconCls
        )}
      >
        K
      </span>
      <div className="leading-none">
        <div className={cn("font-display font-semibold tracking-tight text-foreground", textCls)}>
          Khazna
        </div>
        {tagline && (
          <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{tagline}</div>
        )}
      </div>
    </div>
  );
}
