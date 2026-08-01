import { env } from '../config/env.js';

type CustomerDiscovery = {
  graphql_api: string;
};

type CustomerIdentityResponse = {
  data?: {
    customer: {
      id: string;
    };
  };
  errors?: Array<{ message: string }>;
};

type AdminTagsResponse = {
  data?: {
    tagsAdd: {
      node: { id: string } | null;
      userErrors: Array<{ message: string }>;
    };
  };
  errors?: Array<{ message: string }>;
};

function primaryDomain(): string {
  const configured = env.SHOPIFY_PRIMARY_DOMAIN || 'https://hausone.de';
  return configured.replace(/\/$/, '');
}

function storeDomain(): string {
  if (!env.SHOPIFY_STORE_DOMAIN) {
    throw new Error('Shopify store domain is not configured.');
  }
  return env.SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

async function getCustomerId(customerAccessToken: string): Promise<string> {
  const discoveryResponse = await fetch(
    `${primaryDomain()}/.well-known/customer-account-api`,
  );
  if (!discoveryResponse.ok) {
    throw new Error('Customer Account API discovery failed.');
  }

  const discovery = await discoveryResponse.json() as CustomerDiscovery;
  const response = await fetch(discovery.graphql_api, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: customerAccessToken,
    },
    body: JSON.stringify({
      query: `query DeletionRequestCustomer { customer { id } }`,
    }),
  });

  if (!response.ok) {
    throw new Error('Customer authentication failed.');
  }

  const payload = await response.json() as CustomerIdentityResponse;
  if (payload.errors?.length || !payload.data?.customer?.id) {
    throw new Error(
      payload.errors?.map((error) => error.message).join('; ') ||
      'Authenticated customer could not be resolved.',
    );
  }

  return payload.data.customer.id;
}

async function markDeletionRequest(customerId: string, requestedAt: string): Promise<void> {
  if (!env.SHOPIFY_ADMIN_ACCESS_TOKEN) {
    throw new Error('Shopify Admin access token is not configured.');
  }

  const response = await fetch(
    `https://${storeDomain()}/admin/api/${env.SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': env.SHOPIFY_ADMIN_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        query: `
          mutation AddDeletionRequestTags($id: ID!, $tags: [String!]!) {
            tagsAdd(id: $id, tags: $tags) {
              node { id }
              userErrors { message }
            }
          }
        `,
        variables: {
          id: customerId,
          tags: [
            'AIShop account deletion requested',
            `AIShop deletion ${requestedAt.slice(0, 10)}`,
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error('Shopify Admin deletion request update failed.');
  }

  const payload = await response.json() as AdminTagsResponse;
  const userErrors = payload.data?.tagsAdd.userErrors ?? [];
  if (payload.errors?.length || userErrors.length || !payload.data?.tagsAdd.node) {
    throw new Error(
      payload.errors?.map((error) => error.message).join('; ') ||
      userErrors.map((error) => error.message).join('; ') ||
      'Shopify customer could not be marked for deletion.',
    );
  }
}

export async function requestAuthenticatedAccountDeletion(
  customerAccessToken: string,
): Promise<{ requestedAt: string }> {
  const requestedAt = new Date().toISOString();
  const customerId = await getCustomerId(customerAccessToken);
  await markDeletionRequest(customerId, requestedAt);

  console.info(JSON.stringify({
    event: 'account_deletion_requested',
    customerId,
    requestedAt,
  }));

  return { requestedAt };
}
