import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { TODAY } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { Student } from "@/lib/khazna/types";
import { queueKhaznaMutationIfOffline } from "@/lib/network/offlineQueue";
import { SafeButton } from "@/components/network/SafeButton";
import { Btn } from "./btn";
import { KDrawer } from "./overlays";
import { Field } from "./primitives";

export function StudentFormDrawer({
  open,
  onOpenChange,
  student,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  student?: Student | null | undefined;
}) {
  const students = useKhazna((s) => s.students);
  const classes = useKhazna((s) => s.classes);
  const addStudent = useKhazna((s) => s.addStudent);
  const editStudent = useKhazna((s) => s.editStudent);
  const addClass = useKhazna((s) => s.addClass);

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [phone, setPhone] = useState("");
  const [guardian, setGuardian] = useState("");
  const [joined, setJoined] = useState(TODAY);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    if (student) {
      setId(student.id);
      setName(student.name);
      setClassName(student.className);
      setPhone(student.phone);
      setGuardian(student.guardian);
      setJoined(student.joined || TODAY);
      setErr("");
      return;
    }
    const maxNum = students.reduce((acc, s) => {
      const m = /\d+/.exec(s.id);
      return m ? Math.max(acc, Number(m[0])) : acc;
    }, 140);
    setId(`S${String(maxNum + 1).padStart(4, "0")}`);
    setName("");
    setClassName(classes[0] || "Fiqh 2");
    setPhone("");
    setGuardian("");
    setJoined(TODAY);
    setErr("");
  }, [open, student, students, classes]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!id.trim()) return setErr("Admission number is required.");
    if (name.trim().length < 2) return setErr("Student full name is required.");
    if (!className.trim()) return setErr("Class is required.");

    if (!classes.includes(className.trim())) {
      addClass(className.trim());
    }

    if (student) {
      const patch = {
        name: name.trim(),
        className: className.trim(),
        phone: phone.trim(),
        guardian: guardian.trim() || "Parent / Guardian",
        joined: joined || TODAY,
      };
      editStudent(student.id, patch);
      const queued = queueKhaznaMutationIfOffline(
        "EDIT_STUDENT",
        { id: student.id, ...patch },
        `Edit student ${student.id}`
      );
      toast.success(queued ? `Saved offline: ${patch.name} queued to sync` : `Updated ${patch.name}`);
    } else {
      const cleanId = id.trim().toUpperCase();
      if (students.some((s) => s.id.toUpperCase() === cleanId)) {
        return setErr(`Admission number ${cleanId} already exists.`);
      }
      const newStudent: Student = {
        id: cleanId,
        name: name.trim(),
        className: className.trim(),
        phone: phone.trim() || "9847000000",
        guardian: guardian.trim() || "Parent / Guardian",
        joined: joined || TODAY,
      };
      addStudent(newStudent);
      const queued = queueKhaznaMutationIfOffline(
        "ADD_STUDENT",
        newStudent as unknown as Record<string, unknown>,
        `Add student ${cleanId}`
      );
      toast.success(
        queued
          ? `Saved offline: ${newStudent.name} queued to sync`
          : `Added ${newStudent.name} (${cleanId})`
      );
    }
    onOpenChange(false);
  };

  if (!open) return null;

  return (
    <KDrawer
      open={open}
      onOpenChange={onOpenChange}
      title={student ? `Edit ${student.name}` : "Add student"}
      description={student ? `Admission No. ${student.id}` : "Enroll a new student into the campus directory."}
      footer={
        <>
          <Btn type="button" variant="ghost" data-ai-id="student-form-cancel-btn" onClick={() => onOpenChange(false)}>
            Cancel
          </Btn>
          <SafeButton type="submit" form="student-drawer-form" variant="primary" data-ai-id="student-form-submit-btn">
            {student ? "Save changes" : "Add student"}
          </SafeButton>
        </>
      }
    >
      <form id="student-drawer-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Admission Number" required>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            disabled={!!student}
            data-ai-id="student-form-id-input"
            className="k-input uppercase font-mono disabled:opacity-60"
            placeholder="S0150"
          />
        </Field>
        <Field label="Full Name" required>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            data-ai-id="student-form-name-input"
            className="k-input"
            placeholder="e.g. Muhammed Ameen"
          />
        </Field>
        <Field label="Class / Batch" required>
          <select
            value={className}
            onChange={(e) => setClassName(e.target.value)}
            data-ai-id="student-form-class-select"
            className="k-input"
          >
            {classes.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            {!classes.includes(className) && className && (
              <option value={className}>{className}</option>
            )}
          </select>
        </Field>
        <Field label="Guardian Name">
          <input
            value={guardian}
            onChange={(e) => setGuardian(e.target.value)}
            data-ai-id="student-form-guardian-input"
            className="k-input"
            placeholder="Parent or guardian name"
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Phone Number">
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-ai-id="student-form-phone-input"
              className="k-input num"
              placeholder="9847000000"
            />
          </Field>
          <Field label="Joined Date">
            <input
              type="date"
              value={joined}
              onChange={(e) => setJoined(e.target.value)}
              data-ai-id="student-form-joined-input"
              className="k-input"
            />
          </Field>
        </div>

        {err && (
          <div className="rounded-lg border border-debit/30 bg-debit/10 px-3 py-2 text-xs text-debit">
            {err}
          </div>
        )}
      </form>
    </KDrawer>
  );
}
