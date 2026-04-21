import crypto from 'node:crypto';
import type { Page } from 'playwright';

const MIN_BODY_LEN = 200;

export type ExtractionResult = { text: string; htmlHash: string };

export type BodyExtractor = ReturnType<typeof makeBodyExtractor>;

export function makeBodyExtractor() {
  async function extract(page: Page): Promise<ExtractionResult | null> {
    const html = await page.content();
    const htmlHash = crypto.createHash('sha256').update(html).digest('hex');
    const title = (await page.title()).trim();

    // Priority 1–3: named semantic selectors.
    for (const sel of ['[itemprop="articleBody"]', 'article', 'main'] as const) {
      const el = await page.$(sel);
      if (!el) continue;
      const text = (await el.innerText()).trim();
      if (isAcceptable(text, title)) return { text, htmlHash };
    }

    // Priority 4: largest <p>-cluster fallback (browser-side evaluation).
    const fallback = await page.evaluate(largestTextBlockEval);
    if (fallback && isAcceptable(fallback, title)) return { text: fallback, htmlHash };

    return null;
  }

  return { extract };
}

function isAcceptable(text: string, title: string): boolean {
  return text.length >= MIN_BODY_LEN && !title.includes(text);
}

// Runs inside the browser context — no external imports allowed.
// DOM globals are available at runtime; cast via globalThis to satisfy node tsconfig.
function largestTextBlockEval(): string {
  const doc: any = (globalThis as any).document;
  const paras: any[] = Array.from(doc.querySelectorAll('p'));
  const groups = new Map<object, string[]>();

  for (const p of paras) {
    let ancestor = p;
    for (let i = 0; i < 3; i++) {
      if (ancestor.parentElement) ancestor = ancestor.parentElement;
    }
    const texts: string[] = groups.get(ancestor) ?? [];
    texts.push((p.innerText as string).trim());
    groups.set(ancestor, texts);
  }

  let bestText = '';
  let bestLen = 0;
  for (const texts of groups.values()) {
    const joined = texts.filter(Boolean).join(' ');
    if (joined.length > bestLen) {
      bestLen = joined.length;
      bestText = joined;
    }
  }
  return bestText;
}
