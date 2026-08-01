import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8080),
  CORS_ORIGIN: z.string().default('*'),
  SHOPIFY_STORE_DOMAIN: z.string().optional(),
  SHOPIFY_STOREFRONT_TOKEN: z.string().optional(),
  SHOPIFY_ADMIN_ACCESS_TOKEN: z.string().optional(),
  SHOPIFY_PRIMARY_DOMAIN: z.string().optional(),
  SHOPIFY_SALE_COLLECTION_ID: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default('2026-04'),
  OPENAI_API_KEY: z.string().optional(),
  PLENTY_BASE_URL: z.string().url().optional(),
  PLENTY_USERNAME: z.string().optional(),
  PLENTY_PASSWORD: z.string().optional(),
  INVOICE_LINK_SECRET: z.string().min(32).optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
