import type { AccessScope } from '../security/scope.ts';

export interface StudentRecord {
  id: string; // Ad.No e.g. S0125
  organizationId: string;
  sectorId?: string;
  name: string;
  className: string;
  phone: string;
  guardian: string;
  email?: string;
  joined: string;
  status: 'active' | 'inactive';
}

export interface SectorRecord {
  slug: string;
  organizationId: string;
  name: string;
  short: string;
  description: string;
  color: string;
  receiptPrefix: string;
  target: number;
  credit: number;
  debit: number;
  balance: number;
  managerName?: string;
}

export interface TransactionRecord {
  id: string;
  organizationId: string;
  sector: string;
  studentId: string;
  studentName?: string;
  type: 'credit' | 'debit';
  title: string;
  amount: number;
  date: string;
  receiptNo: string;
  batchId?: string;
  voided?: { reason: string; by: string; at: string };
}

export interface ClassRecord {
  name: string;
  organizationId: string;
  sectorId?: string;
  studentCount: number;
  totalDebit: number;
  totalCredit: number;
  totalBalance: number;
}

export interface FundRecord {
  id: string;
  organizationId: string;
  sourceName: string;
  fundingType: 'Student Fees' | 'Charity' | 'Government Grant' | 'Endowment';
  targetSector: string;
  amount: number;
  createdAt: string;
}

export interface BatchRecord {
  id: string;
  organizationId: string;
  sector: string;
  title: string;
  type: 'credit' | 'debit';
  amountPerStudent: number;
  studentCount: number;
  totalAmount: number;
  date: string;
  status: 'posted' | 'voided';
}

export interface ManagerRecord {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone?: string;
  role: 'ADMIN' | 'SECTOR_MANAGER';
  sectorIds: string[];
  status: 'active' | 'invited' | 'inactive';
  lastActive: string;
}

export interface PrincipalRecord {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  phone: string;
  title: string;
  office: string;
  institution: string;
  status: 'active' | 'inactive';
}

export interface TeacherRecord {
  id: string;
  organizationId: string;
  sectorId: string;
  name: string;
  department: string;
  subject: string;
  designation: string;
  phone: string;
  email: string;
  status: 'active' | 'inactive';
}

export interface OfficeStaffRecord {
  id: string;
  organizationId: string;
  sectorId: string;
  name: string;
  designation: string;
  office: string;
  department: string;
  phone: string;
  email: string;
  status: 'active' | 'inactive';
}

export interface UnionMemberRecord {
  id: string;
  organizationId: string;
  sectorId: string;
  name: string;
  designation: string;
  unionName: string;
  phone: string;
  email: string;
  status: 'active' | 'inactive';
}

export interface SignatoryRecord {
  id: string;
  organizationId: string;
  fullName: string;
  designation: string;
  role: 'accounts_officer' | 'hod' | 'principal';
  sectorId?: string;
  active: boolean;
  authorisedAt: string;
  authorisedBy: string;
}

export interface NoticeRecord {
  id: string;
  organizationId: string;
  sector?: string;
  targetRole?: 'ALL' | 'STUDENT' | 'SECTOR_MANAGER' | 'ADMIN';
  kind: 'info' | 'warning' | 'urgent';
  title: string;
  body: string;
  read: boolean;
  at: string;
}

export interface IssuedReportRecord {
  ref: string;
  organizationId: string;
  sector: string;
  title: string;
  format: 'pdf' | 'xlsx' | 'csv';
  issuedBy: string;
  issuedAt: string;
  expiresAt: string;
  status: 'valid' | 'revoked' | 'expired';
}

export interface AuditLogRecord {
  id: string;
  organizationId: string;
  sector?: string;
  actor: string;
  role: string;
  action: string;
  target: string;
  details: string;
  at: string;
}

export interface DisambiguationChoice {
  id: string;
  name: string;
  className: string;
  sector: string;
}

// Conversation Focus Entity Store (per conversation and scope)
export interface FocusEntity {
  type: 'student' | 'sector' | 'class' | 'transaction';
  id: string;
  name: string;
  organizationId: string;
  metadata?: Record<string, unknown>;
  updatedAt: string;
}

const focusStore = new Map<string, FocusEntity>();

export function setConversationFocus(conversationId: string, entity: FocusEntity): void {
  focusStore.set(conversationId, entity);
}

export function getConversationFocus(conversationId: string, scope: AccessScope): FocusEntity | null {
  if (scope.role === 'PUBLIC') return null;
  const entity = focusStore.get(conversationId);
  if (!entity) return null;
  if (scope.role === 'SUPER_ADMIN') return entity;
  const currentOrg = 'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
  if (currentOrg !== entity.organizationId) {
    return null;
  }
  if (scope.role === 'STUDENT' && entity.type === 'student' && entity.id.toLowerCase() !== scope.studentId.toLowerCase()) {
    return null;
  }
  if (scope.role === 'SECTOR_MANAGER' && entity.type === 'sector' && !scope.sectorIds.includes(entity.id)) {
    return null;
  }
  return entity;
}

// Fuzzy & Trigram / Levenshtein similarity calculation
export function calculateSimilarity(s1: string, s2: string): number {
  const a = s1.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  const b = s2.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.85;

  const getBigrams = (str: string) => {
    const s = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) s.add(str.slice(i, i + 2));
    return s;
  };
  const bg1 = getBigrams(a);
  const bg2 = getBigrams(b);
  let intersection = 0;
  for (const bg of bg1) {
    if (bg2.has(bg)) intersection++;
  }
  return (2 * intersection) / (bg1.size + bg2.size);
}

type ScopedEntityType =
  | 'student'
  | 'sector'
  | 'transaction'
  | 'fund'
  | 'class'
  | 'organization'
  | 'batch'
  | 'manager'
  | 'signatory'
  | 'notice'
  | 'issued_report'
  | 'audit';

export class ScopedDataRepository {
  private readonly students: StudentRecord[] = [];
  private readonly sectors: SectorRecord[] = [];
  private readonly transactions: TransactionRecord[] = [];
  private readonly funds: FundRecord[] = [];
  private readonly batches: BatchRecord[] = [];
  private readonly managers: ManagerRecord[] = [];
  private readonly principals: PrincipalRecord[] = [];
  private readonly teachers: TeacherRecord[] = [];
  private readonly officeStaff: OfficeStaffRecord[] = [];
  private readonly unionMembers: UnionMemberRecord[] = [];
  private readonly signatories: SignatoryRecord[] = [];
  private readonly notices: NoticeRecord[] = [];
  private readonly issuedReports: IssuedReportRecord[] = [];
  private readonly auditLogs: AuditLogRecord[] = [];
  private readonly organizations: Array<{ id: string; name: string; adminEmail: string; demo: boolean; createdAt: string }> = [];

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData() {
    // Organizations
    this.organizations.push(
      { id: 'demo', name: 'Islahul Uloom', adminEmail: 'principal@islahululoom.edu.in', demo: true, createdAt: '2026-01-01T00:00:00Z' },
      { id: 'org-markaz', name: 'Markaz College of Technology', adminEmail: 'admin@markaz.edu', demo: false, createdAt: '2026-02-01T00:00:00Z' },
      { id: 'org-al-jamia', name: 'Al Jamia Arts & Science', adminEmail: 'contact@aljamia.edu', demo: false, createdAt: '2026-03-01T00:00:00Z' }
    );

    // Sectors for Demo Org
    this.sectors.push(
      { slug: 'office', organizationId: 'demo', name: 'Office', short: 'OF', description: 'Central office', color: 'var(--sector-office)', receiptPrefix: 'OF-', target: 1450000, credit: 54000, debit: 22000, balance: 32000, managerName: 'Hamza Saqafi' },
      { slug: 'ihsan-union', organizationId: 'demo', name: 'Ihsan Union', short: 'IU', description: 'Student union', color: 'var(--sector-ihsan)', receiptPrefix: 'IU-', target: 320000, credit: 28000, debit: 18000, balance: 10000, managerName: 'Shameer Hudawi' },
      { slug: 'velitcham-welfare', organizationId: 'demo', name: 'Velitcham Welfare', short: 'VW', description: 'Welfare wing', color: 'var(--sector-velitcham)', receiptPrefix: 'VW-', target: 540000, credit: 41000, debit: 19000, balance: 22000, managerName: 'Rashid Wafy' },
      { slug: 'dept-fiqh', organizationId: 'demo', name: 'Dept Fiqh', short: 'DF', description: 'Department of Fiqh', color: 'var(--sector-fiqh)', receiptPrefix: 'DF-', target: 410000, credit: 38000, debit: 15000, balance: 23000, managerName: 'Jaseel Faizy' },
      { slug: 'dept-civil', organizationId: 'demo', name: 'Dept Civil', short: 'DC', description: 'Department of Civil Law', color: 'var(--sector-civil)', receiptPrefix: 'DC-', target: 360000, credit: 32000, debit: 12000, balance: 20000, managerName: 'Anees Rahmani' },
      { slug: 'dept-eng', organizationId: 'demo', name: 'Engineering', short: 'ENG', description: 'Department of Engineering', color: '#0ea5e9', receiptPrefix: 'EN-', target: 380000, credit: 42000, debit: 15000, balance: 27000, managerName: 'Salim Eng' },
      { slug: 'dept-sci', organizationId: 'demo', name: 'Applied Sciences', short: 'SCI', description: 'Department of Applied Sciences', color: '#10b981', receiptPrefix: 'SC-', target: 350000, credit: 36000, debit: 12000, balance: 24000, managerName: 'Fathima Sci' }
    );

    // Sectors for Markaz Org (Org B)
    this.sectors.push(
      { slug: 'sec-tech', organizationId: 'org-markaz', name: 'Tech & Engineering', short: 'TE', description: 'Tech department', color: '#3b82f6', receiptPrefix: 'TE-', target: 500000, credit: 75000, debit: 30000, balance: 45000, managerName: 'Kareem Tech' }
    );

    // Students for Demo Org
    const sampleStudents = [
      { id: 'S0125', name: 'Safwan K.', className: 'Fiqh 2', sectorId: 'dept-fiqh', phone: '+91 98470 12345', guardian: 'Musthafa K.', email: 'safwan@campus.edu' },
      { id: 'S0126', name: 'Siraj Usman', className: 'Fiqh 2', sectorId: 'dept-fiqh', phone: '+91 98470 23456', guardian: 'Usman P.', email: 'siraj@campus.edu' },
      { id: 'S0127', name: 'Nabeel Qasim', className: 'Fiqh 1', sectorId: 'dept-fiqh', phone: '+91 98470 34567', guardian: 'Qasim M.', email: 'nabeel@campus.edu' },
      { id: 'S0128', name: 'Rashid P.', className: 'Civil 1', sectorId: 'dept-civil', phone: '+91 98470 45678', guardian: 'Parambil K.', email: 'rashid@campus.edu' },
      { id: 'S0129', name: 'Rahul Sharma', className: 'Civil 1', sectorId: 'dept-civil', phone: '+91 98470 56789', guardian: 'Rajesh Sharma', email: 'rahul@campus.edu' },
      { id: 'S0130', name: 'Rahul Varma', className: 'Fiqh 1', sectorId: 'dept-fiqh', phone: '+91 98470 67890', guardian: 'Suresh Varma', email: 'rahul.v@campus.edu' },
      { id: 'S0131', name: 'Amina K.', className: 'Fiqh 2', sectorId: 'dept-fiqh', phone: '+91 98470 78901', guardian: 'Koya Haji', email: 'amina@campus.edu' },
      { id: 'S0132', name: 'Bilal Ahmed', className: 'Fiqh 2', sectorId: 'dept-fiqh', phone: '+91 98470 89012', guardian: 'Ahmed K.', email: 'bilal@campus.edu' },
      { id: 'S0133', name: 'Anu Joseph', className: 'Civil 1', sectorId: 'dept-civil', phone: '+91 98470 90123', guardian: 'Joseph K.', email: 'anu@campus.edu' },
      { id: 'S0134', name: 'Mohammed Farhan', className: 'Hifz', sectorId: 'office', phone: '+91 98470 01234', guardian: 'Farhan Sr.', email: 'farhan@campus.edu' },
      { id: 'CF-2026-001', name: 'Aarav Krishnan', className: 'Fiqh 1', sectorId: 'dept-fiqh', phone: '+91 98470 11111', guardian: 'Krishnan M.', email: 'aarav@campus.edu' },
      { id: 'CF-2026-002', name: 'Bilal (stu-eng-2)', className: 'Eng 2', sectorId: 'dept-eng', phone: '+91 98470 22222', guardian: 'Ibrahim B.', email: 'bilal.eng@campus.edu' },
      { id: 'S0135', name: 'Abdulla M.', className: 'Fiqh 2', sectorId: 'dept-fiqh', phone: '+91 98470 55135', guardian: 'M. Kunhi', email: 'abdulla.m@campus.edu' },
    ];

    sampleStudents.forEach((s) => {
      this.students.push({
        id: s.id,
        organizationId: 'demo',
        sectorId: s.sectorId,
        name: s.name,
        className: s.className,
        phone: s.phone,
        guardian: s.guardian,
        email: s.email,
        joined: '2026-01-15',
        status: 'active',
      });
    });

    // Student for Markaz (Org B)
    this.students.push({
      id: 'MK-101',
      organizationId: 'org-markaz',
      sectorId: 'sec-tech',
      name: 'Salman Tech',
      className: 'CS 1',
      phone: '+91 99999 00001',
      guardian: 'Hassan M.',
      email: 'salman@markaz.edu',
      joined: '2026-02-01',
      status: 'active',
    });

    // Transactions for Demo Org
    this.transactions.push(
      { id: 'tx-001', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0125', studentName: 'Safwan K.', type: 'debit', title: 'Tuition Fee – Term 2', amount: 15000, date: '2026-11-01', receiptNo: 'DF-201', batchId: 'B-2026-01' },
      { id: 'tx-002', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0125', studentName: 'Safwan K.', type: 'credit', title: 'Fee Payment (Cash)', amount: 10000, date: '2026-11-05', receiptNo: 'DF-202' },
      { id: 'tx-003', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0126', studentName: 'Siraj Usman', type: 'debit', title: 'Tuition Fee – Term 2', amount: 15000, date: '2026-11-01', receiptNo: 'DF-203', batchId: 'B-2026-01' },
      { id: 'tx-004', organizationId: 'demo', sector: 'office', studentId: 'S0125', studentName: 'Safwan K.', type: 'debit', title: 'Admission Fee', amount: 5000, date: '2026-10-15', receiptNo: 'OF-1047' },
      { id: 'tx-005', organizationId: 'demo', sector: 'office', studentId: 'S0125', studentName: 'Safwan K.', type: 'credit', title: 'Advance Deposit', amount: 5000, date: '2026-10-16', receiptNo: 'OF-1048' },
      { id: 'tx-006', organizationId: 'demo', sector: 'dept-civil', studentId: 'S0129', studentName: 'Rahul Sharma', type: 'debit', title: 'Tuition Fee', amount: 12000, date: '2026-11-02', receiptNo: 'DC-101', batchId: 'B-2026-02' },
      { id: 'tx-007', organizationId: 'demo', sector: 'dept-civil', studentId: 'S0129', studentName: 'Rahul Sharma', type: 'credit', title: 'Fee Payment', amount: 8000, date: '2026-11-10', receiptNo: 'DC-102' },
      { id: 'tx-008', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0130', studentName: 'Rahul Varma', type: 'debit', title: 'Kitab Fee', amount: 3500, date: '2026-11-08', receiptNo: 'DF-204' },
      { id: 'tx-009', organizationId: 'demo', sector: 'dept-civil', studentId: 'S0133', studentName: 'Anu Joseph', type: 'debit', title: 'Civil 1 Lab Fee', amount: 2500, date: '2026-11-09', receiptNo: 'DC-103' },
      { id: 'tx-010', organizationId: 'demo', sector: 'dept-civil', studentId: 'S0133', studentName: 'Anu Joseph', type: 'credit', title: 'Cash Deposit', amount: 2500, date: '2026-11-12', receiptNo: 'DC-104' },
      { id: 'tx-011', organizationId: 'demo', sector: 'dept-eng', studentId: 'CF-2026-002', studentName: 'Bilal (stu-eng-2)', type: 'debit', title: 'Engineering Lab Fee', amount: 15000, date: '2026-11-11', receiptNo: 'EN-101' },
      { id: 'tx-012', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0135', studentName: 'Abdulla M.', type: 'debit', title: 'Term 2 Tuition & Kit Fee', amount: 5000, date: '2026-11-01', receiptNo: 'DF-205' },
      { id: 'tx-013', organizationId: 'demo', sector: 'dept-fiqh', studentId: 'S0135', studentName: 'Abdulla M.', type: 'credit', title: 'Part Tuition Payment', amount: 2000, date: '2026-11-06', receiptNo: 'DF-206' }
    );

    // Funds for Demo Org
    this.funds.push(
      { id: 'fund-01', organizationId: 'demo', sourceName: 'Zakat Welfare Fund', fundingType: 'Charity', targetSector: 'velitcham-welfare', amount: 250000, createdAt: '2026-09-01T00:00:00Z' },
      { id: 'fund-02', organizationId: 'demo', sourceName: 'Wakf Educational Endowment', fundingType: 'Endowment', targetSector: 'dept-fiqh', amount: 180000, createdAt: '2026-09-15T00:00:00Z' },
      { id: 'fund-03', organizationId: 'demo', sourceName: 'State Minority Grant', fundingType: 'Government Grant', targetSector: 'office', amount: 450000, createdAt: '2026-10-01T00:00:00Z' },
      { id: 'fund-04', organizationId: 'demo', sourceName: 'General Student Fees Pool', fundingType: 'Student Fees', targetSector: 'office', amount: 850000, createdAt: '2026-10-10T00:00:00Z' }
    );

    // Batches
    this.batches.push(
      { id: 'B-2026-01', organizationId: 'demo', sector: 'dept-fiqh', title: 'Term 2 Tuition Charge', type: 'debit', amountPerStudent: 15000, studentCount: 2, totalAmount: 30000, date: '2026-11-01', status: 'posted' },
      { id: 'B-2026-02', organizationId: 'demo', sector: 'dept-civil', title: 'Civil Dept Tuition Charge', type: 'debit', amountPerStudent: 12000, studentCount: 1, totalAmount: 12000, date: '2026-11-02', status: 'posted' }
    );

    // Managers & Admins
    this.managers.push(
      { id: 'mgr-01', organizationId: 'demo', name: 'Jaseel Faizy', email: 'jaseel@islahululoom.edu.in', phone: '+91 98471 12201', role: 'SECTOR_MANAGER', sectorIds: ['dept-fiqh'], status: 'active', lastActive: '2026-11-14T08:00:00Z' },
      { id: 'mgr-02', organizationId: 'demo', name: 'Anees Rahmani', email: 'anees@islahululoom.edu.in', phone: '+91 98471 12204', role: 'SECTOR_MANAGER', sectorIds: ['dept-civil'], status: 'active', lastActive: '2026-11-14T07:30:00Z' },
      { id: 'mgr-03', organizationId: 'demo', name: 'Hamza Saqafi', email: 'hamza@islahululoom.edu.in', phone: '+91 98471 12202', role: 'SECTOR_MANAGER', sectorIds: ['office'], status: 'active', lastActive: '2026-11-13T17:15:00Z' },
      { id: 'adm-01', organizationId: 'demo', name: 'Abdulla K.', email: 'principal@islahululoom.edu.in', phone: '+91 98471 12200', role: 'ADMIN', sectorIds: [], status: 'active', lastActive: '2026-11-14T09:00:00Z' }
    );

    // Principals
    this.principals.push({
      id: 'ADM-01',
      organizationId: 'demo',
      name: 'Abdulla K.',
      email: 'principal@islahululoom.edu.in',
      phone: '+91 98471 12200',
      title: 'Principal',
      office: "Principal's Office",
      institution: 'Islahul Uloom Arabic College',
      status: 'active',
    });

    // Teachers
    this.teachers.push(
      {
        id: 'T01',
        organizationId: 'demo',
        sectorId: 'dept-fiqh',
        name: 'Usthad Ismail Hudawi',
        department: 'Dept Fiqh',
        subject: 'Usul al-Fiqh',
        designation: 'Senior Lecturer',
        phone: '+91 98471 33001',
        email: 'ismail.hudawi@islahululoom.edu.in',
        status: 'active',
      },
      {
        id: 'T02',
        organizationId: 'demo',
        sectorId: 'office',
        name: 'Prof. Kareem Nadwi',
        department: 'Dept Hadith',
        subject: 'Sahih al-Bukhari',
        designation: 'Professor',
        phone: '+91 98471 33002',
        email: 'kareem.nadwi@islahululoom.edu.in',
        status: 'active',
      }
    );

    // Office Staff
    this.officeStaff.push({
      id: 'STF-01',
      organizationId: 'demo',
      sectorId: 'office',
      name: 'Abdul Gafoor P.',
      designation: 'Senior Office Clerk',
      office: 'Campus Office',
      department: 'Administration & Fee Desk',
      phone: '+91 98471 44001',
      email: 'gafoor.office@islahululoom.edu.in',
      status: 'active',
    });

    // Union Members / Managers
    this.unionMembers.push(
      {
        id: 'UN-01',
        organizationId: 'demo',
        sectorId: 'ihsan-union',
        name: 'Shameer Hudawi',
        designation: 'Union Manager & President',
        unionName: 'Ihsan Union',
        phone: '+91 98471 55001',
        email: 'shameer.union@islahululoom.edu.in',
        status: 'active',
      },
      {
        id: 'UN-02',
        organizationId: 'demo',
        sectorId: 'velitcham-welfare',
        name: 'Shuhaib Thangal',
        designation: 'Union Manager',
        unionName: 'Velitcham & Ihsan',
        phone: '+91 98471 55002',
        email: 'shuhaib.union@islahululoom.edu.in',
        status: 'active',
      }
    );

    // Signatories
    this.signatories.push(
      { id: 'sig_accounts', organizationId: 'demo', fullName: 'K. Mohammed Kutty', designation: 'Chief Accounts Officer', role: 'accounts_officer', active: true, authorisedAt: '2026-11-12T00:00:00Z', authorisedBy: 'Abdulla K.' },
      { id: 'sig_hod_fiqh', organizationId: 'demo', fullName: 'Dr. Hamza Saqafi', designation: 'Head of Department, Fiqh', role: 'hod', sectorId: 'dept-fiqh', active: true, authorisedAt: '2026-11-12T00:00:00Z', authorisedBy: 'Abdulla K.' },
      { id: 'sig_hod_civil', organizationId: 'demo', fullName: 'Anees Rahman', designation: 'Head of Department, Civil', role: 'hod', sectorId: 'dept-civil', active: true, authorisedAt: '2026-11-12T00:00:00Z', authorisedBy: 'Abdulla K.' },
      { id: 'sig_principal', organizationId: 'demo', fullName: 'Prof. Sayyid Munavvar Ali', designation: 'Principal & Head of Institution', role: 'principal', active: true, authorisedAt: '2026-11-12T00:00:00Z', authorisedBy: 'Abdulla K.' }
    );

    // Notices
    this.notices.push(
      { id: 'N-01', organizationId: 'demo', sector: 'dept-fiqh', targetRole: 'ALL', kind: 'info', title: 'Term 2 Fee Schedule Published', body: 'Term 2 tuition receipts for Fiqh 1 and Fiqh 2 are now open.', read: false, at: '2026-11-10T09:00:00Z' },
      { id: 'N-02', organizationId: 'demo', sector: 'office', targetRole: 'ADMIN', kind: 'warning', title: 'Monthly Audit Export Reminder', body: 'Download the monthly verified audit CSV before the 25th.', read: false, at: '2026-11-12T10:30:00Z' },
      { id: 'N-03', organizationId: 'demo', targetRole: 'STUDENT', kind: 'info', title: 'Download Verified Student Statements', body: 'Students can download their PDF fee statement from the Student portal.', read: true, at: '2026-11-08T14:00:00Z' }
    );

    // Issued Reports
    this.issuedReports.push(
      { ref: 'KHZ-2026-1001', organizationId: 'demo', sector: 'dept-fiqh', title: 'Dept Fiqh Term 2 Collection Report', format: 'pdf', issuedBy: 'Abdulla K.', issuedAt: '2026-11-10T11:00:00Z', expiresAt: '2027-11-10T11:00:00Z', status: 'valid' },
      { ref: 'KHZ-2026-1002', organizationId: 'demo', sector: 'dept-civil', title: 'Dept Civil Class Statement', format: 'xlsx', issuedBy: 'Anees Rahmani', issuedAt: '2026-11-11T15:20:00Z', expiresAt: '2027-11-11T15:20:00Z', status: 'valid' }
    );

    // Audit Logs
    this.auditLogs.push(
      { id: 'AU-001', organizationId: 'demo', sector: 'dept-fiqh', actor: 'Jaseel Faizy', role: 'SECTOR_MANAGER', action: 'POST_BATCH', target: 'B-2026-01', details: 'Posted Term 2 Tuition Charge (₹15,000 × 2)', at: '2026-11-01T10:00:00Z' },
      { id: 'AU-002', organizationId: 'demo', sector: 'dept-fiqh', actor: 'Jaseel Faizy', role: 'SECTOR_MANAGER', action: 'CREATE_ENTRY', target: 'DF-202', details: 'Recorded Cash Fee Payment ₹10,000 for Safwan K.', at: '2026-11-05T11:30:00Z' },
      { id: 'AU-003', organizationId: 'demo', sector: 'dept-civil', actor: 'Anees Rahmani', role: 'SECTOR_MANAGER', action: 'POST_BATCH', target: 'B-2026-02', details: 'Posted Civil Dept Tuition Charge (₹12,000)', at: '2026-11-02T09:15:00Z' },
      { id: 'AU-004', organizationId: 'demo', sector: 'office', actor: 'Abdulla K.', role: 'ADMIN', action: 'ISSUE_REPORT', target: 'KHZ-2026-1001', details: 'Issued Dept Fiqh Term 2 Collection Report', at: '2026-11-10T11:00:00Z' }
    );
  }

  private resolveStudentPrimarySector(student: StudentRecord): string {
    if (student.sectorId) return student.sectorId;
    const tx = this.transactions.find((t) => t.studentId === student.id);
    if (tx) return tx.sector;
    return 'office';
  }

  private filterByScope<T extends { organizationId?: string; sector?: string; sectorId?: string; studentId?: string; id?: string; slug?: string; targetSector?: string; sectorIds?: string[]; targetRole?: string }>(
    items: T[],
    scope: AccessScope,
    entityType: ScopedEntityType
  ): T[] {
    if (scope.role === 'PUBLIC') {
      return [];
    }
    if (scope.role === 'SUPER_ADMIN') {
      return items;
    }
    const currentOrg = 'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';

    return items.filter((item) => {
      if (item.organizationId && item.organizationId !== currentOrg) {
        return false;
      }

      if (scope.role === 'ADMIN') {
        return true;
      }

      if (scope.role === 'SECTOR_MANAGER') {
        const mgrSectors = scope.sectorIds.map((s) => s.toLowerCase());
        if (entityType === 'sector') {
          return mgrSectors.includes(String(item.slug || item.id || '').toLowerCase());
        }
        if (entityType === 'transaction' || entityType === 'batch' || entityType === 'issued_report' || entityType === 'audit') {
          return item.sector ? mgrSectors.includes(item.sector.toLowerCase()) : false;
        }
        if (entityType === 'fund') {
          return item.targetSector ? mgrSectors.includes(item.targetSector.toLowerCase()) || item.targetSector === 'All Sectors' : false;
        }
        if (entityType === 'signatory') {
          return !item.sectorId || mgrSectors.includes(item.sectorId.toLowerCase());
        }
        if (entityType === 'notice') {
          return !item.sector || mgrSectors.includes(item.sector.toLowerCase());
        }
        if (entityType === 'student') {
          const primarySec = item.sectorId?.toLowerCase();
          if (primarySec && mgrSectors.includes(primarySec)) return true;
          const studentTxs = this.transactions.filter((t) => t.studentId === item.id);
          return studentTxs.some((t) => mgrSectors.includes(t.sector.toLowerCase()));
        }
        if (entityType === 'manager') {
          return false; // Manager directory is Admin+ only
        }
        return true;
      }

      if (scope.role === 'STUDENT') {
        if (entityType === 'student') {
          return String(item.id || '').toLowerCase() === scope.studentId.toLowerCase();
        }
        if (entityType === 'transaction') {
          return item.studentId?.toLowerCase() === scope.studentId.toLowerCase();
        }
        if (entityType === 'notice') {
          return item.targetRole === 'ALL' || item.targetRole === 'STUDENT';
        }
        return false;
      }

      return false;
    });
  }

  // --------------------------------------------------------------------------
  // Student Queries & Multi-Key Entity Resolution
  // --------------------------------------------------------------------------
  async findStudents(
    query: string,
    scope: AccessScope
  ): Promise<{ matches: StudentRecord[]; disambiguation?: DisambiguationChoice[]; message?: string }> {
    const scoped = this.filterByScope(this.students, scope, 'student');
    const q = query.toLowerCase().trim();

    if (!q) {
      return { matches: [] };
    }

    const exactId = scoped.filter((s) => s.id.toLowerCase() === q);
    if (exactId.length === 1) {
      return { matches: exactId };
    }

    const digitsOnly = q.replace(/[^0-9]/g, '');
    const phoneOrEmail = scoped.filter((s) => {
      const phoneMatch = digitsOnly.length >= 4 && s.phone.replace(/[^0-9]/g, '').includes(digitsOnly);
      const emailMatch = q.includes('@') && s.email && s.email.toLowerCase().includes(q);
      return phoneMatch || emailMatch;
    });
    if (phoneOrEmail.length === 1) {
      return { matches: phoneOrEmail };
    }

    const queryWords = q.split(/\s+/).filter(Boolean);
    const scored = scoped
      .map((s) => {
        const studentNameLower = s.name.toLowerCase();
        let sim = calculateSimilarity(s.name, q);
        if (studentNameLower === q) {
          sim = 1.0;
        } else if (studentNameLower.includes(q)) {
          sim = Math.max(sim, 0.95);
        } else if (queryWords.length > 1) {
          const matchingWords = queryWords.filter((w) => studentNameLower.includes(w));
          if (matchingWords.length === queryWords.length) {
            sim = Math.max(sim, 0.9);
          } else if (matchingWords.length < queryWords.length) {
            sim = Math.min(sim, 0.4);
          }
        }
        return { student: s, score: sim };
      })
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return { matches: [], message: 'No records found matching the query within your authorized scope.' };
    }

    if (scored.length === 1 || (scored[0].score >= 0.95 && scored.length > 1 && scored[1].score < 0.7)) {
      return { matches: [scored[0].student] };
    }

    const disambiguation: DisambiguationChoice[] = scored.slice(0, 5).map((item) => ({
      id: item.student.id,
      name: item.student.name,
      className: item.student.className,
      sector: this.resolveStudentPrimarySector(item.student),
    }));

    return {
      matches: scored.map((s) => s.student),
      disambiguation,
      message: `Found ${scored.length} matching students. Please select one:`,
    };
  }

  async getStudent(studentId: string, scope: AccessScope): Promise<StudentRecord | null> {
    const scoped = this.filterByScope(this.students, scope, 'student');
    return scoped.find((s) => s.id.toLowerCase() === studentId.toLowerCase()) || null;
  }

  async listStudents(
    filters: { className?: string; status?: string; limit?: number; offset?: number },
    scope: AccessScope
  ): Promise<{ students: StudentRecord[]; total: number }> {
    let scoped = this.filterByScope(this.students, scope, 'student');
    if (filters.className) {
      scoped = scoped.filter((s) => s.className.toLowerCase().includes(filters.className!.toLowerCase()));
    }
    if (filters.status) {
      scoped = scoped.filter((s) => s.status === filters.status);
    }
    const total = scoped.length;
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    return { students: scoped.slice(offset, offset + limit), total };
  }

  async summarizeStudentFinance(
    studentId: string,
    scope: AccessScope
  ): Promise<{
    student: StudentRecord;
    totalDebit: number;
    totalCredit: number;
    netBalance: number;
    status: 'Settled' | 'Pending Dues' | 'Advance Credit';
    recentTransactions: TransactionRecord[];
  } | null> {
    const student = await this.getStudent(studentId, scope);
    if (!student) return null;

    const scopedTxs = this.filterByScope(this.transactions, scope, 'transaction').filter(
      (t) => t.studentId.toLowerCase() === student.id.toLowerCase() && !t.voided
    );

    let totalDebit = 0;
    let totalCredit = 0;
    for (const t of scopedTxs) {
      if (t.type === 'debit') totalDebit += t.amount;
      if (t.type === 'credit') totalCredit += t.amount;
    }

    const netBalance = totalDebit - totalCredit;
    const status = netBalance === 0 ? 'Settled' : netBalance > 0 ? 'Pending Dues' : 'Advance Credit';

    return {
      student,
      totalDebit,
      totalCredit,
      netBalance,
      status,
      recentTransactions: scopedTxs.slice(-8).reverse(),
    };
  }

  // --------------------------------------------------------------------------
  // Sector Queries
  // --------------------------------------------------------------------------
  async findSectors(query: string, scope: AccessScope): Promise<SectorRecord[]> {
    const scoped = this.filterByScope(this.sectors, scope, 'sector');
    const q = query.toLowerCase().trim();
    if (!q) return scoped;
    return scoped.filter(
      (s) =>
        s.slug.toLowerCase().includes(q) ||
        s.short.toLowerCase() === q ||
        s.name.toLowerCase().includes(q)
    );
  }

  async getSector(slug: string, scope: AccessScope): Promise<SectorRecord | null> {
    const scoped = this.filterByScope(this.sectors, scope, 'sector');
    const q = slug.toLowerCase().trim();
    return (
      scoped.find((s) => s.slug.toLowerCase() === q || s.name.toLowerCase() === q || s.short.toLowerCase() === q) ||
      null
    );
  }

  async listSectors(scope: AccessScope): Promise<SectorRecord[]> {
    return this.filterByScope(this.sectors, scope, 'sector');
  }

  async summarizeSectorFinance(
    slug: string,
    scope: AccessScope
  ): Promise<{
    sector: SectorRecord;
    target: number;
    credit: number;
    debit: number;
    balance: number;
    studentCount: number;
    collectionRate: number;
  } | null> {
    const sector = await this.getSector(slug, scope);
    if (!sector) return null;

    const scopedTxs = this.filterByScope(this.transactions, scope, 'transaction').filter(
      (t) => t.sector.toLowerCase() === sector.slug.toLowerCase() && !t.voided
    );

    let credit = 0;
    let debit = 0;
    const uniqueStudents = new Set<string>();

    for (const t of scopedTxs) {
      if (t.type === 'credit') credit += t.amount;
      if (t.type === 'debit') debit += t.amount;
      uniqueStudents.add(t.studentId);
    }

    // Use precomputed sector balances if transactions subset is empty
    const effectiveCredit = credit > 0 ? credit : sector.credit;
    const effectiveDebit = debit > 0 ? debit : sector.debit;
    const collectionRate = sector.target > 0 ? Math.round((effectiveCredit / sector.target) * 100) : 0;

    return {
      sector,
      target: sector.target,
      credit: effectiveCredit,
      debit: effectiveDebit,
      balance: effectiveCredit - effectiveDebit,
      studentCount: uniqueStudents.size || this.filterByScope(this.students, scope, 'student').filter((st) => st.sectorId === sector.slug).length,
      collectionRate,
    };
  }

  // --------------------------------------------------------------------------
  // Class Queries & Reports
  // --------------------------------------------------------------------------
  async listClasses(scope: AccessScope): Promise<ClassRecord[]> {
    const scopedStudents = this.filterByScope(this.students, scope, 'student');
    const scopedTxs = this.filterByScope(this.transactions, scope, 'transaction').filter((t) => !t.voided);
    const classMap = new Map<string, { count: number; sectorId?: string; studentIds: Set<string> }>();

    for (const s of scopedStudents) {
      const cls = s.className || 'General';
      const cur = classMap.get(cls) || { count: 0, sectorId: s.sectorId, studentIds: new Set() };
      cur.count += 1;
      cur.studentIds.add(s.id);
      classMap.set(cls, cur);
    }

    const res: ClassRecord[] = [];
    const currentOrg = 'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';

    for (const [name, stats] of classMap.entries()) {
      let totalDebit = 0;
      let totalCredit = 0;
      for (const tx of scopedTxs) {
        if (stats.studentIds.has(tx.studentId)) {
          if (tx.type === 'debit') totalDebit += tx.amount;
          if (tx.type === 'credit') totalCredit += tx.amount;
        }
      }
      res.push({
        name,
        organizationId: currentOrg,
        sectorId: stats.sectorId,
        studentCount: stats.count,
        totalDebit,
        totalCredit,
        totalBalance: totalDebit - totalCredit,
      });
    }

    return res;
  }

  async findClasses(query: string, scope: AccessScope): Promise<ClassRecord[]> {
    const all = await this.listClasses(scope);
    const q = query.toLowerCase().trim();
    if (!q) return all;
    return all.filter((c) => c.name.toLowerCase().includes(q));
  }

  async getClass(className: string, scope: AccessScope): Promise<ClassRecord | null> {
    const all = await this.listClasses(scope);
    const q = className.toLowerCase().trim();
    return all.find((c) => c.name.toLowerCase() === q) || null;
  }

  async reportClass(
    className: string,
    scope: AccessScope
  ): Promise<{
    className: string;
    studentCount: number;
    totalDebit: number;
    totalCredit: number;
    totalPending: number;
    defaultersCount: number;
    students: Array<{ id: string; name: string; debit: number; credit: number; balance: number }>;
  } | null> {
    const scopedStudents = this.filterByScope(this.students, scope, 'student').filter(
      (s) => s.className.toLowerCase() === className.toLowerCase()
    );

    if (scopedStudents.length === 0) return null;

    const scopedTxs = this.filterByScope(this.transactions, scope, 'transaction').filter((t) => !t.voided);
    let totalDebit = 0;
    let totalCredit = 0;
    let defaultersCount = 0;
    const studentRows: Array<{ id: string; name: string; debit: number; credit: number; balance: number }> = [];

    for (const s of scopedStudents) {
      const txs = scopedTxs.filter((t) => t.studentId === s.id);
      let sDebit = 0;
      let sCredit = 0;
      for (const t of txs) {
        if (t.type === 'debit') sDebit += t.amount;
        if (t.type === 'credit') sCredit += t.amount;
      }
      const sBal = sDebit - sCredit;
      if (sBal > 0) defaultersCount++;
      totalDebit += sDebit;
      totalCredit += sCredit;
      studentRows.push({
        id: s.id,
        name: s.name,
        debit: sDebit,
        credit: sCredit,
        balance: sBal,
      });
    }

    return {
      className,
      studentCount: scopedStudents.length,
      totalDebit,
      totalCredit,
      totalPending: totalDebit - totalCredit,
      defaultersCount,
      students: studentRows,
    };
  }

  // --------------------------------------------------------------------------
  // Payments, Receipts & Defaulters
  // --------------------------------------------------------------------------
  async getReceipt(receiptNo: string, scope: AccessScope): Promise<TransactionRecord | null> {
    const scoped = this.filterByScope(this.transactions, scope, 'transaction');
    return scoped.find((t) => t.receiptNo.toLowerCase() === receiptNo.toLowerCase()) || null;
  }

  async findPayments(query: string, scope: AccessScope): Promise<TransactionRecord[]> {
    const scoped = this.filterByScope(this.transactions, scope, 'transaction');
    const q = query.toLowerCase().trim();
    if (!q) return scoped.slice(0, 25);
    return scoped.filter(
      (t) =>
        t.receiptNo.toLowerCase().includes(q) ||
        t.title.toLowerCase().includes(q) ||
        (t.studentName || '').toLowerCase().includes(q) ||
        t.studentId.toLowerCase().includes(q) ||
        t.sector.toLowerCase().includes(q)
    );
  }

  async listPayments(
    filter: { sector?: string; startDate?: string; endDate?: string; type?: 'credit' | 'debit'; limit?: number },
    scope: AccessScope
  ): Promise<{ transactions: TransactionRecord[]; total: number; totalAmount: number }> {
    let scoped = this.filterByScope(this.transactions, scope, 'transaction');
    if (filter.sector) {
      scoped = scoped.filter((t) => t.sector.toLowerCase() === filter.sector!.toLowerCase());
    }
    if (filter.type) {
      scoped = scoped.filter((t) => t.type === filter.type);
    }
    if (filter.startDate) {
      scoped = scoped.filter((t) => t.date >= filter.startDate!);
    }
    if (filter.endDate) {
      scoped = scoped.filter((t) => t.date <= filter.endDate!);
    }
    const totalAmount = scoped.reduce((sum, t) => sum + t.amount, 0);
    const limit = filter.limit || 50;
    return { transactions: scoped.slice(0, limit), total: scoped.length, totalAmount };
  }

  async summarizeCollections(
    filter: { sector?: string; startDate?: string; endDate?: string },
    scope: AccessScope
  ): Promise<{
    totalCredit: number;
    totalDebit: number;
    netBalance: number;
    transactionCount: number;
    bySector: Record<string, { credit: number; debit: number; count: number }>;
  }> {
    let scoped = this.filterByScope(this.transactions, scope, 'transaction').filter((t) => !t.voided);
    if (filter.sector) {
      scoped = scoped.filter((t) => t.sector.toLowerCase() === filter.sector!.toLowerCase());
    }
    if (filter.startDate) {
      scoped = scoped.filter((t) => t.date >= filter.startDate!);
    }
    if (filter.endDate) {
      scoped = scoped.filter((t) => t.date <= filter.endDate!);
    }

    let totalCredit = 0;
    let totalDebit = 0;
    const bySector: Record<string, { credit: number; debit: number; count: number }> = {};

    for (const t of scoped) {
      const s = bySector[t.sector] || { credit: 0, debit: 0, count: 0 };
      if (t.type === 'credit') {
        totalCredit += t.amount;
        s.credit += t.amount;
      } else {
        totalDebit += t.amount;
        s.debit += t.amount;
      }
      s.count += 1;
      bySector[t.sector] = s;
    }

    return {
      totalCredit,
      totalDebit,
      netBalance: totalCredit - totalDebit,
      transactionCount: scoped.length,
      bySector,
    };
  }

  async comparePeriods(
    params: {
      period1Start: string;
      period1End: string;
      period2Start: string;
      period2End: string;
      sector?: string;
    },
    scope: AccessScope
  ): Promise<{
    period1: { start: string; end: string; credit: number; debit: number; net: number; count: number };
    period2: { start: string; end: string; credit: number; debit: number; net: number; count: number };
    deltaCredit: number;
    deltaDebit: number;
    deltaNet: number;
    percentChangeCredit: number | null;
  }> {
    let scoped = this.filterByScope(this.transactions, scope, 'transaction').filter((t) => !t.voided);
    if (params.sector) {
      const sectorQuery = params.sector.toLowerCase();
      scoped = scoped.filter((t) => t.sector.toLowerCase() === sectorQuery);
    }

    const computePeriod = (start: string, end: string) => {
      let credit = 0;
      let debit = 0;
      let count = 0;
      for (const t of scoped) {
        if (t.date >= start && t.date <= end) {
          if (t.type === 'credit') credit += t.amount;
          else if (t.type === 'debit') debit += t.amount;
          count += 1;
        }
      }
      return { start, end, credit, debit, net: credit - debit, count };
    };

    const period1 = computePeriod(params.period1Start, params.period1End);
    const period2 = computePeriod(params.period2Start, params.period2End);
    const deltaCredit = period2.credit - period1.credit;
    const deltaDebit = period2.debit - period1.debit;
    const deltaNet = period2.net - period1.net;
    const percentChangeCredit =
      period1.credit > 0 ? Math.round((deltaCredit / period1.credit) * 10000) / 100 : null;

    return {
      period1,
      period2,
      deltaCredit,
      deltaDebit,
      deltaNet,
      percentChangeCredit,
    };
  }

  async reportDefaulters(
    sectorSlug: string | undefined,
    scope: AccessScope
  ): Promise<{
    totalDefaulters: number;
    totalAmountOwed: number;
    defaulters: Array<{ studentId: string; name: string; className: string; sector: string; amountOwed: number }>;
  }> {
    const scopedStudents = this.filterByScope(this.students, scope, 'student');
    const scopedTxs = this.filterByScope(this.transactions, scope, 'transaction').filter((t) => !t.voided);
    const defaulters: Array<{ studentId: string; name: string; className: string; sector: string; amountOwed: number }> = [];
    let totalAmountOwed = 0;

    for (const student of scopedStudents) {
      let txs = scopedTxs.filter((t) => t.studentId === student.id);
      if (sectorSlug) {
        txs = txs.filter((t) => t.sector.toLowerCase() === sectorSlug.toLowerCase());
      }
      let deb = 0;
      let cred = 0;
      for (const t of txs) {
        if (t.type === 'debit') deb += t.amount;
        if (t.type === 'credit') cred += t.amount;
      }
      const due = deb - cred;
      if (due > 0) {
        totalAmountOwed += due;
        defaulters.push({
          studentId: student.id,
          name: student.name,
          className: student.className,
          sector: sectorSlug || this.resolveStudentPrimarySector(student),
          amountOwed: due,
        });
      }
    }

    return {
      totalDefaulters: defaulters.length,
      totalAmountOwed,
      defaulters,
    };
  }

  // --------------------------------------------------------------------------
  // Batches
  // --------------------------------------------------------------------------
  async listBatches(filter: { sector?: string; status?: 'posted' | 'voided' }, scope: AccessScope): Promise<BatchRecord[]> {
    let scoped = this.filterByScope(this.batches, scope, 'batch');
    if (filter.sector) {
      scoped = scoped.filter((b) => b.sector.toLowerCase() === filter.sector!.toLowerCase());
    }
    if (filter.status) {
      scoped = scoped.filter((b) => b.status === filter.status);
    }
    return scoped;
  }

  async getBatch(batchId: string, scope: AccessScope): Promise<BatchRecord | null> {
    const scoped = this.filterByScope(this.batches, scope, 'batch');
    return scoped.find((b) => b.id.toLowerCase() === batchId.toLowerCase()) || null;
  }

  async summarizeBatches(scope: AccessScope): Promise<{ totalBatches: number; postedCount: number; voidedCount: number; totalAmount: number }> {
    const scoped = this.filterByScope(this.batches, scope, 'batch');
    const posted = scoped.filter((b) => b.status === 'posted');
    const voided = scoped.filter((b) => b.status === 'voided');
    return {
      totalBatches: scoped.length,
      postedCount: posted.length,
      voidedCount: voided.length,
      totalAmount: posted.reduce((s, b) => s + b.totalAmount, 0),
    };
  }

  // --------------------------------------------------------------------------
  // Managers / Users
  // --------------------------------------------------------------------------
  async findUsers(query: string, scope: AccessScope): Promise<ManagerRecord[]> {
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return [];
    const scoped = this.filterByScope(this.managers, scope, 'manager');
    const q = query.toLowerCase().trim();
    if (!q) return scoped;
    return scoped.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        m.sectorIds.some((s) => s.toLowerCase().includes(q))
    );
  }

  async listUsers(scope: AccessScope): Promise<ManagerRecord[]> {
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return [];
    return this.filterByScope(this.managers, scope, 'manager');
  }

  async getUser(userId: string, scope: AccessScope): Promise<ManagerRecord | null> {
    if (scope.role !== 'SUPER_ADMIN' && scope.role !== 'ADMIN') return null;
    const scoped = this.filterByScope(this.managers, scope, 'manager');
    return scoped.find((m) => m.id.toLowerCase() === userId.toLowerCase() || m.email.toLowerCase() === userId.toLowerCase()) || null;
  }

  async summarizeManagers(scope: AccessScope): Promise<{ totalUsers: number; activeManagers: number; admins: number; sectorsCovered: string[] }> {
    const users = await this.listUsers(scope);
    const activeManagers = users.filter((u) => u.role === 'SECTOR_MANAGER' && u.status === 'active');
    const admins = users.filter((u) => u.role === 'ADMIN');
    const sectorsCovered = Array.from(new Set(users.flatMap((u) => u.sectorIds)));
    return {
      totalUsers: users.length,
      activeManagers: activeManagers.length,
      admins: admins.length,
      sectorsCovered,
    };
  }

  // --------------------------------------------------------------------------
  // Funds & Utilization
  // --------------------------------------------------------------------------
  async findFunds(query: string, scope: AccessScope): Promise<FundRecord[]> {
    const scoped = this.filterByScope(this.funds, scope, 'fund');
    const q = query.toLowerCase().trim();
    if (!q) return scoped;
    return scoped.filter(
      (f) =>
        f.sourceName.toLowerCase().includes(q) ||
        f.fundingType.toLowerCase().includes(q) ||
        f.targetSector.toLowerCase().includes(q)
    );
  }

  async getFund(fundId: string, scope: AccessScope): Promise<FundRecord | null> {
    const scoped = this.filterByScope(this.funds, scope, 'fund');
    return scoped.find((f) => f.id.toLowerCase() === fundId.toLowerCase()) || null;
  }

  async listFunds(scope: AccessScope): Promise<FundRecord[]> {
    return this.filterByScope(this.funds, scope, 'fund');
  }

  async reportFundUtilization(scope: AccessScope): Promise<{
    totalFunding: number;
    fundsByType: Record<string, number>;
    funds: FundRecord[];
  }> {
    const scoped = this.filterByScope(this.funds, scope, 'fund');
    const fundsByType: Record<string, number> = {};
    let totalFunding = 0;

    for (const f of scoped) {
      totalFunding += f.amount;
      fundsByType[f.fundingType] = (fundsByType[f.fundingType] || 0) + f.amount;
    }

    return { totalFunding, fundsByType, funds: scoped };
  }

  // --------------------------------------------------------------------------
  // Signatories
  // --------------------------------------------------------------------------
  async listSignatories(scope: AccessScope): Promise<SignatoryRecord[]> {
    if (scope.role === 'STUDENT' || scope.role === 'PUBLIC') return [];
    return this.filterByScope(this.signatories, scope, 'signatory');
  }

  async getSignatory(id: string, scope: AccessScope): Promise<SignatoryRecord | null> {
    const list = await this.listSignatories(scope);
    return list.find((s) => s.id.toLowerCase() === id.toLowerCase()) || null;
  }

  async summarizeSignatories(scope: AccessScope): Promise<{ total: number; activeCount: number; byRole: Record<string, number> }> {
    const list = await this.listSignatories(scope);
    const byRole: Record<string, number> = {};
    let activeCount = 0;
    for (const s of list) {
      if (s.active) activeCount += 1;
      byRole[s.role] = (byRole[s.role] || 0) + 1;
    }
    return { total: list.length, activeCount, byRole };
  }

  // --------------------------------------------------------------------------
  // Notices
  // --------------------------------------------------------------------------
  async listNotices(scope: AccessScope): Promise<NoticeRecord[]> {
    return this.filterByScope(this.notices, scope, 'notice');
  }

  async getNotice(id: string, scope: AccessScope): Promise<NoticeRecord | null> {
    const list = await this.listNotices(scope);
    return list.find((n) => n.id.toLowerCase() === id.toLowerCase()) || null;
  }

  async summarizeNotices(scope: AccessScope): Promise<{ total: number; unreadCount: number; notices: NoticeRecord[] }> {
    const notices = await this.listNotices(scope);
    return {
      total: notices.length,
      unreadCount: notices.filter((n) => !n.read).length,
      notices,
    };
  }

  // --------------------------------------------------------------------------
  // Issued Reports
  // --------------------------------------------------------------------------
  async listIssuedReports(scope: AccessScope): Promise<IssuedReportRecord[]> {
    if (scope.role === 'STUDENT' || scope.role === 'PUBLIC') return [];
    return this.filterByScope(this.issuedReports, scope, 'issued_report');
  }

  async getIssuedReport(ref: string, scope: AccessScope): Promise<IssuedReportRecord | null> {
    const list = await this.listIssuedReports(scope);
    return list.find((r) => r.ref.toLowerCase() === ref.toLowerCase()) || null;
  }

  async summarizeIssuedReports(scope: AccessScope): Promise<{ total: number; validCount: number; revokedCount: number }> {
    const list = await this.listIssuedReports(scope);
    return {
      total: list.length,
      validCount: list.filter((r) => r.status === 'valid').length,
      revokedCount: list.filter((r) => r.status === 'revoked').length,
    };
  }

  // --------------------------------------------------------------------------
  // Audit Logs
  // --------------------------------------------------------------------------
  async listAuditLogs(filter: { action?: string; limit?: number }, scope: AccessScope): Promise<AuditLogRecord[]> {
    if (scope.role === 'STUDENT' || scope.role === 'PUBLIC') return [];
    let scoped = this.filterByScope(this.auditLogs, scope, 'audit');
    if (filter.action) {
      scoped = scoped.filter((a) => a.action.toLowerCase().includes(filter.action!.toLowerCase()));
    }
    return scoped.slice(0, filter.limit || 50);
  }

  async getAuditLog(id: string, scope: AccessScope): Promise<AuditLogRecord | null> {
    const list = await this.listAuditLogs({}, scope);
    return list.find((a) => a.id.toLowerCase() === id.toLowerCase()) || null;
  }

  async summarizeAuditActivity(scope: AccessScope): Promise<{ totalEvents: number; byAction: Record<string, number> }> {
    const list = await this.listAuditLogs({}, scope);
    const byAction: Record<string, number> = {};
    for (const a of list) {
      byAction[a.action] = (byAction[a.action] || 0) + 1;
    }
    return { totalEvents: list.length, byAction };
  }

  // --------------------------------------------------------------------------
  // Platform Super Admin Cross-Tenant Queries
  // --------------------------------------------------------------------------
  async listOrganizations(scope: AccessScope): Promise<Array<{
    id: string;
    name: string;
    adminEmail: string;
    studentCount: number;
    sectorCount: number;
    totalCollections: number;
    createdAt: string;
  }>> {
    if (scope.role !== 'SUPER_ADMIN') {
      throw new Error('Access denied: listOrganizations is restricted to platform Super Admin.');
    }

    return this.organizations.map((org) => {
      const orgStudents = this.students.filter((s) => s.organizationId === org.id);
      const orgSectors = this.sectors.filter((s) => s.organizationId === org.id);
      const orgTxs = this.transactions.filter((t) => t.organizationId === org.id && t.type === 'credit');
      const totalCollections = orgTxs.reduce((sum, t) => sum + t.amount, 0);

      return {
        id: org.id,
        name: org.name,
        adminEmail: org.adminEmail,
        studentCount: orgStudents.length,
        sectorCount: orgSectors.length,
        totalCollections,
        createdAt: org.createdAt,
      };
    });
  }

  async getOrganizationDetail(orgId: string, scope: AccessScope) {
    if (scope.role !== 'SUPER_ADMIN') {
      throw new Error('Access denied: getOrganizationDetail is restricted to platform Super Admin.');
    }
    const org = this.organizations.find((o) => o.id === orgId);
    if (!org) return null;

    const orgStudents = this.students.filter((s) => s.organizationId === org.id);
    const orgSectors = this.sectors.filter((s) => s.organizationId === org.id);
    const orgTxs = this.transactions.filter((t) => t.organizationId === org.id);

    let credits = 0;
    let debits = 0;
    for (const t of orgTxs) {
      if (t.type === 'credit') credits += t.amount;
      if (t.type === 'debit') debits += t.amount;
    }

    return {
      organization: org,
      studentCount: orgStudents.length,
      sectorCount: orgSectors.length,
      totalCredits: credits,
      totalDebits: debits,
      netBalance: credits - debits,
      sectors: orgSectors,
    };
  }

  async summarizePlatformUsage(scope: AccessScope) {
    if (scope.role !== 'SUPER_ADMIN') {
      throw new Error('Access denied: summarizePlatformUsage is restricted to platform Super Admin.');
    }

    const totalStudents = this.students.length;
    const totalTransactions = this.transactions.length;
    const totalCredits = this.transactions.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0);

    return {
      organizationCount: this.organizations.length,
      totalOrganizations: this.organizations.length,
      totalStudents,
      totalSectors: this.sectors.length,
      totalTransactions,
      totalVolume: totalCredits,
      totalCredits,
      systemHealth: '100% Operational',
      activeUsersMonthly: 42,
      aiAssistantRequestsToday: 138,
      timestamp: new Date().toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // Generic Governed Query Engine (`query_data`)
  // --------------------------------------------------------------------------
  async executeStructuredQuery(
    params: {
      entity:
        | 'students'
        | 'sectors'
        | 'classes'
        | 'payments'
        | 'funds'
        | 'batches'
        | 'managers'
        | 'signatories'
        | 'notices'
        | 'issued_reports'
        | 'audit_logs';
      filters?: Array<{ field: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in'; value: unknown }>;
      fields?: string[];
      limit?: number;
    },
    scope: AccessScope
  ): Promise<{ rows: Record<string, unknown>[]; total: number }> {
    if (scope.role === 'PUBLIC') {
      throw new Error('Access denied: unauthenticated queries are not permitted.');
    }

    const { entity, filters = [], fields, limit = 50 } = params;

    let baseRows: Record<string, unknown>[] = [];
    if (entity === 'students') {
      baseRows = this.filterByScope(this.students, scope, 'student') as unknown as Record<string, unknown>[];
    } else if (entity === 'sectors') {
      baseRows = this.filterByScope(this.sectors, scope, 'sector') as unknown as Record<string, unknown>[];
    } else if (entity === 'payments') {
      baseRows = this.filterByScope(this.transactions, scope, 'transaction') as unknown as Record<string, unknown>[];
    } else if (entity === 'funds') {
      baseRows = this.filterByScope(this.funds, scope, 'fund') as unknown as Record<string, unknown>[];
    } else if (entity === 'classes') {
      const clsList = await this.listClasses(scope);
      baseRows = clsList as unknown as Record<string, unknown>[];
    } else if (entity === 'batches') {
      baseRows = this.filterByScope(this.batches, scope, 'batch') as unknown as Record<string, unknown>[];
    } else if (entity === 'managers') {
      baseRows = (await this.listUsers(scope)) as unknown as Record<string, unknown>[];
    } else if (entity === 'signatories') {
      baseRows = (await this.listSignatories(scope)) as unknown as Record<string, unknown>[];
    } else if (entity === 'notices') {
      baseRows = (await this.listNotices(scope)) as unknown as Record<string, unknown>[];
    } else if (entity === 'issued_reports') {
      baseRows = (await this.listIssuedReports(scope)) as unknown as Record<string, unknown>[];
    } else if (entity === 'audit_logs') {
      baseRows = (await this.listAuditLogs({}, scope)) as unknown as Record<string, unknown>[];
    } else {
      throw new Error(`Disallowed query entity: "${String(entity)}"`);
    }

    // Apply allowed filters
    const filtered = baseRows.filter((row) => {
      for (const f of filters) {
        const val = row[f.field];
        if (f.op === 'eq' && val !== f.value) return false;
        if (f.op === 'neq' && val === f.value) return false;
        if (f.op === 'contains' && !String(val || '').toLowerCase().includes(String(f.value || '').toLowerCase())) return false;
        if (f.op === 'gt' && Number(val) <= Number(f.value)) return false;
        if (f.op === 'gte' && Number(val) < Number(f.value)) return false;
        if (f.op === 'lt' && Number(val) >= Number(f.value)) return false;
        if (f.op === 'lte' && Number(val) > Number(f.value)) return false;
        if (f.op === 'in' && Array.isArray(f.value) && !f.value.includes(val)) return false;
      }
      return true;
    });

    // Strip sensitive fields based on role
    const sensitiveFieldsByRole: Record<string, string[]> = {
      PUBLIC: ['phone', 'guardian', 'email', 'passwordHash', 'adminEmail'],
      STUDENT: ['phone', 'guardian', 'email', 'passwordHash'],
      SECTOR_MANAGER: ['passwordHash', 'adminEmail'],
      ADMIN: ['passwordHash'],
      SUPER_ADMIN: ['passwordHash'],
    };

    const disallowed = sensitiveFieldsByRole[scope.role] || ['passwordHash'];

    const trimmed = filtered.slice(0, Math.min(limit, 50)).map((row) => {
      const out: Record<string, unknown> = {};
      const keys =
        fields && fields.length > 0
          ? fields.filter((k) => !disallowed.includes(k))
          : Object.keys(row).filter((k) => !disallowed.includes(k));
      for (const k of keys) {
        if (k in row) out[k] = row[k];
      }
      return out;
    });

    return { rows: trimmed, total: filtered.length };
  }

  /**
   * Returns enriched entity collections for app-agnostic entity registry search.
   * Security/scope filtering is applied centrally by the Entity Search Engine
   * so out-of-scope records are detected and safely denied without leaking data.
   */
  getEntityCollections(): Record<string, Array<Record<string, unknown>>> {
    const ledgerByStudent = new Map<string, { credit: number; debit: number }>();
    for (const tx of this.transactions) {
      if (tx.voided) continue;
      const cur = ledgerByStudent.get(tx.studentId) || { credit: 0, debit: 0 };
      if (tx.type === 'credit') cur.credit += tx.amount;
      else cur.debit += tx.amount;
      ledgerByStudent.set(tx.studentId, cur);
    }

    const enrichedStudents = this.students.map((s) => {
      const agg = ledgerByStudent.get(s.id) || { credit: 0, debit: 0 };
      const balance = agg.credit - agg.debit;
      return {
        ...s,
        paidTotal: agg.credit,
        debitTotal: agg.debit,
        balance,
        pendingFee: balance < 0 ? Math.abs(balance) : 0,
      };
    });

    const sectorManagers = this.managers
      .filter((m) => m.role === 'SECTOR_MANAGER')
      .map((m) => ({
        ...m,
        sectors: m.sectorIds,
      }));

    return {
      students: enrichedStudents as unknown as Array<Record<string, unknown>>,
      principals: this.principals as unknown as Array<Record<string, unknown>>,
      teachers: this.teachers as unknown as Array<Record<string, unknown>>,
      managers: sectorManagers as unknown as Array<Record<string, unknown>>,
      officeStaff: this.officeStaff as unknown as Array<Record<string, unknown>>,
      unionMembers: this.unionMembers as unknown as Array<Record<string, unknown>>,
      sectors: this.sectors as unknown as Array<Record<string, unknown>>,
    };
  }
}

export const scopedRepository = new ScopedDataRepository();
