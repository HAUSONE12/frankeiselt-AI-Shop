from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"
TYPES = MOBILE / "src/types.ts"
CLIENT = MOBILE / "src/api/client.ts"
HOME = MOBILE / "src/screens/HomeScreenV2.tsx"
DETAILS = MOBILE / "src/services/productPageDetails.ts"

DETAILS_SOURCE = r'''import type { ProductPageDetails, ProductSpecification } from '../types';

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
'''

TYPE_SOURCE = r'''export type ProductSpecification = {
  label: string;
  value: string;
};

export type ProductPageDetails = {
  sourceUrl?: string;
  availabilityBadge?: string;
  taxAndShippingText?: string;
  deliveryTime?: string;
  pickupText?: string;
  selfPickupText?: string;
  technicalData?: ProductSpecification[];
  productFeatures?: string[];
  manufacturerTitle?: string;
  manufacturerText?: string;
  safetyTitle?: string;
  safetyText?: string;
  shippingTitle?: string;
  shippingText?: string;
  paymentTitle?: string;
  paymentText?: string;
  returnsTitle?: string;
  returnsText?: string;
};

'''

HELPER = r'''  function togglePublicDetail(key: string) {
    setOpenPublicDetailSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function renderPublicAccordion(
    key: string,
    title?: string,
    body?: string,
    icon = '＋',
  ) {
    if (!title || !body?.trim()) return null;
    const open = Boolean(openPublicDetailSections[key]);

    return (
      <View style={styles.publicDetailAccordion}>
        <Pressable
          onPress={() => togglePublicDetail(key)}
          style={styles.publicDetailAccordionHeader}
        >
          <Text style={styles.publicDetailAccordionIcon}>{icon}</Text>
          <Text style={styles.publicDetailAccordionTitle}>{title}</Text>
          <Text style={styles.publicDetailAccordionChevron}>
            {open ? '−' : '+'}
          </Text>
        </Pressable>
        {open ? (
          <Text style={styles.publicDetailAccordionBody}>{body}</Text>
        ) : null}
      </View>
    );
  }

  function renderPublicProductDetails(
    product: Product,
    selectedVariant?: NonNullable<Product['variants']>[number],
  ) {
    const details = product.pageDetails;
    if (!details) return null;

    const url = product.onlineStoreUrl
      ?? details.sourceUrl
      ?? (product.handle ? `${SHOP_URL}/products/${product.handle}` : SHOP_URL);
    const compareAtPrice = selectedVariant?.compareAtPrice;
    const currency = selectedVariant?.currencyCode ?? product.currencyCode ?? 'EUR';

    return (
      <View style={styles.publicDetailWrap}>
        <View style={styles.publicDetailTopRow}>
          {details.availabilityBadge ? (
            <View style={styles.publicDetailBadge}>
              <Text style={styles.publicDetailBadgeText}>
                {details.availabilityBadge}
              </Text>
            </View>
          ) : <View />}

          <Pressable
            onPress={() => void Share.share({
              title: product.title,
              message: `${product.title}\n${url}`,
              url,
            })}
            style={styles.publicDetailShareButton}
          >
            <Text style={styles.publicDetailShareText}>↗ Teilen</Text>
          </Pressable>
        </View>

        {compareAtPrice && compareAtPrice !== selectedVariant?.price ? (
          <Text style={styles.publicDetailComparePrice}>
            Statt {compareAtPrice} {currency}
          </Text>
        ) : null}

        <Text style={styles.publicDetailTax}>
          {details.taxAndShippingText ?? 'inkl. 19% USt. zzgl. Versandkosten'}
        </Text>

        {details.deliveryTime ? (
          <Text style={styles.publicDetailService}>
            ✓ Lieferzeit: {details.deliveryTime}
          </Text>
        ) : null}
        {details.selfPickupText ? (
          <Text style={styles.publicDetailService}>✓ {details.selfPickupText}</Text>
        ) : null}
        {details.pickupText ? (
          <Text style={styles.publicDetailPickup}>⌖ {details.pickupText}</Text>
        ) : null}

        <View style={styles.publicDetailAccordionGroup}>
          {renderPublicAccordion('shipping', details.shippingTitle, details.shippingText, '▰')}
          {renderPublicAccordion('payment', details.paymentTitle, details.paymentText, '▣')}
          {renderPublicAccordion('returns', details.returnsTitle, details.returnsText, '⇄')}
        </View>

        {details.technicalData?.length ? (
          <View style={styles.publicDetailSection}>
            <Text style={styles.productDetailSectionTitle}>Technische Daten</Text>
            {details.technicalData.map((item, index) => (
              <View key={`${item.label}-${index}`} style={styles.publicDetailSpecRow}>
                <Text style={styles.publicDetailSpecLabel}>{item.label}</Text>
                <Text style={styles.publicDetailSpecValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {details.productFeatures?.length ? (
          <View style={styles.publicDetailSection}>
            <Text style={styles.productDetailSectionTitle}>Produktmerkmale</Text>
            {details.productFeatures.map((item, index) => (
              <Text key={`feature-${index}`} style={styles.publicDetailFeature}>
                ⊕ {item}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.publicDetailAccordionGroup}>
          {renderPublicAccordion(
            'manufacturer',
            details.manufacturerTitle,
            details.manufacturerText ?? product.vendor,
            '♙',
          )}
          {renderPublicAccordion(
            'safety',
            details.safetyTitle,
            details.safetyText,
            '♢',
          )}
        </View>
      </View>
    );
  }

'''

HEADER = r'''  function renderHeader() {
    return (
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zur Startseite"
          onPress={() => setActiveTab('home')}
          hitSlop={8}
          style={styles.brandButton}
        >
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <Text style={styles.brand}>Frank Eiselt</Text>
        </Pressable>
      </View>
    );
  }
'''

STYLES = r'''  brandButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  publicDetailWrap: { marginTop: 18 },
  publicDetailTopRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  publicDetailBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#E53B3B',
  },
  publicDetailBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  publicDetailShareButton: { paddingHorizontal: 8, paddingVertical: 6 },
  publicDetailShareText: { color: '#007ABB', fontSize: 12, fontWeight: '800' },
  publicDetailComparePrice: {
    color: '#7D8991',
    fontSize: 12,
    marginTop: 8,
    textDecorationLine: 'line-through',
  },
  publicDetailTax: {
    color: '#71818A',
    fontSize: 10,
    marginTop: 5,
    marginBottom: 10,
    textDecorationLine: 'underline',
  },
  publicDetailService: {
    color: '#278B56',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  publicDetailPickup: {
    color: '#314852',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  publicDetailAccordionGroup: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#DDE5E9',
  },
  publicDetailAccordion: {
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5E9',
  },
  publicDetailAccordionHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  publicDetailAccordionIcon: {
    width: 27,
    color: '#007ABB',
    fontSize: 16,
    textAlign: 'center',
  },
  publicDetailAccordionTitle: {
    flex: 1,
    color: '#12262F',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    paddingHorizontal: 7,
  },
  publicDetailAccordionChevron: {
    width: 25,
    color: '#12262F',
    fontSize: 20,
    textAlign: 'center',
  },
  publicDetailAccordionBody: {
    color: '#526873',
    fontSize: 12,
    lineHeight: 19,
    paddingLeft: 34,
    paddingRight: 18,
    paddingBottom: 14,
  },
  publicDetailSection: { marginTop: 18 },
  publicDetailSpecRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5E9',
    backgroundColor: '#F8FAFB',
  },
  publicDetailSpecLabel: { width: '42%', color: '#647680', fontSize: 12 },
  publicDetailSpecValue: {
    flex: 1,
    color: '#12262F',
    fontSize: 12,
    fontWeight: '800',
  },
  publicDetailFeature: {
    color: '#278B56',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
  },
'''


def once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Beklenen kod bulunamadi: {label}")
    return text.replace(old, new, 1)


def patch_types() -> None:
    text = TYPES.read_text(encoding="utf-8")
    if "export type ProductPageDetails" not in text:
        text = once(
            text,
            "export type Product = {",
            TYPE_SOURCE + "export type Product = {",
            "types",
        )
    if "pageDetails?: ProductPageDetails;" not in text:
        text = once(
            text,
            "  variants?: ProductVariant[];\n};",
            "  variants?: ProductVariant[];\n  pageDetails?: ProductPageDetails;\n};",
            "product field",
        )
    TYPES.write_text(text, encoding="utf-8")


def patch_client() -> None:
    text = CLIENT.read_text(encoding="utf-8")
    if "import { getProductPageDetails }" not in text:
        text = once(
            text,
            "import type { Cart, Collection, MenuItem, Product } from '../types';\n",
            "import type { Cart, Collection, MenuItem, Product } from '../types';\n"
            "import { getProductPageDetails } from '../services/productPageDetails';\n",
            "client import",
        )

    old = '''export async function getProductByHandle(handle: string): Promise<Product> {
  const [apiResult, publicImages] = await Promise.all([
    request<{ product: ApiProduct }>(
      `/api/v1/products/${encodeURIComponent(handle)}`,
    ),
    getPublicProductImages(handle).catch(() => []),
  ]);
  const product = mapProduct(apiResult.product);
  const merged = mergeProductImages(product, publicImages);

  if (merged.imageUrl || (merged.images?.length ?? 0) > 0) {
    return merged;
  }

  return product;
}
'''
    new = '''export async function getProductByHandle(handle: string): Promise<Product> {
  const [apiResult, publicImages, pageDetails] = await Promise.all([
    request<{ product: ApiProduct }>(
      `/api/v1/products/${encodeURIComponent(handle)}`,
    ),
    getPublicProductImages(handle).catch(() => []),
    getProductPageDetails(handle).catch(() => ({})),
  ]);
  const product = mapProduct(apiResult.product);
  const merged = mergeProductImages(product, publicImages);
  return { ...merged, pageDetails };
}
'''

    if old in text:
        text = text.replace(old, new, 1)
    elif "pageDetails] = await Promise.all" not in text:
        raise RuntimeError("getProductByHandle bulunamadi")

    CLIENT.write_text(text, encoding="utf-8")


def patch_home() -> None:
    text = HOME.read_text(encoding="utf-8")

    if "  Share,\n" not in text:
        text = once(
            text,
            "  ScrollView,\n  StyleSheet,",
            "  ScrollView,\n  Share,\n  StyleSheet,",
            "Share import",
        )

    if "openPublicDetailSections" not in text:
        text = once(
            text,
            "  const [loadingProductDetails, setLoadingProductDetails] = useState(false);",
            "  const [loadingProductDetails, setLoadingProductDetails] = useState(false);\n"
            "  const [openPublicDetailSections, setOpenPublicDetailSections] = "
            "useState<Record<string, boolean>>({});",
            "detail state",
        )

    if "setOpenPublicDetailSections({});" not in text:
        text = once(
            text,
            "    setSelectedVariantId(defaultVariant?.id ?? product.variantId);",
            "    setSelectedVariantId(defaultVariant?.id ?? product.variantId);\n"
            "    setOpenPublicDetailSections({});",
            "detail reset",
        )

    if "function renderPublicProductDetails" not in text:
        text = once(
            text,
            "  function renderHeader() {",
            HELPER + "  function renderHeader() {",
            "detail helper",
        )

    start = text.index("  function renderHeader() {")
    end = text.index("\n  function renderSearchBox()", start)
    text = text[:start] + HEADER.rstrip() + text[end:]

    call = "          {renderPublicProductDetails(product, selectedVariant)}\n\n"
    if call.strip() not in text:
        text = once(
            text,
            "          <Text style={styles.productDetailSectionTitle}>Produktinformationen</Text>",
            call + "          <Text style={styles.productDetailSectionTitle}>Produktinformationen</Text>",
            "detail render call",
        )

    old_header_styles = (
        "  header: { minHeight: 58, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },\n"
        "  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },\n"
        "  logo: { width: 42, height: 42, resizeMode: 'contain', marginRight: 8 },\n"
        "  brand: { color: '#12262F', fontSize: 25, fontWeight: '900', textAlign: 'center' },"
    )
    new_header_styles = (
        "  header: { minHeight: 98, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },\n"
        "  brandRow: { alignItems: 'center', justifyContent: 'center' },\n"
        "  logo: { width: 78, height: 58, resizeMode: 'contain' },\n"
        "  brand: { color: '#12262F', fontSize: 19, fontWeight: '900', textAlign: 'center', marginTop: 2 },"
    )
    if old_header_styles in text:
        text = text.replace(old_header_styles, new_header_styles, 1)
    elif "  brandButton:" not in text:
        raise RuntimeError("Frank Eiselt header stilleri bulunamadi")

    if "  brandButton:" not in text:
        text = once(
            text,
            "  brandAccent: { color: '#007ABB' },",
            STYLES + "  brandAccent: { color: '#007ABB' },",
            "styles",
        )

    HOME.write_text(text, encoding="utf-8")


def main() -> None:
    for path in (TYPES, CLIENT, HOME):
        if not path.exists():
            raise SystemExit(f"Dosya bulunamadi: {path}")

    DETAILS.parent.mkdir(parents=True, exist_ok=True)
    DETAILS.write_text(DETAILS_SOURCE, encoding="utf-8")
    patch_types()
    patch_client()
    patch_home()

    print("Frank Eiselt urun detay alanlari ve tiklanabilir dikey logo uygulandi.")
    print("Calistir: cd mobile && npm run verify")


if __name__ == "__main__":
    main()
