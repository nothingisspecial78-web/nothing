import type { ReactNode } from "react";
import type { Sector } from "@/lib/khazna/types";
import { cn } from "@/lib/utils";
import { Amount } from "./primitives";
import { sectorIcon, tileVar } from "./sector-meta";

export function SectorTile({
  sector,
  value,
  delay: _delay,
  className,
  children,
}: {
  sector: Sector;
  value: number;
  delay?: number | undefined;
  className?: string | undefined;
  children?: ReactNode | undefined;
}) {
  const Icon = sectorIcon(sector.slug);
  return (
    <div
      className={cn("tile-glossy hover-lift p-4", className)}
      style={tileVar(sector.color)}
    >
      <div className="relative flex items-start justify-between gap-2">
        <span className="tile-icon size-9 shrink-0">
          <Icon className="size-4" />
        </span>
        <span className="rounded-full border border-hairline bg-background/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {sector.receiptPrefix.replace(/-$/, "") || sector.short}
        </span>
      </div>
      <div className="relative mt-3 font-medium text-sm text-foreground truncate">
        {sector.name}
      </div>
      <div className="relative mt-1 font-display text-xl font-semibold text-foreground num">
        <Amount value={value} />
      </div>
      {children && (
        <div className="relative mt-2.5 border-t border-hairline/70 pt-2 text-[11px] text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}
