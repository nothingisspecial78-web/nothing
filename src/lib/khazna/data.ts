import { addDays, TODAY } from "./format";
import type { AuditEntry, Batch, Manager, Notice, Sector, SectorSlug, Student, Tx } from "./types";

export const ME_STUDENT_ID = "S0125";
export const DEFAULT_MANAGER_SECTOR: SectorSlug = "dept-fiqh";

export const SUPER_ADMIN = {
  id: "ADM-01",
  name: "Abdulla K.",
  email: "principal@islahululoom.edu.in",
  phone: "+91 98471 12200",
  title: "Principal",
  office: "Principal's Office",
  institution: "Islahul Uloom Arabic College",
  status: "active",
};

export const PRINCIPALS = [
  {
    id: SUPER_ADMIN.id,
    name: SUPER_ADMIN.name,
    email: SUPER_ADMIN.email,
    phone: SUPER_ADMIN.phone,
    title: SUPER_ADMIN.title,
    office: SUPER_ADMIN.office,
    institution: SUPER_ADMIN.institution,
    status: SUPER_ADMIN.status,
  },
];

export const TEACHERS = [
  {
    id: "T01",
    name: "Usthad Ismail Hudawi",
    department: "Dept Fiqh",
    sectorId: "dept-fiqh",
    subject: "Usul al-Fiqh",
    designation: "Senior Lecturer",
    phone: "+91 98471 33001",
    email: "ismail.hudawi@islahululoom.edu.in",
    status: "active",
  },
  {
    id: "T02",
    name: "Prof. Kareem Nadwi",
    department: "Dept Hadith",
    sectorId: "office",
    subject: "Sahih al-Bukhari",
    designation: "Professor",
    phone: "+91 98471 33002",
    email: "kareem.nadwi@islahululoom.edu.in",
    status: "active",
  },
];

export const OFFICE_STAFF = [
  {
    id: "STF-01",
    name: "Abdul Gafoor P.",
    designation: "Senior Office Clerk",
    office: "Campus Office",
    department: "Administration & Fee Desk",
    sectorId: "office",
    phone: "+91 98471 44001",
    email: "gafoor.office@islahululoom.edu.in",
    status: "active",
  },
];

export const UNION_MEMBERS = [
  {
    id: "UN-01",
    name: "Shameer Hudawi",
    designation: "Union Manager & President",
    unionName: "Ihsan Union",
    sectorId: "ihsan",
    phone: "+91 98471 55001",
    email: "shameer.union@islahululoom.edu.in",
    status: "active",
  },
  {
    id: "UN-02",
    name: "Rashid Wafy",
    designation: "Union Secretary",
    unionName: "Velitcham Magazine",
    sectorId: "velitcham",
    phone: "+91 98471 55002",
    email: "rashid.union@islahululoom.edu.in",
    status: "active",
  },
];

export const SECTORS: Sector[] = [
  {
    slug: "office",
    name: "Campus Office",
    short: "Office",
    description: "Central admission fees, tuition, exam registration, and hostel mess dues.",
    color: "var(--sector-office)",
    receiptPrefix: "OF-",
    target: 850000,
    creditTitles: ["Tuition Fee", "Admission Fee", "Hostel Rent", "Exam Registration"],
    debitTitles: ["Monthly Tuition Assessment", "Exam Fee Assessment", "Lab Charges", "Electricity Share"],
  },
  {
    slug: "dept-fiqh",
    name: "Department of Fiqh",
    short: "Fiqh",
    description: "Departmental library fund, seminar assessments, and kit collections for Fiqh.",
    color: "var(--sector-fiqh)",
    receiptPrefix: "FQ-",
    target: 450000,
    creditTitles: ["Department Fee", "Library Contribution", "Seminar Deposit", "Kit Fee"],
    debitTitles: ["Term Assessment", "Kit & Books Issue", "Study Tour Fee", "Seminar Assessment"],
  },
  {
    slug: "ihsan",
    name: "Ihsan Welfare Wing",
    short: "Ihsan",
    description: "Student mutual aid, medical relief fund, and charitable scholarships.",
    color: "var(--sector-ihsan)",
    receiptPrefix: "IH-",
    target: 300000,
    creditTitles: ["Welfare Contribution", "Sponsor Grant", "Scholarship Return"],
    debitTitles: ["Medical Relief Payout", "Scholarship Aid", "Welfare Assessment"],
  },
  {
    slug: "velitcham",
    name: "Velitcham Magazine",
    short: "Velitcham",
    description: "Student union literary publication, annual souvenir, and cultural arts fund.",
    color: "var(--sector-velitcham)",
    receiptPrefix: "VL-",
    target: 220000,
    creditTitles: ["Subscription Fee", "Souvenir Patronage", "Arts Club Deposit"],
    debitTitles: ["Annual Issue Dues", "Printing Expense", "Cultural Fest Assessment"],
  },
  {
    slug: "civil",
    name: "Civil & Maintenance",
    short: "Civil",
    description: "Campus maintenance, water & power infrastructure, and building development.",
    color: "var(--sector-civil)",
    receiptPrefix: "CV-",
    target: 350000,
    creditTitles: ["Development Fund", "Maintenance Fee", "Lab Caution Deposit"],
    debitTitles: ["Annual Development Dues", "Damage Recovery", "Lab Consumables"],
  },
];

export const CLASSES: string[] = [
  "Fiqh 1",
  "Fiqh 2",
  "Hadith 1",
  "Hadith 2",
  "Usul 1",
  "General",
];

const FIRST_NAMES = [
  "Safwan", "Muhammed", "Ameen", "Rashid", "Faisal", "Nabeel", "Zayd", "Irfan",
  "Salman", "Hisham", "Bilal", "Anas", "Fahad", "Shuhaib", "Junaid", "Muneer",
  "Thahir", "Ashraf", "Nihal", "Rayan", "Luqman", "Suhail", "Adnan", "Tariq",
  "Yusuf", "Hamza", "Danish", "Farhan", "Ibrahim", "Umar", "Haris", "Saad",
];
const LAST_INITIALS = ["K.", "P.", "M.", "V.", "T.", "C.", "A.", "N.", "R."];
const GUARDIANS = [
  "K. Usman", "P. Ibrahim", "M. Kunhi", "V. Muhammed", "T. Ali", "C. Hamza",
  "A. Abdul Rahman", "N. Basheer", "R. Moideen", "K. Aboobacker", "P. Sulaiman",
];

function buildDemoStudents(): Student[] {
  const list: Student[] = [
    {
      id: "S0125",
      name: "Safwan K.",
      className: "Fiqh 2",
      phone: "9847123456",
      guardian: "K. Usman",
      joined: "2025-06-12",
    },
    {
      id: "S0101",
      name: "Rahul Sharma",
      className: "Fiqh 1",
      phone: "9847000101",
      guardian: "Vijay Sharma",
      joined: "2025-06-10",
    },
    {
      id: "S0102",
      name: "Bilal C.",
      className: "General",
      phone: "9847000002",
      guardian: "C. Hamza",
      joined: "2025-06-10",
    },
    {
      id: "S0103",
      name: "Anas D.",
      className: "Hadith 1",
      phone: "9847000003",
      guardian: "D. Kareem",
      joined: "2025-06-11",
    },
    {
      id: "S0104",
      name: "Muhammed Rashid P.",
      className: "Fiqh 2",
      phone: "9847000104",
      guardian: "P. Ibrahim",
      joined: "2025-06-11",
    },
    {
      id: "S0135",
      name: "Abdulla M.",
      className: "Fiqh 2",
      phone: "+91 98470 55135",
      guardian: "M. Kunhi",
      joined: "2025-06-15",
    },
  ];

  for (let i = 5; list.length < 40; i++) {
    const idNum = 101 + i;
    if (idNum === 125 || idNum === 135) continue;
    const id = `S${String(idNum).padStart(4, "0")}`;
    const first = FIRST_NAMES[i % FIRST_NAMES.length]!;
    const last = LAST_INITIALS[(i * 3) % LAST_INITIALS.length]!;
    const cls = CLASSES[i % CLASSES.length]!;
    const guardian = GUARDIANS[(i * 5) % GUARDIANS.length]!;
    list.push({
      id,
      name: `${first} ${last}`,
      className: cls,
      phone: `9847${String(100100 + i * 17).slice(0, 6)}`,
      guardian,
      joined: addDays("2025-06-10", i % 25),
    });
  }
  return list;
}

export const STUDENTS: Student[] = buildDemoStudents();

export const MANAGERS: Manager[] = [
  {
    id: "M01",
    name: "Usthad Dr. Hamza Saqafi",
    email: "hamza@islahululoom.edu.in",
    phone: "9847112201",
    sectors: ["dept-fiqh"],
    status: "active",
    lastActive: "2026-11-15T08:40:00.000Z",
  },
  {
    id: "M02",
    name: "K. Mohammed Kutty",
    email: "office@islahululoom.edu.in",
    phone: "9847112202",
    sectors: ["office"],
    status: "active",
    lastActive: "2026-11-15T09:10:00.000Z",
  },
  {
    id: "M03",
    name: "Shuhaib Thangal",
    email: "ihsan@islahululoom.edu.in",
    phone: "9847112203",
    sectors: ["ihsan", "velitcham"],
    status: "active",
    lastActive: "2026-11-14T16:20:00.000Z",
  },
  {
    id: "M04",
    name: "Anees Rahman",
    email: "civil@islahululoom.edu.in",
    phone: "9847112204",
    sectors: ["civil"],
    status: "invited",
    lastActive: "2026-11-10T11:00:00.000Z",
  },
];

export function managerNameFor(sector: SectorSlug): string {
  const m = MANAGERS.find((x) => x.sectors.includes(sector));
  return m?.name ?? "Department Accounts";
}

function buildDemoTransactions(): Tx[] {
  const list: Tx[] = [
    {
      id: "TX1001",
      sector: "office",
      studentId: "S0125",
      type: "debit",
      title: "Term 2 Tuition Assessment",
      amount: 4500,
      date: addDays(TODAY, -18),
      receiptNo: "OF-401",
      createdBy: "K. Mohammed Kutty",
    },
    {
      id: "TX1002",
      sector: "office",
      studentId: "S0125",
      type: "credit",
      title: "Tuition Fee Payment",
      amount: 3000,
      date: addDays(TODAY, -12),
      receiptNo: "OF-402",
      createdBy: "K. Mohammed Kutty",
    },
    {
      id: "TX1003",
      sector: "dept-fiqh",
      studentId: "S0125",
      type: "debit",
      title: "Fiqh Kit & Library Fee",
      amount: 1200,
      date: addDays(TODAY, -10),
      receiptNo: "FQ-201",
      createdBy: "Usthad Dr. Hamza Saqafi",
    },
    {
      id: "TX1004",
      sector: "dept-fiqh",
      studentId: "S0125",
      type: "credit",
      title: "Department Fee",
      amount: 1500,
      date: addDays(TODAY, -5),
      receiptNo: "FQ-202",
      createdBy: "Usthad Dr. Hamza Saqafi",
    },
    {
      id: "TX1005",
      sector: "ihsan",
      studentId: "S0125",
      type: "credit",
      title: "Welfare Contribution",
      amount: 500,
      date: addDays(TODAY, -3),
      receiptNo: "IH-110",
      createdBy: "Shuhaib Thangal",
    },
    {
      id: "TX1006",
      sector: "dept-fiqh",
      studentId: "S0135",
      type: "debit",
      title: "Term 2 Tuition & Kit Fee",
      amount: 5000,
      date: addDays(TODAY, -14),
      receiptNo: "FQ-210",
      createdBy: "Usthad Dr. Hamza Saqafi",
    },
    {
      id: "TX1007",
      sector: "dept-fiqh",
      studentId: "S0135",
      type: "credit",
      title: "Part Tuition Payment",
      amount: 2000,
      date: addDays(TODAY, -6),
      receiptNo: "FQ-211",
      createdBy: "Usthad Dr. Hamza Saqafi",
    },
  ];

  const batchFiqhStudents = STUDENTS.filter((s) => s.className === "Fiqh 2").map((s) => s.id);
  let seq = 1010;
  for (let i = 0; i < STUDENTS.length; i++) {
    const s = STUDENTS[i]!;
    if (s.id === "S0125" || s.id === "S0135") continue;
    const sec = SECTORS[i % SECTORS.length]!;
    const amt = 1500 + ((i * 500) % 4500);
    list.push({
      id: `TX${seq++}`,
      sector: sec.slug,
      studentId: s.id,
      type: "credit",
      title: sec.creditTitles[i % sec.creditTitles.length] ?? "Term Deposit",
      amount: amt,
      date: addDays(TODAY, -(i % 24)),
      receiptNo: `${sec.receiptPrefix}${500 + i}`,
      createdBy: managerNameFor(sec.slug),
    });
    if (i % 3 === 0) {
      list.push({
        id: `TX${seq++}`,
        sector: sec.slug,
        studentId: s.id,
        type: "debit",
        title: sec.debitTitles[i % sec.debitTitles.length] ?? "Term Assessment",
        amount: amt + 750,
        date: addDays(TODAY, -((i % 20) + 1)),
        receiptNo: `${sec.receiptPrefix}${700 + i}`,
        createdBy: managerNameFor(sec.slug),
      });
    }
  }

  batchFiqhStudents.forEach((sid, idx) => {
    list.push({
      id: `TX${seq++}`,
      sector: "dept-fiqh",
      studentId: sid,
      type: "debit",
      title: "Term 2 Seminar Assessment",
      amount: 450,
      date: addDays(TODAY, -7),
      receiptNo: `FQ-B-${String(idx + 1).padStart(3, "0")}`,
      batchId: "B-TERM2FQ",
      createdBy: "Usthad Dr. Hamza Saqafi",
    });
  });

  list.sort((a, b) => (a.date < b.date ? 1 : -1));
  return list;
}

export const TRANSACTIONS: Tx[] = buildDemoTransactions();

export const BATCHES: Batch[] = [
  {
    id: "B-TERM2FQ",
    sector: "dept-fiqh",
    title: "Term 2 Seminar Assessment",
    type: "debit",
    reason: "Fiqh annual seminar materials & printing",
    amount: 450,
    date: addDays(TODAY, -7),
    receiptPrefix: "FQ-B-",
    studentIds: STUDENTS.filter((s) => s.className === "Fiqh 2").map((s) => s.id),
    createdBy: "Usthad Dr. Hamza Saqafi",
    createdAt: "2026-11-08T10:15:00.000Z",
  },
  {
    id: "B-OFEXAM",
    sector: "office",
    title: "University Exam Registration",
    type: "credit",
    amount: 1200,
    date: addDays(TODAY, -14),
    receiptPrefix: "OF-EX-",
    studentIds: STUDENTS.slice(0, 10).map((s) => s.id),
    createdBy: "K. Mohammed Kutty",
    createdAt: "2026-11-01T09:00:00.000Z",
  },
];

export const AUDIT: AuditEntry[] = [
  {
    id: "AU001",
    actor: "Usthad Dr. Hamza Saqafi",
    role: "manager",
    action: "CREATE_ENTRY",
    target: "S0125 · Safwan K.",
    details: "Credit ₹1,500 · Department Fee · FQ-202",
    sector: "dept-fiqh",
    at: "2026-11-15T08:30:00.000Z",
    ip: "10.0.4.12",
  },
  {
    id: "AU002",
    actor: "Usthad Dr. Hamza Saqafi",
    role: "manager",
    action: "BULK_POST",
    target: "B-TERM2FQ",
    details: "Term 2 Seminar Assessment · ₹450 × Fiqh 2 students",
    sector: "dept-fiqh",
    at: "2026-11-14T15:10:00.000Z",
    ip: "10.0.4.12",
  },
  {
    id: "AU003",
    actor: "Abdulla K.",
    role: "admin",
    action: "INVITE_ADMIN",
    target: "Anees Rahman",
    details: "Invitation sent to civil@islahululoom.edu.in",
    at: "2026-11-13T11:20:00.000Z",
    ip: "10.0.4.8",
  },
  {
    id: "AU004",
    actor: "K. Mohammed Kutty",
    role: "manager",
    action: "CREATE_ENTRY",
    target: "S0125 · Safwan K.",
    details: "Credit ₹3,000 · Tuition Fee Payment · OF-402",
    sector: "office",
    at: "2026-11-12T10:05:00.000Z",
    ip: "10.0.4.15",
  },
  {
    id: "AU005",
    actor: "Abdulla K.",
    role: "admin",
    action: "UPDATE_INSTITUTION_PROFILE",
    target: "Islahul Uloom Arabic College",
    details: "Verified QR audit policy & institutional letterhead",
    at: "2026-11-11T09:45:00.000Z",
    ip: "10.0.4.8",
  },
];

export const NOTICES: Notice[] = [
  {
    id: "N01",
    kind: "due",
    title: "Campus Office balance due",
    body: "You have an outstanding balance of ₹1,500 on Campus Office for Term 2 Tuition Assessment.",
    read: false,
    at: "2026-11-15T07:30:00.000Z",
  },
  {
    id: "N02",
    kind: "credit",
    title: "Department Fee receipt FQ-202",
    body: "Your deposit of ₹1,500 in Department of Fiqh has been posted by Usthad Dr. Hamza Saqafi.",
    read: false,
    at: "2026-11-10T14:20:00.000Z",
  },
  {
    id: "N03",
    kind: "debit",
    title: "Term 2 Seminar Assessment",
    body: "A uniform class fee of ₹450 was posted for Fiqh 2 in Department of Fiqh.",
    read: true,
    at: "2026-11-08T10:15:00.000Z",
  },
];
