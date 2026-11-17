import { Link, createFileRoute } from "@tanstack/react-router";
import { LogOut, Phone, Save } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { Avatar, Field, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { formatDate } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";

export const Route = createFileRoute("/app/profile")({
  head: () => ({
    meta: [
      { title: "My Profile — Khazna Student" },
      { name: "description", content: "Admission details, guardian contact, and mobile number preferences." },
    ],
  }),
  component: StudentProfilePage,
});

function StudentProfilePage() {
  const meStudentId = useKhazna((s) => s.meStudentId);
  const me = useKhazna((s) => s.students.find((x) => x.id === meStudentId));
  const updatePhone = useKhazna((s) => s.updatePhone);
  const [phone, setPhone] = useState(me?.phone ?? "");

  useEffect(() => {
    setPhone(me?.phone ?? "");
  }, [me?.phone]);

  const handleSave = (e: FormEvent) => {
    e.preventDefault();
    if (!me) return;
    if (phone.trim().length < 7) {
      toast.error("Enter a valid phone number");
      return;
    }
    updatePhone(me.id, phone.trim());
    toast.success("Phone number updated");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Student Profile"
        description="Your admission record and guardian contact information."
      />

      <GlassCard data-guide-id="student-profile-card" className="space-y-6 p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar name={me?.name ?? "Student"} size={56} />
            <div>
              <h2 className="text-xl font-semibold text-foreground">{me?.name ?? "Student"}</h2>
              <div className="text-sm text-muted-foreground num">
                {me?.id ?? meStudentId} · {me?.className ?? "—"}
              </div>
            </div>
          </div>
          <Btn asChild variant="glass" size="sm">
            <Link to="/login" data-ai-id="profile-signout-link" data-sensitive="true">
              <LogOut className="size-4" /> Sign out
            </Link>
          </Btn>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="glass-inset p-3.5">
            <div className="text-xs text-muted-foreground">Admission Number</div>
            <div className="mt-1 font-mono font-semibold text-foreground">{me?.id ?? meStudentId}</div>
          </div>
          <div className="glass-inset p-3.5">
            <div className="text-xs text-muted-foreground">Guardian</div>
            <div className="mt-1 font-medium text-foreground">{me?.guardian ?? "—"}</div>
          </div>
          <div className="glass-inset p-3.5">
            <div className="text-xs text-muted-foreground">Joined</div>
            <div className="mt-1 font-medium text-foreground">{me?.joined ? formatDate(me.joined) : "—"}</div>
          </div>
        </div>

        <form onSubmit={handleSave} className="max-w-sm space-y-3 border-t border-hairline pt-5">
          <Field label="Contact Phone Number">
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                data-ai-id="student-profile-phone-input"
                className="k-input pl-9 num"
              />
            </div>
          </Field>
          <Btn type="submit" variant="primary" data-ai-id="student-profile-save-btn">
            <Save className="size-4" /> Save phone number
          </Btn>
        </form>
      </GlassCard>
    </div>
  );
}
