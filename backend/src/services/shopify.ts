import { env } from '../config/env.js';

type Money = {
  amount: string;
  currencyCode: string;
};

export type ShopifySelectedOption = {
  name: string;
  value: string;
};

export type ShopifyProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  sku: string | null;
  price: Money;
  compareAtPrice: Money | null;
  image: ShopifyImage | null;
  selectedOptions: ShopifySelectedOption[];
};

type ShopifyImage = {
  url: string;
  altText: string | null;
};

export type ShopifyProduct = {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  images?: ShopifyImage[];
  onlineStoreUrl?: string | null;
  seo?: { title: string | null; description: string | null };
  availableForSale: boolean;
  image: ShopifyImage | null;
  price: Money | null;
  variantId: string | null;
  variants: ShopifyProductVariant[];
};

export type ShopifyCollection = {
  id: string;
  title: string;
  handle: string;
  description: string;
  image: ShopifyImage | null;
};

export type ShopifyMenuItem = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  resourceId: string | null;
  collection: {
    id: string;
    title: string;
    handle: string;
    image: ShopifyImage | null;
  } | null;
  items: ShopifyMenuItem[];
};

export type ShopifyCartLine = {
  id: string;
  quantity: number;
  cost: {
    amountPerQuantity: Money;
    subtotalAmount: Money;
    totalAmount: Money;
  };
  merchandise: {
    id: string;
    title: string;
    availableForSale: boolean;
    price: Money;
    image: ShopifyImage | null;
    selectedOptions: ShopifySelectedOption[];
    product: {
      id: string;
      title: string;
      handle: string;
      featuredImage: ShopifyImage | null;
    };
  };
};

export type ShopifyCart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
  };
  lines: ShopifyCartLine[];
};

export type ShopifyContentPage = {
  id: string;
  title: string;
  handle: string;
  body: string;
  bodySummary: string;
  onlineStoreUrl: string | null;
};

export type ShopifyPolicy = {
  id: string;
  title: string;
  handle: string;
  body: string;
  url: string;
  type: 'privacyPolicy' | 'termsOfService' | 'refundPolicy' | 'shippingPolicy';
};

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  description: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  images?: { nodes: ShopifyImage[] };
  onlineStoreUrl?: string | null;
  seo?: { title: string | null; description: string | null };
  availableForSale: boolean;
  featuredImage: ShopifyImage | null;
  variants: {
    nodes: ShopifyProductVariant[];
  };
};

type CartNode = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
  };
  lines: {
    nodes: ShopifyCartLine[];
  };
};

type MenuNode = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  resourceId: string | null;
  resource: {
    id: string;
    title: string;
    handle: string;
    image: ShopifyImage | null;
  } | null;
  items: MenuNode[];
};

type GraphQLError = { message: string };
type UserError = { field?: string[] | null; message: string };

function isConfigured(): boolean {
  return Boolean(env.SHOPIFY_STORE_DOMAIN && env.SHOPIFY_STOREFRONT_TOKEN);
}

async function storefrontRequest<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  if (!isConfigured()) {
    throw new Error('Shopify Storefront API is not configured.');
  }

  const domain = env.SHOPIFY_STORE_DOMAIN!.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const response = await fetch(`https://${domain}/api/${env.SHOPIFY_API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Shopify-Storefront-Private-Token': env.SHOPIFY_STOREFRONT_TOKEN!,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    throw new Error(`Shopify request failed with status ${response.status}.`);
  }

  const payload = await response.json() as { data?: T; errors?: GraphQLError[] };
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join('; '));
  }
  if (!payload.data) {
    throw new Error('Shopify returned no data.');
  }

  return payload.data;
}

function throwUserErrors(errors: UserError[]): void {
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join('; '));
  }
}

function mapProduct(product: ProductNode): ShopifyProduct {
  const variants = product.variants.nodes ?? [];

  const selectedVariant =
    variants.find((variant) => variant.availableForSale) ??
    variants[0] ??
    null;

  const imageCandidates = [
    product.featuredImage,
    ...(product.images?.nodes ?? []),
    selectedVariant?.image ?? null,
    ...variants.map((variant) => variant.image),
  ].filter((image): image is ShopifyImage => Boolean(image?.url));

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
    images,
    onlineStoreUrl: product.onlineStoreUrl,
    seo: product.seo,
    availableForSale: product.availableForSale,
    image: images[0] ?? null,
    price: selectedVariant?.price ?? null,
    variantId: selectedVariant?.id ?? null,
    variants,
  };
}

function mapMenuItem(item: MenuNode): ShopifyMenuItem {
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    url: item.url,
    resourceId: item.resourceId,
    collection: item.resource
      ? {
          id: item.resource.id,
          title: item.resource.title,
          handle: item.resource.handle,
          image: item.resource.image,
        }
      : null,
    items: (item.items ?? []).map(mapMenuItem),
  };
}

function mapCart(cart: CartNode): ShopifyCart {
  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    cost: cart.cost,
    lines: cart.lines.nodes ?? [],
  };
}

const PRODUCT_FIELDS = `
  id
  title
  handle
  description
  availableForSale
  featuredImage {
    url
    altText
  }
  images(first: 20) {
    nodes {
      url
      altText
    }
  }
  variants(first: 100) {
    nodes {
      id
      title
      availableForSale
      sku
      price {
        amount
        currencyCode
      }
      compareAtPrice {
        amount
        currencyCode
      }
      image {
        url
        altText
      }
      selectedOptions {
        name
        value
      }
    }
  }
`;

const PRODUCT_DETAIL_FIELDS = `
  ${PRODUCT_FIELDS}
  descriptionHtml
  vendor
  productType
  tags
  onlineStoreUrl
  seo {
    title
    description
  }
`;

const CART_FIELDS = `
  id
  checkoutUrl
  totalQuantity
  cost {
    subtotalAmount { amount currencyCode }
    totalAmount { amount currencyCode }
  }
  lines(first: 100) {
    nodes {
      id
      quantity
      cost {
        amountPerQuantity { amount currencyCode }
        subtotalAmount { amount currencyCode }
        totalAmount { amount currencyCode }
      }
      merchandise {
        ... on ProductVariant {
          id
          title
          availableForSale
          price { amount currencyCode }
          image { url altText }
          selectedOptions { name value }
          product {
            id
            title
            handle
            featuredImage { url altText }
          }
        }
      }
    }
  }
`;

const MENU_ITEM_FIELDS = `
  id
  title
  type
  url
  resourceId
  resource {
    ... on Collection {
      id
      title
      handle
      image { url altText }
    }
  }
`;

export async function searchProducts(search: string, first = 12): Promise<ShopifyProduct[]> {
  const query = `
    query SearchProducts($first: Int!, $query: String!) {
      products(first: $first, query: $query, sortKey: RELEVANCE) {
        nodes { ${PRODUCT_FIELDS} }
      }
    }
  `;

  const data = await storefrontRequest<{ products: { nodes: ProductNode[] } }>(query, {
    first,
    query: search,
  });

  return data.products.nodes.map(mapProduct);
}

export async function getProductByHandle(handle: string): Promise<ShopifyProduct | null> {
  const query = `
    query ProductByHandle($handle: String!) {
      product(handle: $handle) { ${PRODUCT_DETAIL_FIELDS} }
    }
  `;

  const data = await storefrontRequest<{ product: ProductNode | null }>(query, { handle });
  return data.product ? mapProduct(data.product) : null;
}

export async function getCollectionProducts(
  collectionId: string,
  first = 9,
): Promise<{ collection: ShopifyCollection | null; products: ShopifyProduct[] }> {
  const id = collectionId.startsWith('gid://')
    ? collectionId
    : `gid://shopify/Collection/${collectionId}`;

  const query = `
    query CollectionProducts($id: ID!, $first: Int!) {
      collection(id: $id) {
        id
        title
        handle
        description
        image { url altText }
        products(first: $first, sortKey: COLLECTION_DEFAULT) {
          nodes { ${PRODUCT_FIELDS} }
        }
      }
    }
  `;

  const data = await storefrontRequest<{
    collection: (ShopifyCollection & { products: { nodes: ProductNode[] } }) | null;
  }>(query, { id, first });

  if (!data.collection) {
    return { collection: null, products: [] };
  }

  return {
    collection: {
      id: data.collection.id,
      title: data.collection.title,
      handle: data.collection.handle,
      description: data.collection.description,
      image: data.collection.image,
    },
    products: data.collection.products.nodes.map(mapProduct),
  };
}

export async function getCollectionProductsByHandle(
  handle: string,
  first = 50,
): Promise<{ collection: ShopifyCollection | null; products: ShopifyProduct[] }> {
  const query = `
    query CollectionProductsByHandle($handle: String!, $first: Int!) {
      collection(handle: $handle) {
        id
        title
        handle
        description
        image { url altText }
        products(first: $first, sortKey: COLLECTION_DEFAULT) {
          nodes { ${PRODUCT_FIELDS} }
        }
      }
    }
  `;

  const data = await storefrontRequest<{
    collection: (ShopifyCollection & { products: { nodes: ProductNode[] } }) | null;
  }>(query, { handle, first });

  if (!data.collection) {
    return { collection: null, products: [] };
  }

  return {
    collection: {
      id: data.collection.id,
      title: data.collection.title,
      handle: data.collection.handle,
      description: data.collection.description,
      image: data.collection.image,
    },
    products: data.collection.products.nodes.map(mapProduct),
  };
}

export async function getCollections(first = 30): Promise<ShopifyCollection[]> {
  const query = `
    query Collections($first: Int!) {
      collections(first: $first, sortKey: TITLE) {
        nodes {
          id
          title
          handle
          description
          image { url altText }
        }
      }
    }
  `;

  const data = await storefrontRequest<{ collections: { nodes: ShopifyCollection[] } }>(query, {
    first,
  });

  return data.collections.nodes;
}

export async function getContentPages(first = 50): Promise<ShopifyContentPage[]> {
  const query = `
    query ContentPages($first: Int!) {
      pages(first: $first, sortKey: TITLE) {
        nodes {
          id
          title
          handle
          body
          bodySummary
          onlineStoreUrl
        }
      }
    }
  `;

  const data = await storefrontRequest<{
    pages: { nodes: ShopifyContentPage[] };
  }>(query, { first });

  return data.pages.nodes;
}

export async function getContentPage(handle: string): Promise<ShopifyContentPage | null> {
  const query = `
    query ContentPage($handle: String!) {
      page(handle: $handle) {
        id
        title
        handle
        body
        bodySummary
        onlineStoreUrl
      }
    }
  `;

  const data = await storefrontRequest<{
    page: ShopifyContentPage | null;
  }>(query, { handle });

  return data.page;
}

export async function getShopPolicies(): Promise<ShopifyPolicy[]> {
  const query = `
    query ShopPolicies {
      shop {
        privacyPolicy { id title handle body url }
        termsOfService { id title handle body url }
        refundPolicy { id title handle body url }
        shippingPolicy { id title handle body url }
      }
    }
  `;

  const data = await storefrontRequest<{
    shop: {
      privacyPolicy: Omit<ShopifyPolicy, 'type'> | null;
      termsOfService: Omit<ShopifyPolicy, 'type'> | null;
      refundPolicy: Omit<ShopifyPolicy, 'type'> | null;
      shippingPolicy: Omit<ShopifyPolicy, 'type'> | null;
    };
  }>(query, {});

  const entries = [
    ['privacyPolicy', data.shop.privacyPolicy],
    ['termsOfService', data.shop.termsOfService],
    ['refundPolicy', data.shop.refundPolicy],
    ['shippingPolicy', data.shop.shippingPolicy],
  ] as const;

  return entries
    .filter((entry): entry is readonly [ShopifyPolicy['type'], Omit<ShopifyPolicy, 'type'>] => Boolean(entry[1]))
    .map(([type, policy]) => ({ ...policy, type }));
}

export async function getMenu(handle = 'main-menu'): Promise<ShopifyMenuItem[]> {
  const query = `
    query MenuByHandle($handle: String!) {
      menu(handle: $handle) {
        items {
          ${MENU_ITEM_FIELDS}
          items {
            ${MENU_ITEM_FIELDS}
            items {
              ${MENU_ITEM_FIELDS}
            }
          }
        }
      }
    }
  `;

  const data = await storefrontRequest<{ menu: { items: MenuNode[] } | null }>(query, { handle });
  return (data.menu?.items ?? []).map(mapMenuItem);
}

export async function getCart(cartId: string): Promise<ShopifyCart | null> {
  const query = `
    query GetCart($cartId: ID!) {
      cart(id: $cartId) { ${CART_FIELDS} }
    }
  `;

  const data = await storefrontRequest<{ cart: CartNode | null }>(query, { cartId });
  return data.cart ? mapCart(data.cart) : null;
}

export async function createCart(
  merchandiseId: string,
  quantity = 1,
  customerAccessToken?: string,
): Promise<ShopifyCart> {
  const mutation = `
    mutation CreateCart($input: CartInput!) {
      cartCreate(input: $input) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontRequest<{
    cartCreate: {
      cart: CartNode | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    input: {
      lines: [{ merchandiseId, quantity }],
      ...(customerAccessToken
        ? { buyerIdentity: { customerAccessToken } }
        : {}),
    },
  });

  throwUserErrors(data.cartCreate.userErrors);
  if (!data.cartCreate.cart) throw new Error('Shopify cart could not be created.');
  return mapCart(data.cartCreate.cart);
}

export async function updateCartBuyerIdentity(
  cartId: string,
  customerAccessToken: string | null,
): Promise<ShopifyCart> {
  const mutation = `
    mutation UpdateCartBuyerIdentity($cartId: ID!, $buyerIdentity: CartBuyerIdentityInput!) {
      cartBuyerIdentityUpdate(cartId: $cartId, buyerIdentity: $buyerIdentity) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontRequest<{
    cartBuyerIdentityUpdate: {
      cart: CartNode | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    cartId,
    buyerIdentity: { customerAccessToken },
  });

  throwUserErrors(data.cartBuyerIdentityUpdate.userErrors);
  if (!data.cartBuyerIdentityUpdate.cart) {
    throw new Error('Shopify cart buyer identity could not be updated.');
  }

  return mapCart(data.cartBuyerIdentityUpdate.cart);
}

export async function addCartLine(cartId: string, merchandiseId: string, quantity = 1): Promise<ShopifyCart> {
  const mutation = `
    mutation AddCartLine($cartId: ID!, $lines: [CartLineInput!]!) {
      cartLinesAdd(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontRequest<{
    cartLinesAdd: {
      cart: CartNode | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    cartId,
    lines: [{ merchandiseId, quantity }],
  });

  throwUserErrors(data.cartLinesAdd.userErrors);
  if (!data.cartLinesAdd.cart) throw new Error('Shopify cart could not be updated.');
  return mapCart(data.cartLinesAdd.cart);
}

export async function updateCartLine(
  cartId: string,
  lineId: string,
  quantity: number,
): Promise<ShopifyCart> {
  const mutation = `
    mutation UpdateCartLine($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
      cartLinesUpdate(cartId: $cartId, lines: $lines) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontRequest<{
    cartLinesUpdate: {
      cart: CartNode | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    cartId,
    lines: [{ id: lineId, quantity }],
  });

  throwUserErrors(data.cartLinesUpdate.userErrors);
  if (!data.cartLinesUpdate.cart) throw new Error('Shopify cart line could not be updated.');
  return mapCart(data.cartLinesUpdate.cart);
}

export async function removeCartLine(cartId: string, lineId: string): Promise<ShopifyCart> {
  const mutation = `
    mutation RemoveCartLine($cartId: ID!, $lineIds: [ID!]!) {
      cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
        cart { ${CART_FIELDS} }
        userErrors { field message }
      }
    }
  `;

  const data = await storefrontRequest<{
    cartLinesRemove: {
      cart: CartNode | null;
      userErrors: UserError[];
    };
  }>(mutation, {
    cartId,
    lineIds: [lineId],
  });

  throwUserErrors(data.cartLinesRemove.userErrors);
  if (!data.cartLinesRemove.cart) throw new Error('Shopify cart line could not be removed.');
  return mapCart(data.cartLinesRemove.cart);
}

export function shopifyConnected(): boolean {
  return isConfigured();
}
