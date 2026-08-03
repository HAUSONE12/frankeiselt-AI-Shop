import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image as ExpoImage } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { useShopifyCheckoutSheet } from '@shopify/checkout-sheet-kit';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  addToCart,
  askProductAssistant,
  getCart,
  getCollectionProducts,
  getCollections,
  getContentPage,
  getContentPages,
  getMainMenu,
  getProductByHandle,
  getSaleProducts,
  hydrateProductImages,
  getShopPolicies,
  removeCartLine,
  requestAccountDeletion,
  sendChat,
  setCartBuyerIdentity,
  updateCartLine,
  type AppLanguage,
  type ContentDocument,
} from '../api/client';
import type { Cart, MenuItem, Product } from '../types';
import {
  getCustomerOrders,
  getCustomerProfile,
  getValidCustomerSession,
  signInCustomer,
  signOutCustomer,
  type CustomerOrder,
  type CustomerProfile,
} from '../services/customerAccount';
import { CustomerOrderDetails } from '../components/CustomerOrderDetails';

type AppTab = 'home' | 'categories' | 'categoryProducts' | 'productDetails' | 'search' | 'cart' | 'orders' | 'orderDetails' | 'profile' | 'content';

const SHOP_URL = 'https://frankeiselt.de';
const ACCOUNT_URL = `${SHOP_URL}/account`;
type HomeCategoryConfig = {
  id: string;
  title: string;
  handle: string;
};

type CategorySlide = HomeCategoryConfig & {
  image: number;
};

const HOME_PRODUCT_CATEGORIES: HomeCategoryConfig[] = [
  {
    id: '401311072515',
    title: 'Putzerbedarf',
    handle: 'putzerbedarf',
  },
  {
    id: '651240866126',
    title: 'Inneneausbau',
    handle: 'inneneausbau',
  },
  {
    id: '401312350467',
    title: 'Baubedarf',
    handle: 'baubedarf',
  },
  {
    id: '401311236355',
    title: 'Verputzen Werkzeug',
    handle: 'verputzen-werkzeug',
  },
];

type CategorySlideTemplate = {
  aliases: string[];
  image: number;
};

const CATEGORY_SLIDE_TEMPLATES: CategorySlideTemplate[] = [
  {
    aliases: ['baubedarf', 'bau-bedarf'],
    image: require('../../assets/category-slider/baubedarf.png'),
  },
  {
    aliases: ['innenausbau', 'innen-ausbau'],
    image: require('../../assets/category-slider/innenausbau.png'),
  },
  {
    aliases: ['putzerbedarf', 'putzbedarf'],
    image: require('../../assets/category-slider/putzerbedarf.png'),
  },
  {
    aliases: [
      'verputzenwerkzeug',
      'verputzwerkzeug',
      'putzerwerkzeug',
      'putzerwerkzeuge',
      'putzwerkzeug',
      'putzwerkzeuge',
    ],
    image: require('../../assets/category-slider/verputzenwerkzeug.png'),
  },
];

function normalizeCategoryKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('de-DE')
    .replace(/[^a-z0-9]/g, '');
}

function buildCategorySlides(categories: HomeCategoryConfig[]): CategorySlide[] {
  return CATEGORY_SLIDE_TEMPLATES.flatMap((template) => {
    const aliases = template.aliases.map(normalizeCategoryKey);
    const category = categories.find((candidate) => {
      const keys = [candidate.handle, candidate.title].map(normalizeCategoryKey);
      return aliases.some((alias) => keys.some(
        (key) => key === alias || key.includes(alias) || alias.includes(key),
      ));
    });

    return category ? [{ ...category, image: template.image }] : [];
  });
}

function shuffleProducts(products: Product[]): Product[] {
  const shuffled = [...products];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [
      shuffled[randomIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function pickFreshRandomProducts(
  products: Product[],
  limit: number,
  previousIds: string[] = [],
): Product[] {
  const uniqueProducts = Array.from(
    new Map(products.map((product) => [product.id, product])).values(),
  );
  const previousIdSet = new Set(previousIds);
  const freshProducts = shuffleProducts(
    uniqueProducts.filter((product) => !previousIdSet.has(product.id)),
  );
  const previousProducts = shuffleProducts(
    uniqueProducts.filter((product) => previousIdSet.has(product.id)),
  );

  return [...freshProducts, ...previousProducts].slice(0, limit);
}

async function prefetchProductImages(products: Product[]): Promise<void> {
  const urls = Array.from(
    new Set(
      products
        .map((product) => getProductImageUrls(product)[0])
        .filter((url): url is string => Boolean(url)),
    ),
  );

  await Promise.all(
    urls.map(async (url) => {
      try {
        // Prefetch into the same memory/disk cache used by ExpoImage cards.
        await ExpoImage.prefetch(url, 'memory-disk');
      } catch {
        // A card can still load the image directly if prefetch fails.
      }
    }),
  );
}

type ContentLink = {
  labels: Record<AppLanguage, string>;
  source: 'policy' | 'page';
  key: string;
  aliases?: string[];
};

const legalLinks: ContentLink[] = [
  {
    labels: { tr: 'Gizlilik', de: 'Datenschutz', en: 'Privacy' },
    source: 'policy',
    key: 'privacyPolicy',
  },
  {
    labels: { tr: 'AGB', de: 'AGB', en: 'Terms' },
    source: 'policy',
    key: 'termsOfService',
  },
  {
    labels: { tr: 'İade hakkı', de: 'Widerrufsrecht', en: 'Returns' },
    source: 'policy',
    key: 'refundPolicy',
    aliases: ['widerrufsrecht', 'ruckgabe', 'rueckgabe'],
  },
  {
    labels: { tr: 'Impressum', de: 'Impressum', en: 'Legal notice' },
    source: 'page',
    key: 'impressum',
  },
  {
    labels: { tr: 'Hakkımızda', de: 'Über uns', en: 'About us' },
    source: 'page',
    key: 'uber-uns',
    aliases: ['ueber-uns', 'über-uns', 'about-us', 'uber-uns'],
  },
  {
    labels: { tr: 'İletişim', de: 'Kontakt', en: 'Contact' },
    source: 'page',
    key: 'kontakt',
    aliases: ['contact', 'iletisim'],
  },
];

const localeByLanguage: Record<AppLanguage, string> = {
  tr: 'tr-TR',
  de: 'de-DE',
  en: 'en-US',
};

const copy = {
  tr: {
    greeting: 'Merhaba! 👋',
    intro: 'İhtiyacın olan ürünü yaz veya söyle, Frank Eiselt AI senin için bulsun.',
    searchPlaceholder: 'Ürün ara... (örn: Mörtelschlauch NW19)',
    recent: 'Son aramalar',
    recommendations: 'Sizin için önerilenler',
    seeAll: 'Tümünü gör',
    add: 'Sepete ekle',
    adding: 'Ekleniyor...',
    inStock: 'Stokta',
    outOfStock: 'Tükendi',
    noPrice: 'Fiyat yok',
    info: 'Bilgi',
    detailsTitle: 'Ürün açıklaması',
    close: 'Kapat',
    noDescription: 'Bu ürün için açıklama bulunmuyor.',
    chooseVariant: 'Seçenek seçin',
    selectedVariant: 'Seçilen seçenek',
    addSelected: 'Seçili ürünü sepete ekle',
    categoriesEmpty: 'Kategoriler yüklenemedi.',
    retry: 'Tekrar dene',
    heroEyebrow: 'Frank Eiselt',
    heroTitle: 'Aradığın ürüne',
    heroAccent: 'akıllı çözümler',
    heroSearch: 'Akıllı ürün arama',
    heroPayment: 'Güvenli Shopify ödeme',
    heroDelivery: 'Hızlı teslimat',
    heroVisual: 'Doğru ürünü daha hızlı bulun',
    assistantTitle: 'Yapay zeka asistanına sor',
    assistantText: 'Shopify ürün bilgilerine göre kısa ve net cevap verir.',
    assistantPlaceholder: 'Örn: Bu ürün hangi makineye uyar?',
    ask: 'Sor',
    categoriesTitle: 'Kategoriler',
    categoriesText: 'Ana kategoriye dokunun; alt kategoriler aşağıda açılsın.',
    ordersTitle: 'Siparişlerim',
    ordersText: 'Siparişlerinizi görmek için Shopify müşteri hesabınıza giriş yapın.',
    profileTitle: 'Hesabım',
    profileText: 'Shopify hesabınıza giriş yapın veya yeni hesap oluşturun.',
    openAccount: 'Shopify hesabını aç',
    home: 'Ana Sayfa',
    categories: 'Kategoriler',
    search: 'Ara',
    orders: 'Siparişlerim',
    profile: 'Profil',
    connectionError: 'Bağlantı kurulamadı. Lütfen tekrar deneyin.',
    voiceError: 'Sesli arama başlatılamadı.',
    resultPrompt: 'Aramak istediğiniz ürünün adını yazın veya mikrofona söyleyin.',
    searchPageTitle: 'Ürün ara',
    searchPageText: 'Ürün adını yazın veya kendi dilinizde söyleyin.',
    micReady: 'Mikrofon hazır',
    listening: 'Dinliyorum… Konuşabilirsiniz.',
    noResults: 'Henüz bir arama yapılmadı.',
    cart: 'Sepet',
    cartTitle: 'Sepetim',
    cartEmpty: 'Sepetiniz henüz boş.',
    cartEmptyText: 'Ürünleri inceleyip sepete ekleyebilirsiniz.',
    subtotal: 'Ara toplam',
    total: 'Toplam',
    checkout: 'Ödemeye geç',
    checkoutError: 'Ödeme ekranı açılamadı. Lütfen tekrar deneyin.',
    remove: 'Sil',
    cartLoadError: 'Sepet yüklenemedi. Lütfen tekrar deneyin.',
    categoryProducts: 'Kategori ürünleri',
    categoryEmpty: 'Bu kategoride henüz ürün bulunamadı.',
    categoryLoadError: 'Kategori ürünleri yüklenemedi.',
    backToCategories: 'Kategorilere dön',
    contentBack: 'Geri',
    contentLoading: 'Sayfa yükleniyor…',
    contentError: 'Bu sayfa yüklenemedi.',
    accountSignIn: 'Giriş yap veya hesap oluştur',
    accountLoading: 'Müşteri hesabı yükleniyor…',
    accountError: 'Müşteri hesabı yüklenemedi. Lütfen tekrar deneyin.',
    signedInAs: 'Giriş yapılan hesap',
    email: 'E-posta',
    phone: 'Telefon',
    addresses: 'Adreslerim',
    noAddress: 'Kayıtlı adres bulunmuyor.',
    logout: 'Çıkış yap',
    deleteAccount: 'Hesabı sil',
    deleteAccountDescription: 'Hesabınızın ve gerekli olmayan kişisel verilerinizin silinmesini talep edin.',
    deleteAccountConfirm: 'Hesap silme talebiniz Frank Eiselt ekibine iletilecek. Yasal olarak saklanması gereken sipariş ve fatura kayıtları korunabilir.',
    deleteAccountConfirmButton: 'Silme talebi gönder',
    deleteAccountRequestedTitle: 'Talebiniz alındı',
    deleteAccountRequestedText: 'Hesap silme talebiniz kaydedildi. İnceleme tamamlandığında hesabınız silinecek veya anonimleştirilecektir.',
    deleteAccountError: 'Hesap silme talebi gönderilemedi. Lütfen tekrar deneyin.',
    cancel: 'İptal',
    ordersEmpty: 'Henüz siparişiniz bulunmuyor.',
    orderTotal: 'Sipariş toplamı',
    orderStatus: 'Durum',
    orderItems: 'Ürünler',
    orderDetails: 'Sipariş detayını aç',
    refresh: 'Yenile',
  },
  de: {
    greeting: '',
    intro: 'Produkt suchen oder sprechen – Frank Eiselt findet das passende Produkt für Sie.',
    searchPlaceholder: 'Produkt suchen... (z. B. Mörtelschlauch NW19)',
    recent: 'Letzte Suchen',
    recommendations: 'Für Sie empfohlen',
    seeAll: 'Alle anzeigen',
    add: 'In den Warenkorb',
    adding: 'Wird hinzugefügt...',
    inStock: 'Auf Lager',
    outOfStock: 'Ausverkauft',
    noPrice: 'Kein Preis',
    info: 'Info',
    detailsTitle: 'Produktdetails',
    close: 'Schließen',
    noDescription: 'Für dieses Produkt ist keine Beschreibung vorhanden.',
    chooseVariant: 'Variante auswählen',
    selectedVariant: 'Ausgewählte Variante',
    addSelected: 'Auswahl in den Warenkorb',
    categoriesEmpty: 'Kategorien konnten nicht geladen werden.',
    retry: 'Erneut versuchen',
    heroEyebrow: 'Frank Eiselt AI',
    heroTitle: 'Für das gesuchte Produkt',
    heroAccent: 'die intelligente Lösung',
    heroSearch: 'Intelligente Produktsuche',
    heroPayment: 'Sicherer Shopify-Checkout',
    heroDelivery: 'Schnelle Lieferung',
    heroVisual: 'Das passende Produkt schneller finden',
    assistantTitle: 'KI-Assistent fragen',
    assistantText: 'Kurze Antworten ausschließlich anhand der Shopify-Produktdaten.',
    assistantPlaceholder: 'Z. B. Für welche Maschine passt das?',
    ask: 'Fragen',
    categoriesTitle: 'Kategorien',
    categoriesText: 'Hauptkategorie antippen, um die Unterkategorien zu öffnen.',
    ordersTitle: 'Meine Bestellungen',
    ordersText: 'Melden Sie sich bei Ihrem Shopify-Kundenkonto an, um Bestellungen zu sehen.',
    profileTitle: 'Mein Konto',
    profileText: 'Bei Shopify anmelden oder ein neues Kundenkonto erstellen.',
    openAccount: 'Shopify-Konto öffnen',
    home: 'Startseite',
    categories: 'Kategorien',
    search: 'Suche',
    orders: 'Bestellungen',
    profile: 'Profil',
    connectionError: 'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
    voiceError: 'Sprachsuche konnte nicht gestartet werden.',
    resultPrompt: 'Produktnamen eingeben oder ins Mikrofon sprechen.',
    searchPageTitle: 'Produkt suchen',
    searchPageText: 'Produktnamen eingeben oder per Sprache suchen.',
    micReady: 'Mikrofon bereit',
    listening: 'Ich höre zu… Bitte sprechen.',
    noResults: 'Noch keine Suche durchgeführt.',
    cart: 'Warenkorb',
    cartTitle: 'Mein Warenkorb',
    cartEmpty: 'Ihr Warenkorb ist noch leer.',
    cartEmptyText: 'Entdecken Sie Produkte und legen Sie sie in den Warenkorb.',
    subtotal: 'Zwischensumme',
    total: 'Gesamt',
    checkout: 'Zur Kasse',
    checkoutError: 'Der Checkout konnte nicht geöffnet werden. Bitte versuchen Sie es erneut.',
    remove: 'Entfernen',
    cartLoadError: 'Der Warenkorb konnte nicht geladen werden.',
    categoryProducts: 'Produkte der Kategorie',
    categoryEmpty: 'In dieser Kategorie wurden noch keine Produkte gefunden.',
    categoryLoadError: 'Die Kategorieprodukte konnten nicht geladen werden.',
    backToCategories: 'Zurück zu Kategorien',
    contentBack: 'Zurück',
    contentLoading: 'Seite wird geladen…',
    contentError: 'Diese Seite konnte nicht geladen werden.',
    accountSignIn: 'Anmelden oder Konto erstellen',
    accountLoading: 'Kundenkonto wird geladen…',
    accountError: 'Das Kundenkonto konnte nicht geladen werden.',
    signedInAs: 'Angemeldetes Konto',
    email: 'E-Mail',
    phone: 'Telefon',
    addresses: 'Meine Adressen',
    noAddress: 'Keine gespeicherte Adresse vorhanden.',
    logout: 'Abmelden',
    deleteAccount: 'Konto löschen',
    deleteAccountDescription: 'Fordern Sie die Löschung Ihres Kontos und Ihrer nicht mehr erforderlichen personenbezogenen Daten an.',
    deleteAccountConfirm: 'Ihre Löschanfrage wird an Frank Eiselt übermittelt. Gesetzlich erforderliche Bestell- und Rechnungsdaten können weiterhin aufbewahrt werden.',
    deleteAccountConfirmButton: 'Löschung anfordern',
    deleteAccountRequestedTitle: 'Anfrage erhalten',
    deleteAccountRequestedText: 'Ihre Löschanfrage wurde gespeichert. Nach Prüfung wird das Konto gelöscht oder anonymisiert.',
    deleteAccountError: 'Die Löschanfrage konnte nicht gesendet werden. Bitte versuchen Sie es erneut.',
    cancel: 'Abbrechen',
    ordersEmpty: 'Sie haben noch keine Bestellungen.',
    orderTotal: 'Bestellsumme',
    orderStatus: 'Status',
    orderItems: 'Artikel',
    orderDetails: 'Bestelldetails öffnen',
    refresh: 'Aktualisieren',
  },
  en: {
    greeting: 'Hello! 👋',
    intro: 'Type or say what you need and Frank Eiselt AI will find it for you.',
    searchPlaceholder: 'Search products... (e.g. Mörtelschlauch NW19)',
    recent: 'Recent searches',
    recommendations: 'Recommended for you',
    seeAll: 'See all',
    add: 'Add to cart',
    adding: 'Adding...',
    inStock: 'In stock',
    outOfStock: 'Sold out',
    noPrice: 'No price',
    info: 'Details',
    detailsTitle: 'Product description',
    close: 'Close',
    noDescription: 'No description is available for this product.',
    chooseVariant: 'Choose an option',
    selectedVariant: 'Selected option',
    addSelected: 'Add selected item to cart',
    categoriesEmpty: 'Categories could not be loaded.',
    retry: 'Try again',
    heroEyebrow: 'Frank Eiselt AI',
    heroTitle: 'Smart solutions for',
    heroAccent: 'the product you need',
    heroSearch: 'Intelligent product search',
    heroPayment: 'Secure Shopify checkout',
    heroDelivery: 'Fast delivery',
    heroVisual: 'Find the right product faster',
    assistantTitle: 'Ask the AI assistant',
    assistantText: 'Short answers based only on Shopify product information.',
    assistantPlaceholder: 'E.g. Which machine is this compatible with?',
    ask: 'Ask',
    categoriesTitle: 'Categories',
    categoriesText: 'Tap a main category to open its subcategories.',
    ordersTitle: 'My orders',
    ordersText: 'Sign in to your Shopify customer account to view orders.',
    profileTitle: 'My account',
    profileText: 'Sign in to Shopify or create a new customer account.',
    openAccount: 'Open Shopify account',
    home: 'Home',
    categories: 'Categories',
    search: 'Search',
    orders: 'Orders',
    profile: 'Profile',
    connectionError: 'Connection failed. Please try again.',
    voiceError: 'Voice search could not be started.',
    resultPrompt: 'Type a product name or say it into the microphone.',
    searchPageTitle: 'Search products',
    searchPageText: 'Type a product name or say it in your own language.',
    micReady: 'Microphone ready',
    listening: 'Listening… You can speak now.',
    noResults: 'No search has been made yet.',
    cart: 'Cart',
    cartTitle: 'My cart',
    cartEmpty: 'Your cart is empty.',
    cartEmptyText: 'Browse products and add them to your cart.',
    subtotal: 'Subtotal',
    total: 'Total',
    checkout: 'Proceed to checkout',
    checkoutError: 'Checkout could not be opened. Please try again.',
    remove: 'Remove',
    cartLoadError: 'The cart could not be loaded.',
    categoryProducts: 'Category products',
    categoryEmpty: 'No products were found in this category.',
    categoryLoadError: 'Category products could not be loaded.',
    backToCategories: 'Back to categories',
    contentBack: 'Back',
    contentLoading: 'Loading page…',
    contentError: 'This page could not be loaded.',
    accountSignIn: 'Sign in or create account',
    accountLoading: 'Loading customer account…',
    accountError: 'The customer account could not be loaded.',
    signedInAs: 'Signed-in account',
    email: 'Email',
    phone: 'Phone',
    addresses: 'My addresses',
    noAddress: 'No saved address found.',
    logout: 'Sign out',
    deleteAccount: 'Delete account',
    deleteAccountDescription: 'Request deletion of your account and personal data that is no longer required.',
    deleteAccountConfirm: 'Your deletion request will be sent to Frank Eiselt. Order and invoice records required by law may be retained.',
    deleteAccountConfirmButton: 'Request deletion',
    deleteAccountRequestedTitle: 'Request received',
    deleteAccountRequestedText: 'Your deletion request was recorded. After review, the account will be deleted or anonymized.',
    deleteAccountError: 'The deletion request could not be sent. Please try again.',
    cancel: 'Cancel',
    ordersEmpty: 'You do not have any orders yet.',
    orderTotal: 'Order total',
    orderStatus: 'Status',
    orderItems: 'Items',
    orderDetails: 'Open order details',
    refresh: 'Refresh',
  },
} as const;

const initialRecent = ['Mörtelschlauch NW19', 'PFT G4 Smart', 'Rotor Stator D6-3', 'Glättkelle'];
const CART_STORAGE_KEY = 'frankeiselt-ai-shop-cart-id';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function humanizeAccountStatus(value?: string | null): string {
  if (!value) return '—';
  return value
    .toLocaleLowerCase('en-US')
    .replace(/_/g, ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function formatAccountDate(value: string, language: AppLanguage): string {
  const locale = language === 'de' ? 'de-DE' : language === 'tr' ? 'tr-TR' : 'en-US';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

const SHOPIFY_TEMPLATE_PAGE_HANDLES = new Set(['kontakt', 'uber-uns']);

function isShopifyTemplatePage(document: ContentDocument): boolean {
  return SHOPIFY_TEMPLATE_PAGE_HANDLES.has(document.handle) ||
    (!document.body.trim() && Boolean(document.url));
}

function getShopifyTemplatePageUrl(document: ContentDocument): string {
  return document.url || `${SHOP_URL}/pages/${document.handle}`;
}

const SHOPIFY_TEMPLATE_PAGE_SCRIPT = `
(function () {
  function applyAppMode() {
    var styleId = 'frankeiselt-ai-shop-app-mode';
    var style = document.getElementById(styleId);

    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      style.textContent = [
        'html, body {',
        '  margin: 0 !important;',
        '  padding: 0 !important;',
        '  width: 100% !important;',
        '  max-width: 100% !important;',
        '  overflow-x: hidden !important;',
        '  background: #ffffff !important;',
        '}',
        '',
        'body > header,',
        'body > footer,',
        'sticky-header,',
        '.announcement-bar,',
        '.announcement-bar-section,',
        '.header-wrapper,',
        '.shopify-section-group-header-group,',
        '.shopify-section-group-footer-group,',
        '[id*="shopify-section-header"],',
        '[id*="shopify-section-footer"],',
        '[class*="header-group"],',
        '[class*="footer-group"],',
        '.breadcrumb,',
        '.breadcrumbs,',
        '.shopify-policy__container + footer,',
        '#shopify-chat,',
        '#dummy-chat-button-iframe,',
        'iframe[title*="chat" i],',
        'iframe[src*="shopify-chat"],',
        '.cookie-banner,',
        '.cookie-consent,',
        '#cookies-banner,',
        '#shopify-section-announcement-bar {',
        '  display: none !important;',
        '  visibility: hidden !important;',
        '  height: 0 !important;',
        '  min-height: 0 !important;',
        '  overflow: hidden !important;',
        '}',
        '',
        'main,',
        '#MainContent,',
        '.content-for-layout,',
        '.page-width,',
        '.container {',
        '  width: 100% !important;',
        '  max-width: 100% !important;',
        '}',
        '',
        '#MainContent,',
        'main {',
        '  margin: 0 !important;',
        '  padding-top: 0 !important;',
        '}',
        '',
        '.page-width,',
        '.container {',
        '  padding-left: 14px !important;',
        '  padding-right: 14px !important;',
        '}',
        '',
        'input,',
        'select,',
        'textarea,',
        'button {',
        '  font-size: 16px !important;',
        '}',
        '',
        'img,',
        'video,',
        'iframe {',
        '  max-width: 100% !important;',
        '}'
      ].join('\\n');
      document.head.appendChild(style);
    }

    var previewBar = document.querySelector('iframe[src*="preview_bar"]');
    if (previewBar) previewBar.remove();
  }

  applyAppMode();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAppMode);
  }

  var observer = new MutationObserver(applyAppMode);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(function () { observer.disconnect(); }, 12000);
})();
true;
`;

function buildContentHtml(document: ContentDocument): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #07141e; color: #dce5ee; }
    body { padding: 18px 16px 36px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 15px; line-height: 1.65; overflow-wrap: anywhere; }
    h1, h2, h3, h4, h5, h6 { color: #ffffff; line-height: 1.25; margin: 24px 0 10px; }
    h1 { font-size: 26px; margin-top: 0; }
    h2 { font-size: 22px; }
    h3 { font-size: 19px; }
    h4 { font-size: 17px; }
    p, li, td, th { color: #dce5ee; }
    a { color: #007abb; text-decoration: none; }
    strong, b { color: #ffffff; }
    ul, ol { padding-left: 22px; }
    img { max-width: 100%; height: auto; border-radius: 12px; }
    table { width: 100%; min-width: 560px; border-collapse: collapse; background: #0b1b26; }
    th, td { padding: 10px; border: 1px solid #274659; text-align: left; vertical-align: top; }
    th { background: #102b39; color: #ffffff; }
    .table-wrap, .shipping-payment-table-wrap { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    blockquote { margin: 16px 0; padding: 12px 14px; border-left: 4px solid #007abb; background: #0d202c; }
    hr { border: 0; border-top: 1px solid #244054; margin: 24px 0; }
    [style*="color: #222"], [style*="color:#222"] { color: #dce5ee !important; }
    [style*="background: white"], [style*="background:#fff"], [style*="background-color: white"], [style*="background-color:#fff"] { background: transparent !important; }
  </style>
</head>
<body>
  <h1>${escapeHtml(document.title)}</h1>
  <div class="content">${document.body}</div>
  <script>
    document.querySelectorAll('table').forEach(function(table) {
      if (table.parentElement && table.parentElement.classList.contains('table-wrap')) return;
      var wrapper = document.createElement('div');
      wrapper.className = 'table-wrap';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  </script>
</body>
</html>`;
}

type AnimatedContourBackgroundProps = {
  compact?: boolean;
  opacity?: number;
};

function AnimatedContourBackground({
  compact = false,
  opacity = 1,
}: AnimatedContourBackgroundProps) {
  const motion = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(motion, {
        toValue: 1,
        duration: compact ? 9000 : 12500,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );

    animation.start();
    return () => animation.stop();
  }, [compact, motion]);

  const blueTranslateX = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-18, 12, -18],
  });
  const blueTranslateY = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [12, -16, 12],
  });
  const orangeTranslateX = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [20, -14, 20],
  });
  const orangeTranslateY = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [-14, 14, -14],
  });
  const breathe = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.98, 1.035, 0.98],
  });
  const glowOpacity = motion.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.42, 0.7, 0.42],
  });

  const lineCount = compact ? 5 : 7;

  return (
    <View pointerEvents="none" style={[styles.motionBackdrop, { opacity }]}> 
      <LinearGradient
        colors={[
          'rgba(16, 97, 129, 0.42)',
          'rgba(7, 16, 29, 0.08)',
          'rgba(255, 147, 21, 0.34)',
        ]}
        start={{ x: 0, y: 0.1 }}
        end={{ x: 1, y: 0.9 }}
        style={StyleSheet.absoluteFill}
      />

      <Animated.View
        style={[
          styles.motionGlow,
          styles.motionGlowBlue,
          {
            opacity: glowOpacity,
            transform: [
              { translateX: blueTranslateX },
              { translateY: blueTranslateY },
              { scale: breathe },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.motionGlow,
          styles.motionGlowOrange,
          {
            opacity: glowOpacity,
            transform: [
              { translateX: orangeTranslateX },
              { translateY: orangeTranslateY },
              { scale: breathe },
            ],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.contourCluster,
          styles.contourClusterBlue,
          {
            transform: [
              { translateX: blueTranslateX },
              { translateY: blueTranslateY },
              { scale: breathe },
              { rotate: '-8deg' },
            ],
          },
        ]}
      >
        {Array.from({ length: lineCount }).map((_, index) => (
          <View
            key={`blue-${index}`}
            style={[
              styles.contourLine,
              styles.contourLineBlue,
              {
                width: (compact ? 165 : 270) + index * (compact ? 28 : 36),
                height: (compact ? 230 : 390) + index * (compact ? 28 : 36),
                borderRadius: (compact ? 58 : 94) + index * 13,
                opacity: 0.78 - index * 0.075,
              },
            ]}
          />
        ))}
      </Animated.View>

      <Animated.View
        style={[
          styles.contourCluster,
          styles.contourClusterOrange,
          {
            transform: [
              { translateX: orangeTranslateX },
              { translateY: orangeTranslateY },
              { scale: breathe },
              { rotate: '9deg' },
            ],
          },
        ]}
      >
        {Array.from({ length: lineCount }).map((_, index) => (
          <View
            key={`orange-${index}`}
            style={[
              styles.contourLine,
              styles.contourLineOrange,
              {
                width: (compact ? 165 : 270) + index * (compact ? 28 : 36),
                height: (compact ? 230 : 390) + index * (compact ? 28 : 36),
                borderRadius: (compact ? 58 : 94) + index * 13,
                opacity: 0.76 - index * 0.075,
              },
            ]}
          />
        ))}
      </Animated.View>
    </View>
  );
}

type ResilientRemoteImageProps = {
  urls: string[];
  style: any;
  logoStyle: any;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
};

const PRODUCT_IMAGE_FALLBACKS_BY_SKU: Record<string, string[]> = {};

function getProductImageUrls(product: Product, preferredVariantId?: string): string[] {
  const preferredVariant = product.variants?.find(
    (variant) => variant.id === preferredVariantId,
  );
  const productSkus = [
    preferredVariant?.sku,
    ...(product.variants ?? []).map((variant) => variant.sku),
  ].filter((sku): sku is string => Boolean(sku));
  const skuFallbacks = productSkus.flatMap(
    (sku) => PRODUCT_IMAGE_FALLBACKS_BY_SKU[sku.trim()] ?? [],
  );
  const candidates = [
    preferredVariant?.imageUrl,
    ...skuFallbacks,
    product.imageUrl,
    ...(product.images ?? []).map((image) => image.url),
    ...(product.variants ?? []).map((variant) => variant.imageUrl),
  ].filter((url): url is string => Boolean(url));

  return Array.from(new Set(candidates));
}

const PRODUCT_IMAGE_RETRY_DELAYS_MS = [500, 1200];

function ResilientRemoteImage({
  urls,
  style,
  logoStyle,
  resizeMode = 'contain',
}: ResilientRemoteImageProps) {
  const uniqueUrls = Array.from(new Set(urls.filter(Boolean)));
  const urlsKey = uniqueUrls.join('|');
  const [urlIndex, setUrlIndex] = useState(0);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    setUrlIndex(0);
    setRetryAttempt(0);

    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, [urlsKey]);

  const uri = uniqueUrls[urlIndex];
  const contentFit: 'cover' | 'contain' | 'fill' | 'none' =
    resizeMode === 'stretch'
      ? 'fill'
      : resizeMode === 'center'
        ? 'none'
        : resizeMode === 'repeat'
          ? 'cover'
          : resizeMode;

  const handleImageError = () => {
    if (!uri) return;

    if (retryAttempt < PRODUCT_IMAGE_RETRY_DELAYS_MS.length) {
      const nextAttempt = retryAttempt + 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        setRetryAttempt(nextAttempt);
      }, PRODUCT_IMAGE_RETRY_DELAYS_MS[retryAttempt]);
      return;
    }

    setRetryAttempt(0);
    setUrlIndex((current) => current + 1);
  };

  if (!uri) {
    return (
      <View
        style={[
          style,
          {
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#F2F6F8',
          },
        ]}
      >
        <Image source={require('../../assets/logo.png')} style={logoStyle} />
      </View>
    );
  }

  return (
    <View
      style={[
        style,
        {
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#F2F6F8',
          overflow: 'hidden',
        },
      ]}
    >
      <Image source={require('../../assets/logo.png')} style={logoStyle} />
      <ExpoImage
        key={`${urlsKey}:${urlIndex}:${retryAttempt}`}
        source={{ uri }}
        contentFit={contentFit}
        cachePolicy="memory-disk"
        recyclingKey={`${urlsKey}:${urlIndex}`}
        transition={120}
        style={StyleSheet.absoluteFill}
        onLoad={() => {
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = null;
        }}
        onError={handleImageError}
      />
    </View>
  );
}


function buildProductDescriptionHtml(product: Product): string {
  const body = product.descriptionHtml?.trim()
    || `<p>${escapeHtml(product.description?.trim() || 'Für dieses Produkt ist keine Beschreibung vorhanden.')}</p>`;

  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #ffffff; color: #1b2f3a; }
    body { padding: 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; font-size: 15px; line-height: 1.65; }
    h1, h2, h3, h4 { color: #12262f; line-height: 1.3; }
    a { color: #007ABB; }
    img { max-width: 100%; height: auto; border-radius: 10px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 9px; border: 1px solid #dce5e9; text-align: left; }
    ul, ol { padding-left: 22px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}

export function HomeScreenV2() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const shopifyCheckout = useShopifyCheckoutSheet();
  const pulse = useRef(new Animated.Value(0)).current;

  const language: AppLanguage = 'de';
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [searchText, setSearchText] = useState('');
  const [statusText, setStatusText] = useState<string>(copy.de.resultPrompt);
  const [recommendedProducts, setRecommendedProducts] = useState<Product[]>([]);
  const [saleProductPool, setSaleProductPool] = useState<Product[]>([]);
  const [homeCategories, setHomeCategories] = useState<HomeCategoryConfig[]>([]);
  const [categorySlides, setCategorySlides] = useState<CategorySlide[]>([]);
  const [homeCategoryProducts, setHomeCategoryProducts] = useState<Record<string, Product[]>>({});
  const [loadingHomeSections, setLoadingHomeSections] = useState(true);
  const [hydratingHomeCategories, setHydratingHomeCategories] = useState(true);
  const [heroSlideIndex, setHeroSlideIndex] = useState(0);
  const heroSliderRef = useRef<ScrollView>(null);
  const previousRecommendedIdsRef = useRef<string[]>([]);
  const hydratedRecommendationCacheRef = useRef<Map<string, Product>>(new Map());
  const [searchProducts, setSearchProducts] = useState<Product[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [openMenuId, setOpenMenuId] = useState<string>();
  const [openNestedPath, setOpenNestedPath] = useState<string[]>([]);
  const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
  const [categoryTitle, setCategoryTitle] = useState('');
  const [categoryBackTab, setCategoryBackTab] = useState<AppTab>('categories');
  const [loadingCategoryProducts, setLoadingCategoryProducts] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [recentSearches, setRecentSearches] = useState(initialRecent);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('');
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingMenu, setLoadingMenu] = useState(false);
  const [loadingAssistant, setLoadingAssistant] = useState(false);
  const [listening, setListening] = useState(false);
  const [cartId, setCartId] = useState<string>();
  const [cart, setCart] = useState<Cart>();
  const [loadingCart, setLoadingCart] = useState(false);
  const [updatingLineId, setUpdatingLineId] = useState<string>();
  const [cartError, setCartError] = useState('');
  const [addingVariantId, setAddingVariantId] = useState<string>();
  const [selectedProduct, setSelectedProduct] = useState<Product>();
  const [selectedVariantId, setSelectedVariantId] = useState<string>();
  const [productBackTab, setProductBackTab] = useState<AppTab>('home');
  const [cartBackTab, setCartBackTab] = useState<AppTab>('home');
  const [loadingProductDetails, setLoadingProductDetails] = useState(false);
  const [openPublicDetailSections, setOpenPublicDetailSections] = useState<Record<string, boolean>>({});
  const [contentDocument, setContentDocument] = useState<ContentDocument>();
  const [loadingContent, setLoadingContent] = useState(false);
  const [contentError, setContentError] = useState('');
  const [contentBackTab, setContentBackTab] = useState<AppTab>('home');
  const [customerAuthenticated, setCustomerAuthenticated] = useState(false);
  const [customerProfile, setCustomerProfile] = useState<CustomerProfile>();
  const [customerOrders, setCustomerOrders] = useState<CustomerOrder[]>([]);
  const [selectedCustomerOrder, setSelectedCustomerOrder] = useState<CustomerOrder>();
  const [loadingCustomer, setLoadingCustomer] = useState(false);
  const [customerError, setCustomerError] = useState('');
  const [requestingAccountDeletion, setRequestingAccountDeletion] = useState(false);

  const t = copy[language];
  const cartPreloadKey = cart
    ? `${cart.id}:${cart.totalQuantity}:${cart.lines
        .map((line) => `${line.id}:${line.quantity}`)
        .join('|')}`
    : '';
  const cardGap = 8;
  const pagePadding = 14;
  const cardWidth = Math.max(96, (width - pagePadding * 2 - cardGap * 2) / 3);

  useEffect(() => {
    void loadHomeSections();
    void restoreCart();
    void restoreCustomerAccount();
  }, []);

  useEffect(() => {
    if (categorySlides.length === 0) return;

    const sliderWidth = Math.max(1, width - pagePadding * 2);
    const interval = setInterval(() => {
      setHeroSlideIndex((current) => {
        const next = (current + 1) % categorySlides.length;
        heroSliderRef.current?.scrollTo({ x: next * sliderWidth, animated: true });
        return next;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [categorySlides.length, width]);

  useEffect(() => {
    if (saleProductPool.length === 0) return;

    let cancelled = false;
    let rotating = false;

    const rotateRecommendations = async () => {
      if (rotating) return;
      rotating = true;

      try {
        const selectedProducts = pickFreshRandomProducts(
          saleProductPool,
          6,
          previousRecommendedIdsRef.current,
        );
        const nextProducts = await hydrateRecommendationImages(selectedProducts);

        await prefetchProductImages(nextProducts);
        if (cancelled) return;

        previousRecommendedIdsRef.current = nextProducts.map((product) => product.id);
        setRecommendedProducts(nextProducts);
      } finally {
        rotating = false;
      }
    };

    const interval = setInterval(() => {
      void rotateRecommendations();
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [saleProductPool]);

  useEffect(() => {
    if (activeTab === 'categories' && menuItems.length === 0) void loadMenu();
  }, [activeTab, menuItems.length]);

  useEffect(() => {
    if (activeTab === 'profile' || activeTab === 'orders') {
      void loadCustomerAccount(activeTab === 'orders');
    }
  }, [activeTab]);

  useEffect(() => {
    const completedSubscription = shopifyCheckout.addEventListener(
      'completed',
      () => {
        void (async () => {
          await clearSavedCart();
          setCartError('');

          if (customerAuthenticated) {
            await loadCustomerAccount(true);
            setActiveTab('orders');
          } else {
            setActiveTab('home');
          }
        })();
      },
    );

    const errorSubscription = shopifyCheckout.addEventListener(
      'error',
      () => setCartError(copy[language].checkoutError),
    );

    return () => {
      completedSubscription?.remove();
      errorSubscription?.remove();
    };
  }, [shopifyCheckout, customerAuthenticated, language]);

  useEffect(() => {
    if (
      activeTab !== 'cart' ||
      !cart?.checkoutUrl ||
      cart.lines.length === 0
    ) {
      return;
    }

    try {
      shopifyCheckout.preload(cart.checkoutUrl);
    } catch {
      // Preload is only an optimization. Checkout can still be presented normally.
    }
  }, [activeTab, cart?.checkoutUrl, cartPreloadKey, shopifyCheckout]);

  useEffect(() => {
    if (!listening) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    animation.start();
    return () => animation.stop();
  }, [listening, pulse]);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) return;
    setSearchText(transcript);
    if (event.isFinal) void runSearch(transcript);
  });
  useSpeechRecognitionEvent('error', () => setListening(false));

  async function restoreCustomerAccount() {
    const session = await getValidCustomerSession();
    setCustomerAuthenticated(Boolean(session));
  }

  async function loadCustomerAccount(includeOrders: boolean) {
    setLoadingCustomer(true);
    setCustomerError('');

    try {
      const session = await getValidCustomerSession();
      if (!session) {
        setCustomerAuthenticated(false);
        setCustomerProfile(undefined);
        setCustomerOrders([]);
        return;
      }

      const profile = await getCustomerProfile();
      setCustomerAuthenticated(true);
      setCustomerProfile(profile);

      if (includeOrders) {
        setCustomerOrders(await getCustomerOrders());
      }
    } catch {
      setCustomerError(t.accountError);
    } finally {
      setLoadingCustomer(false);
    }
  }

  async function handleCustomerSignIn() {
    setLoadingCustomer(true);
    setCustomerError('');

    try {
      const session = await signInCustomer(language);

      if (cartId) {
        try {
          await persistCart(
            await setCartBuyerIdentity(cartId, session.accessToken),
          );
        } catch {
          // Customer sign-in remains valid even if an old cart cannot be linked.
        }
      }

      await loadCustomerAccount(activeTab === 'orders');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (!message.toLocaleLowerCase('en-US').includes('cancel')) {
        setCustomerError(t.accountError);
      }
    } finally {
      setLoadingCustomer(false);
    }
  }

  async function handleCustomerSignOut() {
    setLoadingCustomer(true);
    try {
      if (cartId) {
        try {
          await persistCart(await setCartBuyerIdentity(cartId, null));
        } catch {
          // Local sign-out continues even if a stale cart cannot be detached.
        }
      }

      await signOutCustomer();
    } finally {
      setCustomerAuthenticated(false);
      setCustomerProfile(undefined);
      setCustomerOrders([]);
      setCustomerError('');
      setLoadingCustomer(false);
    }
  }

  function confirmAccountDeletion() {
    Alert.alert(
      t.deleteAccount,
      t.deleteAccountConfirm,
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.deleteAccountConfirmButton,
          style: 'destructive',
          onPress: () => void handleAccountDeletionRequest(),
        },
      ],
    );
  }

  async function handleAccountDeletionRequest() {
    if (requestingAccountDeletion) return;

    setRequestingAccountDeletion(true);
    setCustomerError('');

    try {
      const session = await getValidCustomerSession();
      if (!session) throw new Error('AUTH_REQUIRED');

      await requestAccountDeletion(session.accessToken, language);
      await signOutCustomer();

      setCustomerAuthenticated(false);
      setCustomerProfile(undefined);
      setCustomerOrders([]);

      Alert.alert(
        t.deleteAccountRequestedTitle,
        t.deleteAccountRequestedText,
      );
    } catch {
      setCustomerError(t.deleteAccountError);
    } finally {
      setRequestingAccountDeletion(false);
    }
  }

  async function persistCart(nextCart: Cart) {
    setCart(nextCart);
    setCartId(nextCart.id);
    setCartError('');
    await AsyncStorage.setItem(CART_STORAGE_KEY, nextCart.id);
  }

  async function clearSavedCart() {
    setCart(undefined);
    setCartId(undefined);
    await AsyncStorage.removeItem(CART_STORAGE_KEY);
  }

  async function restoreCart() {
    const savedCartId = await AsyncStorage.getItem(CART_STORAGE_KEY);
    if (!savedCartId) return;

    setCartId(savedCartId);
    setLoadingCart(true);
    try {
      const savedCart = await getCart(savedCartId);
      await persistCart(savedCart);
    } catch {
      await clearSavedCart();
    } finally {
      setLoadingCart(false);
    }
  }

  async function hydrateRecommendationImages(products: Product[]): Promise<Product[]> {
    if (products.length === 0) return [];

    const hydratedProducts = [...products];
    let nextIndex = 0;
    const workerCount = Math.min(2, products.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < products.length) {
        const productIndex = nextIndex;
        nextIndex += 1;
        const product = products[productIndex];
        const cacheKey = product.handle ?? product.id;
        const cachedProduct = hydratedRecommendationCacheRef.current.get(cacheKey);

        if (cachedProduct) {
          hydratedProducts[productIndex] = cachedProduct;
          continue;
        }
        if (!product.handle) continue;

        try {
          let candidate = product;

          try {
            const detailedProduct = await getProductByHandle(product.handle);
            candidate = {
              ...product,
              ...detailedProduct,
              id: product.id,
              handle: detailedProduct.handle ?? product.handle,
              imageUrl: detailedProduct.imageUrl ?? product.imageUrl,
              images: detailedProduct.images?.length
                ? detailedProduct.images
                : product.images,
              variants: detailedProduct.variants?.length
                ? detailedProduct.variants
                : product.variants,
            };
          } catch {
            // Public storefront hydration below does not depend on detail API success.
          }

          const hydratedProduct = await hydrateProductImages(candidate);
          hydratedRecommendationCacheRef.current.set(cacheKey, hydratedProduct);
          hydratedProducts[productIndex] = hydratedProduct;
        } catch {
          // Keep the collection response when every image source fails.
        }
      }
    });

    await Promise.all(workers);
    return hydratedProducts;
  }

  async function hydrateHomeCategorySections(
    sections: Record<string, Product[]>,
  ): Promise<void> {
    const entries = Object.entries(sections);
    let nextCategoryIndex = 0;
    // Hydrate one category at a time. This prevents Android from opening
    // dozens of image requests at once and caching transient failures.
    const workerCount = Math.min(1, entries.length);

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextCategoryIndex < entries.length) {
        const categoryIndex = nextCategoryIndex;
        nextCategoryIndex += 1;
        const [handle, products] = entries[categoryIndex];
        const hydratedProducts = await hydrateRecommendationImages(products);

        await prefetchProductImages(hydratedProducts);
        setHomeCategoryProducts((current) => ({
          ...current,
          [handle]: hydratedProducts,
        }));
      }
    });

    await Promise.all(workers);
  }

  async function loadHomeSections() {
    setLoadingHomeSections(true);
    setHydratingHomeCategories(true);
    setHomeCategoryProducts({});

    try {
      const collections = await getCollections(50).catch(() => []);
      const availableHomeCategories = HOME_PRODUCT_CATEGORIES;

      setHomeCategories(availableHomeCategories);
      setCategorySlides(buildCategorySlides(
        collections.map((collection) => ({
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
        })),
      ));

      const [entries, saleProducts] = await Promise.all([
        Promise.all(
          availableHomeCategories.map(async (category): Promise<[string, Product[]]> => {
            try {
              const result = await getCollectionProducts(category.id, undefined, 10);
              return [category.handle, result.products.slice(0, 10)];
            } catch {
              return [category.handle, []];
            }
          }),
        ),
        getSaleProducts(24).catch(() => []),
      ]);

      const nextSections = Object.fromEntries(entries) as Record<string, Product[]>;
      const recommendationPool = saleProducts.length > 0
        ? saleProducts
        : Object.values(nextSections).flat();
      const initialSelection = pickFreshRandomProducts(recommendationPool, 6);
      const initialRecommendations = await hydrateRecommendationImages(initialSelection);

      await prefetchProductImages(initialRecommendations);

      setSaleProductPool(recommendationPool);
      previousRecommendedIdsRef.current = initialRecommendations.map(
        (product) => product.id,
      );
      setRecommendedProducts(initialRecommendations);
      setLoadingHomeSections(false);

      await hydrateHomeCategorySections(nextSections);
    } finally {
      setLoadingHomeSections(false);
      setHydratingHomeCategories(false);
    }
  }

  async function loadMenu() {
    setLoadingMenu(true);

    try {
      const mainMenuItems = await getMainMenu();

      if (mainMenuItems.length > 0) {
        setMenuItems(mainMenuItems);
        return;
      }
    } catch {
      // Menü sorgusu başarısız olursa koleksiyonlara geç.
    }

    try {
      const collections = await getCollections(50);

      setMenuItems(
        collections.map((collection) => ({
          id: collection.id,
          title: collection.title,
          type: 'COLLECTION',
          url: `/collections/${collection.handle}`,
          resourceId: collection.id,
          collection: {
            id: collection.id,
            title: collection.title,
            handle: collection.handle,
            imageUrl: collection.imageUrl,
          },
          items: [],
        })),
      );
    } catch {
      setMenuItems([]);
    } finally {
      setLoadingMenu(false);
    }
  }

  async function runSearch(raw?: string) {
    const query = (raw ?? searchText).trim();
    if (query.length < 2 || loadingSearch) return;

    setActiveTab('search');
    setSearchText('');
    setSearchProducts([]);
    setStatusText(query);
    setLoadingSearch(true);
    setRecentSearches((current) => [query, ...current.filter((item) => item !== query)].slice(0, 6));

    try {
      const result = await sendChat(query, language);
      setSearchProducts(result.products);
      setStatusText(result.reply);
    } catch {
      setStatusText(t.connectionError);
    } finally {
      setLoadingSearch(false);
    }
  }

  async function startVoiceSearch() {
    try {
      if (listening) {
        ExpoSpeechRecognitionModule.stop();
        return;
      }

      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) throw new Error('permission denied');

      ExpoSpeechRecognitionModule.start({
        lang: localeByLanguage[language],
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        iosTaskHint: 'search',
      });
    } catch {
      setStatusText(t.voiceError);
    }
  }

  async function openProduct(product: Product) {
    const defaultVariant =
      product.variants?.find((variant) => variant.availableForSale) ??
      product.variants?.[0];

    setProductBackTab(activeTab === 'productDetails' ? productBackTab : activeTab);
    setSelectedProduct(product);
    setSelectedVariantId(defaultVariant?.id ?? product.variantId);
    setOpenPublicDetailSections({});
    setActiveTab('productDetails');

    if (!product.handle) return;

    setLoadingProductDetails(true);
    try {
      const detailedProduct = await getProductByHandle(product.handle);
      const detailedDefaultVariant =
        detailedProduct.variants?.find((variant) => variant.availableForSale) ??
        detailedProduct.variants?.[0];
      setSelectedProduct(detailedProduct);
      setSelectedVariantId(detailedDefaultVariant?.id ?? detailedProduct.variantId);
    } catch {
      // Karttaki temel ürün bilgileriyle detay sayfası kullanılmaya devam eder.
    } finally {
      setLoadingProductDetails(false);
    }
  }

  async function addProduct(product: Product, variantId?: string) {
    const merchandiseId = variantId ?? product.variantId;
    if (!merchandiseId) return;

    const shouldOpenCart = activeTab === 'productDetails';

    setAddingVariantId(merchandiseId);
    try {
      const session = await getValidCustomerSession();
      const nextCart = await addToCart(
        merchandiseId,
        cartId,
        session?.accessToken,
      );
      await persistCart(nextCart);

      if (shouldOpenCart) {
        setCartBackTab('productDetails');
        setActiveTab('cart');
      }
    } catch {
      setCartError(t.cartLoadError);
    } finally {
      setAddingVariantId(undefined);
    }
  }

  async function changeCartQuantity(lineId: string, quantity: number) {
    if (!cartId || quantity < 1) return;

    setUpdatingLineId(lineId);
    try {
      const nextCart = await updateCartLine(cartId, lineId, quantity);
      await persistCart(nextCart);
    } catch {
      setCartError(t.cartLoadError);
    } finally {
      setUpdatingLineId(undefined);
    }
  }

  async function deleteCartLine(lineId: string) {
    if (!cartId) return;

    setUpdatingLineId(lineId);
    try {
      const nextCart = await removeCartLine(cartId, lineId);
      await persistCart(nextCart);
    } catch {
      setCartError(t.cartLoadError);
    } finally {
      setUpdatingLineId(undefined);
    }
  }

  async function openCheckout() {
    if (!cart?.checkoutUrl) return;

    setCartError('');

    let checkoutCart = cart;

    try {
      const session = await getValidCustomerSession();
      if (session) {
        checkoutCart = await setCartBuyerIdentity(
          cart.id,
          session.accessToken,
        );
        await persistCart(checkoutCart);
      }

      await shopifyCheckout.present(checkoutCart.checkoutUrl);
    } catch {
      // Safety fallback preserves the previous working behavior if the native
      // checkout module cannot be presented on a specific device.
      try {
        await Linking.openURL(checkoutCart.checkoutUrl);
      } catch {
        setCartError(t.checkoutError);
      }
    }
  }

  async function askAssistant() {
    const question = assistantQuestion.trim();
    if (question.length < 2 || loadingAssistant) return;
    setAssistantAnswer('');
    setLoadingAssistant(true);
    try {
      const result = await askProductAssistant(question, language);
      setAssistantAnswer(result.answer);
    } catch {
      setAssistantAnswer(t.connectionError);
    } finally {
      setLoadingAssistant(false);
    }
  }

  async function openContent(link: ContentLink) {
    const previousTab = activeTab === 'content' ? contentBackTab : activeTab;
    setContentBackTab(previousTab);
    setContentDocument(undefined);
    setContentError('');
    setLoadingContent(true);
    setActiveTab('content');

    try {
      if (link.source === 'policy') {
        const policies = await getShopPolicies();
        const policy = policies.find((item) => item.type === link.key);
        if (policy) {
          setContentDocument(policy);
          return;
        }
      }

      try {
        const exactPage = await getContentPage(link.key);
        setContentDocument(exactPage);
        return;
      } catch {
        // Bazı eski Shopify sayfalarında farklı handle kullanılabilir.
      }

      const pages = await getContentPages(100);
      const candidates = [link.key, ...(link.aliases ?? [])]
        .map((value) => value.toLocaleLowerCase('de-DE'));
      const page = pages.find((item) => {
        const handle = item.handle.toLocaleLowerCase('de-DE');
        const title = item.title.toLocaleLowerCase('de-DE');
        return candidates.some((candidate) => handle === candidate || title.includes(candidate));
      });

      if (!page) throw new Error('content not found');
      setContentDocument(page);
    } catch {
      setContentError(t.contentError);
    } finally {
      setLoadingContent(false);
    }
  }

  async function openMenuItem(item: MenuItem) {
    const collectionId = item.collection?.id ?? (
      item.type === 'COLLECTION' ? item.resourceId : undefined
    );

    if (collectionId) {
      setCategoryBackTab('categories');
      setCategoryTitle(item.title);
      setCategoryProducts([]);
      setCategoryError('');
      setLoadingCategoryProducts(true);
      setActiveTab('categoryProducts');

      try {
        const result = await getCollectionProducts(collectionId, item.collection?.handle, 50);
        setCategoryTitle(result.collection?.title ?? item.title);
        setCategoryProducts(result.products);
      } catch {
        setCategoryError(t.categoryLoadError);
      } finally {
        setLoadingCategoryProducts(false);
      }
      return;
    }

    let url = item.url;
    if (!url) return;
    if (url.startsWith('/')) url = `${SHOP_URL}${url}`;
    await Linking.openURL(url);
  }

  async function openHomeCategory(category: HomeCategoryConfig) {
    setCategoryBackTab('home');
    setCategoryTitle(category.title);
    setCategoryError('');
    setActiveTab('categoryProducts');

    const cachedProducts = homeCategoryProducts[category.handle] ?? [];
    if (cachedProducts.length > 0) {
      setCategoryProducts(cachedProducts);
    } else {
      setCategoryProducts([]);
    }

    setLoadingCategoryProducts(true);
    try {
      const result = await getCollectionProducts(category.id, undefined, 50);
      setCategoryTitle(result.collection?.title ?? category.title);
      setCategoryProducts(result.products);
    } catch {
      if (cachedProducts.length === 0) setCategoryError(t.categoryLoadError);
    } finally {
      setLoadingCategoryProducts(false);
    }
  }

  function togglePublicDetail(key: string) {
    setOpenPublicDetailSections((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  function renderPublicAccordion(
    key: string,
    title?: string,
    body?: string,
    icon = '＋',
  ) {
    if (!title || !body?.trim()) return null;
    const open = Boolean(openPublicDetailSections[key]);

    return (
      <View style={styles.publicDetailAccordion}>
        <Pressable
          onPress={() => togglePublicDetail(key)}
          style={styles.publicDetailAccordionHeader}
        >
          <Text style={styles.publicDetailAccordionIcon}>{icon}</Text>
          <Text style={styles.publicDetailAccordionTitle}>{title}</Text>
          <Text style={styles.publicDetailAccordionChevron}>
            {open ? '−' : '+'}
          </Text>
        </Pressable>
        {open ? (
          <Text style={styles.publicDetailAccordionBody}>{body}</Text>
        ) : null}
      </View>
    );
  }

  function renderPublicProductDetails(
    product: Product,
    selectedVariant?: NonNullable<Product['variants']>[number],
  ) {
    const details = product.pageDetails;
    if (!details) return null;

    const url = product.onlineStoreUrl
      ?? details.sourceUrl
      ?? (product.handle ? `${SHOP_URL}/products/${product.handle}` : SHOP_URL);
    const compareAtPrice = selectedVariant?.compareAtPrice;
    const currency = selectedVariant?.currencyCode ?? product.currencyCode ?? 'EUR';

    return (
      <View style={styles.publicDetailWrap}>
        <View style={styles.publicDetailTopRow}>
          {details.availabilityBadge ? (
            <View style={styles.publicDetailBadge}>
              <Text style={styles.publicDetailBadgeText}>
                {details.availabilityBadge}
              </Text>
            </View>
          ) : <View />}

          <Pressable
            onPress={() => void Share.share({
              title: product.title,
              message: `${product.title}\n${url}`,
              url,
            })}
            style={styles.publicDetailShareButton}
          >
            <Text style={styles.publicDetailShareText}>↗ Teilen</Text>
          </Pressable>
        </View>

        {compareAtPrice && compareAtPrice !== selectedVariant?.price ? (
          <Text style={styles.publicDetailComparePrice}>
            Statt {compareAtPrice} {currency}
          </Text>
        ) : null}

        <Text style={styles.publicDetailTax}>
          {details.taxAndShippingText ?? 'inkl. 19% USt. zzgl. Versandkosten'}
        </Text>

        {details.deliveryTime ? (
          <Text style={styles.publicDetailService}>
            ✓ Lieferzeit: {details.deliveryTime}
          </Text>
        ) : null}
        {details.selfPickupText ? (
          <Text style={styles.publicDetailService}>✓ {details.selfPickupText}</Text>
        ) : null}
        {details.pickupText ? (
          <Text style={styles.publicDetailPickup}>⌖ {details.pickupText}</Text>
        ) : null}

        <View style={styles.publicDetailAccordionGroup}>
          {renderPublicAccordion('shipping', details.shippingTitle, details.shippingText, '▰')}
          {renderPublicAccordion('payment', details.paymentTitle, details.paymentText, '▣')}
          {renderPublicAccordion('returns', details.returnsTitle, details.returnsText, '⇄')}
        </View>

        {details.technicalData?.length ? (
          <View style={styles.publicDetailSection}>
            <Text style={styles.productDetailSectionTitle}>Technische Daten</Text>
            {details.technicalData.map((item, index) => (
              <View key={`${item.label}-${index}`} style={styles.publicDetailSpecRow}>
                <Text style={styles.publicDetailSpecLabel}>{item.label}</Text>
                <Text style={styles.publicDetailSpecValue}>{item.value}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {details.productFeatures?.length ? (
          <View style={styles.publicDetailSection}>
            <Text style={styles.productDetailSectionTitle}>Produktmerkmale</Text>
            {details.productFeatures.map((item, index) => (
              <Text key={`feature-${index}`} style={styles.publicDetailFeature}>
                ⊕ {item}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.publicDetailAccordionGroup}>
          {renderPublicAccordion(
            'manufacturer',
            details.manufacturerTitle,
            details.manufacturerText ?? product.vendor,
            '♙',
          )}
          {renderPublicAccordion(
            'safety',
            details.safetyTitle,
            details.safetyText,
            '♢',
          )}
        </View>
      </View>
    );
  }

  function renderHeader() {
    return (
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Zur Startseite"
          onPress={() => setActiveTab('home')}
          hitSlop={8}
          style={styles.brandButton}
        >
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <Text style={styles.brand}>Frank Eiselt</Text>
        </Pressable>
      </View>
    );
  }
  function renderSearchBox() {
    const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] });
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] });
    const buttonScale = listening
      ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] })
      : 1;

    return (
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => void runSearch()}
            placeholder={t.searchPlaceholder}
            placeholderTextColor="#7D8999"
            returnKeyType="search"
            style={styles.searchInput}
          />
        </View>
        <View style={styles.micWrap}>
          {listening ? (
            <Animated.View
              style={[
                styles.pulseRing,
                { opacity: pulseOpacity, transform: [{ scale: pulseScale }] },
              ]}
            />
          ) : null}
          <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
            <Pressable
              onPress={startVoiceSearch}
              style={[styles.micButton, listening && styles.micButtonActive]}
            >
              <Text style={styles.micEmoji}>{listening ? '■' : '🎤'}</Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    );
  }

  function renderProducts(products: Product[]) {
    return (
      <View style={styles.productGrid}>
        {products.map((product) => (
          <View key={product.id} style={[styles.productCard, { width: cardWidth }]}>
            <Pressable
              onPress={() => void openProduct(product)}
              style={[styles.productMedia, { height: cardWidth }]}
            >
              <ResilientRemoteImage
                urls={getProductImageUrls(product)}
                style={styles.productImage}
                logoStyle={styles.fallbackLogo}
              />
            </Pressable>

            <View style={styles.productBody}>
              <Text numberOfLines={2} style={styles.productTitle}>
                {product.title}
              </Text>

              <Text style={styles.productPrice}>
                {product.price
                  ? `${product.price} ${product.currencyCode ?? 'EUR'}`
                  : t.noPrice}
              </Text>

              <Text style={styles.productStock}>
                {product.availableForSale ? t.inStock : t.outOfStock}
              </Text>

              <Pressable
                disabled={
                  !product.availableForSale ||
                  !product.variantId ||
                  addingVariantId === product.variantId
                }
                onPress={() => {
                  if ((product.variants?.length ?? 0) > 1) {
                    openProduct(product);
                  } else {
                    void addProduct(product, product.variantId);
                  }
                }}
                style={[
                  styles.addButton,
                  (!product.availableForSale || !product.variantId) &&
                    styles.disabled,
                ]}
              >
                <Text numberOfLines={1} style={styles.addButtonText}>
                  {addingVariantId === product.variantId
                    ? t.adding
                    : t.add}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </View>
    );
  }

  function renderHorizontalProducts(products: Product[]) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.horizontalProductList}
      >
        {products.slice(0, 10).map((product) => (
          <View key={product.id} style={[styles.productCard, styles.horizontalProductCard, { width: cardWidth }]}> 
            <Pressable
              onPress={() => void openProduct(product)}
              style={[styles.productMedia, { height: cardWidth }]}
            >
              <ResilientRemoteImage
                urls={getProductImageUrls(product)}
                style={styles.productImage}
                logoStyle={styles.fallbackLogo}
              />
            </Pressable>

            <View style={styles.productBody}>
              <Text numberOfLines={2} style={styles.productTitle}>{product.title}</Text>
              <Text style={styles.productPrice}>
                {product.price ? `${product.price} ${product.currencyCode ?? 'EUR'}` : t.noPrice}
              </Text>
              <Text style={styles.productStock}>
                {product.availableForSale ? t.inStock : t.outOfStock}
              </Text>
              <Pressable
                disabled={!product.availableForSale || !product.variantId || addingVariantId === product.variantId}
                onPress={() => void addProduct(product)}
                style={[
                  styles.addButton,
                  (!product.availableForSale || !product.variantId) && styles.disabled,
                ]}
              >
                <Text style={styles.addButtonText}>
                  {addingVariantId === product.variantId ? t.adding : t.add}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    );
  }

  function renderProductDetails() {
    const product = selectedProduct;
    if (!product) return null;

    const variants = product.variants ?? [];
    const selectedVariant =
      variants.find((variant) => variant.id === selectedVariantId) ??
      variants.find((variant) => variant.availableForSale) ??
      variants[0];
    const imageUrls = getProductImageUrls(product, selectedVariant?.id);
    const price = selectedVariant?.price ?? product.price;
    const currency = selectedVariant?.currencyCode ?? product.currencyCode ?? 'EUR';
    const available = selectedVariant?.availableForSale ?? product.availableForSale;

    return (
      <View style={styles.productDetailScreen}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.content, { paddingBottom: 185 + insets.bottom }]}
        >
        {renderHeader()}
        <Pressable onPress={() => setActiveTab(productBackTab)} style={styles.productDetailBackButton}>
          <Text style={styles.productDetailBackText}>‹ Zurück</Text>
        </Pressable>

        {loadingProductDetails ? <ActivityIndicator style={styles.loader} /> : null}

        <View style={styles.productDetailCard}>
          {imageUrls.length > 0 ? (
            <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={styles.productDetailGallery}>
              {imageUrls.map((imageUrl, index) => (
                <ResilientRemoteImage
                  key={`${imageUrl}-${index}`}
                  urls={[
                    imageUrl,
                    ...imageUrls.filter((candidate) => candidate !== imageUrl),
                  ]}
                  style={[styles.productDetailImage, { width: width - 58 }]}
                  logoStyle={styles.modalFallbackLogo}
                />
              ))}
            </ScrollView>
          ) : (
            <ResilientRemoteImage
              urls={[]}
              style={[styles.productDetailImage, { width: width - 58 }]}
              logoStyle={styles.modalFallbackLogo}
            />
          )}

          <Text style={styles.productDetailTitle}>{product.title}</Text>

          <View style={styles.productDetailPriceRow}>
            <Text style={styles.productDetailPrice}>
              {price ? `${price} ${currency}` : t.noPrice}
            </Text>
            <Text style={[styles.productDetailStock, !available && styles.productDetailStockUnavailable]}>
              {available ? t.inStock : t.outOfStock}
            </Text>
          </View>

          {product.vendor || product.productType ? (
            <View style={styles.productDetailMetaCard}>
              {product.vendor ? (
                <View style={styles.productDetailMetaRow}>
                  <Text style={styles.productDetailMetaLabel}>Hersteller</Text>
                  <Text style={styles.productDetailMetaValue}>{product.vendor}</Text>
                </View>
              ) : null}
              {product.productType ? (
                <View style={styles.productDetailMetaRow}>
                  <Text style={styles.productDetailMetaLabel}>Produkttyp</Text>
                  <Text style={styles.productDetailMetaValue}>{product.productType}</Text>
                </View>
              ) : null}
              {selectedVariant?.sku ? (
                <View style={styles.productDetailMetaRow}>
                  <Text style={styles.productDetailMetaLabel}>Artikelnummer</Text>
                  <Text style={styles.productDetailMetaValue}>{selectedVariant.sku}</Text>
                </View>
              ) : null}
            </View>
          ) : selectedVariant?.sku ? (
            <Text style={styles.productDetailSku}>Artikelnummer: {selectedVariant.sku}</Text>
          ) : null}

          {variants.length > 1 ? (
            <View style={styles.variantSection}>
              <Text style={styles.variantSectionTitle}>{t.chooseVariant}</Text>
              <View style={styles.variantGrid}>
                {variants.map((variant) => {
                  const active = variant.id === selectedVariant?.id;
                  const label = variant.selectedOptions.length > 0
                    ? variant.selectedOptions.map((option) => `${option.name}: ${option.value}`).join(' · ')
                    : variant.title;
                  return (
                    <Pressable
                      key={variant.id}
                      disabled={!variant.availableForSale}
                      onPress={() => setSelectedVariantId(variant.id)}
                      style={[
                        styles.variantChip,
                        active && styles.variantChipActive,
                        !variant.availableForSale && styles.variantChipDisabled,
                      ]}
                    >
                      <Text style={[styles.variantChipText, active && styles.variantChipTextActive]}>{label}</Text>
                      <Text style={styles.variantChipPrice}>{variant.price} {variant.currencyCode}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {renderPublicProductDetails(product, selectedVariant)}

          <Text style={styles.productDetailSectionTitle}>Produktinformationen</Text>
          <WebView
            originWhitelist={['*']}
            source={{ html: buildProductDescriptionHtml(product), baseUrl: SHOP_URL }}
            style={styles.productDetailWebView}
            scrollEnabled
            setSupportMultipleWindows={false}
          />

          {product.tags?.length ? (
            <View style={styles.productDetailTags}>
              {product.tags.slice(0, 12).map((tag) => (
                <View key={tag} style={styles.productDetailTag}>
                  <Text style={styles.productDetailTagText}>{tag}</Text>
                </View>
              ))}
            </View>
          ) : null}

        </View>
        </ScrollView>

        <View
          style={[
            styles.productDetailStickyButtonWrap,
            { bottom: 78 + Math.max(insets.bottom, 8) },
          ]}
        >
          <Pressable
            disabled={!available || !selectedVariant?.id || addingVariantId === selectedVariant?.id}
            onPress={() => void addProduct(product, selectedVariant?.id)}
            style={[
              styles.productDetailAddButton,
              styles.productDetailStickyButton,
              (!available || !selectedVariant?.id) && styles.disabled,
            ]}
          >
            <Text style={styles.productDetailAddButtonText}>
              {addingVariantId === selectedVariant?.id ? t.adding : t.addSelected}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  function renderRecent() {
    return (
      <>
        <Text style={styles.recentTitle}>{t.recent}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {recentSearches.map((item) => (
            <Pressable key={item} onPress={() => void runSearch(item)} style={styles.chip}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </>
    );
  }

  function renderCategorySlider() {
    if (categorySlides.length === 0) return null;

    const sliderWidth = Math.max(1, width - pagePadding * 2);
    const sliderHeight = sliderWidth * (1086 / 1448);

    return (
      <View style={styles.categorySliderWrap}>
        <ScrollView
          ref={heroSliderRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => {
            const nextIndex = Math.round(
              event.nativeEvent.contentOffset.x / sliderWidth,
            );
            setHeroSlideIndex(Math.max(0, Math.min(nextIndex, categorySlides.length - 1)));
          }}
        >
          {categorySlides.map((slide) => (
            <Pressable
              key={slide.handle}
              onPress={() => void openHomeCategory(slide)}
              style={[
                styles.categorySlideButton,
                { width: sliderWidth, height: sliderHeight },
              ]}
            >
              <Image
                source={slide.image}
                resizeMode="contain"
                style={[
                  styles.categorySlideImage,
                  { width: sliderWidth, height: sliderHeight },
                ]}
              />
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.categorySliderDots}>
          {categorySlides.map((slide, index) => (
            <View
              key={`dot-${slide.handle}`}
              style={[
                styles.categorySliderDot,
                index === heroSlideIndex && styles.categorySliderDotActive,
              ]}
            />
          ))}
        </View>
      </View>
    );
  }

  function renderHome() {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}
        {renderSearchBox()}
        <Text style={styles.intro}>{t.intro}</Text>
        {renderRecent()}
        {renderCategorySlider()}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>✦ {t.recommendations}</Text>
          <Pressable onPress={() => setActiveTab('categories')}>
            <Text style={styles.seeAll}>{t.seeAll} ›</Text>
          </Pressable>
        </View>
        {loadingHomeSections
          ? <ActivityIndicator style={styles.loader} />
          : renderProducts(recommendedProducts)}

        {homeCategories.map((category) => {
          const products = homeCategoryProducts[category.handle] ?? [];
          return (
            <View key={category.handle} style={styles.homeCategoryBlock}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{category.title}</Text>
                <Pressable onPress={() => void openHomeCategory(category)}>
                  <Text style={styles.seeAll}>Alle ansehen ›</Text>
                </Pressable>
              </View>

              {(loadingHomeSections || hydratingHomeCategories) && products.length === 0 ? (
                <ActivityIndicator style={styles.horizontalLoader} />
              ) : products.length > 0 ? (
                renderHorizontalProducts(products)
              ) : (
                <Text style={styles.horizontalEmptyText}>{t.categoryEmpty}</Text>
              )}
            </View>
          );
        })}

        <View style={styles.assistantCard}>
          <View style={styles.assistantCardContent}>
          <View style={styles.assistantHead}>
            <View style={styles.assistantAvatar}>
              <Image source={require('../../assets/logo.png')} style={styles.assistantLogo} />
            </View>
            <View style={styles.assistantCopy}>
              <Text style={styles.assistantTitle}>{t.assistantTitle}</Text>
              <Text style={styles.assistantText}>{t.assistantText}</Text>
            </View>
          </View>
          <View style={styles.assistantInputRow}>
            <TextInput
              value={assistantQuestion}
              onChangeText={setAssistantQuestion}
              onSubmitEditing={() => void askAssistant()}
              placeholder={t.assistantPlaceholder}
              placeholderTextColor="#7D8999"
              style={styles.assistantInput}
              returnKeyType="send"
            />
            <Pressable onPress={() => void askAssistant()} style={styles.askButton}>
              <Text style={styles.askButtonText}>{loadingAssistant ? '…' : t.ask}</Text>
            </Pressable>
          </View>
          {assistantAnswer ? <Text style={styles.answer}>{assistantAnswer}</Text> : null}
          </View>
        </View>

        <View style={styles.legalFooter}>
          {legalLinks.map((item) => (
            <Pressable key={`${item.source}-${item.key}`} onPress={() => void openContent(item)}>
              <Text style={styles.legalLink}>{item.labels[language]}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  function renderSearchPage() {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}
        <Text style={styles.pageTitle}>{t.searchPageTitle}</Text>
        <Text style={styles.pageText}>{t.searchPageText}</Text>
        {renderSearchBox()}

        <View style={[styles.micStatus, listening && styles.micStatusActive]}>
          <View style={[styles.micStatusDot, listening && styles.micStatusDotActive]} />
          <Text style={[styles.micStatusText, listening && styles.micStatusTextActive]}>
            {listening ? t.listening : t.micReady}
          </Text>
        </View>

        {renderRecent()}

        <View style={styles.statusRow}>
          <Text style={styles.statusText}>{statusText}</Text>
          {loadingSearch ? <ActivityIndicator size="small" /> : null}
        </View>

        {searchProducts.length > 0
          ? renderProducts(searchProducts)
          : !loadingSearch
            ? <View style={styles.emptySearch}><Text style={styles.emptySearchText}>{t.noResults}</Text></View>
            : null}
      </ScrollView>
    );
  }

  function renderNestedMenu(items: MenuItem[], depth = 0) {
    return items.map((item) => {
      const hasChildren = item.items.length > 0;
      const expanded = openNestedPath[depth] === item.id;

      return (
        <View key={item.id}>
          <Pressable
            onPress={() => {
              if (hasChildren) {
                setOpenNestedPath((current) => {
                  if (current[depth] === item.id) return current.slice(0, depth);
                  return [...current.slice(0, depth), item.id];
                });
              } else {
                void openMenuItem(item);
              }
            }}
            style={[
              styles.subcategoryRow,
              { marginLeft: depth * 18 },
              expanded && styles.subcategoryRowActive,
            ]}
          >
            <View style={styles.subcategoryCircle}>
              {item.collection?.imageUrl ? (
                <Image source={{ uri: item.collection.imageUrl }} style={styles.subcategoryImage} />
              ) : (
                <Image source={require('../../assets/logo.png')} style={styles.subcategoryLogo} />
              )}
            </View>
            <Text style={styles.subcategoryTitle}>{item.title}</Text>
            <Text style={[styles.subcategoryArrow, expanded && styles.subcategoryArrowOpen]}>
              {hasChildren ? '⌄' : '›'}
            </Text>
          </Pressable>
          {hasChildren && expanded ? (
            <View>{renderNestedMenu(item.items, depth + 1)}</View>
          ) : null}
        </View>
      );
    });
  }

  function renderCategories() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}
        <Text style={styles.pageTitle}>{t.categoriesTitle}</Text>
        <Text style={styles.pageText}>{t.categoriesText}</Text>
        {loadingMenu ? <ActivityIndicator style={styles.loader} /> : null}

        {!loadingMenu && menuItems.length === 0 ? (
          <View style={styles.emptyCategoryCard}>
            <Text style={styles.emptyCategoryText}>
              {t.categoriesEmpty}
            </Text>

            <Pressable
              onPress={() => void loadMenu()}
              style={styles.retryButton}
            >
              <Text style={styles.retryButtonText}>{t.retry}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.menuList}>
          {menuItems.map((item) => {
            const hasChildren = item.items.length > 0;
            const expanded = openMenuId === item.id;
            return (
              <View key={item.id} style={styles.menuGroup}>
                <Pressable
                  onPress={() => {
                    if (hasChildren) {
                      setOpenMenuId((current) => {
                        const next = current === item.id ? undefined : item.id;
                        setOpenNestedPath([]);
                        return next;
                      });
                    } else {
                      void openMenuItem(item);
                    }
                  }}
                  style={[styles.mainCategoryRow, expanded && styles.mainCategoryRowActive]}
                >
                  <View style={styles.categoryCircle}>
                    {item.collection?.imageUrl ? (
                      <Image source={{ uri: item.collection.imageUrl }} style={styles.categoryImage} />
                    ) : (
                      <Image source={require('../../assets/logo.png')} style={styles.categoryLogo} />
                    )}
                  </View>
                  <Text style={styles.mainCategoryTitle}>{item.title}</Text>
                  <Text style={[styles.menuChevron, expanded && styles.menuChevronOpen]}>
                    {hasChildren ? '⌄' : '›'}
                  </Text>
                </Pressable>
                {expanded ? <View style={styles.subcategoryList}>{renderNestedMenu(item.items)}</View> : null}
              </View>
            );
          })}
        </View>
      </ScrollView>
    );
  }

  function renderCategoryProducts() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}

        <Pressable onPress={() => setActiveTab(categoryBackTab)} style={styles.categoryBackButton}>
          <Text style={styles.categoryBackText}>
            ‹ {categoryBackTab === 'home' ? 'Zurück zur Startseite' : t.backToCategories}
          </Text>
        </Pressable>

        <Text style={styles.pageTitle}>{categoryTitle || t.categoryProducts}</Text>

        {loadingCategoryProducts ? <ActivityIndicator style={styles.loader} /> : null}
        {categoryError ? <Text style={styles.categoryErrorText}>{categoryError}</Text> : null}

        {!loadingCategoryProducts && !categoryError && categoryProducts.length === 0 ? (
          <View style={styles.emptyCategoryCard}>
            <Text style={styles.emptyCategoryText}>{t.categoryEmpty}</Text>
          </View>
        ) : null}

        {categoryProducts.length > 0 ? (
          <View style={styles.categoryProductGrid}>{renderProducts(categoryProducts)}</View>
        ) : null}
      </ScrollView>
    );
  }

  function renderContentPage() {
    return (
      <View style={[styles.contentPageRoot, { paddingTop: 8, paddingBottom: 86 + insets.bottom }]}> 
        <View style={styles.contentPageHeaderArea}>
          {renderHeader()}
          <Pressable onPress={() => setActiveTab(contentBackTab)} style={styles.contentBackButton}>
            <Text style={styles.contentBackText}>‹ {t.contentBack}</Text>
          </Pressable>
        </View>

        {loadingContent ? (
          <View style={styles.contentLoadingCard}>
            <ActivityIndicator />
            <Text style={styles.contentLoadingText}>{t.contentLoading}</Text>
          </View>
        ) : null}

        {!loadingContent && contentError ? (
          <View style={styles.contentLoadingCard}>
            <Text style={styles.contentErrorText}>{contentError}</Text>
          </View>
        ) : null}

        {!loadingContent && contentDocument ? (
          <View style={styles.contentWebCard}>
            <WebView
              originWhitelist={['*']}
              source={
                isShopifyTemplatePage(contentDocument)
                  ? { uri: getShopifyTemplatePageUrl(contentDocument) }
                  : { html: buildContentHtml(contentDocument), baseUrl: SHOP_URL }
              }
              style={styles.contentWebView}
              startInLoadingState
              renderLoading={() => (
                <View style={styles.webViewLoader}>
                  <ActivityIndicator />
                </View>
              )}
              injectedJavaScriptBeforeContentLoaded={
                isShopifyTemplatePage(contentDocument)
                  ? SHOPIFY_TEMPLATE_PAGE_SCRIPT
                  : undefined
              }
              injectedJavaScript={
                isShopifyTemplatePage(contentDocument)
                  ? SHOPIFY_TEMPLATE_PAGE_SCRIPT
                  : undefined
              }
              onShouldStartLoadWithRequest={(request) => {
                if (request.url.startsWith('tel:') || request.url.startsWith('mailto:')) {
                  void Linking.openURL(request.url);
                  return false;
                }
                return true;
              }}
              javaScriptEnabled
              domStorageEnabled
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures
            />
          </View>
        ) : null}
      </View>
    );
  }

  function continueShopping() {
    setActiveTab(cartBackTab === 'cart' ? 'home' : cartBackTab);
  }

  function renderCart() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}
        <Text style={styles.pageTitle}>{t.cartTitle}</Text>
        <Pressable onPress={continueShopping} style={styles.continueShoppingButton}>
          <Text style={styles.continueShoppingText}>‹ Weiter einkaufen</Text>
        </Pressable>

        {loadingCart ? <ActivityIndicator style={styles.loader} /> : null}
        {cartError ? <Text style={styles.cartError}>{cartError}</Text> : null}

        {!loadingCart && (!cart || cart.lines.length === 0) ? (
          <View style={styles.emptyCartCard}>
            <Text style={styles.emptyCartIcon}>🛒</Text>
            <Text style={styles.emptyCartTitle}>{t.cartEmpty}</Text>
            <Text style={styles.emptyCartText}>{t.cartEmptyText}</Text>
          </View>
        ) : null}

        {cart?.lines.map((line) => {
          const imageUrl = line.merchandise.image?.url ?? line.merchandise.product.featuredImage?.url;
          const optionText = line.merchandise.selectedOptions
            .map((option) => `${option.name}: ${option.value}`)
            .join(' · ');
          const busy = updatingLineId === line.id;

          return (
            <View key={line.id} style={styles.cartLineCard}>
              <View style={styles.cartLineTop}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.cartLineImage} />
                ) : (
                  <View style={[styles.cartLineImage, styles.productFallback]}>
                    <Image source={require('../../assets/logo.png')} style={styles.cartLineFallbackLogo} />
                  </View>
                )}

                <View style={styles.cartLineInfo}>
                  <Text style={styles.cartLineTitle}>{line.merchandise.product.title}</Text>
                  {optionText ? <Text style={styles.cartLineVariant}>{optionText}</Text> : null}
                  <Text style={styles.cartLineUnitPrice}>
                    {line.cost.amountPerQuantity.amount} {line.cost.amountPerQuantity.currencyCode}
                  </Text>
                </View>
              </View>

              <View style={styles.cartLineBottom}>
                <View style={styles.quantityControl}>
                  <Pressable
                    disabled={busy || line.quantity <= 1}
                    onPress={() => void changeCartQuantity(line.id, line.quantity - 1)}
                    style={[styles.quantityButton, (busy || line.quantity <= 1) && styles.disabled]}
                  >
                    <Text style={styles.quantityButtonText}>−</Text>
                  </Pressable>

                  <View style={styles.quantityValue}>
                    {busy ? <ActivityIndicator size="small" /> : <Text style={styles.quantityText}>{line.quantity}</Text>}
                  </View>

                  <Pressable
                    disabled={busy || line.quantity >= 99}
                    onPress={() => void changeCartQuantity(line.id, line.quantity + 1)}
                    style={[styles.quantityButton, busy && styles.disabled]}
                  >
                    <Text style={styles.quantityButtonText}>+</Text>
                  </Pressable>
                </View>

                <View style={styles.cartLinePriceBlock}>
                  <Text style={styles.cartLineTotal}>
                    {line.cost.totalAmount.amount} {line.cost.totalAmount.currencyCode}
                  </Text>
                  <Pressable disabled={busy} onPress={() => void deleteCartLine(line.id)}>
                    <Text style={styles.removeLineText}>{t.remove}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          );
        })}

        {cart && cart.lines.length > 0 ? (
          <View style={styles.cartSummary}>
            <View style={styles.cartSummaryRow}>
              <Text style={styles.cartSummaryLabel}>{t.subtotal}</Text>
              <Text style={styles.cartSummaryValue}>
                {cart.cost.subtotalAmount.amount} {cart.cost.subtotalAmount.currencyCode}
              </Text>
            </View>
            <View style={[styles.cartSummaryRow, styles.cartTotalRow]}>
              <Text style={styles.cartTotalLabel}>{t.total}</Text>
              <Text style={styles.cartTotalValue}>
                {cart.cost.totalAmount.amount} {cart.cost.totalAmount.currencyCode}
              </Text>
            </View>
            <Pressable onPress={() => void openCheckout()} style={styles.checkoutButton}>
              <Text style={styles.checkoutButtonText}>{t.checkout}</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    );
  }

  function renderSignedOutAccount(orders: boolean) {
    return (
      <View style={styles.accountCard}>
        <Text style={styles.accountIcon}>{orders ? '▣' : '○'}</Text>
        <Text style={styles.accountTitle}>{orders ? t.ordersTitle : t.profileTitle}</Text>
        <Text style={styles.accountText}>{orders ? t.ordersText : t.profileText}</Text>
        <Pressable
          disabled={loadingCustomer}
          onPress={() => void handleCustomerSignIn()}
          style={[styles.accountButton, loadingCustomer && styles.disabled]}
        >
          <Text style={styles.accountButtonText}>
            {loadingCustomer ? t.accountLoading : t.accountSignIn}
          </Text>
        </Pressable>
      </View>
    );
  }

  function renderProfileAccount() {
    const profile = customerProfile;
    if (!profile) return renderSignedOutAccount(false);

    const addresses = profile.addresses.length > 0
      ? profile.addresses
      : profile.defaultAddress
        ? [profile.defaultAddress]
        : [];

    return (
      <>
        <View style={styles.profileHeroCard}>
          {profile.imageUrl ? (
            <Image source={{ uri: profile.imageUrl }} style={styles.profileAvatar} />
          ) : (
            <View style={[styles.profileAvatar, styles.profileAvatarFallback]}>
              <Text style={styles.profileAvatarText}>
                {(profile.displayName || '?').trim().charAt(0).toLocaleUpperCase(language)}
              </Text>
            </View>
          )}
          <View style={styles.profileHeroCopy}>
            <Text style={styles.profileEyebrow}>{t.signedInAs}</Text>
            <Text style={styles.profileName}>{profile.displayName}</Text>
            {profile.emailAddress ? <Text style={styles.profileContact}>{profile.emailAddress}</Text> : null}
            {profile.phoneNumber ? <Text style={styles.profileContact}>{profile.phoneNumber}</Text> : null}
          </View>
        </View>

        <View style={styles.accountSectionHeader}>
          <Text style={styles.accountSectionTitle}>{t.addresses}</Text>
          <Pressable onPress={() => void loadCustomerAccount(false)}>
            <Text style={styles.accountRefreshText}>{t.refresh}</Text>
          </Pressable>
        </View>

        {addresses.length === 0 ? (
          <View style={styles.accountEmptyCard}>
            <Text style={styles.accountEmptyText}>{t.noAddress}</Text>
          </View>
        ) : (
          addresses.map((address, index) => (
            <View key={address.id || String(index)} style={styles.addressCard}>
              <Text style={styles.addressTitle}>
                {[address.firstName, address.lastName].filter(Boolean).join(' ') || profile.displayName}
              </Text>
              {address.company ? <Text style={styles.addressLine}>{address.company}</Text> : null}
              {address.address1 ? <Text style={styles.addressLine}>{address.address1}</Text> : null}
              {address.address2 ? <Text style={styles.addressLine}>{address.address2}</Text> : null}
              <Text style={styles.addressLine}>
                {[address.zip, address.city].filter(Boolean).join(' ')}
              </Text>
              {address.territoryCode ? <Text style={styles.addressLine}>{address.territoryCode}</Text> : null}
            </View>
          ))
        )}

        <Pressable
          onPress={() => {
            setActiveTab('orders');
            void loadCustomerAccount(true);
          }}
          style={styles.accountButton}
        >
          <Text style={styles.accountButtonText}>
            Meine Bestellungen{customerOrders.length > 0 ? ` (${customerOrders.length})` : ''}
          </Text>
        </Pressable>

        <Pressable onPress={() => void handleCustomerSignOut()} style={styles.logoutButton}>
          <Text style={styles.logoutButtonText}>{t.logout}</Text>
        </Pressable>

        <View style={styles.deleteAccountCard}>
          <Text style={styles.deleteAccountTitle}>{t.deleteAccount}</Text>
          <Text style={styles.deleteAccountDescription}>
            {t.deleteAccountDescription}
          </Text>
          <Pressable
            disabled={requestingAccountDeletion}
            onPress={confirmAccountDeletion}
            style={[
              styles.deleteAccountButton,
              requestingAccountDeletion && styles.disabled,
            ]}
          >
            <Text style={styles.deleteAccountButtonText}>
              {requestingAccountDeletion ? '…' : t.deleteAccount}
            </Text>
          </Pressable>
        </View>
      </>
    );
  }

  function renderOrdersAccount() {
    if (!customerProfile) return renderSignedOutAccount(true);

    return (
      <>
        <View style={styles.accountSectionHeader}>
          <View>
            <Text style={styles.profileEyebrow}>{t.signedInAs}</Text>
            <Text style={styles.ordersCustomerName}>{customerProfile.displayName}</Text>
          </View>
          <Pressable onPress={() => void loadCustomerAccount(true)}>
            <Text style={styles.accountRefreshText}>{t.refresh}</Text>
          </Pressable>
        </View>

        {customerOrders.length === 0 ? (
          <View style={styles.accountEmptyCard}>
            <Text style={styles.accountEmptyText}>{t.ordersEmpty}</Text>
          </View>
        ) : (
          customerOrders.map((order) => (
            <View key={order.id} style={styles.orderCard}>
              <View style={styles.orderHeaderRow}>
                <View>
                  <Text style={styles.orderName}>{order.name}</Text>
                  <Text style={styles.orderDate}>{formatAccountDate(order.processedAt || order.createdAt, language)}</Text>
                </View>
                <Text style={styles.orderAmount}>
                  {order.totalPrice.amount} {order.totalPrice.currencyCode}
                </Text>
              </View>

              <View style={styles.orderStatusRow}>
                <Text style={styles.orderStatusLabel}>{t.orderStatus}</Text>
                <Text style={styles.orderStatusValue}>
                  {humanizeAccountStatus(order.fulfillmentStatus)}
                  {order.financialStatus ? ` · ${humanizeAccountStatus(order.financialStatus)}` : ''}
                </Text>
              </View>

              <Text style={styles.orderItemsHeading}>{t.orderItems}</Text>
              {order.lineItems.map((line) => (
                <View key={line.id} style={styles.orderLine}>
                  {line.imageUrl ? (
                    <Image source={{ uri: line.imageUrl }} style={styles.orderLineImage} />
                  ) : (
                    <View style={[styles.orderLineImage, styles.productFallback]}>
                      <Image source={require('../../assets/logo.png')} style={styles.orderFallbackLogo} />
                    </View>
                  )}
                  <View style={styles.orderLineCopy}>
                    <Text style={styles.orderLineName}>{line.name}</Text>
                    {line.variantTitle ? <Text style={styles.orderLineVariant}>{line.variantTitle}</Text> : null}
                  </View>
                  <Text style={styles.orderLineQuantity}>×{line.quantity}</Text>
                </View>
              ))}

              <Pressable
                onPress={() => {
                  setSelectedCustomerOrder(order);
                  setActiveTab('orderDetails');
                }}
                style={styles.orderDetailsButton}
              >
                <Text style={styles.orderDetailsButtonText}>{t.orderDetails}</Text>
              </Pressable>
            </View>
          ))
        )}
      </>
    );
  }

  function renderAccount(type: 'orders' | 'profile') {
    const orders = type === 'orders';
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}
      >
        {renderHeader()}
        <Text style={styles.pageTitle}>{orders ? t.ordersTitle : t.profileTitle}</Text>

        {customerError ? <Text style={styles.customerErrorText}>{customerError}</Text> : null}
        {loadingCustomer && customerAuthenticated ? <ActivityIndicator style={styles.loader} /> : null}

        {!customerAuthenticated
          ? renderSignedOutAccount(orders)
          : orders
            ? renderOrdersAccount()
            : renderProfileAccount()}
      </ScrollView>
    );
  }

  const navItems: Array<{ key: AppTab; icon: string; label: string }> = [
    { key: 'home', icon: '⌂', label: t.home },
    { key: 'categories', icon: '▦', label: t.categories },
    { key: 'cart', icon: '🛒', label: t.cart },
    { key: 'orders', icon: '▣', label: t.orders },
    { key: 'profile', icon: '○', label: t.profile },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {activeTab === 'home' ? renderHome() : null}
        {activeTab === 'categories' ? renderCategories() : null}
        {activeTab === 'categoryProducts' ? renderCategoryProducts() : null}
        {activeTab === 'productDetails' ? renderProductDetails() : null}
        {activeTab === 'search' ? renderSearchPage() : null}
        {activeTab === 'cart' ? renderCart() : null}
        {activeTab === 'content' ? renderContentPage() : null}
        {activeTab === 'orders' ? renderAccount('orders') : null}
        {activeTab === 'orderDetails' && selectedCustomerOrder ? (
          <CustomerOrderDetails
            order={selectedCustomerOrder}
            bottomInset={insets.bottom}
            onBack={() => setActiveTab('orders')}
          />
        ) : null}
        {activeTab === 'profile' ? renderAccount('profile') : null}
      </View>


      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}> 
        {navItems.map((item) => {
          const isCenter = false;
          const active = activeTab === item.key ||
            (item.key === 'categories' && activeTab === 'categoryProducts') ||
            (activeTab === 'content' && item.key === contentBackTab) ||
            (activeTab === 'productDetails' && item.key === productBackTab) ||
            (activeTab === 'orderDetails' && item.key === 'orders');
          return (
            <Pressable
              key={item.key}
              onPress={() => {
                if (item.key === 'cart' && activeTab !== 'cart') {
                  setCartBackTab(activeTab);
                }
                setActiveTab(item.key);
              }}
              hitSlop={{ top: 8, right: 4, bottom: 8, left: 4 }}
              style={styles.navItem}
            >
              <View style={[styles.navIconWrap, isCenter && styles.centerNav, active && !isCenter && styles.activeNavIcon]}>
                <Text style={[styles.navIcon, active && styles.navIconActive]}>{item.icon}</Text>
                {item.key === 'cart' && (cart?.totalQuantity ?? 0) > 0 ? (
                  <View style={styles.cartBadge}>
                    <Text style={styles.cartBadgeText}>
                      {(cart?.totalQuantity ?? 0) > 99 ? '99+' : cart?.totalQuantity}
                    </Text>
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={1} style={[styles.navLabel, active && styles.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  screen: { flex: 1, zIndex: 0 },
  content: { paddingHorizontal: 14, paddingTop: 8, backgroundColor: '#FFFFFF' },
  motionBackdrop: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  motionGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
  },
  motionGlowBlue: {
    left: -120,
    top: -85,
    backgroundColor: '#007ABB',
  },
  motionGlowOrange: {
    right: -125,
    bottom: -100,
    backgroundColor: '#007ABB',
  },
  contourCluster: {
    position: 'absolute',
    width: 620,
    height: 620,
  },
  contourClusterBlue: {
    left: -290,
    top: -175,
  },
  contourClusterOrange: {
    right: -305,
    bottom: -235,
  },
  contourLine: {
    position: 'absolute',
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  contourLineBlue: {
    left: 0,
    top: 0,
    borderColor: '#007ABB',
  },
  contourLineOrange: {
    right: 0,
    bottom: 0,
    borderColor: '#007ABB',
  },
  header: { minHeight: 98, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  brandRow: { alignItems: 'center', justifyContent: 'center' },
  logo: { width: 78, height: 58, resizeMode: 'contain' },
  brand: { color: '#12262F', fontSize: 19, fontWeight: '900', textAlign: 'center', marginTop: 2 },
  brandButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  publicDetailWrap: { marginTop: 18 },
  publicDetailTopRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  publicDetailBadge: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: '#E53B3B',
  },
  publicDetailBadgeText: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '900',
  },
  publicDetailShareButton: { paddingHorizontal: 8, paddingVertical: 6 },
  publicDetailShareText: { color: '#007ABB', fontSize: 12, fontWeight: '800' },
  publicDetailComparePrice: {
    color: '#7D8991',
    fontSize: 12,
    marginTop: 8,
    textDecorationLine: 'line-through',
  },
  publicDetailTax: {
    color: '#71818A',
    fontSize: 10,
    marginTop: 5,
    marginBottom: 10,
    textDecorationLine: 'underline',
  },
  publicDetailService: {
    color: '#278B56',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  publicDetailPickup: {
    color: '#314852',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
  publicDetailAccordionGroup: {
    marginTop: 16,
    borderTopWidth: 1,
    borderTopColor: '#DDE5E9',
  },
  publicDetailAccordion: {
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5E9',
  },
  publicDetailAccordionHeader: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
  },
  publicDetailAccordionIcon: {
    width: 27,
    color: '#007ABB',
    fontSize: 16,
    textAlign: 'center',
  },
  publicDetailAccordionTitle: {
    flex: 1,
    color: '#12262F',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '800',
    paddingHorizontal: 7,
  },
  publicDetailAccordionChevron: {
    width: 25,
    color: '#12262F',
    fontSize: 20,
    textAlign: 'center',
  },
  publicDetailAccordionBody: {
    color: '#526873',
    fontSize: 12,
    lineHeight: 19,
    paddingLeft: 34,
    paddingRight: 18,
    paddingBottom: 14,
  },
  publicDetailSection: { marginTop: 18 },
  publicDetailSpecRow: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#DDE5E9',
    backgroundColor: '#F8FAFB',
  },
  publicDetailSpecLabel: { width: '42%', color: '#647680', fontSize: 12 },
  publicDetailSpecValue: {
    flex: 1,
    color: '#12262F',
    fontSize: 12,
    fontWeight: '800',
  },
  publicDetailFeature: {
    color: '#278B56',
    fontSize: 12,
    lineHeight: 19,
    marginTop: 5,
  },
  brandAccent: { color: '#007ABB' },
  languages: { flexDirection: 'row', gap: 4 },
  languageButton: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: '#111C27' },
  languageButtonActive: { backgroundColor: '#007ABB' },
  languageText: { color: '#8C9AAD', fontSize: 10, fontWeight: '800' },
  languageTextActive: { color: '#FFFFFF' },
  greeting: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  intro: { color: '#5D6F79', fontSize: 14, lineHeight: 21, marginTop: 12, marginBottom: 14, textAlign: 'center' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: { flex: 1, minHeight: 58, flexDirection: 'row', alignItems: 'center', borderRadius: 29, borderWidth: 1, borderColor: '#D5E1E6', backgroundColor: '#F4F7F8', paddingHorizontal: 16 },
  searchIcon: { color: '#007ABB', fontSize: 26, marginRight: 10 },
  searchInput: { flex: 1, minHeight: 56, color: '#12262F', fontSize: 14 },
  micWrap: { width: 62, height: 62, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 58, height: 58, borderRadius: 29, borderWidth: 2, borderColor: '#007ABB' },
  micButton: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#007ABB' },
  micButtonActive: { backgroundColor: '#007ABB', borderColor: '#007ABB' },
  micEmoji: { color: '#FFFFFF', fontSize: 22 },
  micStatus: { minHeight: 44, flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#101D27' },
  micStatusActive: { borderWidth: 1, borderColor: '#007ABB', backgroundColor: '#0B2B36' },
  micStatusDot: { width: 9, height: 9, borderRadius: 5, marginRight: 9, backgroundColor: '#607080' },
  micStatusDotActive: { backgroundColor: '#007ABB' },
  micStatusText: { color: '#9DAABA', fontSize: 13, fontWeight: '700' },
  micStatusTextActive: { color: '#FFFFFF' },
  recentTitle: { color: '#697B85', marginTop: 16, marginBottom: 8, fontSize: 12 },
  chips: { gap: 8, paddingRight: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: '#D5E1E6', backgroundColor: '#FFFFFF' },
  chipText: { color: '#2A3E49', fontSize: 12 },
  categorySliderWrap: { marginTop: 18 },
  categorySlideButton: { borderRadius: 22, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: '#07141E' },
  categorySlideImage: { borderRadius: 22, backgroundColor: '#07141E' },
  categorySliderDots: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10 },
  categorySliderDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#C9D5DA' },
  categorySliderDotActive: { width: 22, backgroundColor: '#007ABB' },
  homeCategoryBlock: { marginTop: 4 },
  horizontalProductList: { gap: 8, paddingRight: 14, paddingBottom: 4 },
  horizontalProductCard: { flexShrink: 0 },
  horizontalLoader: { minHeight: 170, marginVertical: 18 },
  horizontalEmptyText: { color: '#6A7D87', fontSize: 13, paddingVertical: 18 },
  heroCard: { height: 270, borderRadius: 22, marginTop: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#D8E3E8', backgroundColor: '#FFFFFF' },
  heroCardGerman: {
    height: 310,
  },
  heroCardCompact: {
    height: 290,
  },
  heroCardGermanCompact: {
    height: 330,
  },
  heroBackground: {
    width: '100%',
    height: '100%',
  },
  heroBackgroundImage: {
    width: '100%',
    height: '100%',
  },
  heroGradient: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
  },
  heroCopy: {
    width: '54%',
    height: '100%',
    paddingLeft: 15,
    paddingRight: 6,
    paddingVertical: 13,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  heroEyebrow: { color: '#5D6F79', fontSize: 9, lineHeight: 12, flexShrink: 1 },
  heroTitle: { color: '#12262F', fontSize: 18, lineHeight: 21, fontWeight: '900', marginTop: 4, flexShrink: 1 },
  heroTitleGerman: {
    fontSize: 16,
    lineHeight: 19,
  },
  heroTitleCompact: {
    fontSize: 16,
    lineHeight: 19,
  },
  heroAccent: { color: '#007ABB', fontSize: 20, lineHeight: 23, fontWeight: '900', marginBottom: 8, flexShrink: 1 },
  heroAccentGerman: {
    fontSize: 17,
    lineHeight: 20,
  },
  heroAccentCompact: {
    fontSize: 17,
    lineHeight: 20,
  },
  heroFeature: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 7,
    maxWidth: '100%',
  },
  heroIcon: {
    width: 20,
    color: '#007ABB',
    fontSize: 14,
    lineHeight: 17,
    fontWeight: '900',
  },
  heroFeatureText: { color: '#435964', fontSize: 9, lineHeight: 12, flex: 1, flexShrink: 1 },
  heroFeatureTextGerman: {
    fontSize: 8,
    lineHeight: 11,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  statusText: { color: '#334B57', fontSize: 13, flex: 1 },
  emptySearch: { minHeight: 180, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#F8FAFB' },
  emptySearchText: { color: '#71828C', fontSize: 14 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: '#12262F', fontSize: 18, fontWeight: '900' },
  seeAll: { color: '#007ABB', fontSize: 13, fontWeight: '700' },
  loader: { marginVertical: 24 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  productCard: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF', elevation: 2 },
  productMedia: {
    position: 'relative',
    width: '100%',
    overflow: 'hidden',
    backgroundColor: '#EDF0F2',
  },
  productImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'contain',
    backgroundColor: '#EDF0F2',
  },
  productFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minHeight: 25,
    paddingHorizontal: 8,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#007ABB',
    backgroundColor: 'rgba(5, 11, 18, 0.88)',
  },
  infoBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  fallbackLogo: { width: 54, height: 54, resizeMode: 'contain' },
  productBody: { padding: 8 },
  productTitle: { color: '#12262F', minHeight: 34, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  productPrice: { color: '#007ABB', fontSize: 13, fontWeight: '900', marginTop: 6 },
  productStock: { color: '#6A7D87', fontSize: 10, marginTop: 3 },
  addButton: { minHeight: 34, borderRadius: 10, marginTop: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: '#007ABB' },
  addButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 34,
    backgroundColor: 'rgba(0, 0, 0, 0.78)',
  },
  modalCard: {
    maxHeight: '84%',
    overflow: 'hidden',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#22506A',
    backgroundColor: '#08151E',
  },
  modalHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#173345',
  },
  modalHeading: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '900',
  },
  modalCloseIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#132735',
  },
  modalCloseIconText: {
    color: '#FFFFFF',
    fontSize: 25,
    lineHeight: 27,
  },
  modalScroll: {
    flexShrink: 1,
  },
  modalContent: {
    padding: 16,
    paddingBottom: 24,
  },
  modalImage: {
    width: '100%',
    height: 210,
    borderRadius: 15,
    resizeMode: 'contain',
    backgroundColor: '#EDF0F2',
  },
  modalFallbackLogo: {
    width: 90,
    height: 90,
    resizeMode: 'contain',
  },
  modalProductTitle: {
    color: '#FFFFFF',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
    marginTop: 16,
  },
  modalMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
  },
  modalPrice: {
    color: '#007ABB',
    fontSize: 18,
    fontWeight: '900',
  },
  modalStock: {
    color: '#65D69E',
    fontSize: 12,
    fontWeight: '800',
  },
  modalStockUnavailable: {
    color: '#FF7A7A',
  },
  modalDescription: {
    color: '#D4DCE5',
    fontSize: 14,
    lineHeight: 22,
    marginTop: 18,
  },
  variantSection: {
    marginTop: 18,
  },
  variantSectionTitle: { color: '#12262F', fontSize: 14, fontWeight: '900', marginBottom: 10 },
  variantGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  variantChip: { minWidth: '47%', paddingHorizontal: 11, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: '#D5E1E6', backgroundColor: '#FFFFFF' },
  variantChipActive: { borderColor: '#007ABB', backgroundColor: '#EAF2F5' },
  variantChipDisabled: {
    opacity: 0.35,
  },
  variantChipText: { color: '#334A56', fontSize: 11, lineHeight: 15, fontWeight: '700' },
  variantChipTextActive: { color: '#007ABB' },
  variantChipPrice: { color: '#007ABB', fontSize: 11, fontWeight: '900', marginTop: 5 },
  modalActions: {
    paddingHorizontal: 16,
    paddingBottom: 16,
  },
  modalAddButton: {
    minHeight: 52,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007ABB',
  },
  modalAddButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  modalCloseButton: {
    minHeight: 52,
    marginTop: 10,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007ABB',
  },
  modalCloseButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '900',
  },
  assistantCard: { position: 'relative', overflow: 'hidden', marginTop: 22, borderRadius: 20, borderWidth: 1, borderColor: '#D8E3E8', backgroundColor: '#FFFFFF' },
  assistantCardContent: { padding: 16, zIndex: 1 },
  assistantHead: { flexDirection: 'row', alignItems: 'center' },
  assistantAvatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#F3F7F8' },
  assistantLogo: { width: 42, height: 42, resizeMode: 'contain' },
  assistantCopy: { flex: 1, marginLeft: 12 },
  assistantTitle: { color: '#12262F', fontSize: 17, fontWeight: '900' },
  assistantText: { color: '#657782', fontSize: 12, lineHeight: 17, marginTop: 4 },
  assistantInputRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  assistantInput: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 13, color: '#12262F', backgroundColor: '#F4F7F8', borderWidth: 1, borderColor: '#DFE7EB' },
  askButton: { minWidth: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  askButtonText: { color: '#FFFFFF', fontWeight: '900' },
  answer: { color: '#243A45', fontSize: 13, lineHeight: 19, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#F2F6F8' },
  legalFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 26, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#E1E8EC' },
  legalLink: { color: '#667983', fontSize: 11 },
  contentPageRoot: { flex: 1, paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  contentPageHeaderArea: { backgroundColor: '#FFFFFF' },
  contentBackButton: { alignSelf: 'flex-start', minHeight: 36, justifyContent: 'center', marginBottom: 8 },
  contentBackText: { color: '#007ABB', fontSize: 13, fontWeight: '800' },
  contentLoadingCard: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  contentLoadingText: { color: '#667983', fontSize: 13, marginTop: 12 },
  contentErrorText: { color: '#FF8E8E', fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  contentWebCard: { flex: 1, overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  contentWebView: { flex: 1, backgroundColor: '#FFFFFF' },
  webViewLoader: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  pageTitle: { color: '#12262F', fontSize: 28, fontWeight: '900', marginTop: 8 },
  pageText: { color: '#60737D', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  emptyCategoryCard: { minHeight: 180, alignItems: 'center', justifyContent: 'center', padding: 20, borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#F8FAFB' },
  emptyCategoryText: { color: '#6C7E88', fontSize: 14, textAlign: 'center' },
  retryButton: {
    minHeight: 42,
    marginTop: 16,
    paddingHorizontal: 20,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#007ABB',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  menuList: { gap: 10 },
  menuGroup: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  mainCategoryRow: { minHeight: 76, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, backgroundColor: '#FFFFFF' },
  mainCategoryRowActive: { backgroundColor: '#EEF5F7' },
  categoryCircle: { width: 54, height: 54, borderRadius: 27, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginRight: 13, borderWidth: 1, borderColor: '#315064', backgroundColor: '#EDF0F2' },
  categoryImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  categoryLogo: { width: 36, height: 36, resizeMode: 'contain' },
  mainCategoryTitle: { flex: 1, color: '#12262F', fontSize: 16, fontWeight: '800' },
  menuChevron: { color: '#007ABB', fontSize: 24, transform: [{ rotate: '-90deg' }] },
  menuChevronOpen: { transform: [{ rotate: '0deg' }] },
  subcategoryList: { paddingHorizontal: 12, paddingBottom: 10, borderTopWidth: 1, borderTopColor: '#E1E8EC' },
  subcategoryRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#E7ECEF' },
  subcategoryRowActive: { backgroundColor: '#EEF5F7' },
  subcategoryCircle: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginRight: 11, backgroundColor: '#EDF0F2' },
  subcategoryImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  subcategoryLogo: { width: 25, height: 25, resizeMode: 'contain' },
  subcategoryTitle: { flex: 1, color: '#334A56', fontSize: 14, fontWeight: '700' },
  subcategoryArrow: { color: '#007ABB', fontSize: 22, transform: [{ rotate: '0deg' }] },
  subcategoryArrowOpen: { transform: [{ rotate: '0deg' }] },
  categoryBackButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', marginBottom: 6 },
  categoryBackText: { color: '#007ABB', fontSize: 13, fontWeight: '800' },
  categoryErrorText: { color: '#FF8E8E', fontSize: 13, lineHeight: 19, marginTop: 16 },
  categoryProductGrid: { marginTop: 18 },
  cartError: { color: '#FF8E8E', fontSize: 13, lineHeight: 19, marginTop: 10 },
  emptyCartCard: { marginTop: 28, padding: 28, borderRadius: 22, alignItems: 'center', borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  emptyCartIcon: { fontSize: 48 },
  emptyCartTitle: { color: '#12262F', fontSize: 20, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  emptyCartText: { color: '#657782', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 8 },
  continueShoppingButton: { alignSelf: 'flex-start', minHeight: 44, marginTop: 10, marginBottom: 6, paddingHorizontal: 18, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  continueShoppingText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  cartLineCard: { marginTop: 14, padding: 13, borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  cartLineTop: { flexDirection: 'row' },
  cartLineImage: { width: 92, height: 92, borderRadius: 13, resizeMode: 'contain', backgroundColor: '#EDF0F2' },
  cartLineFallbackLogo: { width: 52, height: 52, resizeMode: 'contain' },
  cartLineInfo: { flex: 1, marginLeft: 13 },
  cartLineTitle: { color: '#12262F', fontSize: 15, lineHeight: 20, fontWeight: '800' },
  cartLineVariant: { color: '#657782', fontSize: 11, lineHeight: 16, marginTop: 5 },
  cartLineUnitPrice: { color: '#007ABB', fontSize: 14, fontWeight: '900', marginTop: 9 },
  cartLineBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#173345' },
  quantityControl: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: '#315064' },
  quantityButton: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF4F6' },
  quantityButtonText: { color: '#12262F', fontSize: 20, fontWeight: '800' },
  quantityValue: { width: 44, height: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  quantityText: { color: '#12262F', fontSize: 14, fontWeight: '900' },
  cartLinePriceBlock: { alignItems: 'flex-end' },
  cartLineTotal: { color: '#12262F', fontSize: 15, fontWeight: '900' },
  removeLineText: { color: '#FF8E8E', fontSize: 11, fontWeight: '800', marginTop: 7 },
  cartSummary: { marginTop: 18, padding: 17, borderRadius: 20, borderWidth: 1, borderColor: '#D5E1E6', backgroundColor: '#FFFFFF' },
  cartSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  cartSummaryLabel: { color: '#657782', fontSize: 14 },
  cartSummaryValue: { color: '#12262F', fontSize: 14, fontWeight: '800' },
  cartTotalRow: { marginTop: 5, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#173345' },
  cartTotalLabel: { color: '#12262F', fontSize: 17, fontWeight: '900' },
  cartTotalValue: { color: '#007ABB', fontSize: 19, fontWeight: '900' },
  checkoutButton: { minHeight: 54, marginTop: 14, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  checkoutButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  cartBadge: { position: 'absolute', top: -6, right: -8, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  cartBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },
  customerErrorText: { color: '#FF8E8E', fontSize: 13, lineHeight: 19, marginTop: 12 },
  accountCard: { marginTop: 24, padding: 24, borderRadius: 22, alignItems: 'center', borderWidth: 1, borderColor: '#D8E3E8', backgroundColor: '#FFFFFF' },
  accountIcon: { color: '#007ABB', fontSize: 58 },
  accountTitle: { color: '#12262F', fontSize: 25, fontWeight: '900', marginTop: 12, textAlign: 'center' },
  accountText: { color: '#657782', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  accountButton: { minHeight: 52, alignSelf: 'stretch', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: '#007ABB' },
  accountButtonText: { color: '#FFFFFF', fontWeight: '900', textAlign: 'center', paddingHorizontal: 10 },
  profileHeroCard: { flexDirection: 'row', alignItems: 'center', marginTop: 18, padding: 17, borderRadius: 20, borderWidth: 1, borderColor: '#D8E3E8', backgroundColor: '#FFFFFF' },
  profileAvatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#102633' },
  profileAvatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB' },
  profileAvatarText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  profileHeroCopy: { flex: 1, marginLeft: 14 },
  profileEyebrow: { color: '#8493A6', fontSize: 11, fontWeight: '700' },
  profileName: { color: '#12262F', fontSize: 21, lineHeight: 26, fontWeight: '900', marginTop: 4 },
  profileContact: { color: '#536A76', fontSize: 12, lineHeight: 17, marginTop: 3 },
  accountSectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  accountSectionTitle: { color: '#12262F', fontSize: 18, fontWeight: '900' },
  accountRefreshText: { color: '#007ABB', fontSize: 12, fontWeight: '800' },
  accountEmptyCard: { minHeight: 130, alignItems: 'center', justifyContent: 'center', padding: 20, borderRadius: 18, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  accountEmptyText: { color: '#657782', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  addressCard: { marginBottom: 10, padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  addressTitle: { color: '#12262F', fontSize: 15, fontWeight: '900', marginBottom: 6 },
  addressLine: { color: '#536A76', fontSize: 13, lineHeight: 19 },
  logoutButton: { minHeight: 48, marginTop: 12, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#C24A4A', backgroundColor: '#251319' },
  logoutButtonText: { color: '#FF9B9B', fontSize: 13, fontWeight: '900' },
  deleteAccountCard: { marginTop: 18, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: '#6F2C35', backgroundColor: '#1A1015' },
  deleteAccountTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  deleteAccountDescription: { color: '#C7AEB3', fontSize: 12, lineHeight: 18, marginTop: 6 },
  deleteAccountButton: { minHeight: 46, marginTop: 14, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#8B2635' },
  deleteAccountButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  ordersCustomerName: { color: '#12262F', fontSize: 18, fontWeight: '900', marginTop: 3 },
  orderCard: { marginBottom: 13, padding: 15, borderRadius: 19, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  orderHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  orderName: { color: '#12262F', fontSize: 17, fontWeight: '900' },
  orderDate: { color: '#8493A6', fontSize: 11, marginTop: 4 },
  orderAmount: { color: '#007ABB', fontSize: 16, fontWeight: '900' },
  orderStatusRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 12, paddingTop: 11, borderTopWidth: 1, borderTopColor: '#173345' },
  orderStatusLabel: { color: '#8493A6', fontSize: 11 },
  orderStatusValue: { flex: 1, color: '#334A56', fontSize: 11, fontWeight: '800', textAlign: 'right', marginLeft: 12 },
  orderItemsHeading: { color: '#12262F', fontSize: 13, fontWeight: '900', marginTop: 14, marginBottom: 6 },
  orderLine: { flexDirection: 'row', alignItems: 'center', minHeight: 54, paddingVertical: 6 },
  orderLineImage: { width: 48, height: 48, borderRadius: 9, resizeMode: 'contain', backgroundColor: '#EDF0F2' },
  orderFallbackLogo: { width: 28, height: 28, resizeMode: 'contain' },
  orderLineCopy: { flex: 1, marginLeft: 10 },
  orderLineName: { color: '#12262F', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  orderLineVariant: { color: '#8493A6', fontSize: 10, marginTop: 2 },
  orderLineQuantity: { color: '#007ABB', fontSize: 13, fontWeight: '900', marginLeft: 8 },
  orderDetailsButton: { minHeight: 44, marginTop: 10, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  orderDetailsButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  productDetailScreen: { flex: 1, backgroundColor: '#FFFFFF' },
  productDetailStickyButtonWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 900,
    elevation: 24,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#DCE5E9',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
  },
  productDetailStickyButton: {
    width: '100%',
    minHeight: 54,
    marginTop: 0,
  },
  productDetailBackButton: { alignSelf: 'flex-start', minHeight: 38, justifyContent: 'center', marginBottom: 8 },
  productDetailBackText: { color: '#007ABB', fontSize: 13, fontWeight: '800' },
  productDetailCard: { padding: 15, borderRadius: 22, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  productDetailGallery: { borderRadius: 16, backgroundColor: '#F4F7F8' },
  productDetailImage: { height: 310, resizeMode: 'contain', borderRadius: 16, backgroundColor: '#F4F7F8' },
  productDetailTitle: { color: '#12262F', fontSize: 24, lineHeight: 30, fontWeight: '900', marginTop: 17 },
  productDetailPriceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  productDetailPrice: { color: '#007ABB', fontSize: 20, fontWeight: '900' },
  productDetailStock: { color: '#25845A', fontSize: 12, fontWeight: '800' },
  productDetailStockUnavailable: { color: '#B33B45' },
  productDetailMetaCard: { marginTop: 16, padding: 13, borderRadius: 15, backgroundColor: '#F4F7F8' },
  productDetailMetaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  productDetailMetaLabel: { color: '#6A7D87', fontSize: 12 },
  productDetailMetaValue: { flex: 1, color: '#233A46', fontSize: 12, fontWeight: '800', textAlign: 'right', marginLeft: 16 },
  productDetailSku: { color: '#536A76', fontSize: 12, marginTop: 12 },
  productDetailSectionTitle: { color: '#12262F', fontSize: 18, fontWeight: '900', marginTop: 22, marginBottom: 10 },
  productDetailWebView: { height: 420, borderRadius: 14, borderWidth: 1, borderColor: '#E0E8EC', backgroundColor: '#FFFFFF' },
  productDetailTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 15 },
  productDetailTag: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 13, backgroundColor: '#EAF2F5' },
  productDetailTagText: { color: '#007ABB', fontSize: 10, fontWeight: '700' },
  productDetailAddButton: { minHeight: 54, marginTop: 20, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  productDetailAddButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '900' },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 30, minHeight: 78, flexDirection: 'row', alignItems: 'flex-end', paddingTop: 8, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  navItem: {
    flex: 1,
    minHeight: 64,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1001,
    elevation: 31,
  },
  navIconWrap: { width: 36, height: 34, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  activeNavIcon: { backgroundColor: '#EAF2F5' },
  centerNav: { width: 58, height: 58, borderRadius: 29, marginTop: -28, borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#007ABB' },
  navIcon: { color: '#6C7E88', fontSize: 24, fontWeight: '900' },
  navIconActive: { color: '#007ABB' },
  navLabel: { color: '#6C7E88', fontSize: 9, marginTop: 3 },
  navLabelActive: { color: '#007ABB', fontWeight: '800' },
});
