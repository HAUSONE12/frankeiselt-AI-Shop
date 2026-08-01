export type Money = {
  amount: string;
  currencyCode: string;
};

export type CartLine = {
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
    image?: { url: string; altText?: string | null } | null;
    selectedOptions: Array<{ name: string; value: string }>;
    product: {
      id: string;
      title: string;
      handle: string;
      featuredImage?: { url: string; altText?: string | null } | null;
    };
  };
};

export type Cart = {
  id: string;
  checkoutUrl: string;
  totalQuantity: number;
  cost: {
    subtotalAmount: Money;
    totalAmount: Money;
  };
  lines: CartLine[];
};

export type ProductVariant = {
  id: string;
  title: string;
  availableForSale: boolean;
  sku?: string;
  price: string;
  currencyCode: string;
  compareAtPrice?: string;
  imageUrl?: string;
  selectedOptions: Array<{ name: string; value: string }>;
};

export type Product = {
  id: string;
  title: string;
  handle?: string;
  description?: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  imageUrl?: string;
  images?: Array<{ url: string; altText?: string | null }>;
  onlineStoreUrl?: string;
  seoTitle?: string;
  seoDescription?: string;
  price?: string;
  currencyCode?: string;
  availableForSale?: boolean;
  variantId?: string;
  variants?: ProductVariant[];
};

export type Collection = {
  id: string;
  title: string;
  handle: string;
  description?: string;
  imageUrl?: string;
};

export type MenuItem = {
  id: string;
  title: string;
  type: string;
  url?: string;
  resourceId?: string;
  collection?: {
    id: string;
    title: string;
    handle: string;
    imageUrl?: string;
  };
  items: MenuItem[];
};

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  products?: Product[];
};
