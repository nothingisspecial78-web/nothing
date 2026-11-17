import { Link, createFileRoute } from "@tanstack/react-router";
import { GraduationCap, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog, KDrawer } from "@/components/khazna/overlays";
import { Chip, Field, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { sectorIcon, tileVar } from "@/components/khazna/sector-meta";
import { formatCompactINR } from "@/lib/khazna/format";
import { totals } from "@/lib/khazna/ledger";
import { useKhazna } from "@/lib/khazna/store";
import type { Sector } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/sectors")({
  head: () => ({
    meta: [
      { title: "Sectors & Classes — Khazna" },
      { name: "description", content: "Configure college cash sectors, targets, receipt prefixes, and academic classes." },
    ],
  }),
  component: SectorsAndClassesPage,
});

const COLOR_OPTIONS = [
  { label: "Orange (Office)", value: "var(--sector-office)" },
  { label: "Blue (Fiqh)", value: "var(--sector-fiqh)" },
  { label: "Emerald (Ihsan)", value: "var(--sector-ihsan)" },
  { label: "Violet (Velitcham)", value: "var(--sector-velitcham)" },
  { label: "Pink (Civil)", value: "var(--sector-civil)" },
];

function SectorsAndClassesPage() {
  const sectors = useKhazna((s) => s.sectors);
  const txs = useKhazna((s) => s.transactions);
  const classes = useKhazna((s) => s.classes);
  const addSector = useKhazna((s) => s.addSector);
  const updateSector = useKhazna((s) => s.updateSector);
  const deleteSector = useKhazna((s) => s.deleteSector);
  const addClass = useKhazna((s) => s.addClass);
  const editClass = useKhazna((s) => s.editClass);
  const removeClass = useKhazna((s) => s.removeClass);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Sector | null>(null);
  const [deleting, setDeleting] = useState<Sector | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [receiptPrefix, setReceiptPrefix] = useState("");
  const [target, setTarget] = useState("250000");
  const [color, setColor] = useState("var(--sector-office)");

  const [newClassName, setNewClassName] = useState("");
  const [renamingClass, setRenamingClass] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setReceiptPrefix("");
    setTarget("250000");
    setColor("var(--sector-office)");
    setDrawerOpen(true);
  };

  const openEdit = (s: Sector) => {
    setEditing(s);
    setName(s.name);
    setDescription(s.description);
    setReceiptPrefix(s.receiptPrefix);
    setTarget(String(s.target));
    setColor(s.color);
    setDrawerOpen(true);
  };

  const handleSaveSector = (e: FormEvent) => {
    e.preventDefault();
    const numTarget = Number(target);
    if (!editing && !name.trim()) {
      toast.error("Enter a sector name");
      return;
    }
    if (!Number.isFinite(numTarget) || numTarget < 0) {
      toast.error("Enter a valid target amount");
      return;
    }
    if (editing) {
      updateSector(editing.slug, {
        description: description.trim(),
        receiptPrefix: receiptPrefix.trim().toUpperCase() || editing.receiptPrefix,
        target: Math.round(numTarget),
      });
      toast.success(`Updated ${editing.name}`);
    } else {
      const cleanName = name.trim();
      const autoPrefix =
        cleanName
          .split(/\s+/)
          .map((w) => w[0] || "")
          .join("")
          .slice(0, 2)
          .toUpperCase() + "-";
      addSector({
        name: cleanName,
        description: description.trim() || `${cleanName} campus fund`,
        receiptPrefix: (receiptPrefix.trim() || autoPrefix).toUpperCase(),
        target: Math.round(numTarget),
        color,
      });
      toast.success(`Created sector ${cleanName}`);
    }
    setDrawerOpen(false);
  };

  const handleAddClass = (e: FormEvent) => {
    e.preventDefault();
    const clean = newClassName.trim();
    if (!clean) return;
    addClass(clean);
    setNewClassName("");
    toast.success(`Added class ${clean}`);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Structure"
        title="Sectors & Classes"
        description="Manage college cash sectors, collection targets, and academic classes."
        actions={
          <Btn
            data-ai-id="sectors-create-btn"
            data-guide-id="sectors-create-button"
            variant="primary"
            onClick={openCreate}
          >
            <Plus /> New Sector
          </Btn>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {sectors.map((s) => {
          const t = totals(txs, { sector: s.slug });
          const Icon = sectorIcon(s.slug);
          return (
            <GlassCard key={s.slug} className="flex flex-col justify-between gap-4 p-5" style={tileVar(s.color)}>
              <div>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="tile-icon size-10 shrink-0">
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate font-semibold text-foreground">{s.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">Prefix: {s.receiptPrefix}</div>
                    </div>
                  </div>
                  <Chip tone="neutral">{t.count} entries</Chip>
                </div>
                <p className="mt-3 text-xs text-muted-foreground">{s.description}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="glass-inset p-2.5">
                  <div className="text-muted-foreground">Balance</div>
                  <div className="mt-0.5 font-semibold text-foreground num">{formatCompactINR(t.balance)}</div>
                </div>
                <div className="glass-inset p-2.5">
                  <div className="text-muted-foreground">Target</div>
                  <div className="mt-0.5 font-semibold text-foreground num">{formatCompactINR(s.target)}</div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-hairline pt-3">
                <Link
                  to="/m/$sectorSlug"
                  params={{ sectorSlug: s.slug }}
                  onClick={() => {
                    const st = useKhazna.getState();
                    st.setManagerSector(s.slug);
                    st.setCurrentRole("manager");
                  }}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  Open ledger →
                </Link>
                <div className="flex items-center gap-1">
                  <Btn variant="ghost" size="sm" data-ai-id={`sector-edit-${s.slug}`} onClick={() => openEdit(s)}>
                    <Pencil className="size-3.5" />
                  </Btn>
                  <Btn
                    variant="ghost"
                    size="sm"
                    data-ai-id={`sector-delete-${s.slug}`}
                    data-sensitive="true"
                    onClick={() => setDeleting(s)}
                    className="text-debit hover:bg-debit/10"
                  >
                    <Trash2 className="size-3.5" />
                  </Btn>
                </div>
              </div>
            </GlassCard>
          );
        })}
      </div>

      <GlassCard className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary">
              <GraduationCap className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-foreground">Academic Classes</h2>
              <p className="text-xs text-muted-foreground">Used for student directory filters and class-wise reports.</p>
            </div>
          </div>

          <form onSubmit={handleAddClass} className="flex items-center gap-2">
            <input
              value={newClassName}
              onChange={(e) => setNewClassName(e.target.value)}
              data-ai-id="class-add-input"
              placeholder="New class name…"
              className="k-input h-9 w-48"
            />
            <Btn type="submit" variant="primary" size="sm" data-ai-id="class-add-btn">
              <Plus className="size-4" /> Add class
            </Btn>
          </form>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3">
          {classes.map((c) => (
            <div key={c} className="glass-inset flex items-center justify-between gap-2 px-3 py-2.5">
              {renamingClass === c ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    editClass(c, renameValue);
                    setRenamingClass(null);
                    toast.success(`Renamed ${c}`);
                  }}
                  className="flex flex-1 items-center gap-1.5"
                >
                  <input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="k-input h-8 flex-1 text-xs"
                    autoFocus
                  />
                  <Btn type="submit" size="sm" variant="primary">Save</Btn>
                </form>
              ) : (
                <>
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers className="size-3.5 shrink-0 text-primary" />
                    <span className="truncate text-sm font-medium text-foreground">{c}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Btn
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setRenamingClass(c);
                        setRenameValue(c);
                      }}
                    >
                      <Pencil className="size-3" />
                    </Btn>
                    <Btn
                      variant="ghost"
                      size="sm"
                      className="text-debit hover:bg-debit/10"
                      onClick={() => {
                        removeClass(c);
                        toast.success(`Removed class ${c}`);
                      }}
                    >
                      <Trash2 className="size-3" />
                    </Btn>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </GlassCard>

      <KDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editing ? `Edit ${editing.name}` : "Create sector"}
        description="Configure fund details and receipt numbering prefix."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</Btn>
            <Btn type="submit" form="sector-form" variant="primary" data-ai-id="sector-form-submit-btn">
              {editing ? "Save sector" : "Create sector"}
            </Btn>
          </>
        }
      >
        <form id="sector-form" onSubmit={handleSaveSector} className="space-y-4">
          {!editing && (
            <Field label="Sector name" required>
              <input value={name} onChange={(e) => setName(e.target.value)} className="k-input" placeholder="e.g. Library Fund" />
            </Field>
          )}
          <Field label="Description">
            <input value={description} onChange={(e) => setDescription(e.target.value)} className="k-input" placeholder="Purpose of this fund" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Receipt prefix">
              <input value={receiptPrefix} onChange={(e) => setReceiptPrefix(e.target.value)} className="k-input font-mono uppercase" placeholder="e.g. LB-" />
            </Field>
            <Field label="Term target (INR)">
              <input type="number" min="0" value={target} onChange={(e) => setTarget(e.target.value)} className="k-input num" />
            </Field>
          </div>
          {!editing && (
            <Field label="Theme color">
              <select value={color} onChange={(e) => setColor(e.target.value)} className="k-input">
                {COLOR_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </Field>
          )}
        </form>
      </KDrawer>

      <KDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete sector"
        description={deleting ? `Remove ${deleting.name} from active college sectors?` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleting(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              data-ai-id="confirm-delete-sector-btn"
              onClick={() => {
                if (deleting) {
                  deleteSector(deleting.slug);
                  toast.success(`Removed sector ${deleting.name}`);
                  setDeleting(null);
                }
              }}
            >
              Delete sector
            </Btn>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Historical ledger entries remain safely archived in storage.</p>
      </KDialog>
    </div>
  );
}
