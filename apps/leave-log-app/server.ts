import express, { type Express, type Request, type Response } from 'express';
import { MemoryDataAdapter, type AssistantAdapters } from '@ai-assistant/core';
import { createAssistantServerRouter } from '@ai-assistant/server';
import { leaveLogAssistantConfig } from '../../assistant.config.ts';

export interface LeaveRequestRecord {
  id: string;
  employeeId: string;
  employeeName: string;
  department: string;
  leaveType: 'Sick Leave' | 'Casual Leave' | 'Annual Leave' | 'Emergency';
  status: 'Pending' | 'Approved' | 'Rejected';
  fromDate: string;
  toDate: string;
  reason: string;
  approvedBy?: string;
  organizationId: string;
}

export function createLeaveLogStore() {
  const leaveRequests: LeaveRequestRecord[] = [
    {
      id: 'lv-001',
      employeeId: 'EMP-101',
      employeeName: 'Dr. Zainab Siddiqui',
      department: 'dept-sciences',
      leaveType: 'Casual Leave',
      status: 'Pending',
      fromDate: '2026-11-20',
      toDate: '2026-11-22',
      reason: 'Attending National Academic Symposium',
      organizationId: 'org-main',
    },
    {
      id: 'lv-002',
      employeeId: 'EMP-102',
      employeeName: 'Prof. Tariq Mansoor',
      department: 'dept-fiqh',
      leaveType: 'Sick Leave',
      status: 'Approved',
      fromDate: '2026-11-15',
      toDate: '2026-11-17',
      reason: 'Medical recovery after flu',
      approvedBy: 'Principal Office',
      organizationId: 'org-main',
    },
    {
      id: 'lv-003',
      employeeId: 'EMP-103',
      employeeName: 'Farhan Akhtar',
      department: 'dept-tech',
      leaveType: 'Annual Leave',
      status: 'Pending',
      fromDate: '2026-12-01',
      toDate: '2026-12-08',
      reason: 'Family pilgrimage and vacation',
      organizationId: 'org-main',
    },
  ];

  return { leaveRequests };
}

export function createLeaveLogApp(store = createLeaveLogStore()): Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '10mb' }));

  // Initialize SDK data adapter backed by the leaveRequests store
  const dataAdapter = new MemoryDataAdapter({
    leaveRequests: store.leaveRequests as any,
  });

  const adapters: AssistantAdapters = {
    data: dataAdapter,
    actions: {
      requiresConfirmation: (action) => action.includes('approve') || action.includes('reject') || action.includes('delete'),
      executeAction: async (action, params) => {
        if (action === 'approve_leave') {
          const req = store.leaveRequests.find((l) => l.id === params.id);
          if (!req) return { success: false, error: 'Leave request not found' };
          req.status = 'Approved';
          req.approvedBy = 'Admin Office';
          return { success: true, message: `Leave request ${params.id} has been approved.` };
        }
        return { success: false, error: `Action ${action} not supported` };
      },
    },
  };

  // Mount Host App APIs
  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', service: 'leave-log-app', records: store.leaveRequests.length });
  });

  app.get('/api/leaves', (_req: Request, res: Response) => {
    res.json({ leaveRequests: store.leaveRequests });
  });

  // Mount Universal AI Assistant SDK drop-in router
  const assistantRouter = createAssistantServerRouter({
    config: leaveLogAssistantConfig,
    adapters,
  });
  app.use('/assistant', assistantRouter);
  app.use('/api/assistant', assistantRouter);

  return app;
}

const app = createLeaveLogApp();
export default app;
