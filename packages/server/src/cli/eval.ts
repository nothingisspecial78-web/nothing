import 'dotenv/config';
import { loadConfig } from '../config.ts';
import { createLlmGateway } from '../llm/client.ts';
import { runChatAgent } from '../llm/agentLoop.ts';
import { ProfileRegistry } from '../profiles/loader.ts';
import { createEmbedder } from '../rag/embedder.ts';
import { ingestAppDocs } from '../rag/retriever.ts';
import { createVectorStore } from '../rag/store.ts';
import { ActionLogStore } from '../security/confirmation.ts';
import { ResponseCache } from '../security/limits.ts';
import { ToolRegistry } from '../tools/registry.ts';

function parseAppArg(argv: string[]): string {
  const idx = argv.indexOf('--app');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith('--app='));
  return eq ? eq.split('=')[1] : 'college-finance';
}

async function main() {
  const appId = parseAppArg(process.argv.slice(2));
  const cfg = loadConfig({ nodeEnv: 'test' });
  const profiles = new ProfileRegistry();
  await profiles.loadAll(cfg.profilesDir);

  const profile = profiles.getProfile(appId);
  const suite = profiles.getEvalSuite(appId);
  if (!profile || !suite) {
    console.error(`Missing profile or eval.json for app "${appId}"`);
    process.exit(1);
  }

  const embedder = createEmbedder(cfg);
  const vectorStore = createVectorStore(cfg);
  const llm = createLlmGateway(cfg);
  const toolRegistry = new ToolRegistry();
  const actionStore = new ActionLogStore();
  const cache = new ResponseCache(0);

  await ingestAppDocs({ appId, profiles, embedder, store: vectorStore });

  let passed = 0;
  let failed = 0;

  console.log(`\nRunning evaluation suite for "${appId}" (${suite.cases.length} cases)\n`);

  for (const testCase of suite.cases) {
    let answerText = '';
    const outcome = await runChatAgent({
      profile,
      messages: [{ role: 'user', content: testCase.question }],
      context: testCase.context,
      userId: 'eval-runner',
      authToken: '',
      cfg,
      embedder,
      vectorStore,
      llm,
      toolRegistry,
      actionStore,
      cache,
      emit: (ev) => {
        if (ev.type === 'token') answerText += ev.delta;
      },
    });

    const scopeMatch =
      testCase.expectedScope === 'out-of-scope' ? outcome.refusal : !outcome.refusal;

    const normalizedAnswer = answerText
      .replace(/[\u202f\u00a0\u2009]/g, ' ')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/(\d)\s+%/g, '$1%')
      .toLowerCase();
    const missingKeywords = testCase.expectedKeywords.filter(
      (kw) => !normalizedAnswer.includes(kw.toLowerCase())
    );
    const keywordsMatch = missingKeywords.length === 0;
    const casePassed = scopeMatch && keywordsMatch;

    if (casePassed) {
      passed += 1;
      console.log(
        `[PASS] ${testCase.id} | scope=${testCase.expectedScope} | score=${outcome.topScore.toFixed(3)} | "${testCase.question}"`
      );
    } else {
      failed += 1;
      console.log(
        `[FAIL] ${testCase.id} | expected=${testCase.expectedScope} gotRefusal=${outcome.refusal} | score=${outcome.topScore.toFixed(3)} | missing=[${missingKeywords.join(', ')}] | "${testCase.question}"`
      );
    }
  }

  console.log(`\nSummary: ${passed}/${suite.cases.length} passed, ${failed} failed.\n`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Eval runner failed:', err);
  process.exit(1);
});
