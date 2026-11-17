import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Express, type NextFunction, type Request, type Response, type Router } from 'express';
import * as XLSX from 'xlsx';
import { MemoryDataAdapter, type AssistantAdapters } from '@ai-assistant/core';
import { createAssistantServerRouter } from '@ai-assistant/server';
import { khaznaAssistantConfig } from '../../assistant.config.ts';


export interface StudentRecord {
  id: string;
  admissionNo: string;
  fullName: string;
  email: string;
  sectorCode: string;
  unionName: string;
  fundingOption: 'Student Fees' | 'Charity' | 'Government Grant' | 'Endowment';
  feeAmount: number;
  status: 'Paid' | 'Pending' | 'Waived';
}

export interface SectorRecord {
  id: string;
  code: string;
  name: string;
  unionName: string;
  annualBudget: number;
}

export interface FundRecord {
  id: string;
  sourceName: string;
  fundingType: 'Student Fees' | 'Charity' | 'Government Grant' | 'Endowment';
  targetSector: string;
  amount: number;
  createdAt: string;
}

export const DEMO_FINANCE_TOKEN = 'demo-finance-token';

export function createCollegeFinanceStore() {
  const students: StudentRecord[] = [
    {
      id: 'stu-101',
      admissionNo: 'CF-2026-001',
      fullName: 'Aarav Krishnan',
      email: 'aarav.k@campus.edu',
      sectorCode: 'ENG',
      unionName: 'Tech Union',
      fundingOption: 'Student Fees',
      feeAmount: 42000,
      status: 'Paid',
    },
    {
      id: 'stu-102',
      admissionNo: 'CF-2026-002',
      fullName: 'Meera Varghese',
      email: 'meera.v@campus.edu',
      sectorCode: 'SCI',
      unionName: 'Science Forum',
      fundingOption: 'Charity',
      feeAmount: 36000,
      status: 'Waived',
    },
    {
      id: 'stu-103',
      admissionNo: 'CF-2026-003',
      fullName: 'Devika Ramesh',
      email: 'devika.r@campus.edu',
      sectorCode: 'COM',
      unionName: 'Commerce Guild',
      fundingOption: 'Government Grant',
      feeAmount: 28000,
      status: 'Pending',
    },
    {
      id: 'stu-104',
      admissionNo: 'CF-2026-004',
      fullName: 'Nikhil Thomas',
      email: 'nikhil.t@campus.edu',
      sectorCode: 'ART',
      unionName: 'Humanities Collective',
      fundingOption: 'Endowment',
      feeAmount: 24500,
      status: 'Paid',
    },
  ];

  const sectors: SectorRecord[] = [
    { id: 'sec-eng', code: 'ENG', name: 'Engineering & Technology', unionName: 'Tech Union', annualBudget: 850000 },
    { id: 'sec-sci', code: 'SCI', name: 'Applied Sciences', unionName: 'Science Forum', annualBudget: 540000 },
    { id: 'sec-com', code: 'COM', name: 'Commerce & Management', unionName: 'Commerce Guild', annualBudget: 420000 },
    { id: 'sec-art', code: 'ART', name: 'Arts & Humanities', unionName: 'Humanities Collective', annualBudget: 310000 },
  ];

  const funds: FundRecord[] = [
    {
      id: 'fnd-1',
      sourceName: 'Semester Tuition Ledger 2026',
      fundingType: 'Student Fees',
      targetSector: 'All Sectors',
      amount: 1250000,
      createdAt: '2026-08-01T09:00:00.000Z',
    },
    {
      id: 'fnd-2',
      sourceName: 'Alumni Merit & Relief Trust',
      fundingType: 'Charity',
      targetSector: 'SCI',
      amount: 320000,
      createdAt: '2026-08-15T11:30:00.000Z',
    },
    {
      id: 'fnd-3',
      sourceName: 'State Post-Matric Scholarship Pool',
      fundingType: 'Government Grant',
      targetSector: 'COM',
      amount: 480000,
      createdAt: '2026-09-02T14:15:00.000Z',
    },
    {
      id: 'fnd-4',
      sourceName: 'Founders Academic Endowment',
      fundingType: 'Endowment',
      targetSector: 'ART',
      amount: 210000,
      createdAt: '2026-09-10T10:00:00.000Z',
    },
  ];

  return { students, sectors, funds };
}

export function createCollegeFinanceRouter(store = createCollegeFinanceStore()): Router {
  const router = express.Router();

  const requireDemoAuth = (req: Request, res: Response, next: NextFunction) => {
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      return;
    }
    // Accept demo token or any non-empty verified session token in demo mode
    if (token !== DEMO_FINANCE_TOKEN && token.length < 8) {
      res.status(401).json({ error: 'Invalid session token.' });
      return;
    }
    next();
  };

  router.get('/me', requireDemoAuth, (_req, res) => {
    res.json({
      userId: 'bursar-01',
      name: 'Ananya Nair',
      role: 'bursar',
      appId: 'college-finance',
    });
  });

  router.get('/overview', requireDemoAuth, (_req, res) => {
    const totalFees = store.students.reduce((acc, s) => acc + s.feeAmount, 0);
    const totalFunds = store.funds.reduce((acc, f) => acc + f.amount, 0);
    res.json({
      studentCount: store.students.length,
      sectorCount: store.sectors.length,
      totalFees,
      totalFunds,
    });
  });

  router.get('/students', requireDemoAuth, (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.toLowerCase().trim() : '';
    const sector = typeof req.query.sector === 'string' ? req.query.sector.toUpperCase().trim() : '';
    const filtered = store.students.filter((s) => {
      if (sector && s.sectorCode.toUpperCase() !== sector) return false;
      if (
        q &&
        !s.fullName.toLowerCase().includes(q) &&
        !s.admissionNo.toLowerCase().includes(q) &&
        !s.email.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
    res.json({ students: filtered });
  });

  router.post('/students', requireDemoAuth, (req, res) => {
    const body = req.body as Partial<StudentRecord>;
    if (!body.admissionNo || !body.fullName || !body.email) {
      res.status(400).json({ error: 'admissionNo, fullName, and email are required.' });
      return;
    }
    if (store.students.some((s) => s.admissionNo.toLowerCase() === body.admissionNo!.toLowerCase())) {
      res.status(409).json({ error: `Duplicate admission number "${body.admissionNo}".` });
      return;
    }
    const funding = body.fundingOption || 'Student Fees';
    const record: StudentRecord = {
      id: `stu-${crypto.randomUUID().slice(0, 8)}`,
      admissionNo: body.admissionNo,
      fullName: body.fullName,
      email: body.email,
      sectorCode: (body.sectorCode || 'ENG').toUpperCase(),
      unionName: body.unionName || 'General Union',
      fundingOption: funding,
      feeAmount: Number(body.feeAmount ?? 0),
      status: funding === 'Charity' ? 'Waived' : 'Pending',
    };
    store.students.unshift(record);
    res.status(201).json({ student: record });
  });

  router.post('/students/:id/pay', requireDemoAuth, (req, res) => {
    const student = store.students.find((s) => s.id === req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    student.status = 'Paid';
    res.json({ student });
  });

  router.post('/students/:id/unpay', requireDemoAuth, (req, res) => {
    const student = store.students.find((s) => s.id === req.params.id);
    if (!student) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    student.status = 'Pending';
    res.json({ student });
  });

  router.delete('/students/:id', requireDemoAuth, (req, res) => {
    const idx = store.students.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Student not found.' });
      return;
    }
    store.students.splice(idx, 1);
    res.json({ ok: true });
  });

  router.post('/students/import', requireDemoAuth, (req, res) => {
    const incoming = Array.isArray(req.body?.students)
      ? (req.body.students as Array<Record<string, unknown>>)
      : [];
    const createdIds: string[] = [];
    const failedRows: Array<{ admissionNo?: string; reason: string }> = [];

    for (const item of incoming) {
      const admissionNo = String(item.admissionNo || '').trim();
      if (!admissionNo) {
        failedRows.push({ reason: 'Missing admissionNo' });
        continue;
      }
      if (store.students.some((s) => s.admissionNo.toLowerCase() === admissionNo.toLowerCase())) {
        failedRows.push({ admissionNo, reason: `Duplicate admissionNo "${admissionNo}"` });
        continue;
      }

      const funding = (item.fundingOption as StudentRecord['fundingOption']) || 'Student Fees';
      const id = `stu-${crypto.randomUUID().slice(0, 8)}`;
      store.students.unshift({
        id,
        admissionNo,
        fullName: String(item.fullName || ''),
        email: String(item.email || ''),
        sectorCode: String(item.sectorCode || 'ENG').toUpperCase(),
        unionName: String(item.unionName || 'General Union'),
        fundingOption: funding,
        feeAmount: Number(item.feeAmount ?? 0),
        status: funding === 'Charity' ? 'Waived' : 'Pending',
      });
      createdIds.push(id);
    }

    res.json({
      addedCount: createdIds.length,
      createdIds,
      failedRows,
    });
  });

  router.post('/students/import/undo', requireDemoAuth, (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? new Set(req.body.ids.map(String)) : new Set<string>();
    const before = store.students.length;
    for (let i = store.students.length - 1; i >= 0; i -= 1) {
      if (ids.has(store.students[i].id)) {
        store.students.splice(i, 1);
      }
    }
    res.json({ undoneCount: before - store.students.length });
  });

  router.get('/sectors', requireDemoAuth, (_req, res) => {
    res.json({ sectors: store.sectors });
  });

  router.post('/sectors', requireDemoAuth, (req, res) => {
    const body = req.body as Partial<SectorRecord>;
    if (!body.code || !body.name || !body.unionName) {
      res.status(400).json({ error: 'code, name, and unionName are required.' });
      return;
    }
    const code = body.code.toUpperCase().trim();
    if (store.sectors.some((s) => s.code === code)) {
      res.status(409).json({ error: `Sector code "${code}" already exists.` });
      return;
    }
    const sector: SectorRecord = {
      id: `sec-${crypto.randomUUID().slice(0, 8)}`,
      code,
      name: body.name.trim(),
      unionName: body.unionName.trim(),
      annualBudget: Number(body.annualBudget ?? 100000),
    };
    store.sectors.unshift(sector);
    res.status(201).json({ sector });
  });

  router.delete('/sectors/:id', requireDemoAuth, (req, res) => {
    const idx = store.sectors.findIndex((s) => s.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Sector not found.' });
      return;
    }
    store.sectors.splice(idx, 1);
    res.json({ ok: true });
  });

  router.get('/funds', requireDemoAuth, (_req, res) => {
    res.json({ funds: store.funds });
  });

  router.post('/funds', requireDemoAuth, (req, res) => {
    const body = req.body as Partial<FundRecord>;
    if (!body.sourceName || !body.fundingType || body.amount === undefined) {
      res.status(400).json({ error: 'sourceName, fundingType, and amount are required.' });
      return;
    }
    const fund: FundRecord = {
      id: `fnd-${crypto.randomUUID().slice(0, 8)}`,
      sourceName: body.sourceName.trim(),
      fundingType: body.fundingType,
      targetSector: body.targetSector || 'All Sectors',
      amount: Number(body.amount),
      createdAt: new Date().toISOString(),
    };
    store.funds.unshift(fund);
    res.status(201).json({ fund });
  });

  router.delete('/funds/:id', requireDemoAuth, (req, res) => {
    const idx = store.funds.findIndex((f) => f.id === req.params.id);
    if (idx === -1) {
      res.status(404).json({ error: 'Fund not found.' });
      return;
    }
    store.funds.splice(idx, 1);
    res.json({ ok: true });
  });

  router.get('/template.xlsx', (_req, res) => {
    const sampleRows = [
      {
        'Admission No': 'CF-2026-201',
        'Full Name': 'Kiran Raj',
        Email: 'kiran.raj@campus.edu',
        'Sector Code': 'ENG',
        'Union Name': 'Tech Union',
        'Funding Option': 'Student Fees',
        'Fee Amount': 42000,
      },
      {
        'Admission No': 'CF-2026-202',
        'Full Name': 'Lakshmi Menon',
        Email: 'lakshmi.m@campus.edu',
        'Sector Code': 'SCI',
        'Union Name': 'Science Forum',
        'Funding Option': 'Charity',
        'Fee Amount': 36000,
      },
    ];
    const ws = XLSX.utils.json_to_sheet(sampleRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Students');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="students-template.xlsx"');
    res.send(buf);
  });

  return router;
}

export function createCollegeFinanceApp(store = createCollegeFinanceStore()): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  const router = createCollegeFinanceRouter(store);
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'demo-college-finance' });
  });

  // Mount Universal Assistant SDK drop-in routes
  const adapters: AssistantAdapters = {
    data: new MemoryDataAdapter({
      students: store.students as any,
      sectors: store.sectors as any,
      funds: store.funds as any,
    }),
  };
  const assistantRouter = createAssistantServerRouter({
    config: khaznaAssistantConfig,
    adapters,
  });
  app.use('/assistant', assistantRouter);
  app.use('/api/assistant', assistantRouter);

  app.use('/api/demo/college-finance', router);
  app.use('/', router);


  return app;
}

const app = createCollegeFinanceApp();
export default app;

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const currentPath = fileURLToPath(import.meta.url);
if (!process.env.VERCEL && entryPath === currentPath) {
  const port = Number(process.env.PORT || 3001);
  app.listen(port, '0.0.0.0', () => {
    console.log(`demo-college-finance listening on port ${port}`);
  });
}

