import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import { Btn } from "@/components/khazna/btn";
import { Chip, GlassCard, PageHeader } from "@/components/khazna/primitives";
import { downloadCSV } from "@/lib/khazna/download";
import { TODAY } from "@/lib/khazna/format";
import { useKhazna } from "@/lib/khazna/store";
import type { Student } from "@/lib/khazna/types";

export const Route = createFileRoute("/admin/students/import")({
  head: () => ({
    meta: [
      { title: "Bulk Import Students — Khazna" },
      { name: "description", content: "Import student rosters via CSV or Excel spreadsheets." },
    ],
  }),
  component: StudentImportPage,
});

const SAMPLE_ROWS = [
  ["id", "name", "className", "phone", "guardian"],
  ["S0201", "Amina K.", "Fiqh 2", "9847001122", "Kareem P."],
  ["S0202", "Hisham P.", "Hadith 1", "9847002233", "Pocker Haji"],
  ["S0203", "Rasha M.", "Usul 1", "9847003344", "Moideen K."],
  ["S0204", "Salman N.", "Fiqh 1", "9847004455", "Nazar T."],
];

function parseDelimitedText(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const sep = line.includes("\t") ? "\t" : ",";
      return line.split(sep).map((cell) => cell.replace(/^"|"$/g, "").trim());
    });
}

function StudentImportPage() {
  const navigate = useNavigate();
  const importStudents = useKhazna((s) => s.importStudents);
  const students = useKhazna((s) => s.students);
  const existingIds = useMemo(() => new Set(students.map((x) => x.id.toUpperCase())), [students]);
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [colMap, setColMap] = useState({
    id: 0,
    name: 1,
    className: 2,
    phone: 3,
    guardian: 4,
  });

  const loadMatrix = (name: string, matrix: string[][]) => {
    if (matrix.length < 2) {
      toast.error("Spreadsheet needs a header row and at least one student row");
      return;
    }
    const hdr = matrix[0]!;
    const body = matrix.slice(1);
    const findCol = (pats: string[], fallback: number) => {
      const idx = hdr.findIndex((h) => pats.some((p) => h.toLowerCase().includes(p)));
      return idx >= 0 ? idx : Math.min(fallback, Math.max(0, hdr.length - 1));
    };
    setFileName(name);
    setHeaders(hdr);
    setRawRows(body);
    setColMap({
      id: findCol(["id", "adm", "ad.no", "roll"], 0),
      name: findCol(["name", "student"], 1),
      className: findCol(["class", "batch", "dept"], 2),
      phone: findCol(["phone", "mobile", "contact"], 3),
      guardian: findCol(["guardian", "parent", "father"], 4),
    });
    toast.success(`Loaded ${body.length} row(s) from ${name}`);
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) {
      try {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]!];
        const matrix = XLSX.utils.sheet_to_json<string[]>(ws!, { header: 1, defval: "" }).map((r) =>
          r.map((c) => String(c ?? "").trim())
        );
        loadMatrix(file.name, matrix.filter((r) => r.some(Boolean)));
      } catch (err) {
        console.error(err);
        toast.error("Failed to read Excel workbook");
      }
      return;
    }
    const text = await file.text();
    loadMatrix(file.name, parseDelimitedText(text));
  };

  const parsedStudents = useMemo(() => {
    return rawRows.map((row, idx) => {
      const id = (row[colMap.id] || `S${900 + idx}`).trim().toUpperCase();
      const name = (row[colMap.name] || "").trim();
      const className = (row[colMap.className] || "General").trim();
      const phone = (row[colMap.phone] || "").trim();
      const guardian = (row[colMap.guardian] || "Parent / Guardian").trim();
      const duplicate = existingIds.has(id);
      const valid = name.length >= 2 && id.length >= 2 && !duplicate;
      const reason = duplicate ? "Already exists" : name.length < 2 ? "Missing name" : "";
      const student: Student = { id, name, className, phone, guardian, joined: TODAY };
      return { student, valid, reason };
    });
  }, [rawRows, colMap, existingIds]);

  const validStudents = parsedStudents.filter((p) => p.valid).map((p) => p.student);

  const confirmImport = () => {
    if (validStudents.length === 0) {
      toast.error("No valid new student rows to import");
      return;
    }
    importStudents(validStudents);
    toast.success(`Imported ${validStudents.length} student(s)`);
    void navigate({ to: "/admin/students" });
  };

  return (
    <div>
      <PageHeader
        eyebrow="People"
        title="Bulk Student Import"
        description="Upload a CSV or Excel sheet to enroll multiple students and create their classes automatically."
        actions={
          <Btn
            data-ai-id="import-download-template-btn"
            data-guide-id="import-download-template"
            variant="glass"
            onClick={() => {
              downloadCSV("khazna-students-template.csv", SAMPLE_ROWS);
              toast.success("Downloaded students template CSV");
            }}
          >
            <Download /> Download template
          </Btn>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {[
          { n: 1 as const, label: "1. Upload spreadsheet" },
          { n: 2 as const, label: "2. Map columns" },
          { n: 3 as const, label: "3. Validate & import" },
        ].map((item) => (
          <Chip key={item.n} tone={step === item.n ? "primary" : step > item.n ? "credit" : "neutral"}>
            {item.label}
          </Chip>
        ))}
      </div>

      {step === 1 && (
        <GlassCard className="p-6">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,.xlsx,.xls"
            onChange={handleFileChange}
            className="hidden"
          />
          <button
            type="button"
            data-ai-id="import-dropzone-btn"
            data-guide-id="import-dropzone"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/35 bg-accent/40 px-6 py-12 text-center transition-colors hover:border-primary hover:bg-accent"
          >
            <Upload className="mb-3 size-9 text-primary" />
            <div className="text-base font-semibold text-foreground">
              {fileName ? `Loaded: ${fileName} (${rawRows.length} rows)` : "Click to choose a CSV or Excel (.xlsx) file"}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Expected columns: Admission No, Full Name, Class, Phone, Guardian
            </div>
          </button>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <Btn
              type="button"
              variant="soft"
              data-ai-id="import-try-sample-btn"
              onClick={() => loadMatrix("sample-students.csv", SAMPLE_ROWS)}
            >
              <FileSpreadsheet /> Try sample file
            </Btn>
            <Btn
              type="button"
              variant="primary"
              data-ai-id="import-continue-step1-btn"
              data-guide-id="import-continue-step1"
              disabled={rawRows.length === 0}
              onClick={() => setStep(2)}
            >
              Continue <ArrowRight />
            </Btn>
          </div>
        </GlassCard>
      )}

      {step === 2 && (
        <GlassCard className="space-y-4 p-6">
          <h2 className="text-lg font-semibold text-foreground">Map Spreadsheet Columns</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ["id", "Admission Number"],
                ["name", "Full Name"],
                ["className", "Class"],
                ["phone", "Phone"],
                ["guardian", "Guardian"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
                <select
                  value={colMap[key]}
                  onChange={(e) => setColMap((m) => ({ ...m, [key]: Number(e.target.value) }))}
                  className="k-input"
                >
                  {headers.map((h, i) => (
                    <option key={`${h}-${i}`} value={i}>
                      Col {i + 1}: {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Btn variant="ghost" onClick={() => setStep(1)}>Back</Btn>
            <Btn
              variant="primary"
              data-ai-id="import-continue-step2-btn"
              data-guide-id="import-continue-step2"
              onClick={() => setStep(3)}
            >
              Validate rows <ArrowRight />
            </Btn>
          </div>
        </GlassCard>
      )}

      {step === 3 && (
        <GlassCard className="space-y-4 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Validation Preview</h2>
              <p className="text-xs text-muted-foreground">
                {validStudents.length} valid new student(s) ready to import out of {parsedStudents.length} rows.
              </p>
            </div>
            <Chip tone="credit">
              <CheckCircle2 className="size-3.5" /> {validStudents.length} ready
            </Chip>
          </div>

          <div className="overflow-x-auto rounded-xl border border-hairline">
            <table className="k-table">
              <thead>
                <tr>
                  <th>Ad.No</th>
                  <th>Name</th>
                  <th>Class</th>
                  <th>Phone</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {parsedStudents.slice(0, 20).map(({ student, valid, reason }, idx) => (
                  <tr key={`${student.id}-${idx}`}>
                    <td className="font-mono">{student.id}</td>
                    <td className="font-medium text-foreground">{student.name || "—"}</td>
                    <td>{student.className}</td>
                    <td className="num text-muted-foreground">{student.phone || "—"}</td>
                    <td>
                      <Chip tone={valid ? "credit" : "debit"}>{valid ? "Valid" : reason}</Chip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <Btn variant="ghost" onClick={() => setStep(2)}>Back</Btn>
            <Btn
              variant="primary"
              data-ai-id="import-confirm-btn"
              data-guide-id="import-confirm-button"
              disabled={validStudents.length === 0}
              onClick={confirmImport}
            >
              Import {validStudents.length} valid student{validStudents.length === 1 ? "" : "s"}
            </Btn>
          </div>
        </GlassCard>
      )}
    </div>
  );
}
