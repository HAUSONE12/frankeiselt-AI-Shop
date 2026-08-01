import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

const SHOP_DOMAIN = 'frankeiselt.de';
const CLIENT_ID = '8476f0de-f000-451f-b0e4-efdb2d594fcb';
const REDIRECT_URI = 'shop.66231075075.frankeiseltiashop://callback';
const SESSION_KEY = 'frankeiselt-customer-account-session';
const OAUTH_SCOPES = ['openid', 'email', 'customer-account-api:full'];

type OpenIdConfiguration = {
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint?: string;
  revocation_endpoint?: string;
};

type CustomerApiConfiguration = {
  graphql_api: string;
};

export type CustomerSession = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt: number;
};

export type CustomerAddress = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  zoneCode?: string | null;
  territoryCode?: string | null;
  zip?: string | null;
};

export type CustomerProfile = {
  id: string;
  displayName: string;
  firstName?: string | null;
  lastName?: string | null;
  imageUrl?: string | null;
  emailAddress?: string | null;
  phoneNumber?: string | null;
  defaultAddress?: CustomerAddress | null;
  addresses: CustomerAddress[];
};

export type CustomerOrderMoney = {
  amount: string;
  currencyCode: string;
};

export type CustomerOrderTracking = {
  company?: string | null;
  number?: string | null;
  url?: string | null;
};

export type CustomerOrderFulfillment = {
  id: string;
  status?: string | null;
  latestShipmentStatus?: string | null;
  estimatedDeliveryAt?: string | null;
  trackingInformation: CustomerOrderTracking[];
};

export type CustomerOrderLine = {
  id: string;
  name: string;
  quantity: number;
  variantTitle?: string | null;
  imageUrl?: string | null;
  sku?: string | null;
  vendor?: string | null;
  price?: CustomerOrderMoney | null;
  totalPrice?: CustomerOrderMoney | null;
};

export type CustomerOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string;
  confirmationNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  note?: string | null;
  poNumber?: string | null;
  financialStatus?: string | null;
  fulfillmentStatus: string;
  statusPageUrl: string;
  billingAddress?: CustomerAddress | null;
  shippingAddress?: CustomerAddress | null;
  subtotal?: CustomerOrderMoney | null;
  totalShipping: CustomerOrderMoney;
  totalTax?: CustomerOrderMoney | null;
  totalRefunded: CustomerOrderMoney;
  totalPrice: CustomerOrderMoney;
  fulfillments: CustomerOrderFulfillment[];
  invoiceUrl?: string | null;
  lineItems: CustomerOrderLine[];
};

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string }>;
};

let openIdCache: OpenIdConfiguration | undefined;
let customerApiCache: CustomerApiConfiguration | undefined;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function getOpenIdConfiguration(): Promise<OpenIdConfiguration> {
  if (openIdCache) return openIdCache;
  openIdCache = await fetchJson<OpenIdConfiguration>(
    `https://${SHOP_DOMAIN}/.well-known/openid-configuration`,
  );
  return openIdCache;
}

async function getCustomerApiConfiguration(): Promise<CustomerApiConfiguration> {
  if (customerApiCache) return customerApiCache;
  customerApiCache = await fetchJson<CustomerApiConfiguration>(
    `https://${SHOP_DOMAIN}/.well-known/customer-account-api`,
  );
  return customerApiCache;
}

function toDiscovery(config: OpenIdConfiguration): AuthSession.DiscoveryDocument {
  return {
    authorizationEndpoint: config.authorization_endpoint,
    tokenEndpoint: config.token_endpoint,
    revocationEndpoint: config.revocation_endpoint,
  };
}

async function saveSession(session: CustomerSession): Promise<void> {
  await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session));
}

export async function clearCustomerSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY);
}

export async function loadCustomerSession(): Promise<CustomerSession | null> {
  const raw = await SecureStore.getItemAsync(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as CustomerSession;
  } catch {
    await clearCustomerSession();
    return null;
  }
}

async function refreshCustomerSession(session: CustomerSession): Promise<CustomerSession> {
  if (!session.refreshToken) throw new Error('No refresh token available.');

  const openId = await getOpenIdConfiguration();
  const token = await AuthSession.refreshAsync(
    {
      clientId: CLIENT_ID,
      refreshToken: session.refreshToken,
    },
    toDiscovery(openId),
  );

  const next: CustomerSession = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? session.refreshToken,
    idToken: token.idToken ?? session.idToken,
    expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
  };

  await saveSession(next);
  return next;
}

export async function getValidCustomerSession(): Promise<CustomerSession | null> {
  const session = await loadCustomerSession();
  if (!session) return null;
  if (session.expiresAt > Date.now() + 60_000) return session;

  try {
    return await refreshCustomerSession(session);
  } catch {
    await clearCustomerSession();
    return null;
  }
}

export async function getCustomerAccessToken(): Promise<string | undefined> {
  const session = await getValidCustomerSession();
  return session?.accessToken;
}

export async function signInCustomer(language: 'tr' | 'de' | 'en' = 'de'): Promise<CustomerSession> {
  const openId = await getOpenIdConfiguration();
  const discovery = toDiscovery(openId);

  const request = new AuthSession.AuthRequest({
    clientId: CLIENT_ID,
    redirectUri: REDIRECT_URI,
    responseType: AuthSession.ResponseType.Code,
    scopes: OAUTH_SCOPES,
    usePKCE: true,
    extraParams: {
      nonce: Crypto.randomUUID(),
      locale: language,
      region_country: 'DE',
    },
  });

  const result = await request.promptAsync(discovery, {
    // Android uses a branded Custom Tab in the same task as the app.
    toolbarColor: '#007ABB',
    secondaryToolbarColor: '#12262F',
    showTitle: false,
    enableBarCollapsing: false,
    enableDefaultShareMenuItem: false,
    showInRecents: false,
    createTask: false,
    useProxyActivity: false,

    // iOS uses the secure system authentication session and returns directly
    // to the custom callback scheme after login/account creation.
    controlsColor: '#007ABB',
    dismissButtonStyle: 'close',
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    preferEphemeralSession: false,
  });
  if (result.type !== 'success') {
    throw new Error(result.type === 'cancel' || result.type === 'dismiss'
      ? 'Authentication cancelled.'
      : 'Authentication failed.');
  }

  const code = result.params.code;
  if (!code || !request.codeVerifier) {
    throw new Error('Authorization code or PKCE verifier missing.');
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: CLIENT_ID,
      code,
      redirectUri: REDIRECT_URI,
      extraParams: {
        code_verifier: request.codeVerifier,
      },
    },
    discovery,
  );

  const session: CustomerSession = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    idToken: token.idToken,
    expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
  };

  await saveSession(session);
  return session;
}

export async function signOutCustomer(): Promise<void> {
  const session = await loadCustomerSession();
  const openId = await getOpenIdConfiguration();

  if (session?.idToken && openId.end_session_endpoint) {
    const url = new URL(openId.end_session_endpoint);
    url.searchParams.set('id_token_hint', session.idToken);
    try {
      await fetch(url.toString(), { method: 'GET' });
    } catch {
      // Local session is still cleared if Shopify logout cannot be reached.
    }
  }

  await clearCustomerSession();
}

async function customerGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const session = await getValidCustomerSession();
  if (!session) throw new Error('AUTH_REQUIRED');

  const api = await getCustomerApiConfiguration();
  const response = await fetchJson<GraphqlResponse<T>>(api.graphql_api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: session.accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (response.errors?.length) {
    throw new Error(response.errors.map((error) => error.message).join('\n'));
  }
  if (!response.data) throw new Error('Customer Account API returned no data.');
  return response.data;
}

export async function getCustomerProfile(): Promise<CustomerProfile> {
  const query = `
    query CustomerProfile {
      customer {
        id
        displayName
        firstName
        lastName
        imageUrl
        emailAddress { emailAddress }
        phoneNumber { phoneNumber }
        defaultAddress {
          id firstName lastName company address1 address2 city zoneCode territoryCode zip
        }
        addresses(first: 20) {
          nodes {
            id firstName lastName company address1 address2 city zoneCode territoryCode zip
          }
        }
      }
    }
  `;

  const data = await customerGraphql<{
    customer: {
      id: string;
      displayName: string;
      firstName?: string | null;
      lastName?: string | null;
      imageUrl?: string | null;
      emailAddress?: { emailAddress: string } | null;
      phoneNumber?: { phoneNumber: string } | null;
      defaultAddress?: CustomerAddress | null;
      addresses: { nodes: CustomerAddress[] };
    };
  }>(query);

  return {
    ...data.customer,
    emailAddress: data.customer.emailAddress?.emailAddress ?? null,
    phoneNumber: data.customer.phoneNumber?.phoneNumber ?? null,
    addresses: data.customer.addresses.nodes,
  };
}

export async function getCustomerOrders(): Promise<CustomerOrder[]> {
  const query = `
    query CustomerOrders {
      customer {
        orders(first: 30, reverse: true) {
          nodes {
            id
            name
            createdAt
            processedAt
            confirmationNumber
            email
            phone
            note
            poNumber
            financialStatus
            fulfillmentStatus
            statusPageUrl
            billingAddress {
              id firstName lastName company address1 address2 city zoneCode territoryCode zip
            }
            shippingAddress {
              id firstName lastName company address1 address2 city zoneCode territoryCode zip
            }
            subtotal { amount currencyCode }
            totalShipping { amount currencyCode }
            totalTax { amount currencyCode }
            totalRefunded { amount currencyCode }
            totalPrice { amount currencyCode }
            invoiceCustom: metafield(namespace: "custom", key: "invoice_url") { value }
            invoiceFrankEiselt: metafield(namespace: "frankeiselt", key: "invoice_url") { value }
            invoicePdf: metafield(namespace: "custom", key: "invoice_pdf") { value }
            fulfillments(first: 20) {
              nodes {
                id
                status
                latestShipmentStatus
                estimatedDeliveryAt
                trackingInformation { company number url }
              }
            }
            lineItems(first: 100) {
              nodes {
                id
                name
                quantity
                variantTitle
                sku
                vendor
                price { amount currencyCode }
                totalPrice { amount currencyCode }
                image { url altText }
              }
            }
          }
        }
      }
    }
  `;

  const data = await customerGraphql<{
    customer: {
      orders: {
        nodes: Array<{
          id: string;
          name: string;
          createdAt: string;
          processedAt: string;
          confirmationNumber?: string | null;
          email?: string | null;
          phone?: string | null;
          note?: string | null;
          poNumber?: string | null;
          financialStatus?: string | null;
          fulfillmentStatus: string;
          statusPageUrl: string;
          billingAddress?: CustomerAddress | null;
          shippingAddress?: CustomerAddress | null;
          subtotal?: CustomerOrderMoney | null;
          totalShipping: CustomerOrderMoney;
          totalTax?: CustomerOrderMoney | null;
          totalRefunded: CustomerOrderMoney;
          totalPrice: CustomerOrderMoney;
          invoiceCustom?: { value: string } | null;
          invoiceFrankEiselt?: { value: string } | null;
          invoicePdf?: { value: string } | null;
          fulfillments: {
            nodes: CustomerOrderFulfillment[];
          };
          lineItems: {
            nodes: Array<{
              id: string;
              name: string;
              quantity: number;
              variantTitle?: string | null;
              sku?: string | null;
              vendor?: string | null;
              price?: CustomerOrderMoney | null;
              totalPrice?: CustomerOrderMoney | null;
              image?: { url: string; altText?: string | null } | null;
            }>;
          };
        }>;
      };
    };
  }>(query);

  return data.customer.orders.nodes.map((order) => ({
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    processedAt: order.processedAt,
    confirmationNumber: order.confirmationNumber,
    email: order.email,
    phone: order.phone,
    note: order.note,
    poNumber: order.poNumber,
    financialStatus: order.financialStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    statusPageUrl: order.statusPageUrl,
    billingAddress: order.billingAddress,
    shippingAddress: order.shippingAddress,
    subtotal: order.subtotal,
    totalShipping: order.totalShipping,
    totalTax: order.totalTax,
    totalRefunded: order.totalRefunded,
    totalPrice: order.totalPrice,
    fulfillments: order.fulfillments.nodes ?? [],
    invoiceUrl:
      order.invoiceCustom?.value ??
      order.invoiceFrankEiselt?.value ??
      order.invoicePdf?.value ??
      null,
    lineItems: order.lineItems.nodes.map((line) => ({
      id: line.id,
      name: line.name,
      quantity: line.quantity,
      variantTitle: line.variantTitle,
      imageUrl: line.image?.url,
      sku: line.sku,
      vendor: line.vendor,
      price: line.price,
      totalPrice: line.totalPrice,
    })),
  }));
}
