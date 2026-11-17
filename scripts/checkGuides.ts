import fs from 'node:fs';
import path from 'node:path';
import { AUTHORED_GUIDES } from '../packages/core/src/guides/definitions.ts';
import { GuideDefSchema } from '../packages/core/src/guides/types.ts';

function collectSourceContents(dir: string): string {
  const parts: string[] = [];
  if (!fs.existsSync(dir)) return '';
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      parts.push(collectSourceContents(full));
    } else if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      parts.push(fs.readFileSync(full, 'utf8'));
    }
  }
  return parts.join('\n');
}

function hasGuideTargetInSource(guideId: string, sourceText: string): boolean {
  if (sourceText.includes(`"${guideId}"`) || sourceText.includes(`'${guideId}'`)) {
    return true;
  }
  // Handle dynamic login-role-${r} and login-demo-${r}-btn patterns
  if (guideId.startsWith('login-role-') && sourceText.includes('login-role-${')) {
    return true;
  }
  if (guideId.startsWith('login-demo-') && sourceText.includes('login-demo-${')) {
    return true;
  }
  return false;
}

/**
 * Guides Validator Script
 * Validates all registered guides against the Zod schema,
 * checks step ID uniqueness, instruction presence, and verifies every step target
 * exists as a data-guide-id in src/.
 */
function checkAllGuides() {
  console.log(`[GuidesCheck] Validating ${AUTHORED_GUIDES.length} authored guides...`);
  let errors = 0;

  const srcText = collectSourceContents(path.resolve(process.cwd(), 'src'));
  const guideIds = new Set<string>();
  let checkedTargets = 0;

  for (const guide of AUTHORED_GUIDES) {
    // 1. Zod schema validation
    const parsed = GuideDefSchema.safeParse(guide);
    if (!parsed.success) {
      console.error(`[GuidesCheck] Schema validation failed for guide "${guide.guideId}":`);
      for (const issue of parsed.error.issues) {
        console.error(`  - Path: ${issue.path.join('.')}: ${issue.message}`);
      }
      errors++;
      continue;
    }

    // 2. Guide ID uniqueness
    if (guideIds.has(guide.guideId)) {
      console.error(`[GuidesCheck] Duplicate guide ID found: "${guide.guideId}"`);
      errors++;
    }
    guideIds.add(guide.guideId);

    // 3. Step ID uniqueness, instructions & DOM data-guide-id existence in src/
    const stepIds = new Set<string>();
    for (const step of guide.steps) {
      if (stepIds.has(step.stepId)) {
        console.error(`[GuidesCheck] Duplicate step ID "${step.stepId}" in guide "${guide.guideId}"`);
        errors++;
      }
      stepIds.add(step.stepId);

      if (!step.instruction.en || step.instruction.en.trim().length === 0) {
        console.error(`[GuidesCheck] Missing English instruction in guide "${guide.guideId}" step "${step.stepId}"`);
        errors++;
      }

      if (step.target?.guideId) {
        checkedTargets++;
        if (!hasGuideTargetInSource(step.target.guideId, srcText)) {
          console.error(
            `[GuidesCheck] Missing DOM attribute data-guide-id="${step.target.guideId}" in src/ (referenced by ${guide.guideId}.${step.stepId})`
          );
          errors++;
        }
      }
    }
  }

  if (errors > 0) {
    console.error(`[GuidesCheck] FAILED: ${errors} error(s) found in guide registry.`);
    process.exit(1);
  }

  console.log(
    `[GuidesCheck] SUCCESS: All ${AUTHORED_GUIDES.length} guides and ${checkedTargets} DOM targets verified.`
  );
}

checkAllGuides();
