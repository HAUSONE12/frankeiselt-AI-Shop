import { env } from '../config/env.js';

export type SearchLanguage = 'tr' | 'de' | 'en';

type ResponseContentPart = {
  type?: string;
  text?: string;
};

type ResponseOutputItem = {
  content?: ResponseContentPart[];
};

type OpenAIResponse = {
  output?: ResponseOutputItem[];
};

function extractOutputText(payload: OpenAIResponse): string {
  return (payload.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join(' ')
    .trim();
}

export async function translateProductSearchToGerman(
  message: string,
  language: SearchLanguage,
): Promise<string> {
  const original = message.trim();
  if (!original || language === 'de' || !env.OPENAI_API_KEY) return original;

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
        max_output_tokens: 80,
        instructions:
          'Extract only the product name or product search keywords from the customer request and translate them into concise German. Return only the German search phrase, without quotes, explanation, punctuation, or a full sentence. Preserve model numbers, sizes, standards, and brand names exactly.',
        input: `Source language: ${language}\nCustomer request: ${original}`,
      }),
    });

    if (!response.ok) return original;

    const payload = (await response.json()) as OpenAIResponse;
    return extractOutputText(payload) || original;
  } catch {
    return original;
  }
}
