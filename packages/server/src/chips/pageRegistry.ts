import type { AccessScope } from '../security/scope.ts';

export interface LocalizedText {
  en: string;
  ml: string;
}

export interface ChipDef {
  id: string;
  label: LocalizedText;
  prompt: LocalizedText;
  icon?: string;
  role: 'PUBLIC' | 'SUPER_ADMIN' | 'ADMIN' | 'SECTOR_MANAGER' | 'STUDENT' | 'ALL';
  pageId: string;
  priority: number;
  dynamic?: boolean;
  evaluateDynamic?: (context: ChipEvaluationContext) => { label?: LocalizedText; prompt?: LocalizedText } | null;
}

export interface ChipEvaluationContext {
  scope: AccessScope;
  appState?: Record<string, unknown>;
  dueAmount?: number;
  unpaidCount?: number;
  unassignedSectorsCount?: number;
  studentCount?: number;
}

export interface RankedChip {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  priority: number;
}

// Map pathname to canonical pageId
export function resolvePageId(pathname: string): string {
  const p = pathname.toLowerCase().replace(/\/$/, '') || '/';

  if (
    p === 'public.login' ||
    p === 'auth.login' ||
    p.startsWith('/login') ||
    p.startsWith('/signup') ||
    p.startsWith('/register') ||
    p.startsWith('/auth') ||
    p === '/super-admin/login'
  ) {
    return 'auth.login';
  }

  // Super Admin platform routes
  if (p === 'super_admin.dashboard' || p.startsWith('/super-admin') || p.startsWith('/superadmin')) {
    return 'super_admin.dashboard';
  }

  // Admin routes
  if (p === '/admin' || p === '/admin/dashboard') return 'admin.dashboard';
  if (p.startsWith('/admin/students')) return 'admin.students';
  if (p.startsWith('/admin/sectors')) return 'admin.sectors';
  if (p.startsWith('/admin/ledger')) return 'admin.ledger';
  if (p.startsWith('/admin/reports') || p.startsWith('/admin/issued-reports')) return 'admin.reports';
  if (p.startsWith('/admin/batches')) return 'admin.batches';
  if (p.startsWith('/admin/audit')) return 'admin.audit';
  if (p.startsWith('/admin/admins')) return 'admin.admins';
  if (p.startsWith('/admin/settings') || p.startsWith('/admin/institution')) return 'admin.settings';

  // Sector Manager routes: /m/:sectorSlug/...
  if (p.startsWith('/m/')) {
    const parts = p.split('/').filter(Boolean); // e.g. ['m', 'dept-fiqh', 'ledger']
    const subRoute = parts[2] || '';
    if (subRoute === 'ledger' || subRoute === 'entries') return 'manager.entries';
    if (subRoute === 'students') return 'manager.students';
    if (subRoute === 'bulk' || subRoute === 'batches') return 'manager.batches';
    if (subRoute === 'reports') return 'manager.reports';
    return 'manager.dashboard';
  }
  if (p === '/m' || p === '/m/dashboard') return 'manager.dashboard';

  // Student routes: /app/...
  if (p === '/app' || p === '/app/dashboard') return 'student.dashboard';
  if (p.startsWith('/app/ledger') || p.startsWith('/app/s/')) return 'student.ledger';
  if (p.startsWith('/app/receipts')) return 'student.receipts';
  if (p.startsWith('/app/notifications')) return 'student.notifications';
  if (p.startsWith('/app/profile')) return 'student.profile';

  return 'global';
}

export const CHIP_REGISTRY: ChipDef[] = [
  // -------------------------------------------------------------
  // STUDENT: Dashboard
  // -------------------------------------------------------------
  {
    id: 'student.dashboard.my-balance',
    pageId: 'student.dashboard',
    role: 'STUDENT',
    priority: 100,
    icon: 'Wallet',
    label: {
      en: 'My Balance',
      ml: 'എന്റെ ബാക്കി തുക',
    },
    prompt: {
      en: 'What is my current fee balance and total dues?',
      ml: 'എന്റെ നിലവിലെ ഫീസ് ബാക്കിയും മൊത്തം അടയ്ക്കാനുള്ള തുകയും എത്രയാണ്?',
    },
  },
  {
    id: 'student.dashboard.recent-receipts',
    pageId: 'student.dashboard',
    role: 'STUDENT',
    priority: 90,
    icon: 'Receipt',
    label: {
      en: 'Recent Receipts',
      ml: 'സമീപകാല രസീതുകൾ',
    },
    prompt: {
      en: 'Show my last 5 payments and receipt numbers.',
      ml: 'എന്റെ കഴിഞ്ഞ 5 പേയ്‌മെന്റുകളും രസീത് നമ്പറുകളും കാണിക്കുക.',
    },
  },
  {
    id: 'student.dashboard.download-statement',
    pageId: 'student.dashboard',
    role: 'STUDENT',
    priority: 85,
    icon: 'FileDown',
    label: {
      en: 'Download Statement',
      ml: 'സ്റ്റേറ്റ്‌മെന്റ് ഡൗൺലോഡ്',
    },
    prompt: {
      en: 'Please generate and download my official student statement PDF.',
      ml: 'ദയവായി എന്റെ ഔദ്യോഗിക വിദ്യാർത്ഥി സ്റ്റേറ്റ്മെന്റ് PDF ജനറേറ്റ് ചെയ്ത് ഡൗൺലോഡ് ചെയ്യുക.',
    },
  },
  {
    id: 'student.dashboard.why-pending',
    pageId: 'student.dashboard',
    role: 'STUDENT',
    priority: 95,
    icon: 'HelpCircle',
    dynamic: true,
    evaluateDynamic: (ctx) => {
      const due = ctx.dueAmount ?? (Number((ctx.appState?.mySummary as Record<string, unknown>)?.balance || 0));
      if (due > 0) {
        return {
          label: {
            en: `Pay Due (₹${due})`,
            ml: `കുടിശ്ശിക അടയ്ക്കുക (₹${due})`,
          },
          prompt: {
            en: `Why do I have pending dues of ₹${due} and how do I pay them?`,
            ml: `എനിക്ക് ₹${due} കുടിശ്ശിക വരാൻ കാരണമെന്താണ്, അത് എങ്ങനെ അടയ്ക്കാം?`,
          },
        };
      }
      return null;
    },
    label: {
      en: 'Why Pending Fees?',
      ml: 'എന്തുകൊണ്ട് ഫീസ് കുടിശ്ശിക?',
    },
    prompt: {
      en: 'Why do I have pending fees and how can I clear them?',
      ml: 'എനിക്ക് ഫീസ് കുടിശ്ശിക വരാൻ കാരണമെന്താണ്, അത് എങ്ങനെ തീർക്കാം?',
    },
  },

  // -------------------------------------------------------------
  // STUDENT: Ledger
  // -------------------------------------------------------------
  {
    id: 'student.ledger.filter-sector',
    pageId: 'student.ledger',
    role: 'STUDENT',
    priority: 80,
    icon: 'Layers',
    label: {
      en: 'Sector Breakdown',
      ml: 'സെക്ടർ തിരിച്ചുള്ള തുക',
    },
    prompt: {
      en: 'Give me a breakdown of what I paid across each sector.',
      ml: 'ഓരോ സെക്ടറിലും ഞാൻ അടച്ച തുകയുടെ വിശദവിവരങ്ങൾ നൽകുക.',
    },
  },
  {
    id: 'student.ledger.explain-last-charge',
    pageId: 'student.ledger',
    role: 'STUDENT',
    priority: 75,
    icon: 'FileText',
    label: {
      en: 'Explain Last Charge',
      ml: 'അവസാന ചാർജ്ജ് വിശദീകരിക്കുക',
    },
    prompt: {
      en: 'Explain what my most recent debit charge was for.',
      ml: 'എന്റെ ഏറ്റവും പുതിയ ഡെബിറ്റ് ചാർജ് എന്തിനുവേണ്ടിയാണെന്ന് വിശദീകരിക്കുക.',
    },
  },

  // -------------------------------------------------------------
  // SECTOR MANAGER: Dashboard
  // -------------------------------------------------------------
  {
    id: 'manager.dashboard.sector-total',
    pageId: 'manager.dashboard',
    role: 'SECTOR_MANAGER',
    priority: 100,
    icon: 'BarChart2',
    label: {
      en: 'Sector Total',
      ml: 'സെക്ടർ ആകെ തുക',
    },
    prompt: {
      en: 'What is the total credit and balance collected for my sector?',
      ml: 'എന്റെ സെക്ടറിൽ ഇതുവരെ പിരിച്ചെടുത്ത മൊത്തം ക്രെഡിറ്റും ബാലൻസും എത്രയാണ്?',
    },
  },
  {
    id: 'manager.dashboard.unpaid-students',
    pageId: 'manager.dashboard',
    role: 'SECTOR_MANAGER',
    priority: 95,
    icon: 'Users',
    dynamic: true,
    evaluateDynamic: (ctx) => {
      const unpaid = ctx.unpaidCount ?? 0;
      if (unpaid > 0) {
        return {
          label: {
            en: `${unpaid} Unpaid Students`,
            ml: `${unpaid} ഫീസ് അടയ്ക്കാത്തവർ`,
          },
          prompt: {
            en: `List the ${unpaid} students in my sector who currently have unpaid fees.`,
            ml: `എന്റെ സെക്ടറിൽ ഫീസ് അടയ്ക്കാൻ ബാക്കിയുള്ള ${unpaid} വിദ്യാർത്ഥികളുടെ പട്ടിക നൽകുക.`,
          },
        };
      }
      return null;
    },
    label: {
      en: 'Unpaid Students',
      ml: 'ഫീസ് അടയ്ക്കാത്തവർ',
    },
    prompt: {
      en: 'Which students in my sector have unpaid fee balances?',
      ml: 'എന്റെ സെക്ടറിൽ ഫീസ് അടയ്ക്കാൻ ബാക്കിയുള്ള വിദ്യാർത്ഥികൾ ആരെല്ലാമാണ്?',
    },
  },
  {
    id: 'manager.dashboard.record-deposit',
    pageId: 'manager.dashboard',
    role: 'SECTOR_MANAGER',
    priority: 85,
    icon: 'PlusCircle',
    label: {
      en: 'Record Deposit',
      ml: 'തുക വരവ് വെക്കുക',
    },
    prompt: {
      en: 'Help me record a student fee deposit for my sector.',
      ml: 'എന്റെ സെക്ടറിലേക്ക് വിദ്യാർത്ഥി ഫീസ് ഡെപ്പോസിറ്റ് രേഖപ്പെടുത്താൻ സഹായിക്കുക.',
    },
  },
  {
    id: 'manager.dashboard.post-batch',
    pageId: 'manager.dashboard',
    role: 'SECTOR_MANAGER',
    priority: 80,
    icon: 'FolderPlus',
    label: {
      en: 'Post Batch Fee',
      ml: 'ബാച്ച് ഫീസ് പോസ്റ്റ് ചെയ്യുക',
    },
    prompt: {
      en: 'How do I post a uniform fee batch across all students in a class?',
      ml: 'ഒരു ക്ലാസിലെ എല്ലാ കുട്ടികൾക്കും ഒരുമിച്ച് ബാച്ച് ഫീസ് എങ്ങനെ പോസ്റ്റ് ചെയ്യാം?',
    },
  },

  // -------------------------------------------------------------
  // SECTOR MANAGER: Entries
  // -------------------------------------------------------------
  {
    id: 'manager.entries.recent-entries',
    pageId: 'manager.entries',
    role: 'SECTOR_MANAGER',
    priority: 90,
    icon: 'List',
    label: {
      en: 'Recent Entries',
      ml: 'സമീപകാല എൻട്രികൾ',
    },
    prompt: {
      en: 'Show the most recent 10 transactions recorded in my sector.',
      ml: 'എന്റെ സെക്ടറിൽ രേഖപ്പെടുത്തിയ സമീപകാല 10 ഇടപാടുകൾ കാണിക്കുക.',
    },
  },
  {
    id: 'manager.entries.void-help',
    pageId: 'manager.entries',
    role: 'SECTOR_MANAGER',
    priority: 70,
    icon: 'AlertTriangle',
    label: {
      en: 'Void an Entry',
      ml: 'എൻട്രി റദ്ദാക്കുക',
    },
    prompt: {
      en: 'How do I void an incorrect transaction in my sector?',
      ml: 'എന്റെ സെക്ടറിലെ തെറ്റായ ഇടപാട് എങ്ങനെ വോയ്ഡ് (റദ്ദാക്കാം) ചെയ്യാം?',
    },
  },

  // -------------------------------------------------------------
  // SUPER ADMIN: Dashboard
  // -------------------------------------------------------------
  {
    id: 'superadmin.dashboard.overview',
    pageId: 'super_admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 105,
    icon: 'Globe',
    label: { en: 'Platform Overview', ml: 'പ്ലാറ്റ്‌ഫോം അവലോകനം' },
    prompt: {
      en: 'Show global platform overview across all colleges, total volume, and registered students',
      ml: 'എല്ലാ കോളേജുകളുടെയും ആകെ സാമ്പത്തിക കണക്കുകൾ കാണിക്കുക',
    },
  },
  {
    id: 'superadmin.dashboard.organizations',
    pageId: 'super_admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 95,
    icon: 'Building',
    label: { en: 'Colleges & Admins', ml: 'കോളേജുകളുടെ വിവരങ്ങൾ' },
    prompt: {
      en: 'List all onboarded colleges, their active admins, and status',
      ml: 'എല്ലാ കോളേജുകളുടെയും അഡ്മിൻമാരുടെയും വിവരങ്ങൾ കാണിക്കുക',
    },
  },
  {
    id: 'superadmin.dashboard.audit-logs',
    pageId: 'super_admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 90,
    icon: 'Shield',
    label: { en: 'Security Audit Logs', ml: 'സെക്യൂരിറ്റി ഓഡിറ്റ് ലോഗുകൾ' },
    prompt: {
      en: 'Show recent platform security audit logs and administrative actions',
      ml: 'ഏറ്റവും പുതിയ പ്ലാറ്റ്‌ഫോം ഓഡിറ്റ് ലോഗുകൾ പരിശോധിക്കുക',
    },
  },
  {
    id: 'admin.dashboard.institution-overview',
    pageId: 'admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 100,
    icon: 'Globe',
    label: {
      en: 'Campus Overview',
      ml: 'ക്യാമ്പസ് അവലോകനം',
    },
    prompt: {
      en: 'Give me the complete campus-wide financial summary and sector totals.',
      ml: 'ക്യാമ്പസിലെ സമഗ്ര സാമ്പത്തിക സംഗ്രഹവും സെക്ടർ തിരിച്ചുള്ള തുകയും നൽകുക.',
    },
  },
  {
    id: 'admin.dashboard.download-report',
    pageId: 'admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 90,
    icon: 'Download',
    label: {
      en: 'Download Campus PDF',
      ml: 'ക്യാമ്പസ് PDF ഡൗൺലോഡ്',
    },
    prompt: {
      en: 'Generate and download the complete Class-wise PDF report for all sectors.',
      ml: 'എല്ലാ സെക്ടറുകളുടെയും സമഗ്ര ക്ലാസ് തിരിച്ചുള്ള PDF റിപ്പോർട്ട് ഡൗൺലോഡ് ചെയ്യുക.',
    },
  },
  {
    id: 'admin.dashboard.unassigned-sectors',
    pageId: 'admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 85,
    icon: 'UserX',
    dynamic: true,
    evaluateDynamic: (ctx) => {
      const count = ctx.unassignedSectorsCount ?? 0;
      if (count > 0) {
        return {
          label: {
            en: `${count} Sectors Without Manager`,
            ml: `മാനേജരില്ലാത്ത ${count} സെക്ടറുകൾ`,
          },
          prompt: {
            en: `Which ${count} sectors currently have no sector manager assigned?`,
            ml: `നിലവിൽ സെക്ടർ മാനേജർ ഇല്ലാത്ത ${count} സെക്ടറുകൾ ഏതെല്ലാമാണ്?`,
          },
        };
      }
      return null;
    },
    label: {
      en: 'Unassigned Sectors',
      ml: 'മാനേജരില്ലാത്ത സെക്ടറുകൾ',
    },
    prompt: {
      en: 'Which sectors currently have no manager assigned?',
      ml: 'നിലവിൽ മാനേജർ ഇല്ലാത്ത സെക്ടറുകൾ ഏതെല്ലാമാണ്?',
    },
  },
  {
    id: 'admin.dashboard.add-student',
    pageId: 'admin.dashboard',
    role: 'SUPER_ADMIN',
    priority: 80,
    icon: 'UserPlus',
    label: {
      en: 'Add Student',
      ml: 'വിദ്യാർത്ഥിയെ ചേർക്കുക',
    },
    prompt: {
      en: 'I want to add a new student to the campus.',
      ml: 'ക്യാമ്പസിലേക്ക് പുതിയൊരു വിദ്യാർത്ഥിയെ ചേർക്കാൻ ഞാൻ ആഗ്രഹിക്കുന്നു.',
    },
  },

  // -------------------------------------------------------------
  // SUPER ADMIN: Students Page
  // -------------------------------------------------------------
  {
    id: 'admin.students.bulk-import',
    pageId: 'admin.students',
    role: 'SUPER_ADMIN',
    priority: 95,
    icon: 'Upload',
    label: {
      en: 'Bulk Import Excel',
      ml: 'ബൾക്ക് ഇമ്പോർട്ട് എക്സൽ',
    },
    prompt: {
      en: 'How do I bulk import students from an Excel spreadsheet?',
      ml: 'എക്സൽ സ്പ്രെഡ്ഷീറ്റിൽ നിന്ന് വിദ്യാർത്ഥികളെ എങ്ങനെ ബൾക്ക് ഇമ്പോർട്ട് ചെയ്യാം?',
    },
  },
  {
    id: 'admin.students.defaulters',
    pageId: 'admin.students',
    role: 'SUPER_ADMIN',
    priority: 90,
    icon: 'AlertCircle',
    label: {
      en: 'Top Fee Defaulters',
      ml: 'കൂടുതൽ കുടിശ്ശികയുള്ളവർ',
    },
    prompt: {
      en: 'Show the top students with highest pending fee balances across campus.',
      ml: 'ക്യാമ്പസിൽ ഏറ്റവും കൂടുതൽ ഫീസ് കുടിശ്ശികയുള്ള വിദ്യാർത്ഥികളെ കാണിക്കുക.',
    },
  },

  // -------------------------------------------------------------
  // GLOBAL (Available on any page when role matches)
  // -------------------------------------------------------------
  {
    id: 'global.help-shortcuts',
    pageId: 'global',
    role: 'ALL',
    priority: 50,
    icon: 'HelpCircle',
    label: {
      en: 'What can you do?',
      ml: 'എന്തെല്ലാം ചെയ്യാൻ കഴിയും?',
    },
    prompt: {
      en: 'What actions and reports can you help me with in my current account?',
      ml: 'എന്റെ അക്കൗണ്ടിൽ എന്തെല്ലാം കാര്യങ്ങളും റിപ്പോർട്ടുകളുമാണ് താങ്കൾക്ക് ചെയ്തു നൽകാൻ കഴിയുക?',
    },
  },
  {
    id: 'global.guide-tour',
    pageId: 'global',
    role: 'ALL',
    priority: 40,
    icon: 'Compass',
    label: {
      en: 'Guide Me / Walkthrough',
      ml: 'സഹായ മാർഗ്ഗനിർദ്ദേശം',
    },
    prompt: {
      en: 'Guide me around the screen and show me what I can do here step by step.',
      ml: 'ഈ പേജിൽ എന്തെല്ലാം ചെയ്യാം എന്ന് ഓരോ ഘട്ടമായി എനിക്ക് കാണിച്ചു തരിക.',
    },
  },
  // -------------------------------------------------------------
  // GUIDE CHIPS (Interactive On-Screen Walkthroughs)
  // -------------------------------------------------------------
  {
    id: 'guide.import-students',
    pageId: 'admin.students',
    role: 'ADMIN',
    priority: 95,
    icon: 'Compass',
    label: {
      en: 'Guide: Import Students',
      ml: 'ഗൈഡ്: ഇമ്പോർട്ട് ചെയ്യുക',
    },
    prompt: {
      en: 'Guide me to import students step by step',
      ml: 'വിദ്യാർത്ഥികളെ ഇമ്പോർട്ട് ചെയ്യാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'guide.add-student',
    pageId: 'admin.students',
    role: 'ADMIN',
    priority: 85,
    icon: 'Compass',
    label: {
      en: 'Guide: Add Student',
      ml: 'ഗൈഡ്: പുതിയ വിദ്യാർത്ഥി',
    },
    prompt: {
      en: 'Guide me to add an individual student',
      ml: 'പുതിയ വിദ്യാർത്ഥിയെ ചേർക്കാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'guide.create-sector',
    pageId: 'admin.sectors',
    role: 'ADMIN',
    priority: 95,
    icon: 'Compass',
    label: {
      en: 'Guide: Create Sector',
      ml: 'ഗൈഡ്: സെക്ടർ ഉണ്ടാക്കുക',
    },
    prompt: {
      en: 'Guide me to create a new sector',
      ml: 'പുതിയ സെക്ടർ ഉണ്ടാക്കാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'guide.record-deposit',
    pageId: 'manager.entries',
    role: 'SECTOR_MANAGER',
    priority: 95,
    icon: 'Compass',
    label: {
      en: 'Guide: Record Deposit',
      ml: 'ഗൈഡ്: ഫീസ് ഡെപ്പോസിറ്റ്',
    },
    prompt: {
      en: 'Guide me to record a fee deposit',
      ml: 'ഫീസ് ഡെപ്പോസിറ്റ് രേഖപ്പെടുത്താൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'guide.check-fees',
    pageId: 'student.dashboard',
    role: 'STUDENT',
    priority: 95,
    icon: 'Compass',
    label: {
      en: 'Guide: Check My Fees',
      ml: 'ഗൈഡ്: ഫീസ് പരിശോധിക്കുക',
    },
    prompt: {
      en: 'Guide me to see my fees and dues',
      ml: 'എന്റെ ഫീസ് കുടിശ്ശിക കാണാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'guide.login',
    pageId: 'auth.login',
    role: 'PUBLIC',
    priority: 95,
    icon: 'Compass',
    label: {
      en: 'Guide: How to Log In',
      ml: 'ഗൈഡ്: ലോഗിൻ ചെയ്യുക',
    },
    prompt: {
      en: 'Guide me to log in step by step',
      ml: 'ലോഗിൻ ചെയ്യാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'public.login.register-college',
    pageId: 'auth.login',
    role: 'PUBLIC',
    priority: 90,
    icon: 'Building',
    label: {
      en: 'Create College Account',
      ml: 'കോളേജ് അക്കൗണ്ട് തുടങ്ങുക',
    },
    prompt: {
      en: 'Guide me to register a new college account on Khazna',
      ml: 'പുതിയ കോളേജ് അക്കൗണ്ട് രജിസ്റ്റർ ചെയ്യാൻ എന്നെ സഹായിക്കുക',
    },
  },
  {
    id: 'public.login.forgot-password',
    pageId: 'auth.login',
    role: 'PUBLIC',
    priority: 85,
    icon: 'KeyRound',
    label: {
      en: 'Password Help',
      ml: 'പാസ്‌വേഡ് സഹായം',
    },
    prompt: {
      en: 'How do I reset my Khazna account password?',
      ml: 'എന്റെ പാസ്‌വേഡ് എങ്ങനെ റീസെറ്റ് ചെയ്യാം?',
    },
  },
  {
    id: 'public.login.assistant-features',
    pageId: 'auth.login',
    role: 'PUBLIC',
    priority: 88,
    icon: 'Sparkles',
    label: {
      en: 'AI Assistant Features',
      ml: 'AI അസിസ്റ്റന്റ് ഫീച്ചറുകൾ',
    },
    prompt: {
      en: 'What can this AI assistant do and what are its features?',
      ml: 'ഈ AI അസിസ്റ്റന്റിന് എന്തെല്ലാം ചെയ്യാൻ കഴിയും, പ്രധാന ഫീച്ചറുകൾ എന്തൊക്കെയാണ്?',
    },
  },
];

export function getRankedChips(params: {
  scope: AccessScope;
  pageId: string;
  lang?: 'en' | 'ml';
  chipUsageMap?: Map<string, { shownCount: number; clickCount: number; lastClickedAt?: string }>;
  context?: ChipEvaluationContext;
  limit?: number;
}): RankedChip[] {
  const { scope, pageId, lang = 'en', chipUsageMap = new Map(), context = { scope }, limit = 4 } = params;

  // 1. Filter chips by role & pageId
  const eligible = CHIP_REGISTRY.filter((chip) => {
    // Strict PUBLIC isolation: zero PII, only PUBLIC or global ALL chips
    if (scope.role === 'PUBLIC') {
      if (chip.role !== 'PUBLIC' && chip.role !== 'ALL') return false;
      return chip.pageId === 'auth.login' || chip.pageId === 'global';
    }

    // Role check
    if (chip.role !== 'ALL') {
      if (chip.role === 'PUBLIC') return false;
      if (chip.id.startsWith('superadmin.') && scope.role !== 'SUPER_ADMIN') return false;
      if (chip.pageId.startsWith('super_admin.') && scope.role !== 'SUPER_ADMIN') return false;
      if (scope.role === 'SUPER_ADMIN') {
        if (chip.role !== 'SUPER_ADMIN' && chip.role !== 'ADMIN') return false;
      } else if (scope.role === 'ADMIN') {
        if (chip.role !== 'ADMIN' && chip.role !== 'SUPER_ADMIN') return false;
      } else if (scope.role === 'SECTOR_MANAGER') {
        if (chip.role !== 'SECTOR_MANAGER') return false;
      } else if (scope.role === 'STUDENT') {
        if (chip.role !== 'STUDENT') return false;
      }
    }
    // Page check: match pageId or global
    if (chip.pageId === pageId || chip.pageId === 'global') return true;
    if (chip.id === 'admin.dashboard.unassigned-sectors' && (pageId === 'admin.sectors' || pageId === 'admin.dashboard')) return true;
    if (scope.role === 'SECTOR_MANAGER' && (pageId === 'manager.entries' || pageId === 'manager.dashboard') && (chip.pageId === 'manager.dashboard' || chip.pageId === 'manager.entries')) return true;
    if (scope.role === 'SUPER_ADMIN' && (pageId === 'super_admin.dashboard' || pageId === 'admin.dashboard') && (chip.pageId === 'super_admin.dashboard' || chip.pageId === 'admin.dashboard')) return true;
    if (scope.role === 'ADMIN' && pageId.startsWith('admin.') && chip.pageId === 'admin.dashboard') return true;
    return false;
  });

  // 2. Score and rank chips
  const scored = eligible.map((chip) => {
    let label = chip.label[lang] || chip.label.en;
    let prompt = chip.prompt[lang] || chip.prompt.en;

    // Evaluate dynamic rules
    if (chip.dynamic && chip.evaluateDynamic) {
      const dyn = chip.evaluateDynamic(context);
      if (dyn) {
        if (dyn.label) label = dyn.label[lang] || dyn.label.en;
        if (dyn.prompt) prompt = dyn.prompt[lang] || dyn.prompt.en;
      }
    }

    const usage = chipUsageMap.get(chip.id);
    const shown = usage?.shownCount || 0;
    const clicked = usage?.clickCount || 0;

    let score = chip.priority;
    // frequency bonus
    score += clicked * 2;

    // fatigue penalty: shown >= 5 and never clicked
    if (shown >= 5 && clicked === 0) {
      score -= 3;
    }

    // recency bonus: clicked within last 24h
    if (usage?.lastClickedAt) {
      const ageHours = (Date.now() - new Date(usage.lastClickedAt).getTime()) / (1000 * 60 * 60);
      if (ageHours < 24) {
        score += 3;
      }
    }

    return {
      id: chip.id,
      label,
      prompt,
      icon: chip.icon,
      priority: score,
    };
  });

  scored.sort((a, b) => b.priority - a.priority);
  return scored.slice(0, limit);
}
