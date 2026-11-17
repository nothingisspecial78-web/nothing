import { type HTMLMotionProps, motion } from "framer-motion";
import { Search, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { formatINR, initials } from "@/lib/khazna/format";
import type { TxType } from "@/lib/khazna/types";
import { cn } from "@/lib/utils";
import { reveal } from "./motion";

export function GlassCard({ className, children, transition, ...rest }: HTMLMotionProps<"div">) {
  const r = reveal();
  return (
    <motion.div {...r} transition={{ ...r.transition, ...transition }} className={cn("glass hover-lift", className)} {...rest}>
      {children}
    </motion.div>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode | undefined; title: ReactNode; description?: ReactNode | undefined; actions?: ReactNode | undefined }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <div className="mb-1.5 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-primary">
            <span className="h-px w-6 bg-gradient-primary" />
            {eyebrow}
          </div>
        )}
        <h1 className="text-2xl font-semibold text-foreground md:text-3xl">
          {title}
        </h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Amount({ value, type, sign, className }: { value: number; type?: TxType | undefined; sign?: boolean | undefined; className?: string | undefined }) {
  const signed = type ? (type === "credit" ? value : -value) : value;
  const tone = type ? (type === "credit" ? "text-credit" : "text-debit") : value < 0 ? "text-debit" : "";
  return <span className={cn("num", tone, className)}>{formatINR(signed, { sign: sign ?? !!type })}</span>;
}

type Tone = "credit" | "debit" | "info" | "primary" | "neutral" | "velitcham";
const toneCls: Record<Tone, string> = {
  credit: "bg-credit/12 text-credit border-credit/25",
  debit: "bg-debit/12 text-debit border-debit/25",
  info: "bg-info/12 text-info border-info/25",
  primary: "bg-primary/12 text-primary border-primary/25",
  velitcham: "bg-sector-velitcham/12 text-sector-velitcham border-sector-velitcham/25",
  neutral: "bg-accent text-muted-foreground border-hairline",
};
export function Chip({ tone = "neutral", children, className, icon: Icon }: { tone?: Tone | undefined; children: ReactNode; className?: string | undefined; icon?: LucideIcon | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", toneCls[tone], className)}>
      {Icon && <Icon className="size-3" />}
      {children}
    </span>
  );
}

export function CountUp({ value, format = formatINR, className }: { value: number; duration?: number | undefined; format?: (n: number) => string | undefined; className?: string | undefined }) {
  return (
    <span className={cn("num", className)}>
      {format(value) ?? ""}
    </span>
  );
}

export function ProgressRing({
  value,
  size = 140,
  stroke = 12,
  color = "var(--info)",
  children,
}: {
  value: number;
  size?: number | undefined;
  stroke?: number | undefined;
  color?: string | undefined;
  children?: ReactNode | undefined;
  delay?: number | undefined;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--hairline)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: "stroke-dashoffset 0.35s cubic-bezier(0.16, 1, 0.3, 1)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  tone = "primary",
  delay: _delay = 0,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  hint?: ReactNode | undefined;
  tone?: "primary" | "credit" | "debit" | "info" | undefined;
  delay?: number | undefined;
}) {
  const blobColor = { primary: "var(--primary)", credit: "var(--credit)", debit: "var(--debit)", info: "var(--info)" }[tone];
  const barTone = { primary: "bg-primary", credit: "bg-credit", debit: "bg-debit", info: "bg-info" }[tone];
  const iconTone = { primary: "text-primary bg-primary/12 border-primary/25", credit: "text-credit bg-credit/12 border-credit/25", debit: "text-debit bg-debit/12 border-debit/25", info: "text-info bg-info/12 border-info/25" }[tone];
  return (
    <div className="glass hover-lift group relative overflow-hidden p-5">
      <div
        className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full opacity-55 transition-transform duration-300 group-hover:scale-110 group-hover:opacity-80"
        style={{ background: `radial-gradient(circle, color-mix(in oklab, ${blobColor} 22%, transparent) 0%, transparent 70%)` }}
      />
      <div className="relative flex items-start justify-between gap-3">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <div className={cn("grid size-9 place-items-center rounded-xl border transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-110", iconTone)}>
          <Icon className="size-4" />
        </div>
      </div>
      <div className="relative mt-3 font-display text-2xl font-semibold text-foreground num md:text-[1.7rem]">{value}</div>
      {hint && <div className="relative mt-1.5 text-xs text-muted-foreground">{hint}</div>}
      <div className={cn("absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100", barTone)} />
    </div>
  );
}

export function Avatar({ name, size = 36, className }: { name: string; size?: number | undefined; className?: string | undefined }) {
  return (
    <div
      className={cn("grid shrink-0 place-items-center rounded-full border border-glass-border bg-gradient-to-br from-primary/40 to-sector-velitcham/30 font-semibold text-foreground", className)}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials(name)}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body }: { icon: LucideIcon; title: string; body?: string | undefined }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-2xl border border-hairline bg-accent text-muted-foreground">
        <Icon className="size-5" />
      </div>
      <div className="font-medium text-foreground">{title}</div>
      {body && <div className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, required }: { label: string; error?: string | undefined; hint?: string | undefined; children: ReactNode; required?: boolean | undefined }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-primary">*</span>}
      </span>
      {children}
      {error ? <span className="mt-1 block text-xs text-debit">{error}</span> : hint ? <span className="mt-1 block text-xs text-subtle">{hint}</span> : null}
    </label>
  );
}

function toAiSlug(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
  idPrefix = "seg",
}: {
  options: { value: T; label: ReactNode; activeClass?: string | undefined; aiId?: string | undefined }[];
  value: T;
  onChange: (v: T) => void;
  className?: string | undefined;
  idPrefix?: string | undefined;
}) {
  return (
    <div className={cn("glass-inset inline-flex gap-1 p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            data-ai-id={o.aiId ?? `${idPrefix}-${toAiSlug(String(o.value))}-tab`}
            onClick={() => onChange(o.value)}
            className={cn(
              "relative rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              active
                ? cn("border border-glass-border bg-accent text-foreground shadow-xs", o.activeClass)
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="relative z-10 inline-flex items-center gap-1.5">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search…", className, aiId = "search-input" }: { value: string; onChange: (v: string) => void; placeholder?: string | undefined; className?: string | undefined; aiId?: string | undefined }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
      <input data-ai-id={aiId} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="k-input pl-9" />
    </div>
  );
}

export function FilterChip({ active, onClick, children, aiId }: { active: boolean; onClick: () => void; children: ReactNode; aiId?: string | undefined }) {
  const fallback = typeof children === "string" ? `filter-${toAiSlug(children)}-chip` : "filter-chip";
  return (
    <button
      type="button"
      data-ai-id={aiId ?? fallback}
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active ? "border-primary/50 bg-primary/15 text-primary shadow-glow" : "border-hairline bg-accent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function TableShell({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <div className={cn("glass overflow-hidden w-full", className)}>
      <div className="w-full">{children}</div>
    </div>
  );
}

export function Pager({ page, pages, onPage, total, label = "rows", idPrefix = "pager" }: { page: number; pages: number; onPage: (p: number) => void; total: number; label?: string | undefined; idPrefix?: string | undefined }) {
  if (pages <= 1) return <div className="px-4 py-3 text-xs text-muted-foreground">{total} {label}</div>;
  return (
    <div className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-muted-foreground">
      <span>
        Page {page} of {pages} · {total} {label}
      </span>
      <div className="flex gap-1.5">
        <button data-ai-id={`${idPrefix}-prev-btn`} className="rounded-lg border border-hairline px-2.5 py-1 hover:bg-accent disabled:opacity-40" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </button>
        <button data-ai-id={`${idPrefix}-next-btn`} className="rounded-lg border border-hairline px-2.5 py-1 hover:bg-accent disabled:opacity-40" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
        </button>
      </div>
    </div>
  );
}

/**
 * Custom progressive scroll slice hook (no external virtualization library installed in workspace).
 * Loads only `batchSize` items initially and reveals more automatically when the bottom sentinel enters the viewport.
 */
export function useProgressiveSlice<T>(items: readonly T[], batchSize: number, resetKey: string) {
  const safeBatch = Math.max(1, batchSize);
  const [state, setState] = useState<{ key: string; count: number }>({
    key: resetKey,
    count: safeBatch,
  });

  // Reset synchronously on render when filter/route/sector key changes so stale counts never leak across pages
  const rawCount = state.key === resetKey ? state.count : safeBatch;
  const visibleCount = Math.min(items.length, rawCount);
  const hasMore = visibleCount < items.length;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadMore = useCallback(() => {
    setState((prev) => {
      const base = prev.key === resetKey ? prev.count : safeBatch;
      const next = Math.min(items.length, base + safeBatch);
      if (prev.key === resetKey && next === base) return prev;
      return { key: resetKey, count: next };
    });
  }, [items.length, resetKey, safeBatch]);

  useEffect(() => {
    if (!hasMore || typeof window === "undefined") return;
    const node = sentinelRef.current;

    const maybeLoadIfNearBottom = () => {
      if (!node) return;
      const rect = node.getBoundingClientRect();
      if (rect.top <= window.innerHeight + 240) {
        loadMore();
      }
    };

    let observer: IntersectionObserver | null = null;
    if (node && typeof IntersectionObserver !== "undefined") {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((e) => e.isIntersecting)) {
            loadMore();
          }
        },
        { rootMargin: "240px 0px" }
      );
      observer.observe(node);
    }

    window.addEventListener("scroll", maybeLoadIfNearBottom, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", maybeLoadIfNearBottom);
    };
  }, [hasMore, loadMore, visibleCount]);

  return {
    visibleItems: items.slice(0, visibleCount),
    visibleCount,
    totalCount: items.length,
    hasMore,
    loadMore,
    sentinelRef,
  };
}

export function ScrollLoadFooter({
  visibleCount,
  totalCount,
  hasMore,
  onLoadMore,
  sentinelRef,
  label = "rows",
  idPrefix = "scroll",
}: {
  visibleCount: number;
  totalCount: number;
  hasMore: boolean;
  onLoadMore: () => void;
  sentinelRef: { current: HTMLDivElement | null };
  label?: string | undefined;
  idPrefix?: string | undefined;
}) {
  if (totalCount === 0) return null;
  return (
    <div
      ref={sentinelRef}
      data-ai-id={`${idPrefix}-scroll-footer`}
      className="flex items-center justify-between border-t border-hairline px-4 py-3 text-xs text-muted-foreground"
    >
      <span>
        Showing {visibleCount} of {totalCount} {label}
      </span>
      {hasMore ? (
        <button
          type="button"
          data-ai-id={`${idPrefix}-load-more-btn`}
          onClick={onLoadMore}
          className="rounded-lg border border-hairline px-2.5 py-1 text-foreground transition-colors hover:bg-accent"
        >
          Scroll or load more ↓
        </button>
      ) : (
        <span className="text-[11px] text-subtle">All {totalCount} {label} loaded</span>
      )}
    </div>
  );
}

