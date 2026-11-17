import { DEFAULT_CHUNK_OVERLAP_TOKENS, DEFAULT_CHUNK_TOKENS } from '../../constants.ts';
import type { DocumentChunk } from '../../schemas.ts';

export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return Math.max(1, Math.ceil(words.length * 1.3));
}

interface MarkdownSection {
  heading: string;
  body: string;
}

function splitByHeadings(markdown: string): MarkdownSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  const headingStack: string[] = [];
  let currentLines: string[] = [];

  const flush = () => {
    const body = currentLines.join('\n').trim();
    if (body.length > 0) {
      sections.push({
        heading: headingStack.length > 0 ? headingStack.join(' > ') : 'Introduction',
        body,
      });
    }
    currentLines = [];
  };

  for (const line of lines) {
    const match = /^(#{1,4})\s+(.+)$/.exec(line.trim());
    if (match) {
      flush();
      const level = match[1].length;
      const title = match[2].trim();
      headingStack.splice(level - 1);
      headingStack[level - 1] = title;
      currentLines.push(line);
    } else {
      currentLines.push(line);
    }
  }
  flush();

  return sections;
}

function inferVisibility(source: string, heading: string, text: string): 'all' | 'manager' | 'admin' {
  const lower = `${source} ${heading} ${text.slice(0, 300)}`.toLowerCase();
  if (
    lower.includes('visibility: admin') ||
    lower.includes('admin sop') ||
    lower.includes('staff guidelines') ||
    lower.includes('confidential admin') ||
    lower.includes('super admin only')
  ) {
    return 'admin';
  }
  if (
    lower.includes('visibility: manager') ||
    lower.includes('manager guide') ||
    lower.includes('manager only')
  ) {
    return 'manager';
  }
  return 'all';
}

export function chunkMarkdown(params: {
  appId: string;
  source: string;
  markdown: string;
  maxTokens?: number;
  overlapTokens?: number;
  visibility?: 'all' | 'manager' | 'admin';
}): DocumentChunk[] {
  const maxTokens = params.maxTokens ?? DEFAULT_CHUNK_TOKENS;
  const overlapTokens = params.overlapTokens ?? DEFAULT_CHUNK_OVERLAP_TOKENS;
  const sections = splitByHeadings(params.markdown);
  const chunks: DocumentChunk[] = [];
  let chunkIndex = 0;

  for (const section of sections) {
    const sectionTokens = estimateTokens(section.body);
    const vis = params.visibility || inferVisibility(params.source, section.heading, section.body);
    if (sectionTokens <= maxTokens) {
      chunks.push({
        id: `${params.appId}::${params.source}::${chunkIndex}`,
        appId: params.appId,
        source: params.source,
        heading: section.heading,
        chunkIndex,
        content: section.body,
        tokenCount: sectionTokens,
        visibility: vis,
      });
      chunkIndex += 1;
      continue;
    }

    const words = section.body.split(/\s+/).filter(Boolean);
    const maxWords = Math.max(40, Math.floor(maxTokens / 1.3));
    const overlapWords = Math.min(Math.floor(overlapTokens / 1.3), Math.floor(maxWords / 2));
    const step = Math.max(20, maxWords - overlapWords);

    for (let start = 0; start < words.length; start += step) {
      const slice = words.slice(start, start + maxWords);
      if (slice.length === 0) break;
      const content = slice.join(' ');
      chunks.push({
        id: `${params.appId}::${params.source}::${chunkIndex}`,
        appId: params.appId,
        source: params.source,
        heading: section.heading,
        chunkIndex,
        content,
        tokenCount: estimateTokens(content),
        visibility: vis,
      });
      chunkIndex += 1;
      if (start + maxWords >= words.length) break;
    }
  }

  return chunks;
}
