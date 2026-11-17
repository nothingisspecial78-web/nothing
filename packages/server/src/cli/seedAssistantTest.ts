import { createScopeToken, type AccessScope } from '../security/scope.ts';
import { loadConfig } from '../config.ts';
import { chunkMarkdown } from '../rag/chunker.ts';
import { createVectorStore } from '../rag/store.ts';
import { createEmbedder } from '../rag/embedder.ts';

export interface SeedTestData {
  adminToken: string;
  managerEngToken: string;
  managerSciToken: string;
  studentDuesToken: string;
  studentPaidToken: string;
  scopes: {
    admin: AccessScope;
    managerEng: AccessScope;
    managerSci: AccessScope;
    studentDues: AccessScope;
    studentPaid: AccessScope;
  };
}

export async function runSeedAssistantTest(): Promise<SeedTestData> {
  const cfg = loadConfig();
  const secret = cfg.jwtSecret || 'dev-secret-change-in-production';

  // 1. Scopes definition
  const adminScope: AccessScope = {
    role: 'SUPER_ADMIN',
    userId: 'admin-01',
  };

  const managerEngScope: AccessScope = {
    role: 'SECTOR_MANAGER',
    userId: 'manager-eng-01',
    sectorIds: ['dept-eng'],
  };

  const managerSciScope: AccessScope = {
    role: 'SECTOR_MANAGER',
    userId: 'manager-sci-01',
    sectorIds: ['dept-sci'],
  };

  const studentDuesScope: AccessScope = {
    role: 'STUDENT',
    userId: 'stu-eng-2',
    studentId: 'stu-eng-2',
    sectorId: 'dept-eng',
  };

  const studentPaidScope: AccessScope = {
    role: 'STUDENT',
    userId: 'stu-eng-1',
    studentId: 'stu-eng-1',
    sectorId: 'dept-eng',
  };

  // 2. Sign JWT tokens
  const adminToken = createScopeToken(adminScope, secret);
  const managerEngToken = createScopeToken(managerEngScope, secret);
  const managerSciToken = createScopeToken(managerSciScope, secret);
  const studentDuesToken = createScopeToken(studentDuesScope, secret);
  const studentPaidToken = createScopeToken(studentPaidScope, secret);

  // 3. Seed scoped RAG chunks into vector store
  const store = createVectorStore(cfg);
  const embedder = createEmbedder(cfg);

  const sampleAllDoc = `
# Student General Handbook
All students at Khazna Campus have access to academic facilities, library resources, and personal fee payment portals.
Fee dues may be paid online or via the sector bursar office.
`;

  const sampleManagerDoc = `
# Sector Manager Guidelines (Manager Only)
visibility: manager
Sector managers oversee student collections, batch fee postings, and receipt reconciliations for their assigned sector.
Managers are not authorized to view financial records or student totals of other sectors.
`;

  const sampleAdminDoc = `
# Confidential Institutional Audit SOP (Super Admin Only)
visibility: admin
Super administrators hold unrestricted authority across all five campus sectors, including staff appointments, institutional audits, and university grants.
`;

  const allChunks = [
    ...chunkMarkdown({ appId: 'khazna-ledger', source: 'student-handbook.md', markdown: sampleAllDoc, visibility: 'all' }),
    ...chunkMarkdown({ appId: 'khazna-ledger', source: 'manager-guidelines.md', markdown: sampleManagerDoc, visibility: 'manager' }),
    ...chunkMarkdown({ appId: 'khazna-ledger', source: 'admin-audit-sop.md', markdown: sampleAdminDoc, visibility: 'admin' }),
  ];

  const embeddings = await embedder.embed(allChunks.map((c) => `${c.heading}\n${c.content}`));
  const embedded = allChunks.map((c, i) => ({ ...c, embedding: embeddings[i] }));
  await store.upsertChunks('khazna-ledger', embedded);

  console.log('\n============================================================');
  console.log('  KHAZNA AI ASSISTANT: TEST DATA & TOKENS SEEDED');
  console.log('============================================================\n');
  console.log('Sectors Seeded:');
  console.log('  1. dept-eng (Engineering) — Manager: manager.eng@college.test');
  console.log('  2. dept-sci (Applied Sciences) — Manager: manager.sci@college.test');
  console.log('  3. dept-com (Commerce) — [UNASSIGNED: No manager assigned]');
  console.log('\nStudents Seeded: 12 Students across 3 sectors (Paid, Pending, Waived)');
  console.log('\n--- READY-TO-USE SCOPED JWT TOKENS ---');
  console.log('\n[SUPER_ADMIN] (Full access to all sectors & campus reports):');
  console.log(adminToken);
  console.log('\n[SECTOR_MANAGER - Engineering] (Scoped strictly to dept-eng):');
  console.log(managerEngToken);
  console.log('\n[SECTOR_MANAGER - Science] (Scoped strictly to dept-sci):');
  console.log(managerSciToken);
  console.log('\n[STUDENT - With Pending Dues] (Bilal: stu-eng-2, owes ₹15,000):');
  console.log(studentDuesToken);
  console.log('\n[STUDENT - Dues Paid] (Aarav: stu-eng-1, Paid in full):');
  console.log(studentPaidToken);
  console.log('\n============================================================\n');

  return {
    adminToken,
    managerEngToken,
    managerSciToken,
    studentDuesToken,
    studentPaidToken,
    scopes: {
      admin: adminScope,
      managerEng: managerEngScope,
      managerSci: managerSciScope,
      studentDues: studentDuesScope,
      studentPaid: studentPaidScope,
    },
  };
}

const isMain = process.argv[1] && process.argv[1].endsWith('seedAssistantTest.ts');
if (isMain) {
  runSeedAssistantTest()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Seed script failed:', err);
      process.exit(1);
    });
}
