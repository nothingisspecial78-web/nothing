import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Plus, Power, Trash2, UserCog } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { KDialog, KDrawer } from "@/components/khazna/overlays";
import { Avatar, Chip, EmptyState, Field, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { timeAgo } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { Manager } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/admins")({
  head: () => ({
    meta: [
      { title: "Admins & Sector Managers — Khazna" },
      { name: "description", content: "Invite sector managers and assign which campus funds they manage." },
    ],
  }),
  component: AdminsPage,
});

function AdminsPage() {
  const managers = useKhazna((s) => s.managers);
  const sectors = useKhazna((s) => s.sectors);
  const inviteManager = useKhazna((s) => s.inviteManager);
  const editManager = useKhazna((s) => s.editManager);
  const assignSectors = useKhazna((s) => s.assignSectors);
  const toggleManagerStatus = useKhazna((s) => s.toggleManagerStatus);
  const deleteManager = useKhazna((s) => s.deleteManager);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Manager | null>(null);
  const [deleting, setDeleting] = useState<Manager | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);

  const openNew = () => {
    setEditing(null);
    setName("");
    setEmail("");
    setPhone("");
    setSelectedSectors(sectors[0] ? [sectors[0].slug] : []);
    setDrawerOpen(true);
  };

  const openEdit = (m: Manager) => {
    setEditing(m);
    setName(m.name);
    setEmail(m.email);
    setPhone(m.phone);
    setSelectedSectors(m.sectors);
    setDrawerOpen(true);
  };

  const toggleSectorChoice = (slug: string) => {
    setSelectedSectors((prev) =>
      prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]
    );
  };

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    if (editing) {
      editManager(editing.id, {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
      });
      assignSectors(editing.id, selectedSectors);
      toast.success(`Updated manager ${name.trim()}`);
    } else {
      inviteManager({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || "9847000000",
        sectors: selectedSectors,
      });
      toast.success(`Invited ${name.trim()}`);
    }
    setDrawerOpen(false);
  };

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Sector Managers"
        description="Assign departmental treasurers and staff to specific sectors with scoped ledger access."
        actions={
          <Btn data-ai-id="managers-invite-btn" variant="primary" onClick={openNew}>
            <Plus /> Invite manager
          </Btn>
        }
      />

      {managers.length === 0 ? (
        <GlassCard>
          <EmptyState
            icon={UserCog}
            title="No sector managers yet"
            body="Invite a department treasurer or union secretary and assign them a sector."
          />
        </GlassCard>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {managers.map((m) => (
            <GlassCard key={m.id} className="flex flex-col justify-between gap-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <Avatar name={m.name} size={42} />
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-foreground">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                    <div className="text-[11px] text-subtle num">{m.phone} · active {timeAgo(m.lastActive)}</div>
                  </div>
                </div>
                <Chip tone={m.status === "active" ? "credit" : m.status === "invited" ? "info" : "debit"}>
                  {m.status}
                </Chip>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {m.sectors.length === 0 ? (
                  <span className="text-xs text-muted-foreground">No sectors assigned</span>
                ) : (
                  m.sectors.map((slug) => {
                    const sec = sectors.find((s) => s.slug === slug);
                    return (
                      <Chip key={slug} tone="primary">
                        {sec?.name ?? slug}
                      </Chip>
                    );
                  })
                )}
              </div>

              <div className="flex items-center justify-end gap-1.5 border-t border-hairline pt-3">
                <Btn
                  variant="ghost"
                  size="sm"
                  data-ai-id={`manager-toggle-${m.id}`}
                  onClick={() => {
                    toggleManagerStatus(m.id);
                    toast.success(`Updated status for ${m.name}`);
                  }}
                >
                  <Power className="size-3.5" /> {m.status === "active" ? "Suspend" : "Activate"}
                </Btn>
                <Btn variant="soft" size="sm" data-ai-id={`manager-edit-${m.id}`} onClick={() => openEdit(m)}>
                  <Pencil className="size-3.5" /> Edit
                </Btn>
                <Btn
                  variant="ghost"
                  size="sm"
                  data-ai-id={`manager-delete-${m.id}`}
                  data-sensitive="true"
                  onClick={() => setDeleting(m)}
                  className="text-debit hover:bg-debit/10"
                >
                  <Trash2 className="size-3.5" />
                </Btn>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      <KDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        title={editing ? `Edit ${editing.name}` : "Invite sector manager"}
        description="Managers can view and post entries only in their assigned sectors."
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDrawerOpen(false)}>Cancel</Btn>
            <Btn type="submit" form="manager-form" variant="primary" data-ai-id="manager-form-submit-btn">
              {editing ? "Save changes" : "Send invite"}
            </Btn>
          </>
        }
      >
        <form id="manager-form" onSubmit={handleSave} className="space-y-4">
          <Field label="Full name" required>
            <input value={name} onChange={(e) => setName(e.target.value)} className="k-input" placeholder="e.g. Usthad Shameer" />
          </Field>
          <Field label="Email" required>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="k-input" placeholder="manager@college.edu" />
          </Field>
          <Field label="Phone">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="k-input num" placeholder="9847000000" />
          </Field>
          <div>
            <span className="mb-2 block text-xs font-medium text-muted-foreground">Assigned sectors</span>
            <div className="space-y-2">
              {sectors.map((s) => (
                <label key={s.slug} className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-hairline bg-accent/50 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedSectors.includes(s.slug)}
                    onChange={() => toggleSectorChoice(s.slug)}
                    className="size-4 accent-primary"
                  />
                  <span className="flex-1 text-foreground">{s.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s.receiptPrefix}</span>
                </label>
              ))}
            </div>
          </div>
        </form>
      </KDrawer>

      <KDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove manager"
        description={deleting ? `Revoke portal access for ${deleting.name} (${deleting.email})?` : undefined}
        footer={
          <>
            <Btn variant="ghost" onClick={() => setDeleting(null)}>Cancel</Btn>
            <Btn
              variant="danger"
              data-ai-id="confirm-delete-manager-btn"
              onClick={() => {
                if (deleting) {
                  deleteManager(deleting.id);
                  toast.success(`Removed ${deleting.name}`);
                  setDeleting(null);
                }
              }}
            >
              Remove manager
            </Btn>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Existing ledger entries created by this manager remain preserved in the audit log.
        </p>
      </KDialog>
    </div>
  );
}
