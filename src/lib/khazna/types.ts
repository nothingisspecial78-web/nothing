export type Role = "admin" | "manager" | "student";
export type SectorSlug = string;
export type TxType = "credit" | "debit";

export interface Sector {
  slug: SectorSlug;
  name: string;
  short: string;
  description: string;
  color: string;
  receiptPrefix: string;
  target: number;
  creditTitles: string[];
  debitTitles: string[];
}

export interface Student {
  id: string;
  name: string;
  className: string;
  phone: string;
  guardian: string;
  joined: string;
  updatedAt?: string | undefined;
  updatedBy?: string | undefined;
}

export interface VoidMeta {
  reason: string;
  by: string;
  at: string;
}

export interface Tx {
  id: string;
  sector: SectorSlug;
  studentId: string;
  type: TxType;
  title: string;
  reason?: string | undefined;
  amount: number;
  date: string;
  receiptNo: string;
  batchId?: string | undefined;
  createdBy?: string | undefined;
  voided?: VoidMeta | undefined;
  updatedAt?: string | undefined;
  updatedBy?: string | undefined;
}

export interface Batch {
  id: string;
  sector: SectorSlug;
  title: string;
  type: TxType;
  reason?: string | undefined;
  amount: number;
  date: string;
  receiptPrefix: string;
  studentIds: string[];
  createdBy: string;
  createdAt: string;
  voided?: VoidMeta | undefined;
  updatedAt?: string | undefined;
  updatedBy?: string | undefined;
}

export type AuditAction =
  | "SIGN_UP"
  | "ADD_SECTOR"
  | "UPDATE_SECTOR"
  | "INVITE_ADMIN"
  | "EDIT_ADMIN"
  | "DELETE_ADMIN"
  | "ASSIGN_SECTOR"
  | "CREATE_ENTRY"
  | "EDIT_ENTRY"
  | "DELETE_ENTRY"
  | "VOID_ENTRY"
  | "BULK_POST"
  | "EDIT_BATCH"
  | "VOID_BATCH"
  | "DELETE_BATCH"
  | "ADD_STUDENT"
  | "EDIT_STUDENT"
  | "DELETE_STUDENT"
  | "IMPORT_STUDENTS"
  | "EDIT_CLASS"
  | "UPDATE_PROFILE"
  | "UPDATE_INSTITUTION_PROFILE"
  | "ADD_SIGNATORY"
  | "EDIT_SIGNATORY"
  | "DELETE_SIGNATORY"
  | "EXPORT"
  | "REVOKE_REPORT"
  | "EXTEND_REPORT";

export interface AuditEntry {
  id: string;
  actor: string;
  role: Role;
  action: AuditAction;
  target: string;
  details: string;
  sector?: SectorSlug | undefined;
  at: string;
  ip?: string | undefined;
}

export interface Manager {
  id: string;
  name: string;
  email: string;
  phone: string;
  sectors: SectorSlug[];
  status: "active" | "invited" | "inactive";
  lastActive: string;
}

export interface Notice {
  id: string;
  kind: "debit" | "due" | "credit" | "info";
  title: string;
  body: string;
  read: boolean;
  at: string;
}

export type SignatoryRole = "accounts_officer" | "hod" | "principal";

export interface Signatory {
  id: string;
  org_id: string;
  full_name: string;
  designation: string;
  role: SignatoryRole;
  sector_id?: string | undefined;
  class_id?: string | undefined;
  active: boolean;
  signature_path?: string | undefined;
  signature_version: number;
  authorised_at?: string | undefined;
  authorised_by?: string | undefined;
  updated_at?: string | undefined;
  updated_by?: string | undefined;
}

export interface SignatureSlotItem {
  label: string;
  role: SignatoryRole;
}

export interface SignatureSlotConfig {
  slot1: SignatureSlotItem;
  slot2: SignatureSlotItem;
  slot3: SignatureSlotItem;
}

export interface InstitutionProfile {
  name: string;
  short_name?: string | undefined;
  tagline?: string | undefined;
  reg_no?: string | undefined;
  established_year?: string | undefined;
  address_line1?: string | undefined;
  address_line2?: string | undefined;
  city?: string | undefined;
  district?: string | undefined;
  state?: string | undefined;
  pincode?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  website?: string | undefined;
  logo_path?: string | undefined;
  logo_version: number;
  seal_path?: string | undefined;
  seal_version: number;
  verify_expiry: "never" | "90d" | "1y";
  verify_mask_names: boolean;
  updated_at?: string | undefined;
  updated_by?: string | undefined;
}

export interface ReportExport {
  id: string;
  ref: string;
  token: string;
  org_id: string;
  sector_id: string;
  sector_name: string;
  class_name: string;
  mode: "class_report" | "student_statement" | "sector_ledger";
  date_from: string;
  date_to: string;
  row_count: number;
  total_credit: number;
  total_debit: number;
  net_balance: number;
  issued_at: string;
  issued_by: string;
  expires_at?: string | undefined;
  revoked_at?: string | undefined;
  revoked_by?: string | undefined;
  pdf_base64?: string | undefined;
}
