import type { ProductPageDetails, ProductSpecification } from '../types';

const SHOP_URL = 'https://frankeiselt.de';
const cache = new Map<string, Promise<ProductPageDetails>>();

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    ndash: '–', mdash: '—', euro: '€', bull: '•', check: '✓',
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (/^#x/i.test(entity)) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[entity.toLocaleLowerCase('en-US')] ?? match;
  });
}

function toLines(html: string): string[] {
  const text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(?:br|hr)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|div|section|article|li|h1|h2|h3|h4|h5|h6|summary|button|tr|td|th|ul|ol)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeEntities(text)
    .replace(/\u00a0/g, ' ')
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function norm(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE').replace(/[^a-z0-9]+/g, ' ').trim();
}

const headings = [
  'beschreibung', 'technische daten', 'spezifikationen', 'produktmerkmale',
  'pro und kontra', 'hersteller eu verantwortliche', 'hersteller',
  'produkt sicherheitshinweise', 'produkt und sicherheitshinweise',
  'ups premium versand kostenfrei', 'gls premium versand',
  'rechnungskauf fur firmenkunden sepa uberweisung',
  'zahlung auf rechnung fur geschaftskunden', 'versand und rucksendungen',
];

function isHeading(line: string): boolean {
  const value = norm(line);
  return headings.some((heading) => value === heading || value.startsWith(`${heading} `));
}

function first(lines: string[], patterns: RegExp[]): string | undefined {
  return lines.find((line) => patterns.some((pattern) => pattern.test(line)));
}

function section(lines: string[], patterns: RegExp[]): string[] {
  const blocks: string[][] = [];
  lines.forEach((line, index) => {
    if (!patterns.some((pattern) => pattern.test(line))) return;
    const block: string[] = [];
    for (let cursor = index + 1; cursor < lines.length && block.length < 35; cursor += 1) {
      if (isHeading(lines[cursor])) break;
      if (lines[cursor].length <= 600) block.push(lines[cursor]);
    }
    if (block.length) blocks.push(block);
  });
  return blocks.sort((a, b) => b.join(' ').length - a.join(' ').length)[0] ?? [];
}

function textBlock(lines: string[]): string | undefined {
  const value = Array.from(new Set(lines.filter((line) => !isHeading(line)))).join('\n').trim();
  return value || undefined;
}

function specifications(lines: string[]): ProductSpecification[] {
  const clean = lines
    .map((line) => line.replace(/^\s*[•+✓✔]\s*/, '').trim())
    .filter((line) => line && !isHeading(line));
  const output: ProductSpecification[] = [];

  for (let index = 0; index < clean.length; index += 1) {
    const line = clean[index];
    const colon = line.indexOf(':');
    if (colon > 0 && colon < line.length - 1) {
      output.push({ label: line.slice(0, colon).trim(), value: line.slice(colon + 1).trim() });
    } else if (clean[index + 1] && line.length <= 45) {
      output.push({ label: line.replace(/:$/, ''), value: clean[index + 1] });
      index += 1;
    }
  }

  return Array.from(
    new Map(output.map((item) => [`${item.label}:${item.value}`, item])).values(),
  ).slice(0, 16);
}

function features(lines: string[]): string[] {
  return Array.from(new Set(
    lines
      .map((line) => line.replace(/^\s*[•+✓✔-]\s*/, '').trim())
      .filter((line) => line && !isHeading(line)),
  )).slice(0, 16);
}

function exactPattern(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

function parse(html: string, sourceUrl: string): ProductPageDetails {
  const lines = toLines(html);
  const technicalLines = section(lines, [/^technische\s+daten$/i, /^spezifikationen$/i]);
  const featureLines = section(lines, [/^produktmerkmale$/i, /^pro\s+und\s+kontra$/i]);
  const manufacturerTitle = first(lines, [/^hersteller\s*\/\s*eu\s*verantwortliche$/i, /^hersteller$/i]);
  const safetyTitle = first(lines, [/^produkt\s*&\s*sicherheitshinweise$/i, /^produkt\s*-?\s*und\s*-?\s*sicherheitshinweise$/i]);
  const shippingTitle = first(lines, [/^(?:ups|gls|dhl).*versand/i]);
  const paymentTitle = first(lines, [/rechnungskauf\s+f[uü]r\s+firmenkunden/i, /zahlung\s+auf\s+rechnung\s+f[uü]r\s+gesch[aä]ftskunden/i]);
  const returnsTitle = first(lines, [/^versand\s+und\s+r[uü]cksendungen$/i]);
  const delivery = first(lines, [/lieferzeit\s*:/i, /lieferzeit\s+\d/i]);

  return {
    sourceUrl,
    availabilityBadge: first(lines, [/^rabatt\b/i, /letzter\s+vorrat/i, /nur\s+noch\s+\d+/i]),
    taxAndShippingText: first(lines, [/inkl\.\s*19%\s*ust/i, /zzgl\.\s*versand/i]),
    deliveryTime: delivery?.replace(/^.*?lieferzeit\s*:?\s*/i, '').trim() || delivery,
    pickupText: first(lines, [/kostenlose\s+abholung/i]),
    selfPickupText: first(lines, [/selbstabholung\s+m[oö]glich/i]),
    technicalData: specifications(technicalLines),
    productFeatures: features(featureLines),
    manufacturerTitle: manufacturerTitle ?? 'Hersteller/EU Verantwortliche',
    manufacturerText: textBlock(section(lines, [/^hersteller\s*\/\s*eu\s*verantwortliche$/i, /^hersteller$/i])),
    safetyTitle: safetyTitle ?? 'Produkt- & Sicherheitshinweise',
    safetyText: textBlock(section(lines, [/^produkt\s*&\s*sicherheitshinweise$/i, /^produkt\s*-?\s*und\s*-?\s*sicherheitshinweise$/i])),
    shippingTitle,
    shippingText: shippingTitle ? textBlock(section(lines, [exactPattern(shippingTitle)])) : undefined,
    paymentTitle,
    paymentText: paymentTitle ? textBlock(section(lines, [exactPattern(paymentTitle)])) : undefined,
    returnsTitle,
    returnsText: returnsTitle ? textBlock(section(lines, [exactPattern(returnsTitle)])) : undefined,
  };
}

async function load(handle: string): Promise<ProductPageDetails> {
  const sourceUrl = `${SHOP_URL}/products/${encodeURIComponent(handle)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(sourceUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'Cache-Control': 'no-cache',
      },
    });
    return response.ok ? parse(await response.text(), sourceUrl) : { sourceUrl };
  } catch {
    return { sourceUrl };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getProductPageDetails(handle: string): Promise<ProductPageDetails> {
  const key = handle.trim().toLocaleLowerCase('de-DE');
  const existing = cache.get(key);
  if (existing) return existing;

  const request = load(handle);
  cache.set(key, request);
  return request;
}
