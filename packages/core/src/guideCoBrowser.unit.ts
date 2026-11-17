import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_GUIDE_ACTIONS,
  GUIDE_SYSTEM_PROMPT,
  MAX_GUIDE_STEPS,
  buildDeterministicGuideStep,
  detectAmbiguousGuidePaths,
  estimateApproxTokens,
  estimateRequiredGuideSteps,
  matchClarificationReply,
  resolveGuideTroubleshootingStep,
  sanitizeGuideStepDecision,
  shouldTriggerGuideMode,
  truncateTipWords,
} from './guideCoBrowser.ts';
import type { PageMapElement } from './schemas.ts';

describe('Guide Co-Browser Pure Logic', () => {
  it('keeps the OpenRouter system prompt strictly under 250 tokens', () => {
    const tokens = estimateApproxTokens(GUIDE_SYSTEM_PROMPT);
    assert.ok(tokens > 20 && tokens < 250, `Expected <250 tokens, got ${tokens}`);
  });

  it('whitelists strictly navigate, point_and_wait, click_safe, and complete actions', () => {
    assert.deepEqual([...ALLOWED_GUIDE_ACTIONS], [
      'navigate',
      'point_and_wait',
      'click_safe',
      'complete',
    ]);
    assert.equal(MAX_GUIDE_STEPS, 10);

    const pageMap: PageMapElement[] = [
      {
        id: 'add-student-btn',
        tag: 'button',
        type: 'button',
        label: 'Add student',
        hasValue: false,
        currentRoute: '/admin/students',
      },
    ];

    const coerced = sanitizeGuideStepDecision(
      { action: 'execute_arbitrary_js', targetId: 'add-student-btn', tip: 'Click add student' },
      pageMap,
      1
    );
    assert.equal(coerced.action, 'point_and_wait');
    assert.equal(coerced.targetId, 'add-student-btn');
  });

  it('blocks AI from auto-clicking data-sensitive="true" buttons or input controls', () => {
    const pageMap: PageMapElement[] = [
      {
        id: 'student-drawer-submit-btn',
        tag: 'button',
        type: 'submit',
        label: 'Create student',
        hasValue: false,
        currentRoute: '/admin/students',
        sensitive: true,
      },
      {
        id: 'student-drawer-name-input',
        tag: 'input',
        type: 'text',
        label: 'Full name',
        hasValue: false,
        currentRoute: '/admin/students',
      },
    ];

    const blockedSensitive = sanitizeGuideStepDecision(
      { action: 'click_safe', targetId: 'student-drawer-submit-btn', tip: 'Submit now' },
      pageMap,
      3
    );
    assert.equal(blockedSensitive.action, 'point_and_wait');
    assert.equal(blockedSensitive.targetId, 'student-drawer-submit-btn');
    assert.equal(blockedSensitive.sensitiveBlocked, true);

    const blockedInput = sanitizeGuideStepDecision(
      { action: 'click_safe', targetId: 'student-drawer-name-input', tip: 'Fill name' },
      pageMap,
      2
    );
    assert.equal(blockedInput.action, 'point_and_wait');
    assert.equal(blockedInput.targetId, 'student-drawer-name-input');
  });

  it('enforces the hard 10-step limit per guide session', () => {
    const pageMap: PageMapElement[] = [
      {
        id: 'some-btn',
        tag: 'button',
        type: 'button',
        label: 'Next',
        hasValue: false,
        currentRoute: '/admin',
      },
    ];

    const overLimit = sanitizeGuideStepDecision(
      { action: 'click_safe', targetId: 'some-btn', tip: 'Keep clicking' },
      pageMap,
      11
    );
    assert.equal(overLimit.action, 'complete');
    assert.ok(overLimit.tip.toLowerCase().includes('10-step'));
  });

  it('caps instruction tips to at most 12 words', () => {
    const longTip =
      'Please carefully read every single instruction and then click on the primary blue button right away now';
    const capped = truncateTipWords(longTip, 12);
    const wordCount = capped.split(/\s+/).filter(Boolean).length;
    assert.ok(wordCount <= 12, `Expected <=12 words, got ${wordCount}: "${capped}"`);
  });

  it('routes "how do I..." / "show me where..." to Guide Me and leaves direct data edits in chat', () => {
    assert.equal(shouldTriggerGuideMode('how do I add a new student?'), true);
    assert.equal(shouldTriggerGuideMode('show me where bulk entry is'), true);
    assert.equal(shouldTriggerGuideMode('guide me to import students'), true);
    assert.equal(shouldTriggerGuideMode('update user table'), false);
    assert.equal(shouldTriggerGuideMode('add student Amina to Class 5 with admission S0999'), false);
  });

  it('prioritizes unfilled modal/drawer inputs ahead of sensitive submit buttons and avoids completing on Step 1', () => {
    const drawerPageMap: PageMapElement[] = [
      {
        id: 'student-drawer-submit-btn',
        tag: 'button',
        type: 'submit',
        label: 'Save student',
        hasValue: false,
        currentRoute: '/admin/students',
        sensitive: true,
      },
      {
        id: 'student-drawer-name-input',
        tag: 'input',
        type: 'text',
        label: 'Full name',
        hasValue: false,
        currentRoute: '/admin/students',
      },
    ];

    const nextStep = buildDeterministicGuideStep({
      goal: 'how do I add a student?',
      previousStepSummary: 'Clicked "students-add-btn"',
      pageMap: drawerPageMap,
      stepNumber: 2,
      currentRoute: '/admin/students',
    });
    assert.equal(nextStep.action, 'point_and_wait');
    assert.equal(nextStep.targetId, 'student-drawer-name-input');

    const stepOneGeneric = buildDeterministicGuideStep({
      goal: 'Guide me on this page',
      previousStepSummary: '',
      pageMap: [
        {
          id: 'students-add-btn',
          tag: 'button',
          type: 'button',
          label: 'Add student',
          hasValue: false,
          currentRoute: '/admin/students',
        },
      ],
      stepNumber: 1,
      currentRoute: '/admin/students',
    });
    assert.notEqual(stepOneGeneric.action, 'complete');
    assert.equal(stepOneGeneric.targetId, 'students-add-btn');
  });

  it('dynamically disambiguates arbitrary multi-method DOM controls without domain hardcoding', () => {
    const saasPageMap: PageMapElement[] = [
      { id: 'auth-method-sso', tag: 'button', type: 'button', label: 'Enterprise SSO', hasValue: false, currentRoute: '/signin' },
      { id: 'auth-method-email', tag: 'button', type: 'button', label: 'Email & Password', hasValue: false, currentRoute: '/signin' },
      { id: 'auth-method-passkey', tag: 'button', type: 'button', label: 'Passkey', hasValue: false, currentRoute: '/signin' },
      { id: 'signin-email-input', tag: 'input', type: 'email', label: 'Work Email', hasValue: false, currentRoute: '/signin' },
    ];

    const broad = detectAmbiguousGuidePaths({
      goal: 'guide me how to sign in',
      pageMap: saasPageMap,
      currentRoute: '/signin',
      availableRoutes: [{ route: '/partner-signin', label: 'Partner Portal Sign In' }],
    });

    assert.ok(broad && broad.action === 'clarify');
    assert.ok((broad.options?.length || 0) >= 3);
    assert.deepEqual(
      broad.options?.map((o) => o.label),
      ['Enterprise SSO', 'Email & Password', 'Passkey', 'Partner Portal Sign In']
    );

    // When the user already specified SSO, bypass clarify immediately
    const specific = detectAmbiguousGuidePaths({
      goal: 'how do I sign in with Enterprise SSO?',
      pageMap: saasPageMap,
      currentRoute: '/signin',
      availableRoutes: [{ route: '/partner-signin', label: 'Partner Portal Sign In' }],
    });
    assert.equal(specific, null);

    // Export format disambiguation on an unrelated analytics app
    const exportMap: PageMapElement[] = [
      { id: 'export-pdf-btn', tag: 'button', type: 'button', label: 'PDF Report', hasValue: false, currentRoute: '/analytics' },
      { id: 'export-csv-btn', tag: 'button', type: 'button', label: 'CSV Spreadsheet', hasValue: false, currentRoute: '/analytics' },
      { id: 'export-xlsx-btn', tag: 'button', type: 'button', label: 'Excel Workbook', hasValue: false, currentRoute: '/analytics' },
    ];
    const exportClarify = detectAmbiguousGuidePaths({
      goal: 'show me how to export my analytics report',
      pageMap: exportMap,
      currentRoute: '/analytics',
    });
    assert.ok(exportClarify && exportClarify.action === 'clarify');
    assert.equal(exportClarify.options?.length, 3);

    const exportSpecific = detectAmbiguousGuidePaths({
      goal: 'how do I export CSV?',
      pageMap: exportMap,
      currentRoute: '/analytics',
    });
    assert.equal(exportSpecific, null);
  });

  it('skips disambiguation when confirmedPath is true or stepNumber > 1 and sanitizes clarify outputs safely', () => {
    const pageMap: PageMapElement[] = [
      { id: 'pay-method-card', tag: 'button', type: 'button', label: 'Credit Card', hasValue: false, currentRoute: '/checkout' },
      { id: 'pay-method-ach', tag: 'button', type: 'button', label: 'Bank ACH', hasValue: false, currentRoute: '/checkout' },
    ];

    assert.equal(
      detectAmbiguousGuidePaths({
        goal: 'how do I pay?',
        pageMap,
        currentRoute: '/checkout',
        confirmedPath: true,
        stepNumber: 1,
      }),
      null
    );

    assert.equal(
      detectAmbiguousGuidePaths({
        goal: 'how do I pay?',
        pageMap,
        currentRoute: '/checkout',
        confirmedPath: false,
        stepNumber: 2,
      }),
      null
    );

    // sanitizeGuideStepDecision blocks clarify when allowClarify=false or stepNumber=2
    const blockedStep2 = sanitizeGuideStepDecision(
      {
        action: 'clarify',
        question: 'Which?',
        options: [
          { id: 'a', label: 'Credit Card', refinedGoal: 'Pay via Credit Card', targetId: 'pay-method-card' },
          { id: 'b', label: 'Bank ACH', refinedGoal: 'Pay via Bank ACH', targetId: 'pay-method-ach' },
        ],
      },
      pageMap,
      2,
      { allowClarify: true }
    );
    assert.notEqual(blockedStep2.action, 'clarify');

    // Strips hallucinated targetIds and unverified routes when sanitizing clarify
    const sanitizedClarify = sanitizeGuideStepDecision(
      {
        action: 'clarify',
        question: 'Choose payment method',
        options: [
          { id: 'c1', label: 'Credit Card', refinedGoal: 'Pay via card', targetId: 'pay-method-card', route: '/checkout' },
          { id: 'c2', label: 'Bank ACH', refinedGoal: 'Pay via ACH', targetId: 'hallucinated-id', route: 'https://evil.com' },
        ],
      },
      pageMap,
      1,
      { allowClarify: true, availableRoutes: [{ route: '/checkout', label: 'Checkout' }] }
    );
    assert.equal(sanitizedClarify.action, 'clarify');
    assert.equal(sanitizedClarify.options?.[0]?.targetId, 'pay-method-card');
    assert.equal(sanitizedClarify.options?.[0]?.route, '/checkout');
    assert.equal(sanitizedClarify.options?.[1]?.targetId, undefined);
    assert.equal(sanitizedClarify.options?.[1]?.route, undefined);
  });

  it('matches typed chat replies cleanly including ordinals and collapsed words', () => {
    const options = [
      { id: 'opt-1', label: 'Workspace Admin', refinedGoal: 'Sign in as Workspace Admin' },
      { id: 'opt-2', label: 'Team Member', refinedGoal: 'Sign in as Team Member' },
      { id: 'opt-3', label: 'Super Admin', refinedGoal: 'Sign in as Super Admin' },
    ];
    assert.equal(matchClarificationReply('2', options)?.id, 'opt-2');
    assert.equal(matchClarificationReply('second', options)?.id, 'opt-2');
    assert.equal(matchClarificationReply('2nd', options)?.id, 'opt-2');
    assert.equal(matchClarificationReply('last', options)?.id, 'opt-3');
    assert.equal(matchClarificationReply('superadmin', options)?.id, 'opt-3');
    assert.equal(matchClarificationReply('I need workspace admin', options)?.id, 'opt-1');
    assert.equal(matchClarificationReply('update user table', options), null);
  });

  it('triggers guide mode for broad "guide <section>" / "help me <task>" prompts and discovers multi-task page sections cleanly', () => {
    assert.equal(shouldTriggerGuideMode('guide login'), true);
    assert.equal(shouldTriggerGuideMode('guide students'), true);
    assert.equal(shouldTriggerGuideMode('help me login'), true);

    const studentsPageMap: PageMapElement[] = [
      { id: 'nav-students-link', tag: 'a', type: 'link', label: 'Students', hasValue: false, currentRoute: '/admin/students' },
      { id: 'students-add-btn', tag: 'button', type: 'button', label: 'Add student', hasValue: false, currentRoute: '/admin/students' },
      { id: 'students-export-btn', tag: 'button', type: 'button', label: 'Export CSV', hasValue: false, currentRoute: '/admin/students' },
      { id: 'students-next-btn', tag: 'button', type: 'button', label: 'Next', hasValue: false, currentRoute: '/admin/students' },
      { id: 'students-prev-btn', tag: 'button', type: 'button', label: 'Previous', hasValue: false, currentRoute: '/admin/students' },
      { id: 'student-edit-S0125', tag: 'button', type: 'button', label: 'Edit', hasValue: false, currentRoute: '/admin/students' },
      { id: 'student-edit-S0126', tag: 'button', type: 'button', label: 'Edit', hasValue: false, currentRoute: '/admin/students' },
      { id: 'student-delete-S0125', tag: 'button', type: 'button', label: 'Delete', hasValue: false, currentRoute: '/admin/students', sensitive: true },
      { id: 'student-delete-S0126', tag: 'button', type: 'button', label: 'Delete', hasValue: false, currentRoute: '/admin/students', sensitive: true },
    ];

    const clarifyStudents = detectAmbiguousGuidePaths({
      goal: 'guide students',
      pageMap: studentsPageMap,
      currentRoute: '/admin/students',
      availableRoutes: [
        { route: '/admin/students', label: 'Students' },
        { route: '/admin/students/import', label: 'Student Import' },
      ],
    });
    assert.ok(clarifyStudents && clarifyStudents.action === 'clarify');
    const labels = clarifyStudents.options?.map((o) => o.label) || [];
    assert.ok(labels.includes('Add student'));
    assert.ok(labels.includes('Export CSV'));
    assert.ok(labels.includes('Student Import'));
    assert.equal(labels.includes('Next'), false);
    assert.equal(labels.includes('Previous'), false);
    // Repeated table row controls collapsed to a single representative action per verb
    assert.equal(labels.filter((l) => l === 'Edit student').length, 1);

    // Ensure /login clarifies Admin / Sector Manager / Student instead of auth-tab (Sign in vs Create college)
    const realLoginPageMap: PageMapElement[] = [
      { id: 'auth-tab-signin', tag: 'button', type: 'button', label: 'Sign in', hasValue: false, currentRoute: '/login' },
      { id: 'auth-tab-signup', tag: 'button', type: 'button', label: 'Create college', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-admin', tag: 'button', type: 'button', label: 'Admin', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-manager', tag: 'button', type: 'button', label: 'Sector Manager', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-student', tag: 'button', type: 'button', label: 'Student', hasValue: false, currentRoute: '/login' },
    ];
    const loginClarify = detectAmbiguousGuidePaths({
      goal: 'guide login',
      pageMap: realLoginPageMap,
      currentRoute: '/login',
      availableRoutes: [
        { route: '/login', label: 'Portal Login' },
        { route: '/super-admin/login', label: 'Super Admin Login' },
      ],
    });
    assert.ok(loginClarify && loginClarify.action === 'clarify');
    assert.deepEqual(
      loginClarify.options?.map((o) => o.label),
      ['Admin', 'Sector Manager', 'Student', 'Super Admin Login']
    );

    // Specific goal on the same page should bypass clarify immediately
    const specificAdd = detectAmbiguousGuidePaths({
      goal: 'how do I add a student?',
      pageMap: studentsPageMap,
      currentRoute: '/admin/students',
      availableRoutes: [
        { route: '/admin/students', label: 'Students' },
        { route: '/admin/students/import', label: 'Student Import' },
      ],
    });
    assert.equal(specificAdd, null);
  });

  it('prefers primary role buttons over demo quick-fill buttons unless demo is requested', () => {
    const loginPageMap: PageMapElement[] = [
      { id: 'login-demo-student-btn', tag: 'button', type: 'button', label: 'Student Demo', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-student', tag: 'button', type: 'button', label: 'Student', hasValue: false, currentRoute: '/login' },
    ];

    const step = buildDeterministicGuideStep({
      goal: 'guide login using "Student"',
      previousStepSummary: '',
      pageMap: loginPageMap,
      stepNumber: 1,
      currentRoute: '/login',
      confirmedPath: true,
    });
    assert.equal(step.action, 'click_safe');
    assert.equal(step.targetId, 'login-role-student');

    // Step 2: even when login-role-student is already in prevLower, never pick login-demo-student-btn
    const stepAfterRole = buildDeterministicGuideStep({
      goal: 'guide me to login as student',
      previousStepSummary: 'Clicked login-role-student (Student)',
      pageMap: [
        { id: 'login-demo-student-btn', tag: 'button', type: 'button', label: 'Student', hasValue: false, currentRoute: '/login' },
        { id: 'login-student-admission-input', tag: 'input', type: 'text', label: 'Admission number', hasValue: false, currentRoute: '/login' },
        { id: 'login-submit-btn', tag: 'button', type: 'submit', label: 'Sign in as Student', hasValue: false, currentRoute: '/login' },
      ],
      stepNumber: 2,
      currentRoute: '/login',
      confirmedPath: true,
    });
    assert.equal(stepAfterRole.action, 'point_and_wait');
    assert.equal(stepAfterRole.targetId, 'login-student-admission-input');

    // Step 4 on /app overview: stops immediately instead of clicking unrelated controls on student portal
    const overviewStep = buildDeterministicGuideStep({
      goal: 'guide me to login as student',
      previousStepSummary: 'Clicked login-role-student -> Guided user to login-student-admission-input -> Clicked login-submit-btn',
      pageMap: [
        { id: 'student-combined-statement-btn', tag: 'button', type: 'button', label: 'Download statement', hasValue: false, currentRoute: '/app' },
        { id: 'user-menu-signout-btn', tag: 'button', type: 'button', label: 'Sign out', hasValue: false, currentRoute: '/app', sensitive: true },
      ],
      stepNumber: 4,
      currentRoute: '/app',
      confirmedPath: true,
    });
    assert.equal(overviewStep.action, 'complete');

    // Sector manager login also stops cleanly upon reaching manager overview
    const managerOverviewStep = buildDeterministicGuideStep({
      goal: 'guide me how to log in using "Sector Manager"',
      previousStepSummary: 'Clicked login-role-manager -> Clicked login-submit-btn',
      pageMap: [
        { id: 'nav-ledger-link', tag: 'a', type: 'link', label: 'Ledger', hasValue: false, currentRoute: '/m/dept-fiqh' },
      ],
      stepNumber: 5,
      currentRoute: '/m/dept-fiqh',
      confirmedPath: true,
    });
    assert.equal(managerOverviewStep.action, 'complete');
  });

  it('guides "open the domo model" (demo typo) across /login clarification, button click, and completion, plus logout guidance', () => {
    assert.equal(shouldTriggerGuideMode('open the domo model'), true);
    assert.equal(shouldTriggerGuideMode('open demo mode'), true);

    const loginWithDemoMap: PageMapElement[] = [
      { id: 'login-role-admin', tag: 'button', type: 'button', label: 'Admin', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-manager', tag: 'button', type: 'button', label: 'Sector Manager', hasValue: false, currentRoute: '/login' },
      { id: 'login-role-student', tag: 'button', type: 'button', label: 'Student', hasValue: false, currentRoute: '/login' },
      { id: 'login-demo-admin-btn', tag: 'button', type: 'button', label: 'Admin Full college overview', hasValue: false, currentRoute: '/login' },
      { id: 'login-demo-manager-btn', tag: 'button', type: 'button', label: 'Sector Manager Dept Fiqh ledger', hasValue: false, currentRoute: '/login' },
      { id: 'login-demo-student-btn', tag: 'button', type: 'button', label: 'Student Safwan K.', hasValue: false, currentRoute: '/login' },
    ];

    // Step 1 on /login clarifies the 3 demo roles
    const clarifyDemo = detectAmbiguousGuidePaths({
      goal: 'open the domo model',
      pageMap: loginWithDemoMap,
      currentRoute: '/login',
      availableRoutes: [{ route: '/login', label: 'Portal Login' }],
    });
    assert.ok(clarifyDemo && clarifyDemo.action === 'clarify');
    assert.equal(clarifyDemo.options?.length, 3);
    assert.deepEqual(
      clarifyDemo.options?.map((o) => o.targetId),
      ['login-demo-admin-btn', 'login-demo-manager-btn', 'login-demo-student-btn']
    );

    // Selecting Sector Manager clicks login-demo-manager-btn
    const pickManagerStep = buildDeterministicGuideStep({
      goal: 'open the domo model using "Sector Manager"',
      previousStepSummary: '',
      pageMap: loginWithDemoMap,
      stepNumber: 1,
      currentRoute: '/login',
      confirmedPath: true,
      preferredTargetId: 'login-demo-manager-btn',
    });
    assert.equal(pickManagerStep.action, 'click_safe');
    assert.equal(pickManagerStep.targetId, 'login-demo-manager-btn');

    // Step 2 on dashboard completes immediately
    const demoDoneStep = buildDeterministicGuideStep({
      goal: 'open the domo model using "Sector Manager"',
      previousStepSummary: 'Clicked login-demo-manager-btn (Sector Manager)',
      pageMap: [
        { id: 'nav-ledger-link', tag: 'a', type: 'link', label: 'Ledger', hasValue: false, currentRoute: '/m/dept-fiqh' },
      ],
      stepNumber: 2,
      currentRoute: '/m/dept-fiqh',
      confirmedPath: true,
    });
    assert.equal(demoDoneStep.action, 'complete');

    // Asking to open demo from dashboard navigates to /login first
    const navToLoginStep = buildDeterministicGuideStep({
      goal: 'open the domo model',
      previousStepSummary: '',
      pageMap: [
        { id: 'nav-ledger-link', tag: 'a', type: 'link', label: 'Ledger', hasValue: false, currentRoute: '/m/dept-fiqh' },
      ],
      stepNumber: 1,
      currentRoute: '/m/dept-fiqh',
    });
    assert.equal(navToLoginStep.action, 'navigate');
    assert.equal(navToLoginStep.route, '/login');

    // Logout guide opens user menu then points to sign out
    const openMenuStep = buildDeterministicGuideStep({
      goal: 'how do i log out?',
      previousStepSummary: '',
      pageMap: [
        { id: 'user-menu-btn', tag: 'button', type: 'button', label: 'Profile', hasValue: false, currentRoute: '/m/dept-fiqh' },
      ],
      stepNumber: 1,
      currentRoute: '/m/dept-fiqh',
    });
    assert.equal(openMenuStep.action, 'click_safe');
    assert.equal(openMenuStep.targetId, 'user-menu-btn');

    const pointSignOutStep = buildDeterministicGuideStep({
      goal: 'how do i log out?',
      previousStepSummary: 'Clicked user-menu-btn',
      pageMap: [
        { id: 'user-menu-signout-btn', tag: 'button', type: 'button', label: 'Sign out', hasValue: false, currentRoute: '/m/dept-fiqh', sensitive: true },
      ],
      stepNumber: 2,
      currentRoute: '/m/dept-fiqh',
    });
    assert.equal(pointSignOutStep.action, 'point_and_wait');
    assert.equal(pointSignOutStep.targetId, 'user-menu-signout-btn');
  });

  it('triggers guide for direct login prompts and dynamically diagnoses page errors with Yes/No/Follow-up recovery', () => {
    assert.equal(shouldTriggerGuideMode('log in as student'), true);
    assert.equal(shouldTriggerGuideMode('sign in as admin'), true);

    // 1. Visible student ID error -> contextual diagnostic question + Yes/No chips
    const diag = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      pageErrors: ['No student found with that admission number.'],
    });
    assert.ok(diag);
    assert.equal(diag.action, 'ask_user');
    assert.equal(diag.askStage, 'diagnostic');
    assert.equal(diag.question, 'Are you registered by the admin?');
    assert.deepEqual(
      diag.quickReplies?.map((q) => q.value),
      ['yes', 'no']
    );

    // 2. Affirmative ("yes") -> refresh_and_retry
    const yesRes = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      userReply: 'Yes',
      troubleshootingContext: {
        errorText: 'No student found with that admission number.',
        questionAsked: diag.question!,
        stage: 'diagnostic',
      },
    });
    assert.ok(yesRes);
    assert.equal(yesRes.action, 'refresh_and_retry');
    assert.equal(yesRes.refreshApp, true);

    // 3. Negative ("no") -> advise contact admin + ask if user wants another guide
    const noRes = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      userReply: 'no',
      troubleshootingContext: {
        errorText: 'No student found with that admission number.',
        questionAsked: diag.question!,
        stage: 'diagnostic',
      },
    });
    assert.ok(noRes);
    assert.equal(noRes.action, 'ask_user');
    assert.equal(noRes.askStage, 'follow_up_guide');
    assert.ok(noRes.question?.toLowerCase().includes('contact the admin'));
    assert.ok(noRes.question?.toLowerCase().includes('any other guide'));
    assert.deepEqual(
      noRes.quickReplies?.map((q) => q.value),
      ['close']
    );

    // 4. Saying "yes" to follow-up asks what they want; saying "open demo mode" hands off cleanly; saying "close" closes
    const followUpYes = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      userReply: 'yes',
      troubleshootingContext: {
        errorText: 'No student found with that admission number.',
        questionAsked: noRes.question!,
        stage: 'follow_up_guide',
      },
    });
    assert.equal(followUpYes?.action, 'ask_user');

    const followUpNewTopic = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      userReply: 'open demo mode',
      troubleshootingContext: {
        errorText: 'No student found with that admission number.',
        questionAsked: noRes.question!,
        stage: 'follow_up_guide',
      },
    });
    assert.equal(followUpNewTopic, null);

    const followUpClose = resolveGuideTroubleshootingStep({
      goal: 'log in as student',
      currentRoute: '/login',
      userReply: 'close',
      troubleshootingContext: {
        errorText: 'No student found with that admission number.',
        questionAsked: noRes.question!,
        stage: 'follow_up_guide',
      },
    });
    assert.equal(followUpClose?.action, 'complete');

    // 5. Dynamic non-login errors generate relevant contextual questions
    const dupErr = resolveGuideTroubleshootingStep({
      goal: 'add student',
      currentRoute: '/admin/students',
      pageErrors: ['Student admission number already exists.'],
    });
    assert.equal(dupErr?.action, 'ask_user');
    assert.ok(dupErr?.question?.toLowerCase().includes('existing record'));
  });

  it('estimates exact per-task totalSteps instead of flat 10 and completes after submit closes drawer', () => {
    const addStudentStep1 = buildDeterministicGuideStep({
      goal: 'guide me to add a student',
      previousStepSummary: '',
      pageMap: [
        { id: 'students-add-btn', tag: 'button', type: 'button', label: 'Add student', hasValue: false, currentRoute: '/admin/students' },
        { id: 'students-export-btn', tag: 'button', type: 'button', label: 'Export', hasValue: false, currentRoute: '/admin/students' },
      ],
      stepNumber: 1,
      currentRoute: '/admin/students',
    });
    assert.equal(addStudentStep1.targetId, 'students-add-btn');
    assert.equal(addStudentStep1.totalSteps, 3);

    const addStudentStep2 = buildDeterministicGuideStep({
      goal: 'guide me to add a student',
      previousStepSummary: 'Clicked students-add-btn (Add student)',
      pageMap: [
        { id: 'student-drawer-name-input', tag: 'input', type: 'text', label: 'Full Name', hasValue: false, currentRoute: '/admin/students' },
        { id: 'student-drawer-guardian-input', tag: 'input', type: 'text', label: 'Guardian Name', hasValue: false, currentRoute: '/admin/students' },
        { id: 'student-drawer-phone-input', tag: 'input', type: 'tel', label: 'Phone Number', hasValue: false, currentRoute: '/admin/students' },
        { id: 'student-drawer-submit-btn', tag: 'button', type: 'submit', label: 'Add student', hasValue: false, currentRoute: '/admin/students', sensitive: true },
      ],
      stepNumber: 2,
      currentRoute: '/admin/students',
    });
    assert.equal(addStudentStep2.targetId, 'student-drawer-name-input');
    assert.equal(addStudentStep2.totalSteps, 3);

    const addStudentStep3 = buildDeterministicGuideStep({
      goal: 'guide me to add a student',
      previousStepSummary: 'Clicked students-add-btn (Add student) -> Guided user to student-drawer-name-input (Full Name)',
      pageMap: [
        { id: 'student-drawer-name-input', tag: 'input', type: 'text', label: 'Full Name', hasValue: true, currentRoute: '/admin/students' },
        { id: 'student-drawer-guardian-input', tag: 'input', type: 'text', label: 'Guardian Name', hasValue: false, currentRoute: '/admin/students' },
        { id: 'student-drawer-phone-input', tag: 'input', type: 'tel', label: 'Phone Number', hasValue: false, currentRoute: '/admin/students' },
        { id: 'student-drawer-submit-btn', tag: 'button', type: 'submit', label: 'Add student', hasValue: false, currentRoute: '/admin/students', sensitive: true },
      ],
      stepNumber: 3,
      currentRoute: '/admin/students',
    });
    assert.equal(addStudentStep3.targetId, 'student-drawer-submit-btn');
    assert.equal(addStudentStep3.totalSteps, 3);

    // Once user clicks submit and drawer closes (submit button disappears), completes instead of looping Step 4 over table
    const postSubmitComplete = buildDeterministicGuideStep({
      goal: 'guide me to add a student',
      previousStepSummary:
        'Clicked students-add-btn -> Guided user to student-drawer-name-input -> Guided user to student-drawer-submit-btn (Add student)',
      pageMap: [
        { id: 'students-add-btn', tag: 'button', type: 'button', label: 'Add student', hasValue: false, currentRoute: '/admin/students' },
        { id: 'students-search-input', tag: 'input', type: 'text', label: 'Search students', hasValue: false, currentRoute: '/admin/students' },
      ],
      stepNumber: 4,
      currentRoute: '/admin/students',
    });
    assert.equal(postSubmitComplete.action, 'complete');

    // 2-step logout workflow -> totalSteps = 2
    const logoutStep1 = buildDeterministicGuideStep({
      goal: 'how do I log out?',
      previousStepSummary: '',
      pageMap: [
        { id: 'user-menu-btn', tag: 'button', type: 'button', label: 'Profile', hasValue: false, currentRoute: '/admin' },
      ],
      stepNumber: 1,
      currentRoute: '/admin',
    });
    assert.equal(logoutStep1.totalSteps, 2);

    // 1-step export workflow -> totalSteps = 1
    const exportTotal = estimateRequiredGuideSteps({
      goal: 'how do I export csv?',
      currentRoute: '/admin/students',
      stepNumber: 1,
      pageMap: [
        { id: 'students-export-btn', tag: 'button', type: 'button', label: 'Export CSV', hasValue: false, currentRoute: '/admin/students' },
      ],
      decision: { action: 'point_and_wait', targetId: 'students-export-btn', tip: 'Click Export CSV.' },
    });
    assert.equal(exportTotal, 1);
  });
});



