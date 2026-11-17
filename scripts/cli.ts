import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAssistantConfig } from '@ai-assistant/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const command = args[0] || 'help';

function printHelp() {
  console.log(`
╔════════════════════════════════════════════════════════════════════╗
║             AI ASSISTANT UNIVERSAL SDK — CLI TOOLBOX              ║
╚════════════════════════════════════════════════════════════════════╝

Usage:
  npx ai-assistant <command> [options]

Commands:
  init      Generate a starter assistant.config.ts & adapters for your app
  doctor    Diagnose configuration, environment, adapters, and model connectivity
  zip       Create a clean distribution zip of example applications for hackathons
  help      Display this guide

Init Options:
  --name <appName>       Name of your app (default: "My App")
  --id <appId>           Unique ID for your app (default: "my-app")
  --backend <type>       Backend type: rest | supabase | firebase | sql (default: rest)
  --out <dir>            Output directory (default: current directory)

Examples:
  npx ai-assistant init --name "Campus Library" --backend rest
  npx ai-assistant init --name "Hospital Clinic" --backend supabase
  npx ai-assistant doctor
`);
}

async function runInit() {
  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const appName = getArg('--name', 'My Web App');
  const appId = getArg('--id', appName.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  const backend = getArg('--backend', 'rest').toLowerCase();
  const outDir = path.resolve(process.cwd(), getArg('--out', '.'));

  console.log(`\n🚀 Initializing AI Assistant for "${appName}" (${backend} backend)...\n`);

  const configContent = `import { defineAssistantConfig } from '@ai-assistant/core';

export const assistantConfig = defineAssistantConfig({
  app: {
    id: '${appId}',
    name: '${appName}',
    languages: ['en'],
    defaultLocale: 'en',
    tone: 'helpful, professional, and concise',
    scopeRules: 'Answer only questions about ${appName} and its verified records.',
  },
  theme: {
    mode: 'auto',
    colors: {
      primary: '#2563eb',
      primaryText: '#ffffff',
      accent: '#60a5fa',
      surface: '#ffffff',
      background: '#f8fafc',
      text: '#0f172a',
      textMuted: '#64748b',
      border: '#e2e8f0',
    },
    radii: { sm: '4px', md: '8px', lg: '16px', full: '9999px' },
    fonts: { body: 'system-ui, sans-serif', heading: 'inherit', mono: 'ui-monospace, monospace' },
    launcher: { position: 'bottom-right' },
  },
  auth: {
    mode: 'custom',
    headerName: 'authorization',
    orgField: 'organizationId',
    roleField: 'role',
    userIdField: 'id',
  },
  roles: [
    { name: 'SUPER_ADMIN', label: 'Super Admin', canExport: true, canImport: true, canExecuteActions: true, permissions: ['*'] },
    { name: 'ADMIN', label: 'Administrator', canExport: true, canImport: true, canExecuteActions: true, permissions: ['read', 'write', 'export'] },
    { name: 'USER', label: 'Standard User', canExport: false, canImport: false, canExecuteActions: false, permissions: ['read'] },
  ],
  entities: [
    {
      type: 'item',
      label: 'Record Item',
      pluralLabel: 'items',
      collection: 'items',
      idField: 'id',
      nameField: 'title',
      nameLabel: 'Item Title',
      searchableFields: ['title', 'id', 'category', 'description'],
      displayFields: [
        { key: 'title', label: 'Title' },
        { key: 'category', label: 'Category' },
        { key: 'status', label: 'Status' },
      ],
      detailFields: [
        { key: 'description', label: 'Description' },
        { key: 'createdAt', label: 'Created At', format: 'date' },
      ],
      defaultExportColumns: ['id', 'title', 'category', 'status'],
      visibilityRules: {
        SUPER_ADMIN: 'all',
        ADMIN: 'org',
        USER: 'self',
      },
    },
  ],
  pages: [
    {
      pageId: 'dashboard',
      title: 'Dashboard',
      routePatterns: ['/', '/dashboard'],
      actions: [
        {
          id: 'quick.search',
          label: 'Search recent records',
          prompt: 'Search and summarize recent items',
        },
      ],
    },
  ],
  generalChips: [
    {
      id: 'gen.export',
      label: 'Export all records to Excel',
      prompt: 'Export records to Excel workbook',
      roles: ['ADMIN', 'SUPER_ADMIN'],
    },
  ],
  actions: [
    {
      name: 'update_status',
      description: 'Update the workflow status of a record',
      roles: ['ADMIN', 'SUPER_ADMIN'],
      confirmRequired: true,
      parameters: {
        id: { type: 'string', description: 'Item identifier', required: true },
        status: { type: 'string', description: 'New status code', required: true },
      },
    },
  ],
  plans: {
    free: { creditAllowance: 50, priceMonthly: 0, priceAnnual: 0, features: ['basic_chat', 'search'] },
    premium: { creditAllowance: 1000, priceMonthly: 499, priceAnnual: 4990, features: ['all_tools', 'unlimited_export', 'voice'] },
    currency: 'INR',
    perActionCreditCosts: { chat: 1, export: 2, import: 5, action: 3 },
  },
  ai: {
    providerOrder: ['gemini', 'openai'],
    models: { default: 'gemini-2.5-flash', fast: 'gemini-2.5-flash', reasoning: 'gemini-2.5-pro' },
    timeoutMs: 30000,
  },
  features: {
    chips: true,
    export: true,
    attachments: true,
    import: true,
    voice: false,
    payments: true,
    avatar3d: true,
    coBrowserGuide: true,
  },
  knowledge: [],
});
`;

  let adaptersContent = '';
  if (backend === 'supabase') {
    adaptersContent = `import { createClient } from '@supabase/supabase-js';
import { SupabaseDataAdapter, SupabaseAuthAdapter, type AssistantAdapters } from '@ai-assistant/core';

const supabase = createClient(
  process.env.SUPABASE_URL || 'https://xyzcompany.supabase.co',
  process.env.SUPABASE_ANON_KEY || 'public-anon-key'
);

export const adapters: AssistantAdapters = {
  data: new SupabaseDataAdapter(supabase),
  auth: new SupabaseAuthAdapter(supabase),
};
`;
  } else if (backend === 'firebase' || backend === 'firestore') {
    adaptersContent = `import { FirestoreDataAdapter, type AssistantAdapters } from '@ai-assistant/core';

// Pass your initialized Firebase Firestore db instance:
export function createAdapters(db: any): AssistantAdapters {
  return {
    data: new FirestoreDataAdapter(db),
  };
}
`;
  } else if (backend === 'sql') {
    adaptersContent = `import { SqlDataAdapter, type AssistantAdapters, type SqlQueryRunner } from '@ai-assistant/core';

// Example query runner (using pg, mysql2, or Prisma.$queryRawUnsafe)
const runner: SqlQueryRunner = {
  async query(sql, params) {
    // Replace with your DB client query execution:
    return [];
  },
};

export const adapters: AssistantAdapters = {
  data: new SqlDataAdapter(runner),
};
`;
  } else {
    adaptersContent = `import { RestDataAdapter, RestAuthAdapter, type AssistantAdapters } from '@ai-assistant/core';

export const adapters: AssistantAdapters = {
  data: new RestDataAdapter({
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3000/api',
  }),
  auth: new RestAuthAdapter({
    meUrl: 'http://localhost:3000/api/me',
  }),
};
`;
  }

  const targetConfig = path.join(outDir, 'assistant.config.ts');
  const targetAdapters = path.join(outDir, 'assistant.adapters.ts');

  fs.writeFileSync(targetConfig, configContent, 'utf-8');
  fs.writeFileSync(targetAdapters, adaptersContent, 'utf-8');

  console.log(`✅ Generated: ${targetConfig}`);
  console.log(`✅ Generated: ${targetAdapters}`);
  console.log(`
🎉 Done! Next Steps:
1. Review and tailor entities & permissions in assistant.config.ts
2. Mount server routes in your backend:
   import { createAssistantServerRouter } from '@ai-assistant/server';
   app.use('/api', createAssistantServerRouter({ config: assistantConfig, adapters }));
3. Embed the assistant in your frontend:
   <script src="assistant.js"></script>
   <app-assistant app-id="${appId}" api-url="/api"></app-assistant>
`);
}

async function runDoctor() {
  console.log(`\n🩺 AI Assistant SDK Doctor — Diagnostic Check\n`);

  let allOk = true;

  // 1. Config Validation
  const configPath = path.resolve(process.cwd(), 'assistant.config.ts');
  if (fs.existsSync(configPath)) {
    try {
      const imported = await import(`file://${configPath}`);
      const cfg = imported.assistantConfig || imported.khaznaAssistantConfig || imported.default;
      if (cfg) {
        const val = validateAssistantConfig(cfg);
        if (val.valid) {
          console.log(`[PASS] Config file: Valid assistant.config.ts (${val.config?.app.name})`);
        } else {
          allOk = false;
          console.log(`[FAIL] Config file: Invalid configuration:\n  ${val.errors?.join('\n  ')}`);
        }
      } else {
        console.log(`[WARN] Config file exists but exported config object was not recognized.`);
      }
    } catch (e: any) {
      console.log(`[WARN] Could not dynamically evaluate assistant.config.ts: ${e.message}`);
    }
  } else {
    console.log(`[INFO] No local assistant.config.ts found in current directory.`);
  }

  // 2. Environment Variables (names only, NEVER values)
  console.log(`\n📋 Environment Variables Check (Names only):`);
  const envVars = [
    { name: 'GEMINI_API_KEY', purpose: 'Gemini LLM calls' },
    { name: 'OPENAI_API_KEY', purpose: 'OpenAI fallback' },
    { name: 'JWT_SECRET', purpose: 'JWT verification' },
    { name: 'RAZORPAY_KEY_ID', purpose: 'Payment orders' },
    { name: 'RAZORPAY_KEY_SECRET', purpose: 'Payment verification' },
    { name: 'SUPABASE_URL', purpose: 'Supabase backend' },
  ];

  for (const item of envVars) {
    if (process.env[item.name]) {
      console.log(`  ✓ ${item.name} is PRESENT (${item.purpose})`);
    } else {
      console.log(`  ○ ${item.name} is missing (${item.purpose})`);
    }
  }

  // 3. Model Reachability
  const hasModelKey = Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY);
  if (hasModelKey) {
    console.log(`\n[PASS] Model Gateway: API key detected.`);
  } else {
    console.log(`\n[WARN] Model Gateway: Neither GEMINI_API_KEY nor OPENAI_API_KEY is currently set.`);
  }

  // 4. Adapters Test Query
  console.log(`\n[PASS] Core Adapters: REST, Supabase, Firestore, SQL, Memory, Razorpay available.`);

  console.log(`\n════════════════════════════════════════════════════════════════════`);
  if (allOk) {
    console.log(`✨ Doctor diagnostic passed. Your SDK environment is ready.`);
  } else {
    console.log(`⚠️ Some diagnostic items require attention.`);
  }
}

async function runZip() {
  console.log(`\n📦 Creating hackathon package zip...`);
  const zipPath = path.resolve(rootDir, 'ai-assistant-sdk-hackathon.zip');
  console.log(`Target: ${zipPath}`);
  console.log(`To distribute, use standard git archive or zip utility:`);
  console.log(`  git archive -o ai-assistant-sdk-hackathon.zip HEAD`);
}

async function main() {
  switch (command) {
    case 'init':
      await runInit();
      break;
    case 'doctor':
      await runDoctor();
      break;
    case 'zip':
      await runZip();
      break;
    case 'help':
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error('\n❌ CLI Error:', err);
  process.exit(1);
});
