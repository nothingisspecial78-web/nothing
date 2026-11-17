import type { GuideDef } from './types.ts';

export const AUTHORED_GUIDES: GuideDef[] = [
  // ---------------------------------------------------------------------------
  // 1. PUBLIC GUIDES
  // ---------------------------------------------------------------------------
  {
    guideId: 'public.login',
    title: {
      en: 'Log in to your account',
      ml: 'നിങ്ങളുടെ അക്കൗണ്ടിലേക്ക് ലോഗിൻ ചെയ്യുക',
    },
    summary: {
      en: 'Walks through choosing your role, entering your email or admission number, and securely typing your password.',
      ml: 'നിങ്ങളുടെ റോൾ തിരഞ്ഞെടുത്ത് ഇമെയിലും പാസ്‌വേഡും നൽകി ലോഗിൻ ചെയ്യുക.',
    },
    keywords: [
      'login',
      'log in',
      'sign in',
      'signin',
      'enter app',
      'open account',
      'enikku login cheyyanam',
      'login cheyyan',
      'log in engane',
      'ലോഗിൻ',
    ],
    roles: 'public',
    startRoute: '/login',
    steps: [
      {
        stepId: 'choose-tab',
        route: '/login',
        target: {
          guideId: 'auth-tab-signin',
          fallbacks: ['button:contains("Sign in")'],
        },
        instruction: {
          en: "First, make sure the 'Sign in' tab is selected.",
          ml: "ആദ്യം 'Sign in' ടാബ് തിരഞ്ഞെടുത്തിട്ടുണ്ടെന്ന് ഉറപ്പുവരുത്തുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'select-role',
        route: '/login',
        target: {
          guideId: 'login-role-admin',
          fallbacks: ['button:contains("Admin")', 'login-role-manager', 'login-role-student'],
        },
        instruction: {
          en: 'Choose your role: Admin, Sector Manager, or Student.',
          ml: 'നിങ്ങളുടെ റോൾ തിരഞ്ഞെടുക്കുക: അഡ്മിൻ, സെക്ടർ മാനേജർ, അല്ലെങ്കിൽ വിദ്യാർത്ഥി.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'enter-username',
        route: '/login',
        target: {
          guideId: 'login-email',
          fallbacks: ['login-student-admission', 'input[type=email]', 'input[placeholder*="you@college.edu"]'],
        },
        instruction: {
          en: 'Enter your registered college email or student admission number here.',
          ml: 'ഇവിടെ നിങ്ങളുടെ കോളേജ് ഇമെയിൽ അല്ലെങ്കിൽ അഡ്മിഷൻ നമ്പർ നൽകുക.',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 3 },
        hint: {
          en: 'Type your email (e.g. admin@islahululoom.edu) or student ID (e.g. S0125).',
          ml: 'നിങ്ങളുടെ ഇമെയിൽ അല്ലെങ്കിൽ അഡ്മിഷൻ നമ്പർ ടൈപ്പ് ചെയ്യുക.',
        },
      },
      {
        stepId: 'enter-password',
        route: '/login',
        target: {
          guideId: 'login-password',
          fallbacks: ['input[type=password]', 'input[autocomplete="current-password"]'],
        },
        instruction: {
          en: "Now enter your password. I will close my eyes while you type for your privacy.",
          ml: 'ഇപ്പോൾ നിങ്ങളുടെ പാസ്‌വേഡ് ടൈപ്പ് ചെയ്യുക. നിങ്ങളുടെ സ്വകാര്യതയ്ക്കായി ഞാൻ കണ്ണുകൾ അടയ്ക്കും.',
        },
        voice: {
          en: "Now enter your password. I won't peek while you type.",
          ml: 'ഇപ്പോൾ നിങ്ങളുടെ പാസ്‌വേഡ് ടൈപ്പ് ചെയ്യുക. നിങ്ങളുടെ സ്വകാര്യതയ്ക്കായി ഞാൻ നോക്കില്ല.',
        },
        action: 'type',
        sensitive: true,
        completeWhen: { type: 'valueFilled', minLength: 4 },
        hint: {
          en: 'Enter your password (at least 6 characters).',
          ml: 'നിങ്ങളുടെ പാസ്‌വേഡ് നൽകുക.',
        },
      },
      {
        stepId: 'click-submit',
        route: '/login',
        target: {
          guideId: 'login-submit',
          fallbacks: ['button[type=submit]', 'button:contains("Sign in")'],
        },
        instruction: {
          en: 'Click the Sign in button to enter your portal.',
          ml: 'പോർട്ടലിൽ പ്രവേശിക്കാൻ Sign in ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: "You're in! Welcome to Khazna Campus Ledger.",
        ml: 'സ്വാഗതം! നിങ്ങൾ വിജയകരമായി ലോഗിൻ ചെയ്തു.',
      },
      followUpChips: ['Overview of today', 'Show my fees', 'Pending collections'],
    },
  },

  {
    guideId: 'public.register',
    title: {
      en: 'Register your college on Khazna',
      ml: 'നിങ്ങളുടെ കോളേജ് ഖസ്നയിൽ രജിസ്റ്റർ ചെയ്യുക',
    },
    summary: {
      en: 'Field-by-field guidance to register your institution and set up your initial Administrator account.',
      ml: 'നിങ്ങളുടെ സ്ഥാപനം രജിസ്റ്റർ ചെയ്ത് ആദ്യ അഡ്മിൻ അക്കൗണ്ട് ക്രമീകരിക്കുക.',
    },
    keywords: [
      'register',
      'signup',
      'create college',
      'new college',
      'new institution',
      'register my college',
      'pudhiya college',
      'college thudanganam',
      'രജിസ്റ്റർ',
    ],
    roles: 'public',
    startRoute: '/login',
    steps: [
      {
        stepId: 'switch-to-signup',
        route: '/login',
        target: {
          guideId: 'auth-tab-signup',
          fallbacks: ['button:contains("Create college")'],
        },
        instruction: {
          en: "Click the 'Create college' tab to begin registration.",
          ml: "രജിസ്ട്രേഷൻ ആരംഭിക്കാൻ 'Create college' ടാബിൽ ക്ലിക്ക് ചെയ്യുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'fill-college-name',
        route: '/login',
        target: {
          guideId: 'signup-college',
          fallbacks: ['input[placeholder*="Al Noor"]'],
        },
        instruction: {
          en: 'Enter the official name of your college or campus.',
          ml: 'നിങ്ങളുടെ കോളേജിന്റെ ഔദ്യോഗിക പേര് നൽകുക.',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 3 },
      },
      {
        stepId: 'fill-admin-name',
        route: '/login',
        target: {
          guideId: 'signup-name',
          fallbacks: ['input[placeholder*="Principal"]'],
        },
        instruction: {
          en: 'Enter the full name of the Administrator or Principal.',
          ml: 'അഡ്മിനിസ്ട്രേറ്ററുടെ അല്ലെങ്കിൽ പ്രിൻസിപ്പലിന്റെ പൂർണ്ണനാമം നൽകുക.',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 3 },
      },
      {
        stepId: 'fill-email',
        route: '/login',
        target: {
          guideId: 'signup-email',
          fallbacks: ['input[type=email]'],
        },
        instruction: {
          en: 'Enter the administrative contact email.',
          ml: 'അഡ്മിൻ ഇമെയിൽ വിലാസം നൽകുക.',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 5 },
      },
      {
        stepId: 'fill-password',
        route: '/login',
        target: {
          guideId: 'signup-password',
          fallbacks: ['input[placeholder*="8+ characters"]'],
        },
        instruction: {
          en: 'Choose a strong password (8+ characters). I will look away while you type.',
          ml: 'ശക്തമായ പാസ്‌വേഡ് തിരഞ്ഞെടുക്കുക. നിങ്ങൾ ടൈപ്പ് ചെയ്യുമ്പോൾ ഞാൻ നോക്കില്ല.',
        },
        action: 'type',
        sensitive: true,
        completeWhen: { type: 'valueFilled', minLength: 6 },
      },
      {
        stepId: 'submit-signup',
        route: '/login',
        target: {
          guideId: 'signup-submit',
          fallbacks: ['button[type=submit]'],
        },
        instruction: {
          en: 'Click Create College & Admin to complete setup.',
          ml: 'സെറ്റപ്പ് പൂർത്തിയാക്കാൻ Create College & Admin ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'College registered! You can now configure sectors and import students.',
        ml: 'കോളേജ് രജിസ്റ്റർ ചെയ്തു! ഇനി സെക്ടറുകൾ ക്രമീകരിക്കാം.',
      },
      followUpChips: ['Guide me: import students', 'Guide me: create a sector'],
    },
  },

  {
    guideId: 'public.forgot_password',
    title: {
      en: 'Reset or recover password',
      ml: 'പാസ്‌വേഡ് റീസെറ്റ് ചെയ്യുക',
    },
    summary: {
      en: 'Information on resetting your password or requesting access from your college admin.',
      ml: 'പാസ്‌വേഡ് റീസെറ്റ് ചെയ്യുന്നതിനുള്ള വിവരങ്ങൾ.',
    },
    keywords: ['forgot password', 'reset password', 'lost password', 'recover account', 'password marannu'],
    roles: 'public',
    startRoute: '/login',
    steps: [
      {
        stepId: 'info-step',
        route: '/login',
        target: {
          guideId: 'auth-tab-signin',
        },
        instruction: {
          en: "If you are a student or manager, contact your College Admin to reset your credentials. Admins can sign in using their registered email.",
          ml: 'വിദ്യാർത്ഥികളോ മാനേജർമാരോ കോളേജ് അഡ്മിനെ ബന്ധപ്പെടുക. അഡ്മിന്മാർക്ക് രജിസ്റ്റർ ചെയ്ത ഇമെയിൽ വഴി ലോഗിൻ ചെയ്യാം.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: 'For instant support, ask your campus office or IT desk.',
        ml: 'സഹായത്തിനായി കോളേജ് ഓഫീസ് അല്ലെങ്കിൽ ഐടി ഡെസ്കുമായി ബന്ധപ്പെടുക.',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 2. STUDENT GUIDES
  // ---------------------------------------------------------------------------
  {
    guideId: 'student.view_fees',
    title: {
      en: 'Check my fee dues & balances',
      ml: 'ഫീസ് കുടിശ്ശിക പരിശോധിക്കുക',
    },
    summary: {
      en: 'Walks through your personal fee breakdown, sector balances, and payment status.',
      ml: 'നിങ്ങളുടെ ഫീസ് വിശദാംശങ്ങളും ഓരോ സെക്ടറിലെയും കുടിശ്ശികയും പരിശോധിക്കുക.',
    },
    keywords: [
      'my fees',
      'fee dues',
      'check balance',
      'how much do i owe',
      'pending fees',
      'student fee',
      'enikku enthoram fee und',
      'fee ethraya',
      'ഫീസ്',
    ],
    roles: ['STUDENT'],
    startRoute: '/app',
    steps: [
      {
        stepId: 'nav-overview',
        route: '/app',
        target: {
          guideId: 'nav-student-overview',
          fallbacks: ['a[href="/app"]'],
        },
        instruction: {
          en: "Click Overview in the sidebar to open your student dashboard.",
          ml: 'നിങ്ങളുടെ വിദ്യാർത്ഥി ഡാഷ്‌ബോർഡ് തുറക്കാൻ Overview ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'view-total-dues',
        route: '/app',
        target: {
          guideId: 'student-dues-card',
          fallbacks: ['div:contains("Total Outstanding")', 'div.glass-strong:first'],
        },
        instruction: {
          en: 'Here is your total outstanding fee amount across all college sectors.',
          ml: 'ഇവിടെ എല്ലാ സെക്ടറുകളിലെയും നിങ്ങളുടെ ആകെ ഫീസ് കുടിശ്ശിക കാണാം.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
      {
        stepId: 'view-sector-breakdown',
        route: '/app',
        target: {
          guideId: 'student-sectors-list',
          fallbacks: ['div:contains("Sector Breakdown")', 'div.grid'],
        },
        instruction: {
          en: 'Review the breakdown per sector to see which specific funds have pending dues.',
          ml: 'ഏതൊക്കെ സെക്ടറുകളിലാണ് കുടിശ്ശികയുള്ളതെന്ന് ഇവിടെ പരിശോധിക്കാം.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: 'Now you know where to track your fees anytime.',
        ml: 'നിങ്ങളുടെ ഫീസ് കുടിശ്ശിക ഇനി എപ്പോൾ വേണമെങ്കിലും ഇവിടെ പരിശോധിക്കാം.',
      },
      followUpChips: ['Show my recent payments', 'Download statement'],
    },
  },

  {
    guideId: 'student.profile',
    title: {
      en: 'View my student profile',
      ml: 'വിദ്യാർത്ഥി പ്രൊഫൈൽ കാണുക',
    },
    summary: {
      en: 'Walks to your student profile showing admission number, class, and guardian info.',
      ml: 'അഡ്മിഷൻ നമ്പർ, ക്ലാസ്, രക്ഷിതാവിന്റെ വിവരം എന്നിവ കാണാൻ പ്രൊഫൈൽ പേജിലേക്ക് പോകുക.',
    },
    keywords: ['profile', 'my details', 'admission number', 'class', 'guardian', 'ente profile'],
    roles: ['STUDENT'],
    startRoute: '/app',
    steps: [
      {
        stepId: 'click-profile-nav',
        route: '/app',
        target: {
          guideId: 'nav-student-profile',
          fallbacks: ['a[href="/app/profile"]'],
        },
        instruction: {
          en: 'Click Profile in the navigation menu.',
          ml: 'മെനുവിൽ നിന്ന് Profile ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'inspect-details',
        route: '/app/profile',
        target: {
          guideId: 'student-profile-card',
          fallbacks: ['div.glass-strong'],
        },
        instruction: {
          en: 'Review your admission number, batch, class, and contact details.',
          ml: 'നിങ്ങളുടെ അഡ്മിഷൻ നമ്പർ, ക്ലാസ്, ബന്ധപ്പെടാനുള്ള വിവരങ്ങൾ എന്നിവ പരിശോധിക്കുക.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: 'Profile verified. If any information needs updating, reach out to your office admin.',
        ml: 'വിവരങ്ങളിൽ മാറ്റമുണ്ടെങ്കിൽ കോളേജ് ഓഫീസുമായി ബന്ധപ്പെടുക.',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 3. SECTOR MANAGER GUIDES
  // ---------------------------------------------------------------------------
  {
    guideId: 'manager.ledger_entry',
    title: {
      en: 'View and filter sector ledger',
      ml: 'സെക്ടർ ലെഡ്ജർ പരിശോധിക്കുക',
    },
    summary: {
      en: 'Walkthrough of your sector financial transactions, balance, and search options.',
      ml: 'സെക്ടറിലെ സാമ്പത്തിക ഇടപാടുകളും ബാലൻസും പരിശോധിക്കുക.',
    },
    keywords: [
      'ledger',
      'sector ledger',
      'view entries',
      'transactions',
      'receipts',
      'ledger engane kaanam',
      'ഇടപാടുകൾ',
    ],
    roles: ['SECTOR_MANAGER'],
    startRoute: '/m/dept-fiqh/ledger',
    steps: [
      {
        stepId: 'nav-ledger',
        target: {
          guideId: 'nav-manager-ledger',
          fallbacks: ['a[href$="/ledger"]'],
        },
        instruction: {
          en: 'Click Ledger in the sector menu.',
          ml: 'സെക്ടർ മെനുവിൽ നിന്ന് Ledger ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'search-ledger',
        target: {
          guideId: 'ledger-search-input',
          fallbacks: ['input[placeholder*="Search"]', 'input[type=search]'],
        },
        instruction: {
          en: 'Use this search field to filter transactions by receipt number, student name, or date.',
          ml: 'റസീപ്റ്റ് നമ്പർ അല്ലെങ്കിൽ വിദ്യാർത്ഥിയുടെ പേര് നൽകി തിരയാൻ ഈ ഫീൽഡ് ഉപയോഗിക്കുക.',
        },
        action: 'type',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: 'You can now monitor every incoming fee and outgoing expenditure in your sector.',
        ml: 'സെക്ടറിലെ എല്ലാ വരുമാനവും ചെലവും ഇനി എളുപ്പത്തിൽ നിരീക്ഷിക്കാം.',
      },
      followUpChips: ['Guide me: record deposit', 'Guide me: class reports'],
    },
  },

  {
    guideId: 'manager.add_deposit',
    title: {
      en: 'Record a fee collection deposit',
      ml: 'ഫീസ് ഡെപ്പോസിറ്റ് രേഖപ്പെടുത്തുക',
    },
    summary: {
      en: 'Step-by-step guidance to open the entry dialog, choose a student, enter amount, and save.',
      ml: 'വിദ്യാർത്ഥിയുടെ ഫീസ് അടവ് പുതിയ എൻട്രി വഴി രേഖപ്പെടുത്തുക.',
    },
    keywords: [
      'add deposit',
      'record deposit',
      'record payment',
      'collect fee',
      'new entry',
      'fee add cheyyan',
      'deposit engane',
      'ഡെപ്പോസിറ്റ്',
    ],
    roles: ['SECTOR_MANAGER'],
    startRoute: '/m/dept-fiqh/ledger',
    steps: [
      {
        stepId: 'click-new-entry',
        target: {
          guideId: 'ledger-new-entry-button',
          fallbacks: ['button:contains("New entry")', 'quick-action-button'],
        },
        instruction: {
          en: "Click the 'New entry' button at the top right.",
          ml: "മുകളിലെ 'New entry' ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'enter-amount',
        target: {
          guideId: 'dialog-entry-amount',
          fallbacks: ['input[name=amount]', 'input[placeholder="0"]'],
        },
        instruction: {
          en: 'Enter the fee amount in rupees (e.g. 500).',
          ml: 'ഫീസ് തുക രൂപയിൽ നൽകുക (ഉദാ: 500).',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 1 },
      },
      {
        stepId: 'select-student',
        target: {
          guideId: 'dialog-entry-student',
          fallbacks: ['select[name=studentId]', 'input[placeholder*="Select student"]'],
        },
        instruction: {
          en: 'Choose the student who made the payment.',
          ml: 'ഫീസ് അടച്ച വിദ്യാർത്ഥിയെ തിരഞ്ഞെടുക്കുക.',
        },
        action: 'select',
        completeWhen: { type: 'manual' },
      },
      {
        stepId: 'submit-entry',
        target: {
          guideId: 'dialog-entry-submit',
          fallbacks: ['button:contains("Save entry")', 'button[type=submit]'],
        },
        instruction: {
          en: 'Click Save Entry to record the transaction with an immutable receipt number.',
          ml: 'ഇടപാട് രേഖപ്പെടുത്താൻ Save Entry ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Fee deposit successfully recorded with receipt generation.',
        ml: 'ഫീസ് വിജയകരമായി രേഖപ്പെടുത്തി റസീപ്റ്റ് നൽകി.',
      },
      followUpChips: ['Show recent transactions', 'Sector balance'],
    },
  },

  {
    guideId: 'manager.bulk_entry',
    title: {
      en: 'Post bulk class fees',
      ml: 'ക്ലാസ് ബൾക്ക് ഫീസ് രേഖപ്പെടുത്തുക',
    },
    summary: {
      en: 'How to charge or credit an entire class of students at once.',
      ml: 'ഒരു ക്ലാസിലെ മുഴുവൻ വിദ്യാർത്ഥികൾക്കും ഒരേസമയം ഫീസ് രേഖപ്പെടുത്തുക.',
    },
    keywords: [
      'bulk entry',
      'class fee',
      'all students',
      'charge class',
      'bulk fee',
      'ella studentkum fee',
      'ബൾക്ക് ഫീസ്',
    ],
    roles: ['SECTOR_MANAGER'],
    startRoute: '/m/dept-fiqh/bulk',
    steps: [
      {
        stepId: 'nav-bulk',
        target: {
          guideId: 'nav-manager-bulk',
          fallbacks: ['a[href$="/bulk"]'],
        },
        instruction: {
          en: 'Click Bulk Entry in the sector navigation menu.',
          ml: 'സെക്ടർ മെനുവിൽ നിന്ന് Bulk Entry ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Bulk class entry is ready to post.',
        ml: 'ക്ലാസ് ബൾക്ക് എൻട്രി തയ്യാറാണ്.',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 4. ADMIN GUIDES
  // ---------------------------------------------------------------------------
  {
    guideId: 'admin.students.import',
    title: {
      en: 'Bulk import students from Excel or CSV',
      ml: 'എക്സൽ വഴി വിദ്യാർത്ഥികളെ ചേർക്കുക',
    },
    summary: {
      en: '4-step walkthrough: download template, upload spreadsheet, map columns, and validate rows before saving.',
      ml: 'ടെംപ്ലേറ്റ് ഡൗൺലോഡ് ചെയ്ത് എക്സൽ വഴി എല്ലാ വിദ്യാർത്ഥികളെയും ഒറ്റയടിക്ക് ചേർക്കുക.',
    },
    keywords: [
      'import students',
      'upload excel',
      'csv import',
      'bulk student import',
      'add many students',
      'spreadsheet import',
      'student ne upload cheyyan',
      'excel import engane',
      'വിദ്യാർത്ഥി ഇമ്പോർട്ട്',
      'വിദ്യാർത്ഥികളെ ഇമ്പോർട്ട്',
      'ഇമ്പോർട്ട്',
      'import',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/students/import',
    steps: [
      {
        stepId: 'nav-import',
        route: '/admin/students/import',
        target: {
          guideId: 'nav-students-import',
          fallbacks: ['a[href="/admin/students/import"]'],
        },
        instruction: {
          en: "First, navigate to Bulk Import under the People section.",
          ml: "ആദ്യം People മെനുവിലെ Bulk Import ക്ലിക്ക് ചെയ്യുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'download-template',
        route: '/admin/students/import',
        target: {
          guideId: 'import-download-template',
          fallbacks: ['button:contains("Download template")'],
        },
        instruction: {
          en: 'You can download the sample template here to see the recommended column headers.',
          ml: 'ശരിയായ കോളങ്ങൾ മനസ്സിലാക്കാൻ ഇവിടെ നിന്ന് മാതൃകാ ടെംപ്ലേറ്റ് ഡൗൺലോഡ് ചെയ്യാം.',
        },
        action: 'click',
        optional: true,
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'upload-file',
        route: '/admin/students/import',
        target: {
          guideId: 'import-dropzone',
          fallbacks: ['div:contains("Drop your CSV here")', 'import-sample-file'],
        },
        instruction: {
          en: 'Click here or drag-and-drop your Excel/CSV file with student details.',
          ml: 'വിദ്യാർത്ഥികളുടെ വിവരങ്ങളടങ്ങിയ ഫയൽ ഇവിടെ ഡ്രാഗ് ചെയ്യുകയോ ക്ലിക്ക് ചെയ്ത് അപ്‌ലോഡ് ചെയ്യുകയോ ചെയ്യുക.',
        },
        action: 'upload',
        completeWhen: { type: 'fileSelected' },
        hint: {
          en: "Or click 'try the sample file' to test with instant sample data.",
          ml: "അല്ലെങ്കിൽ മാതൃകാ ഡാറ്റ വെച്ച് പരീക്ഷിക്കാൻ 'try the sample file' ക്ലിക്ക് ചെയ്യുക.",
        },
      },
      {
        stepId: 'continue-to-mapping',
        route: '/admin/students/import',
        target: {
          guideId: 'import-continue-step1',
          fallbacks: ['button:contains("Continue")'],
        },
        instruction: {
          en: 'Click Continue to proceed to column mapping.',
          ml: 'കോളങ്ങൾ പൊരുത്തപ്പെടുത്താൻ Continue ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'validate-columns',
        route: '/admin/students/import',
        target: {
          guideId: 'import-continue-step2',
          fallbacks: ['button:contains("Validate rows")'],
        },
        instruction: {
          en: 'Ensure Admission Number, Full Name, and Class are mapped, then click Validate rows.',
          ml: 'അഡ്മിഷൻ നമ്പർ, പേര്, ക്ലാസ് എന്നിവ ശരിയായി പൊരുത്തപ്പെടുത്തി Validate rows ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'confirm-import',
        route: '/admin/students/import',
        target: {
          guideId: 'import-confirm-button',
          fallbacks: ['button:contains("Import")', 'button:contains("valid students")'],
        },
        instruction: {
          en: 'Review the validation summary and click Import to save students into your college database.',
          ml: 'പരിശോധന പൂർത്തിയാക്കി വിദ്യാർത്ഥികളെ ചേർക്കാൻ Import ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Students imported! They can now log in using their admission number.',
        ml: 'വിദ്യാർത്ഥികളെ ചേർത്തു കഴിഞ്ഞു! ഇനി അവർക്ക് ലോഗിൻ ചെയ്യാം.',
      },
      followUpChips: ['View student directory', 'Guide me: create a sector'],
    },
  },

  {
    guideId: 'admin.students.add',
    title: {
      en: 'Add an individual student',
      ml: 'പുതിയ വിദ്യാർത്ഥിയെ ചേർക്കുക',
    },
    summary: {
      en: 'Opens the Student drawer to register a new student with auto-assigned admission number.',
      ml: 'അഡ്മിഷൻ നമ്പർ നൽകി പുതിയ വിദ്യാർത്ഥിയെ ചേർക്കുക.',
    },
    keywords: [
      'add student',
      'new student',
      'create student',
      'register student',
      'oru student ne add cheyyan',
      'വിദ്യാർത്ഥി',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/students',
    steps: [
      {
        stepId: 'nav-students',
        route: '/admin/students',
        target: {
          guideId: 'nav-students',
          fallbacks: ['a[href="/admin/students"]'],
        },
        instruction: {
          en: 'Go to Student Directory from the navigation menu.',
          ml: 'മെനുവിൽ നിന്ന് Student Directory തുറക്കുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'click-add-student',
        route: '/admin/students',
        target: {
          guideId: 'students-add-button',
          fallbacks: ['button:contains("Add Student")', 'button:contains("New student")'],
        },
        instruction: {
          en: "Click the 'Add Student' button at the top right.",
          ml: "മുകളിലെ 'Add Student' ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Fill in the student details and save to create their campus ledger.',
        ml: 'വിദ്യാർത്ഥിയുടെ വിവരങ്ങൾ നൽകി സേവ് ചെയ്യുക.',
      },
    },
  },

  {
    guideId: 'admin.students.view',
    title: {
      en: "View a student's details and ledger statement",
      ml: 'വിദ്യാർത്ഥിയുടെ വിവരങ്ങളും സ്റ്റേറ്റ്‌മെന്റും കാണുക',
    },
    summary: {
      en: 'Opens Student Directory, searches by name or admission number, and inspects full balance & sector breakdown.',
      ml: 'വിദ്യാർത്ഥിയുടെ പേരോ അഡ്മിഷൻ നമ്പറോ തിരഞ്ഞ് പൂർണ്ണ വിവരങ്ങൾ കാണുക.',
    },
    keywords: [
      'see student details',
      'view student details',
      'student details',
      'student profile',
      'inspect student',
      'find student',
      'how do i see a student',
      'വിദ്യാർത്ഥിയുടെ വിവരങ്ങൾ',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/students',
    steps: [
      {
        stepId: 'nav-students-view',
        route: '/admin/students',
        target: {
          guideId: 'nav-students',
          fallbacks: ['a[href="/admin/students"]'],
        },
        instruction: {
          en: 'Open Student Directory from the People section in the navigation menu.',
          ml: 'മെനുവിൽ നിന്ന് Student Directory തുറക്കുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'search-student-view',
        route: '/admin/students',
        target: {
          guideId: 'students-search-input',
          fallbacks: ['input[placeholder*="Search"]'],
        },
        instruction: {
          en: 'Search by student name, Admission Number (e.g. S0125), or phone number.',
          ml: 'പേര്, അഡ്മിഷൻ നമ്പർ, അല്ലെങ്കിൽ ഫോൺ നമ്പർ നൽകി തിരയുക.',
        },
        action: 'type',
        completeWhen: { type: 'valueFilled', minLength: 1 },
      },
      {
        stepId: 'click-student-row',
        route: '/admin/students',
        target: {
          guideId: 'students-directory-table',
          fallbacks: ['table tbody tr', 'div.divide-y'],
        },
        instruction: {
          en: "Click any student row to open their full details drawer, sector balances, recent entries, and PDF statement download.",
          ml: 'പൂർണ്ണ വിവരങ്ങളും റസീപ്റ്റുകളും കാണാൻ വിദ്യാർത്ഥിയുടെ പേരിൽ ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: "You can inspect any student's sector balances, edit their profile, or download their statement PDF right from the drawer.",
        ml: 'വിദ്യാർത്ഥിയുടെ വിവരങ്ങൾ പരിശോധിക്കാനും സ്റ്റേറ്റ്‌മെന്റ് ഡൗൺലോഡ് ചെയ്യാനും ഇപ്പോൾ കഴിയും.',
      },
      followUpChips: ['Search student S0125', 'Guide me: add a student'],
    },
  },

  {
    guideId: 'admin.sectors.create',
    title: {
      en: 'Create a new sector or department fund',
      ml: 'പുതിയ സെക്ടർ അല്ലെങ്കിൽ ഫണ്ട് ഉണ്ടാക്കുക',
    },
    summary: {
      en: 'How to add a college sector, define receipt prefix, set fee targets, and assign budget colors.',
      ml: 'കോളേജിൽ പുതിയ സെക്ടർ ഉണ്ടാക്കി റസീപ്റ്റ് പ്രിഫിക്സും ബഡ്ജറ്റും നിശ്ചയിക്കുക.',
    },
    keywords: [
      'create sector',
      'new sector',
      'add fund',
      'department',
      'create fund',
      'pudhiya sector',
      'സെക്ടർ ഉണ്ടാക്കുക',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/sectors',
    steps: [
      {
        stepId: 'nav-sectors',
        route: '/admin/sectors',
        target: {
          guideId: 'nav-sectors',
          fallbacks: ['a[href="/admin/sectors"]'],
        },
        instruction: {
          en: 'Click Sectors & Classes in the structure menu.',
          ml: 'മെനുവിൽ നിന്ന് Sectors & Classes ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
      {
        stepId: 'click-create-sector',
        route: '/admin/sectors',
        target: {
          guideId: 'sectors-create-button',
          fallbacks: ['button:contains("New Sector")', 'button:contains("Create Sector")'],
        },
        instruction: {
          en: "Click 'New Sector' to define a new department or union wing.",
          ml: "പുതിയ സെക്ടർ തുടങ്ങാൻ 'New Sector' ബട്ടൺ ക്ലിക്ക് ചെയ്യുക.",
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Sector created! You can now assign a manager to look after its collections.',
        ml: 'സെക്ടർ തയ്യാറായി! ഇനി മാനേജറെ ചുമതലപ്പെടുത്താം.',
      },
      followUpChips: ['Guide me: assign sector manager', 'Show sectors list'],
    },
  },

  {
    guideId: 'admin.managers.assign',
    title: {
      en: 'Add or assign a sector manager',
      ml: 'സെക്ടർ മാനേജറെ ചുമതലപ്പെടുത്തുക',
    },
    summary: {
      en: 'Manage sector administrators and configure who has access to which departmental ledgers.',
      ml: 'സെക്ടർ മാനേജർമാരെ ചേർക്കുകയോ മാറ്റുകയോ ചെയ്യുക.',
    },
    keywords: [
      'assign manager',
      'add manager',
      'sector manager',
      'manager email',
      'manager ne add cheyyan',
      'മാനേജർ',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/admins',
    steps: [
      {
        stepId: 'nav-admins',
        route: '/admin/admins',
        target: {
          guideId: 'nav-admins',
          fallbacks: ['a[href="/admin/admins"]'],
        },
        instruction: {
          en: 'Click Admins & Managers in the sidebar.',
          ml: 'മെനുവിലെ Admins & Managers ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Managers assigned will only have access to their designated sector ledgers.',
        ml: 'മാനേജർമാർക്ക് അവരുടെ സെക്ടറിലെ ഇടപാടുകൾ മാത്രമേ കാണാൻ സാധിക്കൂ.',
      },
    },
  },

  {
    guideId: 'admin.reports.issued',
    title: {
      en: 'View and download audit reports',
      ml: 'ഓഡിറ്റ് റിപ്പോർട്ടുകൾ പരിശോധിക്കുക',
    },
    summary: {
      en: 'How to view issued financial statements and download PDF & Excel summaries.',
      ml: 'കോളേജ് സാമ്പത്തിക റിപ്പോർട്ടുകളും സ്റ്റേറ്റ്‌മെന്റുകളും ഡൗൺലോഡ് ചെയ്യുക.',
    },
    keywords: [
      'reports',
      'download pdf',
      'audit reports',
      'issued reports',
      'financial statement',
      'report edukkan',
      'റിപ്പോർട്ടുകൾ',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/issued-reports',
    steps: [
      {
        stepId: 'nav-reports',
        route: '/admin/issued-reports',
        target: {
          guideId: 'nav-reports',
          fallbacks: ['a[href="/admin/issued-reports"]'],
        },
        instruction: {
          en: 'Click Issued Reports in the overview menu.',
          ml: 'മെനുവിൽ നിന്ന് Issued Reports ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'All college audit records are ready for review and printing.',
        ml: 'എല്ലാ റിപ്പോർട്ടുകളും പരിശോധിക്കാൻ തയ്യാറാണ്.',
      },
    },
  },

  {
    guideId: 'admin.institution',
    title: {
      en: 'Update institution profile and receipt settings',
      ml: 'കോളേജ് വിവരങ്ങൾ ക്രമീകരിക്കുക',
    },
    summary: {
      en: 'Edit college name, address, phone, and receipt signatory details.',
      ml: 'കോളേജിന്റെ പേര്, വിലാസം, റസീപ്റ്റ് വിവരങ്ങൾ എന്നിവ മാറ്റുക.',
    },
    keywords: [
      'institution profile',
      'college settings',
      'receipt signatory',
      'college name',
      'settings',
      'settings മാറ്റാൻ',
    ],
    roles: ['ADMIN'],
    startRoute: '/admin/institution',
    steps: [
      {
        stepId: 'nav-institution',
        route: '/admin/institution',
        target: {
          guideId: 'nav-institution',
          fallbacks: ['a[href="/admin/institution"]'],
        },
        instruction: {
          en: 'Click Institution Profile under Structure in the navigation menu.',
          ml: 'മെനുവിലെ Institution Profile ക്ലിക്ക് ചെയ്യുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'College information updated across all future receipts and reports.',
        ml: 'കോളേജ് വിവരങ്ങൾ വിജയകരമായി സേവ് ചെയ്തു.',
      },
    },
  },

  // ---------------------------------------------------------------------------
  // 5. SUPER ADMIN GUIDES
  // ---------------------------------------------------------------------------
  {
    guideId: 'superadmin.overview',
    title: {
      en: 'Platform Overview & Multi-Tenant Analytics',
      ml: 'പ്ലാറ്റ്ഫോം മൾട്ടി-ടെനന്റ് അനലിറ്റിക്സ്',
    },
    summary: {
      en: 'View all campus organizations, student enrollments, and global system health.',
      ml: 'എല്ലാ കാമ്പസുകളുടെയും വിവരങ്ങളും ഇടപാടുകളും ഒരുമിച്ച് കാണുക.',
    },
    keywords: [
      'super admin',
      'platform overview',
      'all organizations',
      'all colleges',
      'tenants',
      'multi tenant',
      'എല്ലാ കോളേജുകളും',
    ],
    roles: ['SUPER_ADMIN'],
    startRoute: '/super-admin',
    steps: [
      {
        stepId: 'super-admin-view',
        route: '/super-admin',
        target: {
          guideId: 'super-admin-orgs-table',
          fallbacks: ['div:contains("Platform Tenant Organizations")', 'table'],
        },
        instruction: {
          en: 'Review all registered institutions, active student counts, and transaction totals across the platform.',
          ml: 'രജിസ്റ്റർ ചെയ്ത എല്ലാ സ്ഥാപനങ്ങളും അവയുടെ വിവരങ്ങളും ഇവിടെ പരിശോധിക്കാം.',
        },
        action: 'read',
        completeWhen: { type: 'manual' },
      },
    ],
    completion: {
      message: {
        en: 'Platform analytics loaded across all campus tenants.',
        ml: 'പ്ലാറ്റ്ഫോം അനലിറ്റിക്സ് ലഭ്യമാക്കി.',
      },
    },
  },
  {
    guideId: 'public.demo',
    title: {
      en: 'Open Demo Mode',
      ml: 'ഡെമോ മോഡ് തുറക്കുക',
    },
    summary: {
      en: 'Launch the sample Khazna demo college as Admin, Sector Manager, or Student with one click.',
      ml: 'അഡ്മിൻ, സെക്ടർ മാനേജർ, അല്ലെങ്കിൽ വിദ്യാർത്ഥി ആയി ഡെമോ മോഡ് തുറക്കുക.',
    },
    keywords: [
      'demo',
      'domo',
      'demo mode',
      'domo model',
      'open demo',
      'try demo',
      'sample college',
      'preview',
    ],
    roles: 'public',
    startRoute: '/login',
    steps: [
      {
        stepId: 'pick-demo-role',
        route: '/login',
        target: {
          guideId: 'login-demo-admin-btn',
          fallbacks: ['login-demo-manager-btn', 'login-demo-student-btn'],
        },
        instruction: {
          en: 'Choose Admin, Sector Manager, or Student under Try the demo to open the sample college.',
          ml: 'ഡെമോ തുറക്കാൻ Try the demo-യ്ക്ക് കീഴിൽ അഡ്മിൻ, മാനേജർ, അല്ലെങ്കിൽ വിദ്യാർത്ഥി തിരഞ്ഞെടുക്കുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Demo workspace opened with sample Khazna data.',
        ml: 'ഡെമോ മോഡ് വിജയകരമായി തുറന്നു.',
      },
    },
  },
  {
    guideId: 'auth.logout',
    title: {
      en: 'Sign Out of Current Session',
      ml: 'നിലവിലെ സെഷനിൽ നിന്ന് ലോഗ് ഔട്ട് ചെയ്യുക',
    },
    summary: {
      en: 'Sign out safely and return to the Khazna portal login screen.',
      ml: 'സുരക്ഷിതമായി ലോഗ് ഔട്ട് ചെയ്ത് ലോഗിൻ പേജിലേക്ക് മടങ്ങുക.',
    },
    keywords: [
      'logout',
      'log out',
      'signout',
      'sign out',
      'end session',
      'log out this section',
      'ലോഗ് ഔട്ട്',
    ],
    roles: ['ADMIN', 'SECTOR_MANAGER', 'STUDENT', 'SUPER_ADMIN'],
    startRoute: '/app',
    steps: [
      {
        stepId: 'click-signout',
        route: '/app',
        target: {
          guideId: 'header-signout-link',
          fallbacks: ['user-menu-btn'],
        },
        instruction: {
          en: 'Use Sign out in the top bar (or open your profile menu) to log out of your current session.',
          ml: 'ലോഗ് ഔട്ട് ചെയ്യാൻ മുകളിലുള്ള Sign out അല്ലെങ്കിൽ പ്രൊഫൈൽ മെനു ഉപയോഗിക്കുക.',
        },
        action: 'click',
        completeWhen: { type: 'click' },
      },
    ],
    completion: {
      message: {
        en: 'Signed out and returned to the login page.',
        ml: 'വിജയകരമായി ലോഗ് ഔട്ട് ചെയ്തു.',
      },
    },
  },
];

export const ALL_GUIDES = AUTHORED_GUIDES;

