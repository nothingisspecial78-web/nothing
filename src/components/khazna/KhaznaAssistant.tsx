import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { toast } from 'sonner';
import type { AvailableRouteHint, ExportFilePayload } from '@ai-assistant/core';
import { AssistantWidget } from '../../../packages/widget/src/index.ts';
import { AssistantErrorBoundary } from './AssistantErrorBoundary';
import { downloadCSV } from '@/lib/khazna/download';
import { OFFICE_STAFF, PRINCIPALS, TEACHERS, UNION_MEMBERS } from '@/lib/khazna/data';
import { addDays, formatDate, TODAY } from '@/lib/khazna/format';
import { totals } from '@/lib/khazna/ledger';
import { useKhazna } from '@/lib/khazna/store';
import { safeLocalSet, safeSessionGet, safeSessionRemove } from '@/lib/safeStorage';
import type { Role, SignatoryRole, Student } from '@/lib/khazna/types';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dataUriToBlob(dataUri: string): Blob {
  const [header, b64] = dataUri.split(',');
  const mimeMatch = /data:([^;]+)/.exec(header || '');
  const mime = mimeMatch ? mimeMatch[1] : 'application/pdf';
  const binary = atob(b64 || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

export function KhaznaAssistant() {
  const router = useRouter();
  const { pathname } = useLocation();

  const activeOrgId = useKhazna((s) => s.activeOrgId);
  const currentRole = useKhazna((s) => s.currentRole);
  const sessionLoginRole = useKhazna((s) => s.sessionLoginRole);
  const effectiveAiRole: Role =
    sessionLoginRole === 'admin' && currentRole === 'manager' ? 'admin' : currentRole;
  const meStudentId = useKhazna((s) => s.meStudentId);
  const managerSector = useKhazna((s) => s.managerSector);
  const adminEmail = useKhazna((s) => s.college.adminEmail);
  const adminName = useKhazna((s) => s.college.adminName);
  const firstSectorSlug = useKhazna((s) => s.sectors[0]?.slug || 'dept-fiqh');
  const routeSectorMatch = pathname.match(/^\/m\/([^/]+)/);
  const activeManagerSector = routeSectorMatch ? routeSectorMatch[1] : managerSector || firstSectorSlug;
  const currentStudentName = useKhazna(
    (s) => s.students.find((x) => x.id === s.meStudentId)?.name || ''
  );
  const activeSectorName = useKhazna(
    (s) => s.sectors.find((x) => x.slug === activeManagerSector)?.name || activeManagerSector
  );
  const activeManagerId = useKhazna((s) => {
    const m = s.managers?.find((x) => x.sectors?.includes(activeManagerSector));
    return m?.id || m?.email || activeManagerSector;
  });
  const activeManagerName = useKhazna((s) => {
    const m = s.managers?.find((x) => x.sectors?.includes(activeManagerSector));
    return m?.name || 'Manager';
  });

  const computedIdentity = useMemo(() => {
    const isPublicAuthRoute =
      pathname === '/login' || pathname === '/super-admin/login' || pathname.startsWith('/auth');
    const saToken = safeSessionGet('khazna_super_admin_token');

    if (isPublicAuthRoute && !saToken) {
      return {
        role: 'PUBLIC' as const,
        userKey: 'public:guest',
        userLabel: 'Guest Visitor',
      };
    }

    // 1. Super Admin platform portal (/super-admin)
    const isSuperAdminRoute = pathname.startsWith('/super-admin');
    const saUserRaw = safeSessionGet('khazna_super_admin_user');
    let saEmail = 'superadmin@khaznacampus.platform';
    if (saUserRaw) {
      try {
        const parsed = JSON.parse(saUserRaw);
        if (parsed.email) saEmail = parsed.email;
      } catch {
        // ignore JSON parse error
      }
    }

    if (isSuperAdminRoute || saToken) {
      return {
        role: 'SUPER_ADMIN' as const,
        userKey: `platform:super_admin:${saEmail}`,
        userLabel: `Super Admin (${saEmail})`,
      };
    }

    // 2. Student role (isolated by organization and student ID)
    if (effectiveAiRole === 'student') {
      const studentId = meStudentId || 'S0125';
      const studentLabel = currentStudentName ? `${currentStudentName} (${studentId})` : `Student (${studentId})`;
      return {
        role: 'STUDENT' as const,
        userKey: `${activeOrgId}:student:${studentId}`,
        userLabel: studentLabel,
      };
    }

    // 3. Sector Manager role (only when logged in directly as Sector Manager; Admin previewing a sector keeps Admin AI assistant history)
    if (effectiveAiRole === 'manager') {
      return {
        role: 'SECTOR_MANAGER' as const,
        userKey: `${activeOrgId}:manager:${activeManagerSector}:${activeManagerId}`,
        userLabel: `${activeManagerName} (Manager · ${activeSectorName})`,
      };
    }

    // 4. College Admin role (shared single assistant history across all Admin views including opened sectors)
    const cleanAdminEmail = (adminEmail || 'admin@islahululoom.edu').trim().toLowerCase();
    const collegeName = adminName || 'Admin';
    return {
      role: 'ADMIN' as const,
      userKey: `${activeOrgId}:admin:${cleanAdminEmail}`,
      userLabel: `${collegeName} (${cleanAdminEmail})`,
    };
  }, [
    activeManagerId,
    activeManagerName,
    activeManagerSector,
    activeOrgId,
    activeSectorName,
    adminEmail,
    adminName,
    currentStudentName,
    effectiveAiRole,
    meStudentId,
    pathname,
  ]);

  const identityRoleRef = useRef(computedIdentity.role);
  identityRoleRef.current = computedIdentity.role;

  const getAppState = useCallback(() => {
    const isPublicAuthRoute =
      pathname === '/login' || pathname === '/super-admin/login' || pathname.startsWith('/auth');
    const saToken = safeSessionGet('khazna_super_admin_token');
    if (isPublicAuthRoute && !saToken) {
      return {
        role: 'public',
        pathname,
      };
    }

    const st = useKhazna.getState();
    const effectiveRole: Role =
      st.sessionLoginRole === 'admin' && st.currentRole === 'manager' ? 'admin' : st.currentRole;
    const studentNameMap = new Map(st.students.map((s) => [s.id, s.name]));

    if (effectiveRole === 'student') {
      const meStu = st.students.find((s) => s.id === st.meStudentId) || null;
      const mySummary = totals(st.transactions, { studentId: st.meStudentId });
      const mySectors = st.sectors.map((sec) => {
        const t = totals(st.transactions, { sector: sec.slug, studentId: st.meStudentId });
        return {
          slug: sec.slug,
          name: sec.name,
          short: sec.short,
          receiptPrefix: sec.receiptPrefix,
          credit: t.credit,
          debit: t.debit,
          balance: t.balance,
          count: t.count,
        };
      });
      const myTransactions = st.transactions
        .filter((tx) => tx.studentId === st.meStudentId)
        .slice(0, 60)
        .map((tx) => ({
          ...tx,
          studentName: meStu?.name || tx.studentId,
        }));

      return {
        role: 'student',
        pathname,
        activeOrgId: st.activeOrgId,
        college: {
          id: st.college.id,
          name: st.college.name,
          demo: st.college.demo,
        },
        meStudentId: st.meStudentId,
        meStudent: meStu
          ? {
              id: meStu.id,
              name: meStu.name,
              className: meStu.className,
              phone: meStu.phone,
              guardian: meStu.guardian,
              joined: meStu.joined,
            }
          : null,
        mySummary,
        mySectors,
        myTransactions,
        notices: st.notices.slice(0, 20),
      };
    }

    if (effectiveRole === 'manager') {
      const assignedSlug = st.managerSector || st.sectors[0]?.slug || 'dept-fiqh';
      const assignedSec = st.sectors.find((s) => s.slug === assignedSlug);
      const secTotals = totals(st.transactions, { sector: assignedSlug });
      const scopedSector = assignedSec
        ? {
            slug: assignedSec.slug,
            name: assignedSec.name,
            short: assignedSec.short,
            receiptPrefix: assignedSec.receiptPrefix,
            target: assignedSec.target,
            credit: secTotals.credit,
            debit: secTotals.debit,
            balance: secTotals.balance,
            count: secTotals.count,
          }
        : {
            slug: assignedSlug,
            name: assignedSlug,
            short: assignedSlug.slice(0, 2).toUpperCase(),
            receiptPrefix: 'KZ-',
            target: 0,
            credit: secTotals.credit,
            debit: secTotals.debit,
            balance: secTotals.balance,
            count: secTotals.count,
          };

      const sectorStudents = st.students.slice(0, 200).map((stu) => {
        const stuTotals = totals(st.transactions, { sector: assignedSlug, studentId: stu.id });
        const balance = stuTotals.balance;
        return {
          id: stu.id,
          name: stu.name,
          className: stu.className,
          phone: stu.phone,
          guardian: stu.guardian,
          joined: stu.joined,
          sectorId: assignedSlug,
          organizationId: st.activeOrgId,
          credit: stuTotals.credit,
          debit: stuTotals.debit,
          paidTotal: stuTotals.credit,
          debitTotal: stuTotals.debit,
          balance,
          pendingFee: balance < 0 ? Math.abs(balance) : 0,
          count: stuTotals.count,
        };
      });

      const sectorTransactions = st.transactions
        .filter((tx) => tx.sector === assignedSlug)
        .slice(0, 25)
        .map((tx) => ({
          ...tx,
          studentName: studentNameMap.get(tx.studentId) || tx.studentId,
        }));

      const sectorBatches = st.batches.filter((b) => b.sector === assignedSlug).slice(0, 20);
      const isDemoOrg = st.college.demo || st.activeOrgId === 'demo';
      const scopedTeachers = isDemoOrg
        ? TEACHERS.filter((t) => t.sectorId === assignedSlug).map((t) => ({ ...t, organizationId: st.activeOrgId }))
        : [];
      const scopedUnionMembers = isDemoOrg
        ? UNION_MEMBERS.filter((u) => u.sectorId === assignedSlug).map((u) => ({ ...u, organizationId: st.activeOrgId }))
        : [];
      const scopedPrincipals = isDemoOrg
        ? PRINCIPALS.map((p) => ({ ...p, organizationId: st.activeOrgId }))
        : [];
      const scopedManagers = (st.managers || [])
        .filter((m) => m.sectors?.includes(assignedSlug))
        .map((m) => ({ ...m, organizationId: st.activeOrgId }));

      return {
        role: 'manager',
        pathname,
        activeOrgId: st.activeOrgId,
        college: {
          id: st.college.id,
          name: st.college.name,
          demo: st.college.demo,
        },
        managerSector: assignedSlug,
        classes: st.classes,
        sectors: [scopedSector],
        students: sectorStudents,
        teachers: scopedTeachers,
        principals: scopedPrincipals,
        managers: scopedManagers,
        unionMembers: scopedUnionMembers,
        recentTransactions: sectorTransactions,
        batches: sectorBatches,
        notices: st.notices.slice(0, 15),
      };
    }

    // Build compact per-student overall + bySector totals so lookups work for any student (including tail rows)
    const studentLedgers = new Map<
      string,
      {
        credit: number;
        debit: number;
        count: number;
        bySector: Record<string, { credit: number; debit: number; count: number }>;
      }
    >();
    for (const tx of st.transactions) {
      if (tx.voided) continue;
      let entry = studentLedgers.get(tx.studentId);
      if (!entry) {
        entry = { credit: 0, debit: 0, count: 0, bySector: {} };
        studentLedgers.set(tx.studentId, entry);
      }
      if (tx.type === 'credit') entry.credit += tx.amount;
      else entry.debit += tx.amount;
      entry.count += 1;

      const secEntry = (entry.bySector[tx.sector] ||= { credit: 0, debit: 0, count: 0 });
      if (tx.type === 'credit') secEntry.credit += tx.amount;
      else secEntry.debit += tx.amount;
      secEntry.count += 1;
    }

    const compactStudents = st.students.slice(0, 200).map((stu) => {
      const agg = studentLedgers.get(stu.id);
      const bySector: Record<string, { credit: number; debit: number; balance: number; count: number }> = {};
      if (agg) {
        for (const [slug, sAgg] of Object.entries(agg.bySector)) {
          bySector[slug] = {
            credit: sAgg.credit,
            debit: sAgg.debit,
            balance: sAgg.credit - sAgg.debit,
            count: sAgg.count,
          };
        }
      }
      const credit = agg?.credit || 0;
      const debit = agg?.debit || 0;
      const balance = credit - debit;
      return {
        id: stu.id,
        name: stu.name,
        className: stu.className,
        phone: stu.phone,
        guardian: stu.guardian,
        joined: stu.joined,
        organizationId: st.activeOrgId,
        credit,
        debit,
        paidTotal: credit,
        debitTotal: debit,
        balance,
        pendingFee: balance < 0 ? Math.abs(balance) : 0,
        bySector,
      };
    });

    const isDemoOrg = st.college.demo || st.activeOrgId === 'demo';
    const principalsList = isDemoOrg
      ? PRINCIPALS.map((p) => ({ ...p, organizationId: st.activeOrgId }))
      : [
          {
            id: 'ADM-01',
            name: st.college.adminName || 'Principal',
            email: st.college.adminEmail,
            phone: st.institutionProfile.phone || '',
            title: 'Principal / Admin',
            office: "Principal's Office",
            institution: st.college.name,
            status: 'active',
            organizationId: st.activeOrgId,
          },
        ];

    return {
      role: st.currentRole,
      pathname,
      activeOrgId: st.activeOrgId,
      organizations: st.organizations,
      college: {
        id: st.college.id,
        name: st.college.name,
        adminName: st.college.adminName,
        adminEmail: st.college.adminEmail,
        demo: st.college.demo,
      },
      institutionProfile: {
        name: st.institutionProfile.name,
        short_name: st.institutionProfile.short_name,
        tagline: st.institutionProfile.tagline,
        reg_no: st.institutionProfile.reg_no,
        phone: st.institutionProfile.phone,
        email: st.institutionProfile.email,
        website: st.institutionProfile.website,
        verify_expiry: st.institutionProfile.verify_expiry,
        verify_mask_names: st.institutionProfile.verify_mask_names,
      },
      totalStudents: st.students.length,
      sectors: st.sectors.map((sec) => {
        const t = totals(st.transactions, { sector: sec.slug });
        return {
          slug: sec.slug,
          name: sec.name,
          short: sec.short,
          receiptPrefix: sec.receiptPrefix,
          target: sec.target,
          credit: t.credit,
          debit: t.debit,
          balance: t.balance,
          count: t.count,
          organizationId: st.activeOrgId,
        };
      }),
      classes: st.classes,
      students: compactStudents,
      principals: principalsList,
      teachers: isDemoOrg ? TEACHERS.map((t) => ({ ...t, organizationId: st.activeOrgId })) : [],
      officeStaff: isDemoOrg ? OFFICE_STAFF.map((s) => ({ ...s, organizationId: st.activeOrgId })) : [],
      unionMembers: isDemoOrg ? UNION_MEMBERS.map((u) => ({ ...u, organizationId: st.activeOrgId })) : [],
      recentTransactions: st.transactions.slice(0, 25).map((tx) => ({
        ...tx,
        studentName: studentNameMap.get(tx.studentId) || tx.studentId,
      })),
      batches: st.batches.slice(0, 20),
      managers: (st.managers || []).map((m) => ({ ...m, organizationId: st.activeOrgId })),
      signatories: st.signatories,
      signatureSlots: st.signatureSlots,
      reportExports: st.reportExports.map(({ pdf_base64: _omit, ...rest }) => rest),
      notices: st.notices.slice(0, 20),
      auditCount: st.audit.length,
    };
  }, [pathname]);

  const onAppCommand = useCallback(
    (command: string, payload: Record<string, unknown>) => {
      const st = useKhazna.getState();

      switch (command) {
        case 'SIGNUP_COLLEGE': {
          const college = String(payload.college || 'New Campus College').trim();
          const name = String(payload.name || payload.fullName || 'Admin').trim();
          const email = String(payload.email || 'admin@college.edu').trim().toLowerCase();
          const password = String(payload.password || '');
          st.signUpCollege({ college, name, email, password });
          st.setSessionLoginRole('admin');
          st.setCurrentRole('admin');
          void router.navigate({ to: '/admin' });
          toast.success(`Created campus workspace for ${college}`);
          break;
        }

        case 'NAVIGATE': {
          const route = typeof payload.route === 'string' && payload.route ? payload.route : '/admin';
          if (route === '/login' || payload.signOut === true) {
            safeSessionRemove('khazna_super_admin_token');
            safeSessionRemove('khazna_super_admin_user');
            void router.navigate({ to: '/login' });
            if (pathname !== '/login') {
              toast.success('Signed out');
            }
            break;
          }
          if (payload.loadDemo === true) {
            st.loadDemo();
          }
          if (payload.role === 'admin' || payload.role === 'manager' || payload.role === 'student') {
            st.setCurrentRole(payload.role as Role);
            if (payload.loadDemo === true) {
              st.setSessionLoginRole(payload.role as Role);
            }
          } else if (route.startsWith('/admin')) {
            st.setCurrentRole('admin');
          } else if (route.startsWith('/m/')) {
            st.setCurrentRole('manager');
            const mMatch = /^\/m\/([^/]+)/.exec(route);
            if (mMatch?.[1]) st.setManagerSector(mMatch[1]);
          } else if (route.startsWith('/app')) {
            st.setCurrentRole('student');
          }
          if (typeof payload.sectorSlug === 'string' && payload.sectorSlug) {
            st.setManagerSector(payload.sectorSlug);
          }
          void router.navigate({ to: route as never });
          break;
        }

        case 'CREATE_ENTRY': {
          const sector = String(payload.sector || st.managerSector || st.sectors[0]?.slug || 'office');
          let studentId = String(payload.studentId || st.meStudentId || 'S0125');
          if (typeof payload.studentChoice === 'string' && payload.studentChoice.includes('·')) {
            studentId = payload.studentChoice.split('·')[0].trim();
          }
          const tx = st.addEntry({
            id: typeof payload.txId === 'string' ? payload.txId : undefined,
            sector,
            studentId,
            type: payload.type === 'debit' ? 'debit' : 'credit',
            title: String(payload.title || 'Fee Payment'),
            reason: typeof payload.reason === 'string' && payload.reason ? payload.reason : undefined,
            amount: Number(payload.amount || 500),
            date: String(payload.date || new Date().toISOString().slice(0, 10)),
            receiptNo: String(payload.receiptNo || `KZ-${Math.floor(2000 + Math.random() * 7000)}`),
          });
          st.setManagerSector(sector);
          st.setCurrentRole('manager');
          void router.navigate({
            to: '/m/$sectorSlug/ledger',
            params: { sectorSlug: sector },
          });
          toast.success(`Posted ${tx.receiptNo} (₹${tx.amount.toLocaleString('en-IN')})`);
          break;
        }

        case 'EDIT_ENTRY': {
          const id = String(payload.id || '');
          const patch = (payload.patch && typeof payload.patch === 'object' ? payload.patch : payload) as Record<
            string,
            unknown
          >;
          if (id) {
            st.editEntry(id, {
              title: typeof patch.title === 'string' ? patch.title : undefined,
              amount: typeof patch.amount === 'number' ? patch.amount : undefined,
              reason: typeof patch.reason === 'string' ? patch.reason : undefined,
              date: typeof patch.date === 'string' ? patch.date : undefined,
            });
            if (typeof payload.sector === 'string' && payload.sector) {
              st.setManagerSector(payload.sector);
              st.setCurrentRole('manager');
              void router.navigate({
                to: '/m/$sectorSlug/ledger',
                params: { sectorSlug: payload.sector },
              });
            }
            toast.success('Updated ledger entry');
          }
          break;
        }

        case 'DELETE_ENTRIES': {
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
          ids.forEach((id) => st.deleteEntry(id));
          if (ids.length > 0) {
            toast('Undid AI ledger entry');
          }
          break;
        }

        case 'VOID_ENTRY': {
          const id = String(payload.id || '');
          const reason = String(payload.reason || 'Corrected via AI Agent');
          if (id) {
            st.voidEntry(id, reason);
            if (typeof payload.sector === 'string' && payload.sector) {
              st.setManagerSector(payload.sector);
              st.setCurrentRole('manager');
              void router.navigate({
                to: '/m/$sectorSlug/ledger',
                params: { sectorSlug: payload.sector },
              });
            }
            toast.success(`Voided receipt ${String(payload.receiptNo || id)}`);
          }
          break;
        }

        case 'UNVOID_ENTRIES': {
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
          ids.forEach((id) => st.unvoidEntry(id));
          if (ids.length > 0) {
            toast('Restored voided entry');
          }
          break;
        }

        case 'ADD_STUDENT': {
          const student: Student = {
            id: String(payload.id || `S${Date.now().toString().slice(-4)}`).toUpperCase(),
            name: String(payload.name || 'Student'),
            className: String(payload.className || st.classes[0] || 'Fiqh 2'),
            phone: String(payload.phone || '9847000000'),
            guardian: String(payload.guardian || 'Parent / Guardian'),
            joined: String(payload.joined || new Date().toISOString().slice(0, 10)),
          };
          if (student.className && !st.classes.includes(student.className)) {
            st.addClass(student.className);
          }
          st.addStudent(student);
          st.setCurrentRole('admin');
          void router.navigate({ to: '/admin/students' });
          toast.success(`Enrolled ${student.name} (${student.id})`);
          break;
        }

        case 'EDIT_STUDENT': {
          const id = String(payload.id || '');
          if (id) {
            const patch: Partial<Student> = {};
            if (typeof payload.name === 'string' && payload.name.trim()) patch.name = payload.name.trim();
            if (typeof payload.className === 'string' && payload.className.trim()) {
              patch.className = payload.className.trim();
              if (!st.classes.includes(patch.className)) {
                st.addClass(patch.className);
              }
            }
            if (typeof payload.phone === 'string' && payload.phone.trim()) patch.phone = payload.phone.trim();
            if (typeof payload.guardian === 'string' && payload.guardian.trim()) patch.guardian = payload.guardian.trim();
            st.editStudent(id, patch);
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/students' });
            toast.success(`Updated student ${patch.name || id}`);
          }
          break;
        }

        case 'DELETE_STUDENTS': {
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
          ids.forEach((id) => st.deleteStudent(id));
          if (ids.length > 0) {
            toast(`Removed ${ids.length} student record(s)`);
          }
          break;
        }

        case 'CREATE_SECTOR': {
          const name = String(payload.name || 'New Sector');
          const initials =
            name
              .split(/\s+/)
              .map((w) => w[0] || '')
              .join('')
              .slice(0, 2)
              .toUpperCase() || 'SC';
          const created = st.addSector({
            name,
            description: String(payload.description || `${name} — campus ledger sector.`),
            receiptPrefix: String(payload.receiptPrefix || `${initials}-`).toUpperCase(),
            target: Number(payload.target || 300000),
            color: String(payload.color || 'var(--sector-fiqh)'),
          });
          st.setCurrentRole('admin');
          void router.navigate({ to: '/admin/sectors' });
          toast.success(`Created sector ${created.name}`);
          break;
        }

        case 'UPDATE_SECTOR': {
          const slug = String(payload.slug || '');
          const patch = (payload.patch && typeof payload.patch === 'object' ? payload.patch : payload) as Record<
            string,
            unknown
          >;
          if (slug) {
            st.updateSector(slug, {
              target: typeof patch.target === 'number' ? patch.target : undefined,
              receiptPrefix: typeof patch.receiptPrefix === 'string' ? patch.receiptPrefix : undefined,
              description: typeof patch.description === 'string' ? patch.description : undefined,
            });
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/sectors' });
            toast.success(`Updated sector ${slug}`);
          }
          break;
        }

        case 'DELETE_SECTORS': {
          const slugs = Array.isArray(payload.slugs) ? payload.slugs.map(String) : [];
          slugs.forEach((slug) => st.deleteSector(slug));
          if (slugs.length > 0) {
            toast(`Removed ${slugs.length} sector(s)`);
          }
          break;
        }

        case 'ADD_CLASS': {
          const c = String(payload.className || '').trim();
          if (c) {
            st.addClass(c);
            toast.success(`Added class ${c}`);
          }
          break;
        }

        case 'EDIT_CLASS': {
          const oldName = String(payload.className || '').trim();
          const newName = String(payload.newName || payload.newClassName || '').trim();
          if (oldName && newName) {
            st.editClass(oldName, newName);
            toast.success(`Renamed ${oldName} → ${newName}`);
          }
          break;
        }

        case 'REMOVE_CLASS': {
          const c = String(payload.className || '').trim();
          if (c) {
            st.removeClass(c);
            toast.success(`Removed class ${c}`);
          }
          break;
        }

        case 'MANAGE_CLASS': {
          const action = String(payload.action || 'add');
          const c = String(payload.className || '').trim();
          const next = String(payload.newName || payload.newClassName || '').trim();
          if (action === 'add' && c) {
            st.addClass(c);
            toast.success(`Added class ${c}`);
          } else if ((action === 'edit' || action === 'rename') && c && next) {
            st.editClass(c, next);
            toast.success(`Renamed ${c} → ${next}`);
          } else if (action === 'remove' && c) {
            st.removeClass(c);
            toast.success(`Removed class ${c}`);
          }
          break;
        }

        case 'POST_BATCH':
        case 'POST_BATCH_FROM_FORM': {
          const sector = String(payload.sector || st.managerSector || 'dept-fiqh');
          const secObj = st.sectors.find((s) => s.slug === sector) || st.sectors[0];
          let studentIds = Array.isArray(payload.studentIds) ? payload.studentIds.map(String) : [];
          if (studentIds.length === 0) {
            const cls = typeof payload.className === 'string' ? payload.className.trim().toLowerCase() : '';
            const matching = cls && cls !== 'all classes'
              ? st.students.filter((s) => s.className.toLowerCase().includes(cls))
              : st.students;
            studentIds = (matching.length > 0 ? matching : st.students.slice(0, 8)).map((s) => s.id);
          }
          const batch = st.postBatch({
            id: typeof payload.batchId === 'string' ? payload.batchId : undefined,
            sector,
            studentIds,
            type: payload.type === 'credit' ? 'credit' : 'debit',
            title: String(payload.title || 'Batch Entry'),
            reason: typeof payload.reason === 'string' && payload.reason ? payload.reason : undefined,
            amount: Number(payload.amount || 500),
            date: String(payload.date || new Date().toISOString().slice(0, 10)),
            receiptPrefix: String(payload.receiptPrefix || `${secObj?.receiptPrefix || 'KZ-'}B-`),
            receiptStart: Number(payload.receiptStart || 1),
          });
          st.setManagerSector(sector);
          st.setCurrentRole('manager');
          void router.navigate({
            to: '/m/$sectorSlug/batches',
            params: { sectorSlug: sector },
          });
          toast.success(`Posted batch ${batch.title} (${batch.studentIds.length} students)`);
          break;
        }

        case 'EDIT_BATCH': {
          const id = String(payload.id || '');
          if (id) {
            st.editBatch(id, {
              title: typeof payload.title === 'string' ? payload.title : undefined,
              date: typeof payload.date === 'string' ? payload.date : undefined,
            });
            toast.success('Updated batch');
          }
          break;
        }

        case 'VOID_BATCH': {
          const id = String(payload.id || '');
          if (id) {
            st.voidBatch(id, String(payload.reason || 'Voided via AI Agent'));
            toast.success('Voided bulk batch');
          }
          break;
        }

        case 'DELETE_BATCHES': {
          const ids = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
          ids.forEach((id) => st.deleteBatch(id));
          if (ids.length > 0) {
            toast('Removed bulk batch');
          }
          break;
        }

        case 'IMPORT_STUDENTS': {
          const list = Array.isArray(payload.students) ? (payload.students as Student[]) : [];
          if (list.length > 0) {
            st.importStudents(list);
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/students' });
            toast.success(`Imported ${list.length} student(s) into Khazna`);
          }
          break;
        }

        case 'IMPORT_SECTORS': {
          const rawSectors = Array.isArray(payload.sectors)
            ? (payload.sectors as Array<Record<string, unknown>>)
            : [];
          if (rawSectors.length > 0) {
            const createdSlugs: string[] = [];
            for (const sec of rawSectors) {
              const name = String(sec.name || '').trim();
              if (!name) continue;
              const initials =
                name
                  .split(/\s+/)
                  .map((w) => w[0] || '')
                  .join('')
                  .slice(0, 2)
                  .toUpperCase() || 'SC';
              const created = st.addSector({
                name,
                description: String(sec.description || `${name} — campus ledger sector.`),
                receiptPrefix: String(sec.receiptPrefix || `${initials}-`).toUpperCase(),
                target: Number(sec.target || 300000),
                color: String(sec.color || 'var(--sector-fiqh)'),
              });
              createdSlugs.push(created.slug);
            }
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/sectors' });
            toast.success(`Imported ${createdSlugs.length} sector(s)`);
          }
          break;
        }

        case 'IMPORT_MANAGERS': {
          const rawList = Array.isArray(payload.managers)
            ? (payload.managers as Array<Record<string, unknown>>)
            : [];
          if (rawList.length > 0) {
            const normalized = rawList.map((m) => ({
              name: String(m.name || 'Sector Manager'),
              email: String(m.email || 'manager@college.edu'),
              phone: String(m.phone || '9847000000'),
              sectors: Array.isArray(m.sectors) && m.sectors.length > 0 ? m.sectors.map(String) : ['office'],
            }));
            st.addManagers(normalized);
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/admins' });
            toast.success(`Imported ${normalized.length} sector manager(s)`);
          }
          break;
        }

        case 'IMPORT_BULK_ENTRIES': {
          const sector = String(payload.sector || st.managerSector || st.sectors[0]?.slug || 'office');
          const entries = Array.isArray(payload.entries)
            ? (payload.entries as Array<Record<string, unknown>>)
            : [];
          if (entries.length > 0) {
            for (const entry of entries) {
              st.addEntry({
                id: typeof entry.id === 'string' ? entry.id : undefined,
                sector: String(entry.sector || sector),
                studentId: String(entry.studentId || st.students[0]?.id || 'S0125'),
                type: entry.type === 'credit' ? 'credit' : 'debit',
                title: String(entry.title || 'Bulk Entry'),
                amount: Number(entry.amount || 0),
                date: String(entry.date || new Date().toISOString().slice(0, 10)),
                receiptNo: String(entry.receiptNo || `KZ-${Math.floor(1000 + Math.random() * 8999)}`),
                reason: typeof entry.reason === 'string' ? entry.reason : undefined,
              });
            }
            st.setManagerSector(sector);
            if (st.currentRole === 'student') st.setCurrentRole('manager');
            void router.navigate({
              to: '/m/$sectorSlug/ledger',
              params: { sectorSlug: sector },
            });
            toast.success(`Imported ${entries.length} bulk entries into ${sector}`);
          }
          break;
        }

        case 'DOWNLOAD_REPORT': {
          if (st.currentRole === 'student') {
            const stu = st.students.find((s) => s.id === st.meStudentId);
            if (stu) {
              const txs = st.transactions.filter((t) => !t.voided && t.studentId === stu.id);
              void import('@/lib/khazna/pdf-report').then(({ generateStudentStatementPdf }) =>
                generateStudentStatementPdf({
                  collegeName: st.college.name,
                  student: stu,
                  transactions: txs,
                  generatedBy: stu.name,
                  institutionProfile: st.institutionProfile,
                }).then((fname) => toast.success(`Downloaded your personal statement: ${fname}`))
              );
            }
            break;
          }
          const format = String(payload.format || 'pdf') as 'pdf' | 'xlsx' | 'csv';
          const reportKind = String(payload.reportKind || 'class_report');
          const sectorSlug = String(payload.sector || st.managerSector || st.sectors[0]?.slug || 'dept-fiqh');
          const sectorObj = st.sectors.find((s) => s.slug === sectorSlug) || st.sectors[0];
          const className = String(payload.className || 'All Classes');
          const from = String(payload.from || addDays(TODAY, -120));
          const to = String(payload.to || TODAY);
          const contentFilter = (payload.contentFilter as 'all' | 'credit' | 'debit') || 'all';
          const orientation = (payload.orientation as 'portrait' | 'landscape') || 'portrait';
          const sortBy = (payload.sortBy as 'adm_asc' | 'adm_desc' | 'name_asc' | 'name_desc' | 'bal_desc' | 'bal_asc') || 'adm_asc';

          if (reportKind === 'students_directory') {
            downloadCSV('khazna-students-directory.csv', [
              ['Ad.No', 'Full Name', 'Class', 'Phone', 'Guardian', 'Joined'],
              ...st.students.map((s) => [s.id, s.name, s.className, s.phone, s.guardian, s.joined]),
            ]);
            toast.success('Downloaded Student Directory CSV');
            break;
          }

          if (reportKind === 'sector_ledger') {
            const nameMap = new Map(st.students.map((s) => [s.id, s.name]));
            const secTxs = st.transactions.filter((t) => !t.voided && t.sector === sectorObj?.slug);
            downloadCSV(`khazna-${sectorObj?.slug || 'sector'}-ledger.csv`, [
              ['Receipt', 'Date', 'Student ID', 'Student Name', 'Title', 'Type', 'Amount'],
              ...secTxs.map((t) => [
                t.receiptNo,
                t.date,
                t.studentId,
                nameMap.get(t.studentId) || t.studentId,
                t.title,
                t.type.toUpperCase(),
                t.amount,
              ]),
            ]);
            toast.success(`Downloaded ${sectorObj?.name || 'Sector'} Ledger CSV`);
            break;
          }

          const matchingStudents =
            className.toLowerCase() === 'all classes' || className.toLowerCase() === 'all'
              ? st.students
              : st.students.filter((s) => s.className.toLowerCase().includes(className.toLowerCase()));
          const effectiveStudents = matchingStudents.length > 0 ? matchingStudents : st.students;

          const items = effectiveStudents.map((stu) => {
            let credit = 0;
            let debit = 0;
            for (const t of st.transactions) {
              if (t.voided || (sectorObj && t.sector !== sectorObj.slug) || t.studentId !== stu.id) continue;
              if (t.date < from || t.date > to) continue;
              if (t.type === 'credit') credit += t.amount;
              else debit += t.amount;
            }
            return {
              studentId: stu.id,
              studentName: stu.name,
              className: stu.className,
              credit,
              debit,
              balance: credit - debit,
            };
          });

          const totalSum = items.reduce(
            (acc, r) => ({
              credit: acc.credit + r.credit,
              debit: acc.debit + r.debit,
              balance: acc.balance + r.balance,
            }),
            { credit: 0, debit: 0, balance: 0 }
          );

          const cleanSector = (sectorObj?.name || 'Khazna').replace(/\s+/g, '');
          const cleanClass = className.replace(/\s+/g, '');

          if (format === 'xlsx') {
            void import('@/lib/khazna/export').then(({ downloadExcelReport }) =>
              downloadExcelReport({
                filename: `Khazna_${cleanSector}_${cleanClass}_${from}_${to}.xlsx`,
                collegeName: st.college.name,
                sectorName: sectorObj?.name || 'All Sectors',
                className,
                dateRangeStr: `${formatDate(from)} – ${formatDate(to)}`,
                rows: items,
                totals: totalSum,
                contentFilter,
              }).then(() => toast.success('Downloaded Excel (.xlsx) report'))
            );
          } else if (format === 'csv') {
            void import('@/lib/khazna/export').then(({ downloadCSVReport }) => {
              downloadCSVReport({
                filename: `Khazna_${cleanSector}_${cleanClass}_${from}_${to}.csv`,
                collegeName: st.college.name,
                sectorName: sectorObj?.name || 'All Sectors',
                className,
                dateRangeStr: `${formatDate(from)} – ${formatDate(to)}`,
                rows: items,
                totals: totalSum,
                contentFilter,
              });
              toast.success('Downloaded CSV report');
            });
          } else {
            void import('@/lib/khazna/pdf-report').then(({ generateClassWisePdf }) =>
              generateClassWisePdf({
                collegeName: st.college.name,
                sectorName: sectorObj?.name || 'All Sectors',
                className,
                from,
                to,
                contentFilter,
                sortBy,
                showSummaryCards: true,
                showNetBalance: true,
                showSignatureLines: true,
                showPageNumbers: true,
                orientation,
                generatedBy: st.college.adminName,
                institutionProfile: st.institutionProfile,
                signatories: st.signatories,
                signatureSlots: st.signatureSlots,
                qrVerification: payload.qrVerification !== false,
                existingReports: st.reportExports,
                onExportRecorded: (exp) => st.createReportExport(exp),
                items,
              })
                .then((fname) => {
                  toast.success(`Downloaded PDF report: ${fname}`);
                })
                .catch((err) => {
                  console.error(err);
                  toast.error('Failed to generate PDF report');
                })
            );
          }
          break;
        }

        case 'DOWNLOAD_STUDENT_STATEMENT': {
          const studentId = String(payload.studentId || st.meStudentId || st.students[0]?.id || '');
          const stu = st.students.find((s) => s.id === studentId);
          if (!stu) {
            toast.error('Student not found');
            break;
          }
          const sectorSlug = typeof payload.sector === 'string' ? payload.sector : undefined;
          const txs = st.transactions.filter(
            (t) => !t.voided && t.studentId === stu.id && (!sectorSlug || t.sector === sectorSlug)
          );
          if (payload.format === 'csv') {
            downloadCSV(`Statement_${stu.id}_${stu.name.replace(/\s+/g, '_')}.csv`, [
              ['Date', 'Receipt', 'Sector', 'Title', 'Type', 'Amount'],
              ...txs.map((t) => [t.date, t.receiptNo, t.sector, t.title, t.type.toUpperCase(), t.amount]),
            ]);
            toast.success(`Downloaded CSV statement for ${stu.name}`);
          } else {
            void import('@/lib/khazna/pdf-report').then(({ generateStudentStatementPdf }) =>
              generateStudentStatementPdf({
                collegeName: st.college.name,
                student: stu,
                transactions: txs,
                generatedBy: st.college.adminName,
                institutionProfile: st.institutionProfile,
              })
                .then((fname) => toast.success(`Downloaded statement: ${fname}`))
                .catch((err) => {
                  console.error(err);
                  toast.error('Failed to generate student PDF statement');
                })
            );
          }
          break;
        }

        case 'DOWNLOAD_AUDIT_CSV': {
          const actionFilter = typeof payload.action === 'string' ? payload.action.toLowerCase() : '';
          const roleFilter = typeof payload.role === 'string' && payload.role !== 'all' ? payload.role : '';
          const rows = st.audit.filter((a) => {
            if (roleFilter && a.role !== roleFilter) return false;
            if (actionFilter && !a.action.toLowerCase().includes(actionFilter)) return false;
            return true;
          });
          downloadCSV('khazna-audit-log.csv', [
            ['Timestamp', 'Actor', 'Role', 'Action', 'Target', 'Sector', 'Details', 'IP'],
            ...rows.map((a) => [a.at, a.actor, a.role, a.action, a.target, a.sector || '', a.details, a.ip || '']),
          ]);
          toast.success(`Downloaded ${rows.length} audit entries (CSV)`);
          break;
        }

        case 'DOWNLOAD_TEMPLATE_CSV': {
          const template =
            payload.template === 'managers'
              ? 'managers'
              : payload.template === 'bulk-entries'
                ? 'bulk-entries'
                : 'students';
          if (template === 'managers') {
            downloadCSV('managers-template.csv', [
              ['name', 'email', 'phone', 'sectors'],
              ['Usthad Shameer', 'shameer@college.edu', '9847001122', 'dept-fiqh,office'],
            ]);
          } else if (template === 'bulk-entries') {
            downloadCSV('bulk-entries-template.csv', [
              ['studentId', 'title', 'amount', 'type', 'sector', 'date', 'receiptNo'],
              ['S0125', 'Tuition Fee', '1500', 'credit', 'office', TODAY, 'OF-901'],
            ]);
          } else {
            downloadCSV('students-template.csv', [
              ['id', 'name', 'className', 'phone', 'guardian'],
              ['S0201', 'Amina K.', 'Fiqh 2', '9847001122', 'Kareem'],
            ]);
          }
          toast.success(`Downloaded ${template}-template.csv`);
          break;
        }

        case 'PRINT_PAGE': {
          if (typeof window !== 'undefined') {
            window.print();
          }
          break;
        }

        case 'INVITE_MANAGER': {
          const name = String(payload.name || 'New Manager');
          const email = String(payload.email || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@college.edu`);
          const sectors = Array.isArray(payload.sectors)
            ? payload.sectors.map(String)
            : [String(payload.sector || st.sectors[0]?.slug || 'dept-fiqh')];
          st.inviteManager({
            name,
            email,
            phone: String(payload.phone || '9847000000'),
            sectors,
          });
          st.setCurrentRole('admin');
          void router.navigate({ to: '/admin/admins' });
          toast.success(`Invited ${name}`);
          break;
        }

        case 'EDIT_MANAGER': {
          const id = String(payload.id || '');
          if (id) {
            st.editManager(id, {
              name: typeof payload.name === 'string' ? payload.name : undefined,
              email: typeof payload.email === 'string' ? payload.email : undefined,
              phone: typeof payload.phone === 'string' ? payload.phone : undefined,
              sectors: Array.isArray(payload.sectors) ? payload.sectors.map(String) : undefined,
            });
            toast.success('Updated manager');
          }
          break;
        }

        case 'DELETE_MANAGER': {
          const id = String(payload.id || '');
          if (id) {
            st.deleteManager(id);
            toast.success('Removed manager');
          }
          break;
        }

        case 'TOGGLE_MANAGER_STATUS': {
          const id = String(payload.id || '');
          if (id) {
            st.toggleManagerStatus(id);
            toast.success('Updated manager status');
          }
          break;
        }

        case 'ASSIGN_SECTORS': {
          const id = String(payload.id || '');
          const sectors = Array.isArray(payload.sectors) ? payload.sectors.map(String) : [];
          if (id) {
            st.assignSectors(id, sectors);
            toast.success('Updated manager sector assignments');
          }
          break;
        }

        case 'UPDATE_INSTITUTION': {
          st.updateInstitutionProfile({
            ...(typeof payload.name === 'string' && payload.name ? { name: payload.name } : {}),
            ...(typeof payload.short_name === 'string' ? { short_name: payload.short_name } : {}),
            ...(typeof payload.tagline === 'string' ? { tagline: payload.tagline } : {}),
            ...(typeof payload.reg_no === 'string' ? { reg_no: payload.reg_no } : {}),
            ...(typeof payload.phone === 'string' ? { phone: payload.phone } : {}),
            ...(typeof payload.email === 'string' ? { email: payload.email } : {}),
            ...(typeof payload.website === 'string' ? { website: payload.website } : {}),
            ...(payload.verify_expiry === 'never' ||
            payload.verify_expiry === '90d' ||
            payload.verify_expiry === '1y'
              ? { verify_expiry: payload.verify_expiry }
              : {}),
            ...(typeof payload.verify_mask_names === 'boolean'
              ? { verify_mask_names: payload.verify_mask_names }
              : {}),
          });
          st.setCurrentRole('admin');
          void router.navigate({ to: '/admin/institution' });
          toast.success('Updated Institution Profile');
          break;
        }

        case 'ADD_SIGNATORY': {
          const res = st.addSignatory({
            full_name: String(payload.full_name || 'Authorized Officer'),
            designation: String(payload.designation || 'Department Officer'),
            role: (payload.role as SignatoryRole) || 'hod',
            sector_id: typeof payload.sector_id === 'string' && payload.sector_id ? payload.sector_id : undefined,
            active: true,
            signature_version: 1,
          });
          if (res.success) {
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/institution' });
            toast.success(`Added signatory ${String(payload.full_name || '')}`);
          } else {
            toast.error(res.error || 'Could not add signatory');
          }
          break;
        }

        case 'DELETE_SIGNATORY': {
          const id = String(payload.id || '');
          if (id) {
            st.deleteSignatory(id);
            toast.success('Removed signatory');
          }
          break;
        }

        case 'TOGGLE_SIGNATORY': {
          const id = String(payload.id || '');
          if (id) {
            const res = st.toggleSignatoryActive(id);
            if (res.success) toast.success('Toggled signatory active status');
            else toast.error(res.error || 'Failed to toggle signatory');
          }
          break;
        }

        case 'REVOKE_REPORT': {
          const id = String(payload.id || '');
          if (id) {
            st.revokeReportExport(id, String(payload.reason || 'Revoked via AI Agent'));
            toast.success('Revoked issued report QR link');
          }
          break;
        }

        case 'EXTEND_REPORT': {
          const id = String(payload.id || '');
          const days = Number(payload.days || 90);
          if (id) {
            const nextIso = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
            st.extendReportExport(id, nextIso);
            toast.success(`Extended report expiry by ${days} days`);
          }
          break;
        }

        case 'OPEN_VERIFY_REPORT': {
          const token = String(payload.token || '');
          if (token) {
            void router.navigate({ to: '/v/$token', params: { token } });
          }
          break;
        }

        case 'DOWNLOAD_ISSUED_PDF': {
          const id = String(payload.id || '');
          const rep = st.reportExports.find((r) => r.id === id);
          if (rep?.pdf_base64) {
            triggerDownload(dataUriToBlob(rep.pdf_base64), `${rep.ref}.pdf`);
            toast.success(`Re-downloaded ${rep.ref}.pdf`);
          } else {
            toast.error('PDF data unavailable for that report');
          }
          break;
        }

        case 'MANAGE_MANAGER': {
          const action = String(payload.action || 'invite');
          const findMgr = () => {
            if (typeof payload.id === 'string' && payload.id) {
              return st.managers.find((m) => m.id === payload.id);
            }
            const qName = typeof payload.name === 'string' ? payload.name.trim().toLowerCase() : '';
            const qEmail = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
            return st.managers.find(
              (m) =>
                (qEmail && m.email.toLowerCase() === qEmail) ||
                (qName && m.name.toLowerCase().includes(qName))
            );
          };
          if (action === 'invite') {
            const name = String(payload.name || 'New Manager');
            const email = String(
              payload.email || `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@college.edu`
            );
            const sectors = Array.isArray(payload.sectors)
              ? payload.sectors.map(String)
              : [String(payload.sector || st.sectors[0]?.slug || 'dept-fiqh')];
            st.inviteManager({
              name,
              email,
              phone: String(payload.phone || '9847000000'),
              sectors,
            });
            st.setCurrentRole('admin');
            void router.navigate({ to: '/admin/admins' });
            toast.success(`Invited ${name}`);
          } else {
            const mgr = findMgr();
            if (!mgr) {
              toast.error('Manager not found');
              break;
            }
            if (action === 'edit') {
              st.editManager(mgr.id, {
                name: typeof payload.name === 'string' ? payload.name : undefined,
                email: typeof payload.email === 'string' ? payload.email : undefined,
                phone: typeof payload.phone === 'string' ? payload.phone : undefined,
                sectors: Array.isArray(payload.sectors) ? payload.sectors.map(String) : undefined,
              });
              toast.success(`Updated ${mgr.name}`);
            } else if (action === 'assign' && Array.isArray(payload.sectors)) {
              st.assignSectors(mgr.id, payload.sectors.map(String));
              toast.success(`Updated sector assignments for ${mgr.name}`);
            } else if (action === 'toggle') {
              st.toggleManagerStatus(mgr.id);
              toast.success(`Toggled status for ${mgr.name}`);
            } else if (action === 'delete') {
              st.deleteManager(mgr.id);
              toast.success(`Removed ${mgr.name}`);
            }
          }
          break;
        }

        case 'MANAGE_SIGNATORY': {
          const action = String(payload.action || 'add');
          if (action === 'add') {
            const res = st.addSignatory({
              full_name: String(payload.full_name || 'Authorized Officer'),
              designation: String(payload.designation || 'Department Officer'),
              role: (payload.role as SignatoryRole) || 'hod',
              sector_id:
                typeof payload.sector_id === 'string' && payload.sector_id ? payload.sector_id : undefined,
              active: true,
              signature_version: 1,
            });
            if (res.success) {
              st.setCurrentRole('admin');
              void router.navigate({ to: '/admin/institution' });
              toast.success(`Added signatory ${String(payload.full_name || '')}`);
            } else {
              toast.error(res.error || 'Could not add signatory');
            }
          } else {
            const qName = typeof payload.full_name === 'string' ? payload.full_name.trim().toLowerCase() : '';
            const sig =
              (typeof payload.id === 'string' && st.signatories.find((s) => s.id === payload.id)) ||
              (qName ? st.signatories.find((s) => s.full_name.toLowerCase().includes(qName)) : undefined);
            if (!sig) {
              toast.error('Signatory not found');
              break;
            }
            if (action === 'toggle') {
              const res = st.toggleSignatoryActive(sig.id);
              if (res.success) toast.success(`Toggled ${sig.full_name}`);
              else toast.error(res.error || 'Failed to toggle signatory');
            } else if (action === 'delete') {
              st.deleteSignatory(sig.id);
              toast.success(`Removed ${sig.full_name}`);
            }
          }
          break;
        }

        case 'MANAGE_ISSUED_REPORT': {
          const action = String(payload.action || 'download');
          const ref = typeof payload.ref === 'string' ? payload.ref.trim().toUpperCase() : '';
          const rep =
            (typeof payload.id === 'string' && st.reportExports.find((r) => r.id === payload.id)) ||
            (ref ? st.reportExports.find((r) => r.ref.toUpperCase() === ref) : undefined) ||
            st.reportExports[0];
          if (!rep) {
            toast.error('Issued report not found');
            break;
          }
          if (action === 'revoke') {
            st.revokeReportExport(rep.id, String(payload.reason || 'Revoked via AI Agent'));
            toast.success(`Revoked issued report ${rep.ref}`);
          } else if (action === 'extend') {
            const nextIso =
              typeof payload.newExpiry === 'string' && payload.newExpiry
                ? payload.newExpiry
                : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            st.extendReportExport(rep.id, nextIso);
            toast.success(`Extended expiry for ${rep.ref}`);
          } else if (rep.pdf_base64) {
            triggerDownload(dataUriToBlob(rep.pdf_base64), `${rep.ref}.pdf`);
            toast.success(`Re-downloaded ${rep.ref}.pdf`);
          } else {
            toast.error('PDF data unavailable for that report');
          }
          break;
        }

        case 'SWITCH_ORG': {
          if (identityRoleRef.current !== 'SUPER_ADMIN') {
            toast.error('Organization switching is restricted to Super Admin.');
            break;
          }
          const id = String(payload.id || '');
          if (id) {
            st.switchOrg(id);
            void router.navigate({ to: '/admin' });
            toast.success('Switched workspace');
          }
          break;
        }

        case 'CREATE_ORG': {
          if (identityRoleRef.current !== 'SUPER_ADMIN' && identityRoleRef.current !== 'PUBLIC') {
            toast.error('Creating a new organization is restricted.');
            break;
          }
          const created = st.createOrg({
            name: String(payload.name || 'New Campus'),
            adminName: String(payload.adminName || 'Principal'),
            adminEmail: String(payload.adminEmail || 'admin@campus.edu'),
          });
          void router.navigate({ to: '/admin' });
          toast.success(`Created organization ${created.name}`);
          break;
        }

        case 'DELETE_ORG': {
          if (identityRoleRef.current !== 'SUPER_ADMIN') {
            toast.error('Deleting organizations is restricted to Super Admin.');
            break;
          }
          const id = String(payload.id || '');
          if (id) {
            st.deleteOrg(id);
            toast.success('Deleted organization');
          }
          break;
        }

        case 'MARK_NOTICE_READ': {
          const id = String(payload.id || payload.noticeId || '');
          if (id && payload.all !== true) {
            st.markRead(id);
            toast.success('Marked notification as read');
          } else {
            st.markAllRead();
            toast.success('Marked all notifications as read');
          }
          break;
        }

        case 'MARK_ALL_NOTICES_READ': {
          st.markAllRead();
          toast.success('Marked all notifications as read');
          break;
        }

        case 'UPDATE_PHONE': {
          const studentId = String(payload.studentId || st.meStudentId);
          const phone = String(payload.phone || '');
          if (studentId && phone) {
            st.updatePhone(studentId, phone);
            toast.success('Updated student phone number');
          }
          break;
        }

        case 'SET_THEME': {
          const html = document.documentElement;
          const mode = String(payload.theme || 'toggle');
          const nextDark =
            mode === 'dark' ? true : mode === 'light' ? false : !html.classList.contains('dark');
          html.classList.toggle('dark', nextDark);
          safeLocalSet('khazna-theme', nextDark ? 'dark' : 'light');
          toast.success(`Switched to ${nextDark ? 'Dark' : 'Light'} appearance`);
          break;
        }

        default:
          break;
      }

    },
    [router]
  );

  const getAuthToken = useCallback(() => {
    const isPublicAuthRoute =
      pathname === '/login' || pathname === '/super-admin/login' || pathname.startsWith('/auth');
    const saToken = safeSessionGet('khazna_super_admin_token');
    if (isPublicAuthRoute && !saToken) {
      return 'demo:PUBLIC:guest';
    }

    const isSuperAdminRoute = pathname.startsWith('/super-admin');
    if (isSuperAdminRoute || saToken) {
      if (saToken) return `Bearer ${saToken}`;
      const saUserRaw = safeSessionGet('khazna_super_admin_user');
      let saEmail = 'superadmin@khaznacampus.platform';
      if (saUserRaw) {
        try {
          const parsed = JSON.parse(saUserRaw);
          if (parsed.email) saEmail = parsed.email;
        } catch {
          // ignore
        }
      }
      return `demo:SUPER_ADMIN:${saEmail}:::platform`;
    }

    const st = useKhazna.getState();
    const role: Role =
      st.sessionLoginRole === 'admin' && st.currentRole === 'manager' ? 'admin' : st.currentRole;
    const orgId = st.activeOrgId || 'demo';

    if (role === 'student') {
      const studentId = st.meStudentId || 'S0125';
      const studentSector = 'dept-fiqh';
      return `demo:STUDENT:${studentId}:${studentSector}:${studentId}:${orgId}`;
    }

    if (role === 'manager') {
      const routeSectorMatch = pathname.match(/^\/m\/([^/]+)/);
      const activeSector = routeSectorMatch ? routeSectorMatch[1] : st.managerSector || 'dept-fiqh';
      const assignedManager = st.managers?.find((m) => m.sectors?.includes(activeSector));
      const managerId = assignedManager?.id || assignedManager?.email || activeSector;
      return `demo:SECTOR_MANAGER:${managerId}:${activeSector}::${orgId}`;
    }

    // Admin role (preserved even while Admin opens/views a sector)
    const cleanAdminEmail = (st.college.adminEmail || 'admin@islahululoom.edu').trim().toLowerCase();
    return `demo:ADMIN:${cleanAdminEmail}:::${orgId}`;
  }, [pathname]);

  const roleSuggestions = useMemo(() => {
    if (computedIdentity.role === 'PUBLIC') {
      return [
        'Guide me: how to log in',
        'Guide me: create organization',
        'What can this AI assistant do?',
      ];
    }
    if (computedIdentity.role === 'SUPER_ADMIN') {
      return [
        'Platform overview across all colleges',
        'List onboarded colleges & admins',
        'Show recent security audit logs',
        'Check multi-tenant isolation status',
      ];
    }
    if (computedIdentity.role === 'STUDENT') {
      return [
        'How much fee do I owe right now?',
        'Show my transactions and fee summary',
        'Download my fee statement PDF',
        'What are the dues for my sector?',
      ];
    }
    if (computedIdentity.role === 'SECTOR_MANAGER') {
      return [
        'List students with pending fees in my sector',
        'Show summary of collections and balance',
        'Recent ledger entries and receipts',
        'Post batch fee for my class',
      ];
    }
    // Admin default
    return [
      'Download Class Report PDF',
      'Add student',
      'Unassigned sectors report',
      'Record ₹1500 credit deposit for Safwan K. in Office',
      'Post ₹500 Study Tour Fee batch for Fiqh 2',
    ];
  }, [computedIdentity.role]);

  const getPageId = useCallback(() => pathname, [pathname]);

  const getAvailableRoutes = useCallback((): AvailableRouteHint[] => {
    const role = computedIdentity.role;
    if (role === 'PUBLIC') {
      return [
        { route: '/login', label: 'Portal Login' },
        { route: '/super-admin/login', label: 'Super Admin Login' },
      ];
    }
    if (role === 'SUPER_ADMIN') {
      return [
        { route: '/super-admin', label: 'Super Admin Console' },
        { route: '/admin', label: 'College Admin Workspace' },
      ];
    }
    if (role === 'STUDENT') {
      return [
        { route: '/app', label: 'Student Portal' },
        { route: '/app/profile', label: 'Student Profile' },
        { route: '/app/notifications', label: 'Notifications' },
      ];
    }
    if (role === 'SECTOR_MANAGER') {
      const sector = activeManagerSector || firstSectorSlug || 'dept-fiqh';
      return [
        { route: `/m/${sector}`, label: 'Sector Overview' },
        { route: `/m/${sector}/ledger`, label: 'Sector Ledger' },
        { route: `/m/${sector}/bulk`, label: 'Bulk Entry' },
        { route: `/m/${sector}/batches`, label: 'Batches' },
        { route: `/m/${sector}/reports`, label: 'Reports' },
      ];
    }
    return [
      { route: '/admin', label: 'Admin Overview' },
      { route: '/admin/students', label: 'Students' },
      { route: '/admin/students/import', label: 'Student Import' },
      { route: '/admin/sectors', label: 'Sectors' },
      { route: '/admin/admins', label: 'Managers' },
      { route: '/admin/institution', label: 'Institution Profile' },
      { route: '/admin/issued-reports', label: 'Issued Reports' },
      { route: '/admin/audit', label: 'Audit Log' },
      { route: '/upgrade', label: 'Plan & Credits' },
    ];
  }, [activeManagerSector, computedIdentity.role, firstSectorSlug]);

  const getAppContext = useCallback(
    () => `role=${computedIdentity.role}; route=${pathname}`,
    [computedIdentity.role, pathname]
  );

  const widgetTheme = useMemo(
    () => ({
      primaryColor: '#f97316',
      accentColor: '#f97316',
      primaryTextColor: '#ffffff',
      position: 'right' as const,
    }),
    []
  );

  // Keep verification QR pages uncluttered for printing/auditing
  if (pathname.startsWith('/v/')) {
    return null;
  }

  return (
    <AssistantErrorBoundary>
      <AssistantWidget
        appId="khazna-ledger"
        appName="Khazna"
        apiUrl=""
        userKey={computedIdentity.userKey}
        userLabel={computedIdentity.userLabel}
        title="Khazna AI"
        currentPath={pathname}
        getPageId={getPageId}
        getAuthToken={getAuthToken}
        getAppState={getAppState}
        getAvailableRoutes={getAvailableRoutes}
        getAppContext={getAppContext}
        onAppCommand={onAppCommand}
        onExportDownloaded={(exportFile: ExportFilePayload) => {
          const st = useKhazna.getState();
          const roleVal =
            computedIdentity.role === 'ADMIN' || computedIdentity.role === 'SUPER_ADMIN'
              ? 'admin'
              : computedIdentity.role === 'SECTOR_MANAGER'
                ? 'manager'
                : 'student';
          st.log({
            actor: computedIdentity.userLabel,
            role: roleVal,
            action: 'EXPORT',
            target: exportFile.filename,
            sector: st.currentRole === 'manager' ? st.managerSector : undefined,
            details: `AI Export (${exportFile.format.toUpperCase()}): ${exportFile.title} — ${exportFile.summaryLine}`,
          });
          toast.success(`Downloaded ${exportFile.filename}`);
        }}
        suggestions={roleSuggestions.slice(0, 3)}
        theme={widgetTheme}
      />
    </AssistantErrorBoundary>
  );
}
