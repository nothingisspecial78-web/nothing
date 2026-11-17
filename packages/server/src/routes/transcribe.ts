import { Router, type Response } from 'express';
import { GoogleGenAI } from '@google/genai';
import multer from 'multer';
import type { AuthedRequest } from '../auth.ts';
import { logger, type ServerConfig } from '../config.ts';
import { checkAndConsume } from '../billing/checkAndConsume.ts';
import type { OrgCreditStore } from '../billing/creditStore.ts';
import { extractAccessScope } from '../security/scope.ts';

export function createTranscribeRouter(params: {
  cfg: ServerConfig;
  creditStore?: OrgCreditStore;
}): Router {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  });

  router.post(
    '/',
    upload.single('audio'),
    async (req: AuthedRequest, res: Response): Promise<void> => {
      let consumedOrgId: string | null = null;
      let consumptionId: string | undefined;

      try {
        const scope = await extractAccessScope(req, params.cfg, { defaultUnauthenticatedRole: 'PUBLIC' });
        if (scope.role === 'PUBLIC') {
          res.status(403).json({
            error: 'Please sign in or create an organization to use voice transcription.',
            errorCode: 'AUTH_REQUIRED',
          });
          return;
        }
        if (params.creditStore) {
          const orgId =
            'organizationId' in scope && scope.organizationId ? scope.organizationId : 'demo';
          const gate = await checkAndConsume(
            params.creditStore,
            orgId,
            scope.userId,
            scope.role,
            'voice'
          );
          if (!gate.allowed) {
            res.status(gate.errorCode === 'UPGRADE_REQUIRED' ? 403 : 402).json({
              error: gate.message,
              errorCode: gate.errorCode,
              plan: gate.plan,
              creditsRemaining: gate.creditsRemaining,
              creditsMonthlyAllowance: gate.creditsMonthlyAllowance,
              resetDate: gate.resetDate,
            });
            return;
          }
          consumedOrgId = orgId;
          consumptionId = gate.consumptionId;
        }

        let audioBuffer: Buffer | null = null;
        let mimeType = 'audio/webm';
        const language =
          typeof req.body?.language === 'string' && req.body.language ? req.body.language : undefined;

        if (req.file && req.file.buffer && req.file.buffer.length > 0) {
          audioBuffer = req.file.buffer;
          mimeType = req.file.mimetype || 'audio/webm';
        } else if (typeof req.body?.audioBase64 === 'string' && req.body.audioBase64.trim()) {
          const raw = req.body.audioBase64.trim();
          const dataMatch = /^data:([^;]+);base64,(.+)$/.exec(raw);
          if (dataMatch) {
            mimeType = dataMatch[1] || mimeType;
            audioBuffer = Buffer.from(dataMatch[2], 'base64');
          } else {
            audioBuffer = Buffer.from(raw, 'base64');
            if (typeof req.body?.mimeType === 'string' && req.body.mimeType) {
              mimeType = req.body.mimeType;
            }
          }
        }

        if (!audioBuffer || audioBuffer.length === 0) {
          if (params.creditStore && consumedOrgId && consumptionId) {
            await params.creditStore.refundConsumption(consumedOrgId, consumptionId, 'Missing audio payload');
          }
          res.status(400).json({ error: 'Missing audio payload for transcription.' });
          return;
        }

        // 1. Gemini audio transcription via @google/genai
        if (params.cfg.geminiApiKey) {
          try {
            const ai = new GoogleGenAI({
              apiKey: params.cfg.geminiApiKey,
              httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
            });
            const prompt =
              language === 'ml'
                ? 'Transcribe the spoken audio accurately (Malayalam or English). Return only the transcript text.'
                : 'Transcribe the spoken audio accurately in its original language (English or Malayalam). Return only the transcript text.';

            const response = await ai.models.generateContent({
              model: 'gemini-4-hydrogen',
              contents: [
                {
                  role: 'user',
                  parts: [
                    { text: prompt },
                    {
                      inlineData: {
                        mimeType,
                        data: audioBuffer.toString('base64'),
                      },
                    },
                  ],
                },
              ],
            });
            const text = (response.text || '').trim();
            if (text) {
              res.json({ text, provider: 'gemini:gemini-4-hydrogen' });
              return;
            }
          } catch (err) {
            logger.warn({ err }, 'Gemini audio transcription failed; trying Groq Whisper fallback');
          }
        }

        // 2. Groq Whisper fallback (whisper-large-v3-turbo)
        if (params.cfg.groqApiKey) {
          try {
            const ext = mimeType.includes('mp4')
              ? 'mp4'
              : mimeType.includes('wav')
                ? 'wav'
                : mimeType.includes('ogg')
                  ? 'ogg'
                  : 'webm';
            const form = new FormData();
            form.append('model', 'whisper-large-v3-turbo');
            form.append(
              'file',
              new Blob([new Uint8Array(audioBuffer)], { type: mimeType }),
              `voice.${ext}`
            );
            if (language === 'en' || language === 'ml') {
              form.append('language', language);
            }

            const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${params.cfg.groqApiKey}`,
              },
              body: form,
            });
            if (groqRes.ok) {
              const json = (await groqRes.json()) as { text?: string };
              const text = (json.text || '').trim();
              if (text) {
                res.json({ text, provider: 'groq:whisper-large-v3-turbo' });
                return;
              }
            }
          } catch (err) {
            logger.warn({ err }, 'Groq audio transcription fallback failed');
          }
        }

        if (params.creditStore && consumedOrgId && consumptionId) {
          await params.creditStore.refundConsumption(consumedOrgId, consumptionId, 'Transcription unavailable');
        }
        res.status(503).json({
          error:
            'Voice transcription is unavailable because neither Gemini nor Groq audio transcription succeeded.',
        });
      } catch (err) {
        if (params.creditStore && consumedOrgId && consumptionId) {
          await params.creditStore.refundConsumption(
            consumedOrgId,
            consumptionId,
            err instanceof Error ? err.message : 'Transcription error'
          );
        }
        logger.error({ err }, 'Unexpected error in /api/transcribe');
        res.status(500).json({ error: 'Audio transcription error.' });
      }
    }
  );

  return router;
}
