import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

type PlentyDocument = {
  id?: number | string;
  type?: string;
  status?: string;
  number?: number | string;
  numberWithPrefix?: string;
  content?: string;
  data?: string;
  path?: string;
  fileName?: string;
  filename?: string;
  references?: unknown;
};

type PlentyOrder = {
  id?: number | string;
  documents?: PlentyDocument[] | { entries?: PlentyDocument[]; nodes?: PlentyDocument[] };
};

type CachedToken = {
  value: string;
  expiresAt: number;
};

const invoiceTypes = new Set([
  'invoice',
  'invoiceexternal',
  'invoice_external',
  'posinvoice',
  'pos_invoice',
  'multiinvoice',
  'multi_invoice',
]);
const completedStatuses = new Set(['done', 'finished', 'complete', 'completed', 'fertig']);
let cachedToken: CachedToken | undefined;

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeDocumentType(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function isCompletedInvoice(document: PlentyDocument): boolean {
  const normalized = normalizeDocumentType(document.type);
  const compact = normalized.replace(/_/g, '');
  const status = String(document.status ?? 'done').trim().toLowerCase();
  return (invoiceTypes.has(normalized) || invoiceTypes.has(compact)) && completedStatuses.has(status);
}

function documentList(value: PlentyOrder['documents']): PlentyDocument[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.entries)) return value.entries;
  if (Array.isArray(value.nodes)) return value.nodes;
  return [];
}

function requiredConfig(): {
  baseUrl: string;
  username: string;
  password: string;
  linkSecret: string;
} {
  if (!env.PLENTY_BASE_URL || !env.PLENTY_USERNAME || !env.PLENTY_PASSWORD || !env.INVOICE_LINK_SECRET) {
    throw new Error('Plenty invoice delivery is not configured.');
  }
  return {
    baseUrl: normalizeBaseUrl(env.PLENTY_BASE_URL),
    username: env.PLENTY_USERNAME,
    password: env.PLENTY_PASSWORD,
    linkSecret: env.INVOICE_LINK_SECRET,
  };
}

async function plentyLogin(force = false): Promise<string> {
  const config = requiredConfig();
  if (!force && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) {
    return cachedToken.value;
  }

  const response = await fetch(`${config.baseUrl}/rest/login`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username: config.username,
      password: config.password,
    }),
  });

  if (!response.ok) {
    throw new Error(`Plenty login failed with status ${response.status}.`);
  }

  const payload = await response.json() as { access_token?: string; expires_in?: number };
  if (!payload.access_token) {
    throw new Error('Plenty login did not return an access token.');
  }

  cachedToken = {
    value: payload.access_token,
    expiresAt: Date.now() + Math.max(payload.expires_in ?? 3600, 300) * 1000,
  };
  return cachedToken.value;
}

async function plentyFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const config = requiredConfig();
  const token = await plentyLogin();
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json, application/pdf;q=0.9, */*;q=0.8');
  }
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401 && retry) {
    cachedToken = undefined;
    await plentyLogin(true);
    return plentyFetch(path, init, false);
  }
  return response;
}

function expectedSignature(orderId: number, documentId: number): string {
  const { linkSecret } = requiredConfig();
  return createHmac('sha256', linkSecret)
    .update(`${orderId}:${documentId}`, 'utf8')
    .digest('hex');
}

export function verifyInvoiceLinkToken(orderId: number, documentId: number, token: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  const expected = Buffer.from(expectedSignature(orderId, documentId), 'hex');
  const received = Buffer.from(token, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

async function getOrder(orderId: number): Promise<PlentyOrder> {
  const query = new URLSearchParams({ with: 'documents' });
  const response = await plentyFetch(`/rest/orders/${orderId}?${query.toString()}`);
  if (response.status === 404) throw new Error('ORDER_NOT_FOUND');
  if (!response.ok) throw new Error(`Plenty order request failed with status ${response.status}.`);
  return response.json() as Promise<PlentyOrder>;
}

function filenameFor(document: PlentyDocument): string {
  const explicit = document.fileName ?? document.filename;
  if (explicit) return String(explicit).replace(/[\r\n"\\/]/g, '_');
  const number = document.numberWithPrefix ?? document.number ?? document.id ?? 'invoice';
  return `Rechnung-${String(number).replace(/[^a-zA-Z0-9._-]+/g, '_')}.pdf`;
}

function decodePossibleBase64(payload: PlentyDocument): Buffer | undefined {
  const encoded = payload.content ?? payload.data;
  if (!encoded || typeof encoded !== 'string') return undefined;
  const normalized = encoded.replace(/^data:application\/pdf;base64,/, '').replace(/\s+/g, '');
  if (!normalized) return undefined;
  try {
    const decoded = Buffer.from(normalized, 'base64');
    return decoded.length > 4 ? decoded : undefined;
  } catch {
    return undefined;
  }
}

async function downloadDocument(documentId: number): Promise<{ bytes: Buffer; fileName: string }> {
  const response = await plentyFetch(`/rest/documents/${documentId}`, {
    headers: { Accept: 'application/pdf, application/json;q=0.9, */*;q=0.8' },
  });
  if (response.status === 404) throw new Error('DOCUMENT_NOT_FOUND');
  if (!response.ok) throw new Error(`Plenty document request failed with status ${response.status}.`);

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  const disposition = response.headers.get('content-disposition') ?? '';
  const dispositionName = disposition.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1];

  if (!contentType.includes('json')) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) throw new Error('Plenty returned an empty invoice document.');
    return {
      bytes,
      fileName: dispositionName ? decodeURIComponent(dispositionName) : `Rechnung-${documentId}.pdf`,
    };
  }

  const payload = await response.json() as PlentyDocument;
  const decoded = decodePossibleBase64(payload);
  if (decoded) return { bytes: decoded, fileName: filenameFor(payload) };

  if (payload.path) {
    const config = requiredConfig();
    const pathUrl = new URL(payload.path, `${config.baseUrl}/`);
    const baseUrl = new URL(config.baseUrl);
    if (pathUrl.origin !== baseUrl.origin) {
      throw new Error('Plenty document path points to an unexpected host.');
    }
    const pathResponse = await plentyFetch(`${pathUrl.pathname}${pathUrl.search}`, {
      headers: { Accept: 'application/pdf, */*' },
    });
    if (!pathResponse.ok) {
      throw new Error(`Plenty document path request failed with status ${pathResponse.status}.`);
    }
    return {
      bytes: Buffer.from(await pathResponse.arrayBuffer()),
      fileName: filenameFor(payload),
    };
  }

  throw new Error('Plenty document response did not contain downloadable PDF data.');
}

export async function getSignedPlentyInvoice(
  orderId: number,
  documentId: number,
  token: string,
): Promise<{ bytes: Buffer; fileName: string }> {
  if (!verifyInvoiceLinkToken(orderId, documentId, token)) {
    throw new Error('INVALID_INVOICE_TOKEN');
  }

  const order = await getOrder(orderId);
  const document = documentList(order.documents).find(
    (entry) => Number(entry.id) === documentId && isCompletedInvoice(entry),
  );
  if (!document) {
    throw new Error('INVOICE_NOT_ATTACHED_TO_ORDER');
  }

  const downloaded = await downloadDocument(documentId);
  return {
    bytes: downloaded.bytes,
    fileName: filenameFor({ ...document, fileName: downloaded.fileName }),
  };
}
