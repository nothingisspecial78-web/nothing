import 'dotenv/config';
import { loadConfig } from '../config.ts';
import { ProfileRegistry } from '../profiles/loader.ts';
import { createEmbedder } from '../rag/embedder.ts';
import { ingestAllProfiles, ingestAppDocs } from '../rag/retriever.ts';
import { createVectorStore } from '../rag/store.ts';

function parseAppArg(argv: string[]): string | undefined {
  const idx = argv.indexOf('--app');
  if (idx !== -1 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith('--app='));
  return eq ? eq.split('=')[1] : undefined;
}

async function main() {
  const cfg = loadConfig();
  const appId = parseAppArg(process.argv.slice(2));
  const profiles = new ProfileRegistry();
  await profiles.loadAll(cfg.profilesDir);

  const embedder = createEmbedder(cfg);
  const store = createVectorStore(cfg);

  if (appId) {
    if (!profiles.getProfile(appId)) {
      console.error(`Error: profile "${appId}" not found in ${cfg.profilesDir}`);
      process.exit(1);
    }
    const res = await ingestAppDocs({ appId, profiles, embedder, store });
    console.log(
      `Ingested app "${res.appId}": ${res.docsCount} doc(s), ${res.chunksCount} chunk(s) [store=${store.backend}, embedder=${embedder.mode}]`
    );
    return;
  }

  const results = await ingestAllProfiles({ profiles, embedder, store });
  for (const res of results) {
    console.log(
      `Ingested app "${res.appId}": ${res.docsCount} doc(s), ${res.chunksCount} chunk(s) [store=${store.backend}, embedder=${embedder.mode}]`
    );
  }
}

main().catch((err) => {
  console.error('Ingestion failed:', err);
  process.exit(1);
});
