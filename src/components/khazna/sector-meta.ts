import {
  BookOpen,
  Building2,
  HeartHandshake,
  Layers,
  Newspaper,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { SectorSlug } from "@/lib/khazna/types";

export function sectorIcon(slug: SectorSlug): LucideIcon {
  const s = String(slug || "").toLowerCase();
  if (s.includes("office")) return Building2;
  if (s.includes("ihsan") || s.includes("welfare")) return HeartHandshake;
  if (s.includes("velitcham") || s.includes("mag")) return Newspaper;
  if (s.includes("fiqh") || s.includes("hadith") || s.includes("dept")) return BookOpen;
  if (s.includes("civil") || s.includes("maint")) return Wrench;
  return Layers;
}

export function tileVar(color?: string): CSSProperties {
  return {
    "--tile": color || "var(--sector-office)",
  } as CSSProperties;
}
