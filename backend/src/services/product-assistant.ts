import { env } from '../config/env.js';
import type { ShopifyProduct } from './shopify.js';

export type AssistantLanguage = 'tr' | 'de' | 'en';

type ResponseContentPart = { type?: string; text?: string };
type ResponseOutputItem = { content?: ResponseContentPart[] };
type OpenAIResponse = { output?: ResponseOutputItem[] };

function extractOutputText(payload: OpenAIResponse): string {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

function fallbackAnswer(products: ShopifyProduct[], language: AssistantLanguage): string {
  const product = products[0];
  if (!product) {
    return language === 'de'
      ? 'Dazu habe ich keine passende Produktinformation gefunden.'
      : language === 'en'
        ? 'I could not find matching product information.'
        : 'Bununla ilgili uygun ürün bilgisi bulamadım.';
  }

  const price = product.price
    ? `${product.price.amount} ${product.price.currencyCode}`
    : language === 'de'
      ? 'Preis nicht verfügbar'
      : language === 'en'
        ? 'Price unavailable'
        : 'Fiyat bilgisi yok';

  const stock = product.availableForSale
    ? language === 'de'
      ? 'auf Lager'
      : language === 'en'
        ? 'in stock'
        : 'stokta'
    : language === 'de'
      ? 'nicht auf Lager'
      : language === 'en'
        ? 'out of stock'
        : 'stokta yok';

  if (language === 'de') return `${product.title}: ${price}, ${stock}.`;
  if (language === 'en') return `${product.title}: ${price}, ${stock}.`;
  return `${product.title}: ${price}, ${stock}.`;
}

export async function answerProductQuestion(
  question: string,
  products: ShopifyProduct[],
  language: AssistantLanguage,
): Promise<string> {
  if (!env.OPENAI_API_KEY) return fallbackAnswer(products, language);

  const productContext = products.slice(0, 5).map((product) => ({
    title: product.title,
    description: product.description,
    availableForSale: product.availableForSale,
    price: product.price,
  }));

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-5-mini',
        store: false,
        max_output_tokens: 120,
        instructions:
          'Answer only from the supplied Shopify product data. Be short, direct and useful. Answer only the user question. Do not invent compatibility, dimensions, stock or specifications. If the data is insufficient, say that briefly in the requested language.',
        input: JSON.stringify({ language, question, products: productContext }),
      }),
    });

    if (!response.ok) return fallbackAnswer(products, language);
    const payload = (await response.json()) as OpenAIResponse;
    return extractOutputText(payload) || fallbackAnswer(products, language);
  } catch {
    return fallbackAnswer(products, language);
  }
}
