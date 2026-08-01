import { Router } from 'express';
import { env } from '../config/env.js';
import { z } from 'zod';
import {
  addCartLine,
  createCart,
  getCart,
  getCollectionProducts,
  getCollectionProductsByHandle,
  getCollections,
  getContentPage,
  getContentPages,
  getMenu,
  getProductByHandle,
  getShopPolicies,
  removeCartLine,
  searchProducts,
  shopifyConnected,
  updateCartBuyerIdentity,
  updateCartLine,
} from '../services/shopify.js';
import {
  translateProductSearchToGerman,
  type SearchLanguage,
} from '../services/translator.js';
import {
  answerProductQuestion,
  type AssistantLanguage,
} from '../services/product-assistant.js';

export const apiRouter = Router();

const SALE_COLLECTION_ID = env.SHOPIFY_SALE_COLLECTION_ID;
type SupportedLanguage = 'tr' | 'de' | 'en';

const SEARCH_STOP_WORDS = new Set([
  'bana', 'bir', 'bu', 'goster', 'göster', 'gosterin', 'gösterin', 'bul', 'bulun',
  'urun', 'ürün', 'urunleri', 'ürünleri', 'lutfen', 'lütfen', 'istiyorum', 'gibi', 'ile', 've',
  'the', 'show', 'find', 'please', 'product', 'products',
  'zeige', 'zeigen', 'finden', 'bitte', 'produkt', 'produkte', 'mir',
]);

const replies: Record<SupportedLanguage, { found: (count: number) => string; empty: string; disconnected: string }> = {
  tr: {
    found: (count) => `${count} uygun ürün bulundu.`,
    empty: 'Bu aramaya uygun ürün bulunamadı.',
    disconnected: 'Shopify bağlantısı yapılandırılmamış.',
  },
  de: {
    found: (count) => `${count} passende Produkte gefunden.`,
    empty: 'Für diese Suche wurden keine passenden Produkte gefunden.',
    disconnected: 'Die Shopify-Verbindung ist nicht konfiguriert.',
  },
  en: {
    found: (count) => `${count} matching products found.`,
    empty: 'No matching products were found for this search.',
    disconnected: 'The Shopify connection is not configured.',
  },
};

function normalizeSearchQuery(message: string): string {
  const cleaned = message
    .toLocaleLowerCase('tr-TR')
    .replace(/[.,!?;:()[\]{}"']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word) => !SEARCH_STOP_WORDS.has(word))
    .join(' ')
    .trim();

  return cleaned || message.trim();
}

apiRouter.get('/products', async (req, res, next) => {
  try {
    const input = z.object({
      q: z.string().min(1).max(200).default('*'),
      limit: z.coerce.number().int().min(1).max(50).default(12),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ products: [], source: 'shopify', connected: false });
    }

    const products = await searchProducts(input.q, input.limit);
    return res.json({ products, source: 'shopify', connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/products/:handle', async (req, res, next) => {
  try {
    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const handle = z.string().min(1).max(255).parse(req.params.handle);
    const product = await getProductByHandle(handle);

    if (!product) {
      return res.status(404).json({ error: 'Ürün bulunamadı.' });
    }

    return res.json({ product });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/sale', async (req, res, next) => {
  try {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(24).default(9),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ collection: null, products: [], connected: false });
    }

    if (SALE_COLLECTION_ID) {
      const result = await getCollectionProducts(
        SALE_COLLECTION_ID,
        input.limit,
      );

      return res.json({ ...result, connected: true });
    }

    const collections = await getCollections(1);
    const fallbackCollection = collections[0];

    if (!fallbackCollection) {
      return res.json({
        collection: null,
        products: [],
        connected: true,
      });
    }

    const result = await getCollectionProducts(
      fallbackCollection.id,
      input.limit,
    );

    return res.json({
      ...result,
      connected: true,
      fallback: true,
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/collections', async (req, res, next) => {
  try {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(50).default(30),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ collections: [], connected: false });
    }

    const collections = await getCollections(input.limit);
    return res.json({ collections, connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/menu', async (req, res, next) => {
  try {
    const input = z.object({
      handle: z.string().min(1).max(100).default('main-menu'),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ items: [], connected: false });
    }

    const items = await getMenu(input.handle);
    if (items.length) {
      return res.json({ items, connected: true, source: 'menu' });
    }

    const collections = await getCollections(30);
    return res.json({
      items: collections.map((collection) => ({
        id: collection.id,
        title: collection.title,
        type: 'COLLECTION',
        url: `/collections/${collection.handle}`,
        resourceId: collection.id,
        collection: {
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
          image: collection.image,
        },
        items: [],
      })),
      connected: true,
      source: 'collections-fallback',
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/collection-products', async (req, res, next) => {
  try {
    const input = z.object({
      handle: z.string().min(1).max(255),
      limit: z.coerce.number().int().min(1).max(50).default(50),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ collection: null, products: [], connected: false });
    }

    const result = await getCollectionProductsByHandle(input.handle, input.limit);
    return res.json({ ...result, connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/collections/:collectionId/products', async (req, res, next) => {
  try {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(24).default(9),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ collection: null, products: [], connected: false });
    }

    const collectionId = z.string().min(1).max(200).parse(req.params.collectionId);
    const result = await getCollectionProducts(collectionId, input.limit);
    return res.json({ ...result, connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/content/pages', async (req, res, next) => {
  try {
    const input = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);

    if (!shopifyConnected()) {
      return res.json({ pages: [], connected: false });
    }

    const pages = await getContentPages(input.limit);
    return res.json({ pages, connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/content/pages/:handle', async (req, res, next) => {
  try {
    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const handle = z.string().min(1).max(255).parse(req.params.handle);
    const page = await getContentPage(handle);

    if (!page) {
      return res.status(404).json({ error: 'Sayfa bulunamadı.' });
    }

    return res.json({ page });
  } catch (error) {
    return next(error);
  }
});

apiRouter.get('/content/policies', async (_req, res, next) => {
  try {
    if (!shopifyConnected()) {
      return res.json({ policies: [], connected: false });
    }

    const policies = await getShopPolicies();
    return res.json({ policies, connected: true });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/chat', async (req, res, next) => {
  try {
    const input = z.object({
      message: z.string().min(2).max(500),
      language: z.enum(['tr', 'de', 'en']).default('tr'),
    }).parse(req.body);

    const language = input.language as SupportedLanguage;

    if (!shopifyConnected()) {
      return res.json({
        reply: replies[language].disconnected,
        products: [],
        shopifyConnected: false,
      });
    }

    const translatedQuery = await translateProductSearchToGerman(
      input.message,
      language as SearchLanguage,
    );
    const searchQuery = normalizeSearchQuery(translatedQuery);
    let products = await searchProducts(searchQuery, 9);

    if (!products.length) {
      const fallbackQuery = normalizeSearchQuery(input.message);
      if (fallbackQuery !== searchQuery) {
        products = await searchProducts(fallbackQuery, 9);
      }
    }

    return res.json({
      reply: products.length ? replies[language].found(products.length) : replies[language].empty,
      products,
      shopifyConnected: true,
      searchQuery,
      translatedToGerman: translatedQuery,
    });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/assistant', async (req, res, next) => {
  try {
    const input = z.object({
      question: z.string().min(2).max(500),
      language: z.enum(['tr', 'de', 'en']).default('tr'),
      productHandle: z.string().min(1).max(255).optional(),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: replies[input.language].disconnected });
    }

    let products = [];

    if (input.productHandle) {
      const product = await getProductByHandle(input.productHandle);
      products = product ? [product] : [];
    } else {
      const translatedQuery = await translateProductSearchToGerman(
        input.question,
        input.language as SearchLanguage,
      );
      products = await searchProducts(normalizeSearchQuery(translatedQuery), 5);
    }

    const answer = await answerProductQuestion(
      input.question,
      products,
      input.language as AssistantLanguage,
    );

    return res.json({ answer, products });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/cart/add', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).optional(),
      merchandiseId: z.string().min(1),
      quantity: z.coerce.number().int().positive().max(99).default(1),
      customerAccessToken: z.string().min(20).max(5000).optional(),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    let cart = input.cartId
      ? await addCartLine(input.cartId, input.merchandiseId, input.quantity)
      : await createCart(
          input.merchandiseId,
          input.quantity,
          input.customerAccessToken,
        );

    if (input.cartId && input.customerAccessToken) {
      cart = await updateCartBuyerIdentity(input.cartId, input.customerAccessToken);
    }

    return res.status(input.cartId ? 200 : 201).json({ cart });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/cart/buyer-identity', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).max(1000),
      customerAccessToken: z.string().min(20).max(5000).nullable(),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const cart = await updateCartBuyerIdentity(
      input.cartId,
      input.customerAccessToken,
    );
    return res.json({ cart });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/cart/get', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).max(1000),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const cart = await getCart(input.cartId);
    if (!cart) {
      return res.status(404).json({ error: 'Sepet bulunamadı veya süresi dolmuş.' });
    }

    return res.json({ cart });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/cart/update', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).max(1000),
      lineId: z.string().min(1).max(500),
      quantity: z.coerce.number().int().min(1).max(99),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const cart = await updateCartLine(input.cartId, input.lineId, input.quantity);
    return res.json({ cart });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/cart/remove', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).max(1000),
      lineId: z.string().min(1).max(500),
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    const cart = await removeCartLine(input.cartId, input.lineId);
    return res.json({ cart });
  } catch (error) {
    return next(error);
  }
});

apiRouter.post('/checkout', async (req, res, next) => {
  try {
    const input = z.object({
      cartId: z.string().min(1).optional(),
      merchandiseId: z.string().min(1).optional(),
      quantity: z.coerce.number().int().positive().max(99).default(1),
    }).refine((value) => value.cartId || value.merchandiseId, {
      message: 'cartId veya merchandiseId gereklidir.',
    }).parse(req.body);

    if (!shopifyConnected()) {
      return res.status(503).json({ error: 'Shopify bağlantısı yapılandırılmamış.' });
    }

    if (input.cartId) {
      return res.json({ cartId: input.cartId });
    }

    const cart = await createCart(input.merchandiseId!, input.quantity);
    return res.status(201).json({ cart });
  } catch (error) {
    return next(error);
  }
});
