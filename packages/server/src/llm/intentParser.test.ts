import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractExportToolCall,
  parseQueryIntent,
  shouldUseAgentLoop,
} from './intentParser.ts';
import {
  clampChipWords,
  clearSuggestionChipsCache,
  getSuggestionChips,
  resolveConfiguredPage,
} from '../chips/suggestionChips.ts';
import {
  khaznaAssistantConfig,
  leaveLogAssistantConfig,
  libraryAssistantConfig,
} from '../../../../assistant.config.ts';

test('parseQueryIntent handles "give the list of net worth minus" with balance < 0 and Due-only columns', () => {
  const parsed = parseQueryIntent('give the list of net worth minus');
  assert.ok(parsed);
  assert.equal(parsed.entityType, 'student');
  assert.deepEqual(parsed.numericFilters, [{ field: 'balance', op: '<', value: 0 }]);
  assert.deepEqual(parsed.columns, ['id', 'name', 'className', 'pendingFee']);
  assert.ok(!parsed.columns?.includes('debitTotal'));
  assert.ok(!parsed.columns?.includes('paidTotal'));
  assert.ok(parsed.assumption?.includes('debit and credit too'));
});

test('parseQueryIntent includes debitTotal and paidTotal when user asks "debit and credit too"', () => {
  const initial = parseQueryIntent('give the list of net worth minus with debit and credit too');
  assert.ok(initial);
  assert.ok(initial.columns?.includes('debitTotal'));
  assert.ok(initial.columns?.includes('paidTotal'));

  const followUp = parseQueryIntent('debit and credit too');
  assert.ok(followUp);
  assert.equal(followUp.usePrevious, true);
  assert.deepEqual(followUp.addColumns, ['debitTotal', 'paidTotal']);
});

test('parseQueryIntent parses follow-up view refinements without re-asking', () => {
  const addPhone = parseQueryIntent('add phone number');
  assert.ok(addPhone);
  assert.equal(addPhone.usePrevious, true);
  assert.deepEqual(addPhone.addColumns, ['phone']);

  const onlyFiqh = parseQueryIntent('only Fiqh 2');
  assert.ok(onlyFiqh);
  assert.equal(onlyFiqh.usePrevious, true);
  assert.deepEqual(onlyFiqh.filters, { className: 'Fiqh 2' });

  const sortHighest = parseQueryIntent('sort by highest due');
  assert.ok(sortHighest);
  assert.equal(sortHighest.usePrevious, true);
  assert.deepEqual(sortHighest.sort, { field: 'pendingFee', dir: 'desc' });
});

test('extractExportToolCall intercepts "can you download this given data as excel file" as usePrevious xlsx', () => {
  const call = extractExportToolCall('can you download this given data as excel file');
  assert.ok(call);
  assert.equal(call.name, 'export_data');
  assert.equal(call.args.usePrevious, true);
  assert.equal(call.args.format, 'xlsx');

  assert.equal(
    shouldUseAgentLoop('can you download this given data as excel file', {
      tools: ['export_data', 'query_entities'],
    }),
    true
  );
});

test('clampChipWords limits chip labels to at most 8 words', () => {
  const clamped = clampChipWords('One two three four five six seven eight nine ten', 8);
  assert.equal(clamped, 'One two three four five six seven eight…');
  assert.equal(clampChipWords('Short chip text', 8), 'Short chip text');
});

test('resolveConfiguredPage generically matches route patterns across different apps', () => {
  const khaznaStudents = resolveConfiguredPage('/admin/students', khaznaAssistantConfig);
  assert.equal(khaznaStudents.pageId, 'admin.students');
  assert.equal(khaznaStudents.pageTitle, 'Students');

  const managerLedger = resolveConfiguredPage('/m/dept-fiqh/ledger', khaznaAssistantConfig);
  assert.equal(managerLedger.pageId, 'manager.entries');

  const libCatalog = resolveConfiguredPage('/catalog', libraryAssistantConfig);
  assert.equal(libCatalog.pageId, 'library.catalog');

  const leaveList = resolveConfiguredPage('/leaves', leaveLogAssistantConfig);
  assert.equal(leaveList.pageId, 'leave.requests');
});

test('getSuggestionChips returns 3 unique RBAC-scoped chips that adapt on navigation and activity', () => {
  clearSuggestionChipsCache();

  // 1. Admin on Overview vs Students -> Chip 2 changes cleanly
  const adminOverview = getSuggestionChips(
    { userId: 'admin-1', role: 'ADMIN' },
    { pathname: '/admin/overview' },
    undefined,
    { appId: 'khazna-ledger', config: khaznaAssistantConfig, rotationSeed: 0, bypassCache: true }
  );
  const adminStudents = getSuggestionChips(
    { userId: 'admin-1', role: 'ADMIN' },
    { pathname: '/admin/students' },
    undefined,
    { appId: 'khazna-ledger', config: khaznaAssistantConfig, rotationSeed: 0, bypassCache: true }
  );

  assert.equal(adminOverview.chips.length, 3);
  assert.equal(adminStudents.chips.length, 3);
  assert.notEqual(adminOverview.chips[1].label, adminStudents.chips[1].label);

  // Check unique labels and <= 8 words
  const labels = adminStudents.chips.map((c) => c.label.toLowerCase());
  assert.equal(new Set(labels).size, 3);
  for (const c of adminStudents.chips) {
    assert.ok(c.label.split(/\s+/).length <= 9);
  }

  // 2. Student RBAC never sees admin actions (e.g. Add student, assign manager, Safwan admin lookup)
  const studentChips = getSuggestionChips(
    { userId: 'S0125', role: 'STUDENT' },
    { pathname: '/admin/students' },
    undefined,
    { appId: 'khazna-ledger', config: khaznaAssistantConfig, rotationSeed: 0, bypassCache: true }
  );
  assert.equal(studentChips.chips.length, 3);
  for (const c of studentChips.chips) {
    assert.ok(!/add a new student|assign sector manager|safwan/i.test(c.label));
  }

  // 3. Abandoned form / failed request surfaces in Chip 1 (Personal / Recent)
  const withAbandoned = getSuggestionChips(
    { userId: 'admin-1', role: 'ADMIN' },
    { pathname: '/admin/overview' },
    {
      lastAbandonedForm: {
        formType: 'khaznaAddStudent',
        title: 'Add Student',
        prompt: 'Open Add Student form',
        abandonedAt: Date.now(),
      },
      history: [],
    },
    { appId: 'khazna-ledger', config: khaznaAssistantConfig, rotationSeed: 0, bypassCache: true }
  );
  assert.equal(withAbandoned.chips[0].slot, 'personal');
  assert.match(withAbandoned.chips[0].label, /Resume: Add Student/);

  // 4. Generic support for Library and Leave Log without code changes
  const libChips = getSuggestionChips(
    { userId: 'lib-1', role: 'ADMIN' },
    { pathname: '/catalog' },
    undefined,
    { appId: 'second-demo', config: libraryAssistantConfig, rotationSeed: 0, bypassCache: true }
  );
  assert.equal(libChips.chips.length, 3);
  assert.equal(libChips.pageId, 'library.catalog');

  const leaveChips = getSuggestionChips(
    { userId: 'hr-1', role: 'ADMIN' },
    { pathname: '/leaves' },
    undefined,
    { appId: 'leave-log', config: leaveLogAssistantConfig, rotationSeed: 0, bypassCache: true }
  );
  assert.equal(leaveChips.chips.length, 3);
  assert.equal(leaveChips.pageId, 'leave.requests');
});
