import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AppProfileSchema,
  EvalSuiteSchema,
  SheetTemplateSchema,
  type AppProfile,
  type EvalSuite,
  type SheetTemplate,
} from '@ai-assistant/core';
import { logger } from '../config.ts';

export interface LoadedDoc {
  source: string;
  content: string;
}

export interface LoadedProfileBundle {
  profile: AppProfile;
  docs: LoadedDoc[];
  templates: Map<string, SheetTemplate>;
  evalSuite?: EvalSuite;
}

export class ProfileRegistry {
  private readonly bundles = new Map<string, LoadedProfileBundle>();

  async loadAll(profilesDir: string): Promise<void> {
    this.bundles.clear();
    let entries: string[];
    try {
      const dirents = await fs.readdir(profilesDir, { withFileTypes: true });
      entries = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
    } catch (err) {
      logger.warn({ profilesDir, err }, 'Could not read profiles directory');
      return;
    }

    for (const folder of entries) {
      const folderPath = path.join(profilesDir, folder);
      const profilePath = path.join(folderPath, 'profile.json');
      try {
        const rawProfile = await fs.readFile(profilePath, 'utf8');
        const profile = AppProfileSchema.parse(JSON.parse(rawProfile));

        const docs: LoadedDoc[] = [];
        const docsDir = path.join(folderPath, 'docs');
        try {
          const docFiles = (await fs.readdir(docsDir)).filter((f) => f.endsWith('.md')).sort();
          for (const docFile of docFiles) {
            const content = await fs.readFile(path.join(docsDir, docFile), 'utf8');
            docs.push({ source: docFile, content });
          }
        } catch {
          // docs folder optional if none yet
        }

        const templates = new Map<string, SheetTemplate>();
        const templatesDir = path.join(folderPath, 'templates');
        try {
          const tplFiles = (await fs.readdir(templatesDir)).filter((f) => f.endsWith('.json')).sort();
          for (const tplFile of tplFiles) {
            const rawTpl = await fs.readFile(path.join(templatesDir, tplFile), 'utf8');
            const parsedTpl = SheetTemplateSchema.parse(JSON.parse(rawTpl));
            templates.set(parsedTpl.templateId, parsedTpl);
          }
        } catch {
          // templates folder optional
        }

        let evalSuite: EvalSuite | undefined;
        const evalPath = path.join(folderPath, 'eval.json');
        try {
          const rawEval = await fs.readFile(evalPath, 'utf8');
          evalSuite = EvalSuiteSchema.parse(JSON.parse(rawEval));
        } catch {
          // eval.json optional
        }

        this.bundles.set(profile.appId, {
          profile,
          docs,
          templates,
          evalSuite,
        });
        logger.info(
          { appId: profile.appId, docsCount: docs.length, templatesCount: templates.size },
          'Loaded app profile'
        );
      } catch (err) {
        logger.error({ folder, err }, 'Failed to load app profile');
      }
    }
  }

  getBundle(appId: string): LoadedProfileBundle | undefined {
    return this.bundles.get(appId);
  }

  getProfile(appId: string): AppProfile | undefined {
    return this.bundles.get(appId)?.profile;
  }

  listProfiles(): AppProfile[] {
    return Array.from(this.bundles.values()).map((b) => b.profile);
  }

  getDocs(appId: string): LoadedDoc[] {
    return this.bundles.get(appId)?.docs || [];
  }

  getTemplate(appId: string, templateId?: string): SheetTemplate | undefined {
    const bundle = this.bundles.get(appId);
    if (!bundle) return undefined;
    if (templateId) return bundle.templates.get(templateId);
    return bundle.templates.values().next().value;
  }

  getTemplates(appId: string): SheetTemplate[] {
    const bundle = this.bundles.get(appId);
    return bundle ? Array.from(bundle.templates.values()) : [];
  }

  getEvalSuite(appId: string): EvalSuite | undefined {
    return this.bundles.get(appId)?.evalSuite;
  }
}
