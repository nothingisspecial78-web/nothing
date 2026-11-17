import { createFileRoute } from "@tanstack/react-router";
import { Building2, Check, Eraser, Image as ImageIcon, PenTool, Plus, QrCode, Save, ShieldCheck, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog } from "@/components/khazna/overlays";
import { Chip, Field, FilterChip, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { useKhazna } from "@/lib/khazna/store";
import type { InstitutionProfile, Signatory, SignatoryRole } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/institution")({
  head: () => ({
    meta: [
      { title: "Institution Profile — Khazna" },
      { name: "description", content: "Configure official branding, seal, authorized signatories, and QR verification settings." },
    ],
  }),
  component: InstitutionProfilePage,
});

type TabId = "identity" | "contact" | "logo" | "seal" | "signatories" | "qr" | "preview";

const TABS: { id: TabId; label: string }[] = [
  { id: "identity", label: "Identity" },
  { id: "contact", label: "Contact" },
  { id: "logo", label: "Logo" },
  { id: "seal", label: "Seal" },
  { id: "signatories", label: "Signatories" },
  { id: "qr", label: "QR Verify" },
  { id: "preview", label: "Live Preview" },
];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function InstitutionProfilePage() {
  const storedProfile = useKhazna((s) => s.institutionProfile);
  const updateProfile = useKhazna((s) => s.updateInstitutionProfile);
  const signatories = useKhazna((s) => s.signatories);
  const sectors = useKhazna((s) => s.sectors);
  const addSignatory = useKhazna((s) => s.addSignatory);
  const toggleSignatoryActive = useKhazna((s) => s.toggleSignatoryActive);
  const deleteSignatory = useKhazna((s) => s.deleteSignatory);

  const [tab, setTab] = useState<TabId>("identity");
  const [draft, setDraft] = useState<InstitutionProfile>(storedProfile);
  const [dirty, setDirty] = useState(false);

  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [sigName, setSigName] = useState("");
  const [sigDesignation, setSigDesignation] = useState("");
  const [sigRole, setSigRole] = useState<SignatoryRole>("hod");
  const [sigSector, setSigSector] = useState("");
  const [sigDataUrl, setSigDataUrl] = useState("");
  const [deletingSig, setDeletingSig] = useState<Signatory | null>(null);

  useEffect(() => {
    setDraft(storedProfile);
    setDirty(false);
  }, [storedProfile]);

  const setField = <K extends keyof InstitutionProfile>(k: K, v: InstitutionProfile[K]) => {
    setDraft((prev) => ({ ...prev, [k]: v }));
    setDirty(true);
  };

  const handleSave = () => {
    updateProfile(draft);
    setDirty(false);
    toast.success("Institution profile saved");
  };

  const handleImageUpload = async (e: ChangeEvent<HTMLInputElement>, target: "logo_path" | "seal_path") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = await readFileAsDataUrl(file);
    setDraft((prev) => ({
      ...prev,
      [target]: url,
      logo_version: target === "logo_path" ? prev.logo_version + 1 : prev.logo_version,
      seal_version: target === "seal_path" ? prev.seal_version + 1 : prev.seal_version,
    }));
    setDirty(true);
    toast.success(`Uploaded ${target === "logo_path" ? "institution logo" : "official seal"}`);
  };

  const handleCreateSignatory = () => {
    if (!sigName.trim() || !sigDesignation.trim()) {
      toast.error("Name and designation are required");
      return;
    }
    const res = addSignatory({
      full_name: sigName.trim(),
      designation: sigDesignation.trim(),
      role: sigRole,
      sector_id: sigRole === "hod" ? sigSector || sectors[0]?.slug : undefined,
      signature_path: sigDataUrl || undefined,
      active: true,
      signature_version: 1,
    });
    if (!res.success) {
      toast.error(res.error || "Failed to add signatory");
      return;
    }
    toast.success(`Added signatory ${sigName.trim()}`);
    setSigModalOpen(false);
    setSigName("");
    setSigDesignation("");
    setSigDataUrl("");
  };

  return (
    <div className="space-y-6 pb-20">
      <PageHeader
        eyebrow="Structure"
        title="Institution Profile"
        description="Official letterhead identity, seal, authorized signatories, and QR report verification policy."
      />

      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <FilterChip key={t.id} aiId={`institution-tab-${t.id}`} active={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </FilterChip>
        ))}
      </div>

      {tab === "identity" && (
        <GlassCard className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
          <Field label="Institution official name" required>
            <input value={draft.name} onChange={(e) => setField("name", e.target.value)} className="k-input" />
          </Field>
          <Field label="Short code / abbreviation">
            <input value={draft.short_name || ""} onChange={(e) => setField("short_name", e.target.value)} className="k-input" />
          </Field>
          <Field label="Tagline / affiliation">
            <input value={draft.tagline || ""} onChange={(e) => setField("tagline", e.target.value)} className="k-input" />
          </Field>
          <Field label="Registration number">
            <input value={draft.reg_no || ""} onChange={(e) => setField("reg_no", e.target.value)} className="k-input font-mono" />
          </Field>
          <Field label="Established year">
            <input value={draft.established_year || ""} onChange={(e) => setField("established_year", e.target.value)} className="k-input num" />
          </Field>
        </GlassCard>
      )}

      {tab === "contact" && (
        <GlassCard className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2">
          <Field label="Address line 1">
            <input value={draft.address_line1 || ""} onChange={(e) => setField("address_line1", e.target.value)} className="k-input" />
          </Field>
          <Field label="Address line 2">
            <input value={draft.address_line2 || ""} onChange={(e) => setField("address_line2", e.target.value)} className="k-input" />
          </Field>
          <Field label="City / Town">
            <input value={draft.city || ""} onChange={(e) => setField("city", e.target.value)} className="k-input" />
          </Field>
          <Field label="State">
            <input value={draft.state || ""} onChange={(e) => setField("state", e.target.value)} className="k-input" />
          </Field>
          <Field label="Official phone">
            <input value={draft.phone || ""} onChange={(e) => setField("phone", e.target.value)} className="k-input num" />
          </Field>
          <Field label="Official email">
            <input type="email" value={draft.email || ""} onChange={(e) => setField("email", e.target.value)} className="k-input" />
          </Field>
          <Field label="Website">
            <input value={draft.website || ""} onChange={(e) => setField("website", e.target.value)} className="k-input" />
          </Field>
        </GlassCard>
      )}

      {(tab === "logo" || tab === "seal") && (
        <GlassCard className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <div className="grid size-24 place-items-center overflow-hidden rounded-2xl border border-hairline bg-white/80 p-2">
            {(tab === "logo" ? draft.logo_path : draft.seal_path) ? (
              <img
                src={tab === "logo" ? draft.logo_path : draft.seal_path}
                alt={tab === "logo" ? "Institution logo" : "Official seal"}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <ImageIcon className="size-8 text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">
              {tab === "logo" ? "Institution Logo" : "Official Stamp / Seal"}
            </h3>
            <p className="text-xs text-muted-foreground">
              PNG or SVG recommended. Rendered on official student statements and class-wise reports.
            </p>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-hairline bg-accent px-3.5 py-2 text-xs font-medium text-foreground hover:bg-primary/10">
              <Upload className="size-3.5 text-primary" />
              <span>Upload {tab === "logo" ? "Logo" : "Seal"}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleImageUpload(e, tab === "logo" ? "logo_path" : "seal_path")}
              />
            </label>
          </div>
        </GlassCard>
      )}

      {tab === "signatories" && (
        <GlassCard className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-semibold text-foreground">Authorized Signatories</h3>
              <p className="text-xs text-muted-foreground">Digital signatures stamped into the PDF signature footer.</p>
            </div>
            <Btn variant="primary" size="sm" data-ai-id="signatory-add-btn" onClick={() => setSigModalOpen(true)}>
              <Plus /> Add signatory
            </Btn>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {signatories.map((sig) => (
              <div key={sig.id} className="glass-inset flex items-start justify-between gap-3 p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground">{sig.full_name}</span>
                    <Chip tone={sig.active ? "credit" : "neutral"}>{sig.active ? "Active" : "Inactive"}</Chip>
                  </div>
                  <div className="text-xs text-muted-foreground">{sig.designation}</div>
                  <div className="text-[11px] uppercase tracking-wider text-subtle">
                    Role: {sig.role.replace(/_/g, " ")}{sig.sector_id ? ` · ${sig.sector_id}` : ""}
                  </div>
                  {sig.signature_path && (
                    <img src={sig.signature_path} alt="Signature" className="mt-2 h-10 rounded border border-hairline bg-white px-2 py-1" />
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Btn
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      const res = toggleSignatoryActive(sig.id);
                      if (res.success) toast.success("Toggled signatory state");
                      else toast.error(res.error || "Conflict");
                    }}
                  >
                    {sig.active ? "Disable" : "Enable"}
                  </Btn>
                  <Btn variant="ghost" size="sm" className="text-debit" onClick={() => setDeletingSig(sig)}>
                    <Trash2 className="size-3.5" />
                  </Btn>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {tab === "qr" && (
        <GlassCard className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <QrCode className="size-5 text-primary" />
            <h3 className="font-semibold text-foreground">QR Verification Policy</h3>
          </div>
          <Field label="Default link expiry">
            <select
              value={draft.verify_expiry || "never"}
              onChange={(e) => setField("verify_expiry", e.target.value as InstitutionProfile["verify_expiry"])}
              className="k-input max-w-xs"
            >
              <option value="never">Never expire</option>
              <option value="90d">90 days</option>
              <option value="1y">1 year</option>
            </select>
          </Field>
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={!!draft.verify_mask_names}
              onChange={(e) => setField("verify_mask_names", e.target.checked)}
              className="size-4 accent-primary"
            />
            Mask staff names on public verification landing pages (`/v/:token`)
          </label>
        </GlassCard>
      )}

      {tab === "preview" && (
        <GlassCard className="p-6">
          <div className="rounded-2xl border border-border bg-white p-6 text-slate-900 shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-200 pb-4">
              <div className="flex items-center gap-3">
                {draft.logo_path ? (
                  <img src={draft.logo_path} alt="Logo preview" className="size-12 object-contain" />
                ) : (
                  <Building2 className="size-10 text-orange-500" />
                )}
                <div>
                  <div className="text-lg font-bold">{draft.name}</div>
                  <div className="text-xs text-slate-500">{draft.tagline}</div>
                </div>
              </div>
              <div className="text-right text-xs text-slate-500">
                <div>{draft.phone}</div>
                <div>{draft.email}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-slate-600">
              <span>Reg No: {draft.reg_no || "—"}</span>
              <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                <ShieldCheck className="size-3.5" /> QR Verification {draft.verify_expiry || "never"}
              </span>
            </div>
          </div>
        </GlassCard>
      )}

      {dirty && (
        <div className="fixed bottom-20 right-6 z-40 flex items-center gap-3 rounded-2xl border border-primary/40 bg-card px-4 py-3 shadow-xl md:bottom-6">
          <span className="text-xs font-medium text-foreground">Unsaved profile changes</span>
          <Btn variant="primary" size="sm" data-ai-id="institution-save-btn" onClick={handleSave}>
            <Save className="size-3.5" /> Save changes
          </Btn>
        </div>
      )}

      <KDialog
        open={sigModalOpen}
        onOpenChange={setSigModalOpen}
        title="Add authorized signatory"
        description="Draw or capture an official signature for verified PDF reports."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setSigModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" data-ai-id="signatory-save-btn" onClick={handleCreateSignatory}>
              <Check className="size-4" /> Save signatory
            </Btn>
          </>
        }
      >
        <div className="space-y-3.5">
          <Field label="Full name" required>
            <input value={sigName} onChange={(e) => setSigName(e.target.value)} className="k-input" placeholder="e.g. Dr. Hamza Saqafi" />
          </Field>
          <Field label="Designation" required>
            <input value={sigDesignation} onChange={(e) => setSigDesignation(e.target.value)} className="k-input" placeholder="e.g. Head of Department" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Role">
              <select value={sigRole} onChange={(e) => setSigRole(e.target.value as SignatoryRole)} className="k-input">
                <option value="accounts_officer">Accounts Officer</option>
                <option value="hod">Head of Department</option>
                <option value="principal">Principal</option>
                <option value="treasurer">Treasurer</option>
              </select>
            </Field>
            {sigRole === "hod" && (
              <Field label="Sector scope">
                <select value={sigSector} onChange={(e) => setSigSector(e.target.value)} className="k-input">
                  {sectors.map((s) => (
                    <option key={s.slug} value={s.slug}>{s.name}</option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          <SignaturePad onChange={setSigDataUrl} />
        </div>
      </KDialog>

      <KDialog
        open={!!deletingSig}
        onOpenChange={(o) => !o && setDeletingSig(null)}
        title="Remove signatory"
        description={deletingSig ? `Delete ${deletingSig.full_name} from institution signatories?` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeletingSig(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              onClick={() => {
                if (deletingSig) {
                  deleteSignatory(deletingSig.id);
                  toast.success(`Removed ${deletingSig.full_name}`);
                  setDeletingSig(null);
                }
              }}
            >
              Remove
            </Btn>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">Previously issued PDFs retain their historical signatures.</p>
      </KDialog>
    </div>
  );
}

function SignaturePad({ onChange }: { onChange: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);

  const pos = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * c.width) / rect.width,
      y: ((e.clientY - rect.top) * c.height) / rect.height,
    };
  };

  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };

  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const p = pos(e);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };

  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.clearRect(0, 0, c.width, c.height);
      onChange("");
    }
  };

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1"><PenTool className="size-3.5" /> Signature pad</span>
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-primary hover:underline">
          <Eraser className="size-3" /> Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        width={420}
        height={110}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        className="w-full touch-none rounded-xl border border-border bg-white"
      />
    </div>
  );
}
