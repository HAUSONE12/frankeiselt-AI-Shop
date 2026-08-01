import type { Cart, Collection, MenuItem, Product } from '../types';

export type AppLanguage = 'tr' | 'de' | 'en';

export type ContentDocument = {
  id: string;
  title: string;
  handle: string;
  body: string;
  url?: string;
  type?: 'privacyPolicy' | 'termsOfService' | 'refundPolicy' | 'shippingPolicy';
};

const API_BASE_URL = 'https://frankeiselt-api-663036738401.europe-west3.run.app';
const SHOP_URL = 'https://frankeiselt.de';

type PublicProductImageValue =
  | string
  | { src?: string | null; url?: string | null }
  | null
  | undefined;

type PublicProductPayload = {
  featured_image?: PublicProductImageValue;
  images?: PublicProductImageValue[];
  variants?: Array<{ featured_image?: PublicProductImageValue }>;
};

function normalizeRemoteImageUrl(input?: string | null): string | undefined {
  let value = input?.trim().replace(/&amp;/g, '&');
  if (!value) return undefined;

  if (value.startsWith('//')) {
    value = `https:${value}`;
  } else if (value.startsWith('/')) {
    value = `${SHOP_URL}${value}`;
  } else if (value.startsWith('http://')) {
    value = `https://${value.slice('http://'.length)}`;
  }

  return value;
}

function extractPublicImageUrl(value: PublicProductImageValue): string | undefined {
  if (typeof value === 'string') return normalizeRemoteImageUrl(value);
  if (!value || typeof value !== 'object') return undefined;
  return normalizeRemoteImageUrl(value.src ?? value.url);
}

type PublicProductImage = { url: string; altText: string | null };

const publicProductImageCache = new Map<
  string,
  Promise<PublicProductImage[]>
>();

async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function collectJsonLdImageValues(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    const url = normalizeRemoteImageUrl(value);
    if (url) output.push(url);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdImageValues(item, output));
    return;
  }

  if (!value || typeof value !== 'object') return;

  const record = value as Record<string, unknown>;
  const typeValue = record['@type'];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  const isProduct = types.some(
    (type) => typeof type === 'string' && type.toLocaleLowerCase('en-US') === 'product',
  );

  if (isProduct) {
    collectJsonLdImageValues(record.image, output);
  }

  if (record['@graph']) {
    collectJsonLdImageValues(record['@graph'], output);
  }
}

function extractStructuredProductImages(html: string): string[] {
  const candidates: string[] = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptPattern.exec(html)) !== null) {
    try {
      const payload = JSON.parse(
        match[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .trim(),
      ) as unknown;
      collectJsonLdImageValues(payload, candidates);
    } catch {
      // Ignore malformed third-party structured data blocks.
    }
  }

  return Array.from(new Set(candidates));
}

function extractGalleryProductImages(html: string): string[] {
  const candidates: string[] = [];
  const galleryStart = html.search(/<media-gallery\b/i);
  if (galleryStart < 0) return candidates;

  const galleryEnd = html.indexOf('</media-gallery>', galleryStart);
  const galleryHtml = html.slice(
    galleryStart,
    galleryEnd >= 0 ? galleryEnd + '</media-gallery>'.length : html.length,
  );
  const attributePattern = /\b(?:src|data-src|data-lazy-src|data-original)=["']([^"']+)["']/gi;
  const srcsetPattern = /\b(?:srcset|data-srcset)=["']([^"']+)["']/gi;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(galleryHtml)) !== null) {
    const url = normalizeRemoteImageUrl(match[1]);
    if (url) candidates.push(url);
  }

  while ((match = srcsetPattern.exec(galleryHtml)) !== null) {
    for (const entry of match[1].split(',')) {
      const rawUrl = entry.trim().split(/\s+/)[0];
      const url = normalizeRemoteImageUrl(rawUrl);
      if (url) candidates.push(url);
    }
  }

  return Array.from(new Set(candidates));
}

function extractImagesFromProductHtml(html: string): string[] {
  const structuredImages = extractStructuredProductImages(html);
  const galleryImages = extractGalleryProductImages(html);
  if (structuredImages.length > 0 || galleryImages.length > 0) {
    return Array.from(new Set([...structuredImages, ...galleryImages]));
  }

  const normalized = html
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&');
  const candidates: string[] = [];

  const addCandidate = (rawValue?: string | null) => {
    const url = normalizeRemoteImageUrl(rawValue);
    if (url) candidates.push(url);
  };

  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]+content=["']([^"']+)["'][^>]*>/gi,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image(?::src)?)["'][^>]*>/gi,
  ];

  for (const pattern of metaPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(normalized)) !== null) {
      addCandidate(match[1]);
    }
  }

  // Shopify themes commonly render the real product media directly in
  // <img src="//store-domain/cdn/shop/files/...">. These protocol-relative
  // URLs were not covered by the old Open Graph-only parser.
  const imageAttributePattern = /<(?:img|source)\b[^>]*\b(?:src|data-src|data-original|data-lazy-src)=["']([^"']+)["'][^>]*>/gi;
  let imageMatch: RegExpExecArray | null;
  while ((imageMatch = imageAttributePattern.exec(normalized)) !== null) {
    addCandidate(imageMatch[1]);
  }

  // Responsive Shopify images are also exposed through srcset. Add every
  // candidate; the first regular src normally contains the largest image.
  const srcsetPattern = /\b(?:srcset|data-srcset)=["']([^"']+)["']/gi;
  let srcsetMatch: RegExpExecArray | null;
  while ((srcsetMatch = srcsetPattern.exec(normalized)) !== null) {
    for (const entry of srcsetMatch[1].split(',')) {
      addCandidate(entry.trim().split(/\s+/)[0]);
    }
  }

  // Some themes place lazy product images in inline CSS instead of src.
  const cssUrlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
  let cssMatch: RegExpExecArray | null;
  while ((cssMatch = cssUrlPattern.exec(normalized)) !== null) {
    addCandidate(cssMatch[1]);
  }

  const normalizedCandidates = Array.from(new Set(candidates));
  const productMediaCandidates = normalizedCandidates.filter((url) => {
    const lower = url.toLocaleLowerCase('en-US');
    const isShopifyProductMedia =
      lower.includes('/cdn/shop/files/') ||
      lower.includes('cdn.shopify.com/s/files/');
    const looksLikeBrandAsset =
      lower.includes('/logo') ||
      lower.includes('logo.') ||
      lower.includes('/icon') ||
      lower.includes('favicon') ||
      lower.includes('hausone-logo') ||
      lower.includes('frankeiselt-logo') ||
      lower.includes('splash') ||
      lower.includes('placeholder');

    return isShopifyProductMedia && !looksLikeBrandAsset;
  });

  return productMediaCandidates.length > 0
    ? productMediaCandidates
    : normalizedCandidates.filter((url) => {
        const lower = url.toLocaleLowerCase('en-US');
        return !(
          lower.includes('/logo') ||
          lower.includes('logo.') ||
          lower.includes('/icon') ||
          lower.includes('favicon') ||
          lower.includes('splash') ||
          lower.includes('placeholder')
        );
      });
}

async function loadPublicProductImages(handle: string): Promise<PublicProductImage[]> {
  const encodedHandle = encodeURIComponent(handle);
  const candidates: string[] = [];

  try {
    const response = await fetchWithTimeout(
      `${SHOP_URL}/products/${encodedHandle}.js`,
      {
        headers: {
          Accept: 'application/json,text/plain,*/*',
          'Cache-Control': 'no-cache',
        },
      },
    );

    if (response.ok) {
      const payload = await response.json() as PublicProductPayload;
      candidates.push(
        ...[
          extractPublicImageUrl(payload.featured_image),
          ...(payload.images ?? []).map(extractPublicImageUrl),
          ...(payload.variants ?? []).map((variant) =>
            extractPublicImageUrl(variant.featured_image),
          ),
        ].filter((url): url is string => Boolean(url)),
      );
    }
  } catch {
    // The HTML/Open Graph fallback below is independent from the JSON endpoint.
  }

    try {
      const response = await fetchWithTimeout(
        `${SHOP_URL}/products/${encodedHandle}`,
        {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            'Cache-Control': 'no-cache',
          },
        },
      );

      if (response.ok) {
        candidates.push(...extractImagesFromProductHtml(await response.text()));
      }
    } catch {
      // Existing API and SKU candidates remain available.
    }

  return Array.from(new Set(candidates)).map((url) => ({
    url,
    altText: null,
  }));
}

async function getPublicProductImages(handle: string): Promise<PublicProductImage[]> {
  const cacheKey = handle.trim().toLocaleLowerCase('de-DE');
  const cached = publicProductImageCache.get(cacheKey);
  if (cached) return cached;

  const request = loadPublicProductImages(handle).then(
    (images) => {
      if (images.length === 0) publicProductImageCache.delete(cacheKey);
      return images;
    },
    (error) => {
      publicProductImageCache.delete(cacheKey);
      throw error;
    },
  );

  publicProductImageCache.set(cacheKey, request);
  return request;
}

function buildSkuImageCandidates(product: Product): PublicProductImage[] {
  const skus = Array.from(new Set(
    (product.variants ?? [])
      .map((variant) => variant.sku?.trim())
      .filter((sku): sku is string => Boolean(sku)),
  ));
  const extensions = ['png', 'jpg', 'jpeg', 'webp'];
  const urls: string[] = [];

  for (const sku of skus) {
    const encodedSku = encodeURIComponent(sku);
    for (const extension of extensions) {
      urls.push(`${SHOP_URL}/cdn/shop/files/${encodedSku}.${extension}`);
      urls.push(
        `https://cdn.shopify.com/s/files/1/0704/8780/2124/files/${encodedSku}.${extension}`,
      );
    }
  }

  return Array.from(new Set(urls)).map((url) => ({ url, altText: null }));
}

function mergeProductImages(
  product: Product,
  extraImages: Array<{ url: string; altText: string | null }>,
): Product {
  const candidates = [
    ...(product.imageUrl
      ? [{ url: product.imageUrl, altText: product.title }]
      : []),
    ...(product.images ?? []),
    ...(product.variants ?? [])
      .filter((variant) => Boolean(variant.imageUrl))
      .map((variant) => ({
        url: variant.imageUrl!,
        altText: product.title,
      })),
    ...extraImages,
  ]
    .map((image) => {
      const url = normalizeRemoteImageUrl(image.url);
      return url ? { ...image, url } : undefined;
    })
    .filter(
      (image): image is { url: string; altText?: string | null } => Boolean(image),
    );

  const images = Array.from(
    new Map(candidates.map((image) => [image.url, image])).values(),
  );

  return {
    ...product,
    imageUrl: images[0]?.url ?? normalizeRemoteImageUrl(product.imageUrl),
    images: images.length > 0 ? images : product.images,
  };
}

type ApiProduct = {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  images?: Array<{ url: string; altText: string | null }>;
  onlineStoreUrl?: string | null;
  seo?: { title: string | null; description: string | null };
  availableForSale: boolean;
  image: { url: string; altText: string | null } | null;
  price: { amount: string; currencyCode: string } | null;
  variantId: string | null;
  variants?: Array<{
    id: string;
    title: string;
    availableForSale: boolean;
    sku: string | null;
    price: { amount: string; currencyCode: string };
    compareAtPrice: { amount: string; currencyCode: string } | null;
    image: { url: string; altText: string | null } | null;
    selectedOptions: Array<{ name: string; value: string }>;
  }>;
};

type ApiCollection = {
  id: string;
  title: string;
  handle: string;
  description: string;
  image: { url: string; altText: string | null } | null;
};

type ApiMenuItem = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  resourceId: string | null;
  collection: {
    id: string;
    title: string;
    handle: string;
    image: { url: string; altText: string | null } | null;
  } | null;
  items: ApiMenuItem[];
};

type ChatResponse = {
  reply: string;
  products: ApiProduct[];
};

type SaleResponse = {
  collection: ApiCollection | null;
  products: ApiProduct[];
  connected: boolean;
};

type CollectionsResponse = {
  collections: ApiCollection[];
  connected: boolean;
};

type CollectionProductsResponse = {
  collection: ApiCollection | null;
  products: ApiProduct[];
  connected: boolean;
};

type MenuResponse = {
  items: ApiMenuItem[];
  connected: boolean;
  source?: string;
};

type AssistantResponse = {
  answer: string;
  products: ApiProduct[];
};

type CartResponse = {
  cart: Cart;
};

type ApiContentPage = {
  id: string;
  title: string;
  handle: string;
  body: string;
  bodySummary: string;
  onlineStoreUrl: string | null;
};

type ApiPolicy = {
  id: string;
  title: string;
  handle: string;
  body: string;
  url: string;
  type: 'privacyPolicy' | 'termsOfService' | 'refundPolicy' | 'shippingPolicy';
};

type ContentPagesResponse = {
  pages: ApiContentPage[];
  connected: boolean;
};

type ContentPageResponse = {
  page: ApiContentPage;
};

type PoliciesResponse = {
  policies: ApiPolicy[];
  connected: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `API request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

function mapProduct(product: ApiProduct): Product {
  const imageCandidates = [
    product.image,
    ...(product.images ?? []),
    ...(product.variants ?? []).map((variant) => variant.image),
  ]
    .map((image) => {
      const url = normalizeRemoteImageUrl(image?.url);
      return url ? { ...image, url } : undefined;
    })
    .filter(
      (image): image is { url: string; altText: string | null } => Boolean(image),
    );
  const images = Array.from(
    new Map(imageCandidates.map((image) => [image.url, image])).values(),
  );

  return {
    id: product.id,
    title: product.title,
    handle: product.handle,
    description: product.description,
    descriptionHtml: product.descriptionHtml,
    vendor: product.vendor,
    productType: product.productType,
    tags: product.tags,
    imageUrl: images[0]?.url,
    images: images.length > 0 ? images : undefined,
    onlineStoreUrl: product.onlineStoreUrl ?? undefined,
    seoTitle: product.seo?.title ?? undefined,
    seoDescription: product.seo?.description ?? undefined,
    price: product.price?.amount,
    currencyCode: product.price?.currencyCode,
    availableForSale: product.availableForSale,
    variantId: product.variantId ?? undefined,
    variants: (product.variants ?? []).map((variant) => ({
      id: variant.id,
      title: variant.title,
      availableForSale: variant.availableForSale,
      sku: variant.sku ?? undefined,
      price: variant.price.amount,
      currencyCode: variant.price.currencyCode,
      compareAtPrice: variant.compareAtPrice?.amount,
      imageUrl: normalizeRemoteImageUrl(variant.image?.url),
      selectedOptions: variant.selectedOptions ?? [],
    })),
  };
}

function mapCollection(collection: ApiCollection): Collection {
  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: collection.description,
    imageUrl: collection.image?.url,
  };
}

function mapMenuItem(item: ApiMenuItem): MenuItem {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    url: item.url ?? undefined,
    resourceId: item.resourceId ?? undefined,
    collection: item.collection
      ? {
          id: item.collection.id,
          title: item.collection.title,
          handle: item.collection.handle,
          imageUrl: item.collection.image?.url,
        }
      : undefined,
    items: (item.items ?? []).map(mapMenuItem),
  };
}

export async function sendChat(
  message: string,
  language: AppLanguage,
): Promise<{ reply: string; products: Product[] }> {
  const data = await request<ChatResponse>('/api/v1/chat', {
    method: 'POST',
    body: JSON.stringify({ message, language }),
  });

  return {
    reply: data.reply,
    products: data.products.map(mapProduct),
  };
}

export async function hydrateProductImages(product: Product): Promise<Product> {
  const publicImages = product.handle
    ? await getPublicProductImages(product.handle).catch(() => [])
    : [];
  const merged = mergeProductImages(product, publicImages);

  if (merged.imageUrl || (merged.images?.length ?? 0) > 0) {
    return merged;
  }

  return product;
}

export async function getProductByHandle(handle: string): Promise<Product> {
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

export async function getSaleProducts(limit = 9): Promise<Product[]> {
  const data = await request<SaleResponse>(`/api/v1/sale?limit=${limit}`);
  return data.products.map(mapProduct);
}

export async function getCollections(limit = 30): Promise<Collection[]> {
  const data = await request<CollectionsResponse>(`/api/v1/collections?limit=${limit}`);
  return data.collections.map(mapCollection);
}

export async function getMainMenu(): Promise<MenuItem[]> {
  const data = await request<MenuResponse>('/api/v1/menu?handle=main-menu');
  return data.items.map(mapMenuItem);
}

export async function getCollectionProducts(
  collectionId: string,
  collectionHandle?: string,
  limit = 50,
): Promise<{ collection?: Collection; products: Product[] }> {
  const path = collectionHandle
    ? `/api/v1/collection-products?handle=${encodeURIComponent(collectionHandle)}&limit=${limit}`
    : `/api/v1/collections/${encodeURIComponent(collectionId)}/products?limit=${limit}`;

  const data = await request<CollectionProductsResponse>(path);

  return {
    collection: data.collection ? mapCollection(data.collection) : undefined,
    products: data.products.map(mapProduct),
  };
}

export async function getContentPages(limit = 50): Promise<ContentDocument[]> {
  const data = await request<ContentPagesResponse>(`/api/v1/content/pages?limit=${limit}`);
  return data.pages.map((page) => ({
    id: page.id,
    title: page.title,
    handle: page.handle,
    body: page.body,
    url: page.onlineStoreUrl ?? undefined,
  }));
}

export async function getContentPage(handle: string): Promise<ContentDocument> {
  const data = await request<ContentPageResponse>(
    `/api/v1/content/pages/${encodeURIComponent(handle)}`,
  );
  return {
    id: data.page.id,
    title: data.page.title,
    handle: data.page.handle,
    body: data.page.body,
    url: data.page.onlineStoreUrl ?? undefined,
  };
}

export async function getShopPolicies(): Promise<ContentDocument[]> {
  const data = await request<PoliciesResponse>('/api/v1/content/policies');
  return data.policies.map((policy) => ({
    id: policy.id,
    title: policy.title,
    handle: policy.handle,
    body: policy.body,
    url: policy.url,
    type: policy.type,
  }));
}

export async function askProductAssistant(
  question: string,
  language: AppLanguage,
  productHandle?: string,
): Promise<{ answer: string; products: Product[] }> {
  const data = await request<AssistantResponse>('/api/v1/assistant', {
    method: 'POST',
    body: JSON.stringify({ question, language, productHandle }),
  });

  return {
    answer: data.answer,
    products: data.products.map(mapProduct),
  };
}

export async function addToCart(
  merchandiseId: string,
  cartId?: string,
  customerAccessToken?: string,
): Promise<Cart> {
  const data = await request<CartResponse>('/api/v1/cart/add', {
    method: 'POST',
    body: JSON.stringify({
      merchandiseId,
      cartId,
      quantity: 1,
      customerAccessToken,
    }),
  });

  return data.cart;
}

export async function setCartBuyerIdentity(
  cartId: string,
  customerAccessToken: string | null,
): Promise<Cart> {
  const data = await request<CartResponse>('/api/v1/cart/buyer-identity', {
    method: 'POST',
    body: JSON.stringify({ cartId, customerAccessToken }),
  });

  return data.cart;
}

export async function getCart(cartId: string): Promise<Cart> {
  const data = await request<CartResponse>('/api/v1/cart/get', {
    method: 'POST',
    body: JSON.stringify({ cartId }),
  });

  return data.cart;
}

export async function updateCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<Cart> {
  const data = await request<CartResponse>('/api/v1/cart/update', {
    method: 'POST',
    body: JSON.stringify({ cartId, lineId, quantity }),
  });

  return data.cart;
}

export async function removeCartLine(cartId: string, lineId: string): Promise<Cart> {
  const data = await request<CartResponse>('/api/v1/cart/remove', {
    method: 'POST',
    body: JSON.stringify({ cartId, lineId }),
  });

  return data.cart;
}


export async function requestAccountDeletion(
  customerAccessToken: string,
  language: AppLanguage,
): Promise<{ status: 'requested'; requestedAt: string }> {
  return request<{ status: 'requested'; requestedAt: string }>(
    '/api/v1/customer/deletion-request',
    {
      method: 'POST',
      headers: {
        Authorization: customerAccessToken,
      },
      body: JSON.stringify({ language }),
    },
  );
}
