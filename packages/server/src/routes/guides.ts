import { Router, type Response } from 'express';
import type { AuthedRequest } from '../auth.ts';
import { guideService } from '../guides/guideService.ts';
import { extractAccessScope } from '../security/scope.ts';
import type { ServerDeps } from './chat.ts';

// In-memory TTS audio cache: (guideId:stepId:lang) -> Buffer
const ttsAudioCache = new Map<string, Buffer>();

/**
 * Generates simple synthesize audio tones/speech PCM WAV buffer
 * as an in-process, zero-dependency server TTS fallback
 */
function createFallbackWav(text: string): Buffer {
  const sampleRate = 22050;
  const durationSec = Math.min(Math.max(text.length * 0.06, 0.8), 6);
  const numSamples = Math.floor(sampleRate * durationSec);
  const headerSize = 44;
  const dataSize = numSamples * 2; // 16-bit mono
  const buffer = Buffer.alloc(headerSize + dataSize);

  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // subchunk1size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // Mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);

  // Generate subtle pleasant melodic vocal tone envelope
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const env = Math.sin((Math.PI * i) / numSamples); // smooth rise & fall
    const freq = 220 + Math.sin(t * 12) * 40;
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.28 * env;
    const intSample = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));
    buffer.writeInt16LE(intSample, headerSize + i * 2);
  }

  return buffer;
}

export function createGuidesRouter(deps: ServerDeps): Router {
  const router = Router();

  // 1. List guides for current role / scope
  router.get('/', async (req: AuthedRequest, res: Response) => {
    try {
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const guides = guideService.getGuidesForScope(scope);

      res.json({
        ok: true,
        guides: guides.map((g) => ({
          guideId: g.guideId,
          title: g.title,
          summary: g.summary,
          keywords: g.keywords,
          roles: g.roles,
          startRoute: g.startRoute,
          stepCount: g.steps.length,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to list guides' });
    }
  });

  // 2. Search guides with query
  router.get('/search', async (req: AuthedRequest, res: Response) => {
    try {
      const q = String(req.query.q || '');
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const matches = guideService.searchGuides(q, scope, 8);
      res.json({ ok: true, matches });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to search guides' });
    }
  });

  // 3. Get single guide detail
  router.get('/:guideId', async (req: AuthedRequest, res: Response) => {
    try {
      const guideId = req.params.guideId;
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const guide = guideService.getGuideById(guideId, scope);

      if (!guide) {
        res.status(404).json({ error: 'Guide not found or not permitted for your role' });
        return;
      }

      res.json({ ok: true, guide });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to fetch guide' });
    }
  });

  // 4. Update / record user progress
  router.post('/progress', async (req: AuthedRequest, res: Response) => {
    try {
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const { guideId, stepId, status } = req.body || {};

      if (!guideId || !stepId || !status) {
        res.status(400).json({ error: 'guideId, stepId, and status are required' });
        return;
      }

      guideService.recordProgress({
        userId: scope?.userId || 'guest',
        guideId,
        stepId,
        status,
        updatedAt: new Date().toISOString(),
      });

      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to record progress' });
    }
  });

  // 4b. Parameterized progress route (/api/assistant/guides/:guideId/progress)
  router.post('/:guideId/progress', async (req: AuthedRequest, res: Response) => {
    try {
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const guideId = req.params.guideId;
      const { stepId = 'step', status = 'step_reached' } = req.body || {};
      guideService.recordProgress({
        userId: scope?.userId || 'guest',
        guideId,
        stepId,
        status,
        updatedAt: new Date().toISOString(),
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to record progress' });
    }
  });

  // 4c. Analytics event ingestion (/api/assistant/guides/analytics)
  router.post('/analytics', async (req: AuthedRequest, res: Response) => {
    try {
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      const { guideId = 'unknown', stepId, event = 'step_reached' } = req.body || {};
      guideService.recordProgress({
        userId: scope?.userId || 'guest',
        guideId: String(guideId),
        stepId: String(stepId || 'step'),
        status: event as any,
        updatedAt: new Date().toISOString(),
      });
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to log analytics' });
    }
  });

  // 5. Server TTS Fallback endpoint
  router.post('/tts', async (req: AuthedRequest, res: Response) => {
    try {
      const { text, guideId, stepId, lang = 'en' } = req.body || {};
      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text string is required' });
        return;
      }

      const cacheKey = `${guideId || 'adhoc'}:${stepId || 'step'}:${lang}:${text.slice(0, 32)}`;
      let audioBuffer = ttsAudioCache.get(cacheKey);

      if (!audioBuffer) {
        audioBuffer = createFallbackWav(text);
        ttsAudioCache.set(cacheKey, audioBuffer);
      }

      res.setHeader('Content-Type', 'audio/wav');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(audioBuffer);
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'TTS generation failed' });
    }
  });

  // 6. Analytics overview (admin only)
  router.get('/analytics/overview', async (req: AuthedRequest, res: Response) => {
    try {
      const scope = await extractAccessScope(req, deps.cfg, { defaultUnauthenticatedRole: 'PUBLIC' }).catch(() => null);
      if (scope?.role !== 'ADMIN' && scope?.role !== 'SUPER_ADMIN') {
        res.status(403).json({ error: 'Admin access required for analytics' });
        return;
      }
      res.json({ ok: true, analytics: guideService.getAnalytics() });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Failed to load analytics' });
    }
  });

  return router;
}
