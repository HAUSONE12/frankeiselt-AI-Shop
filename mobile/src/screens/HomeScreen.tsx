import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import {
  addToCart,
  askProductAssistant,
  getCollections,
  getSaleProducts,
  sendChat,
  type AppLanguage,
} from '../api/client';
import type { Collection, Product } from '../types';
import { ChatScreen } from './ChatScreen';

type AppTab = 'home' | 'categories' | 'search' | 'orders' | 'profile';

const SHOP_URL = 'https://frankeiselt.de';
const ACCOUNT_URL = `${SHOP_URL}/account`;

const legalLinks = [
  { label: 'Datenschutz', url: `${SHOP_URL}/policies/privacy-policy` },
  { label: 'AGB', url: `${SHOP_URL}/policies/terms-of-service` },
  { label: 'Impressum', url: `${SHOP_URL}/pages/impressum` },
  { label: 'Widerrufsrecht', url: `${SHOP_URL}/pages/widerrufsrecht` },
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
    assistantTitle: 'Yapay zeka asistanına sor',
    assistantText: 'Shopify ürün bilgilerine göre kısa ve net cevap verir.',
    assistantPlaceholder: 'Örn: Bu ürün hangi makineye uyar?',
    ask: 'Sor',
    categoriesTitle: 'Kategoriler',
    categoriesText: 'Shopify mağazasındaki ürün koleksiyonları',
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
    resultPrompt: 'Ürün adını yazın veya mikrofona söyleyin.',
  },
  de: {
    greeting: 'Hallo! 👋',
    intro: 'Produkt eingeben oder sprechen – Frank Eiselt AI findet es für Sie.',
    searchPlaceholder: 'Produkt suchen... (z. B. Mörtelschlauch NW19)',
    recent: 'Letzte Suchen',
    recommendations: 'Für Sie empfohlen',
    seeAll: 'Alle anzeigen',
    add: 'In den Warenkorb',
    adding: 'Wird hinzugefügt...',
    inStock: 'Auf Lager',
    outOfStock: 'Ausverkauft',
    noPrice: 'Kein Preis',
    assistantTitle: 'KI-Assistent fragen',
    assistantText: 'Kurze Antworten ausschließlich anhand der Shopify-Produktdaten.',
    assistantPlaceholder: 'Z. B. Für welche Maschine passt das?',
    ask: 'Fragen',
    categoriesTitle: 'Kategorien',
    categoriesText: 'Produktkollektionen aus dem Shopify-Shop',
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
    assistantTitle: 'Ask the AI assistant',
    assistantText: 'Short answers based only on Shopify product information.',
    assistantPlaceholder: 'E.g. Which machine is this compatible with?',
    ask: 'Ask',
    categoriesTitle: 'Categories',
    categoriesText: 'Product collections from the Shopify store',
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
  },
} as const;

const initialRecent = ['Mörtelschlauch NW19', 'PFT G4 Smart', 'Rotor Stator D6-3', 'Glättkelle'];

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const pulse = useRef(new Animated.Value(0)).current;

  const [language, setLanguage] = useState<AppLanguage>('tr');
  const [activeTab, setActiveTab] = useState<AppTab>('home');
  const [searchText, setSearchText] = useState('');
  const [statusText, setStatusText] = useState<string>(copy.tr.resultPrompt);
  const [saleProducts, setSaleProducts] = useState<Product[]>([]);
  const [searchProducts, setSearchProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [recentSearches, setRecentSearches] = useState(initialRecent);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantAnswer, setAssistantAnswer] = useState('');
  const [loadingSale, setLoadingSale] = useState(true);
  const [loadingSearch, setLoadingSearch] = useState(false);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingAssistant, setLoadingAssistant] = useState(false);
  const [listening, setListening] = useState(false);
  const [cartId, setCartId] = useState<string>();
  const [addingVariantId, setAddingVariantId] = useState<string>();

  const t = copy[language];
  const cardGap = 8;
  const pagePadding = 14;
  const cardWidth = Math.max(96, (width - pagePadding * 2 - cardGap * 2) / 3);

  useEffect(() => {
    void loadSale();
  }, []);

  useEffect(() => {
    if (activeTab === 'categories' && collections.length === 0) void loadCollections();
  }, [activeTab, collections.length]);

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
          duration: 750,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 750,
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

  async function loadSale() {
    setLoadingSale(true);
    try {
      setSaleProducts(await getSaleProducts(9));
    } catch {
      setSaleProducts([]);
    } finally {
      setLoadingSale(false);
    }
  }

  async function loadCollections() {
    setLoadingCollections(true);
    try {
      setCollections(await getCollections(30));
    } catch {
      setCollections([]);
    } finally {
      setLoadingCollections(false);
    }
  }

  async function runSearch(raw?: string) {
    const query = (raw ?? searchText).trim();
    if (query.length < 2 || loadingSearch) return;

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

  async function addProduct(product: Product) {
    if (!product.variantId) return;
    setAddingVariantId(product.variantId);
    try {
      const cart = await addToCart(product.variantId, cartId);
      setCartId(cart.id);
      await Linking.openURL(cart.checkoutUrl);
    } finally {
      setAddingVariantId(undefined);
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

  function renderHeader() {
    return (
      <>
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Image source={require('../../assets/logo.png')} style={styles.logo} />
            <Text style={styles.brand}>Frank Eiselt <Text style={styles.brandAccent}>AI Shop</Text></Text>
          </View>
          <View style={styles.languages}>
            {(['tr', 'de', 'en'] as AppLanguage[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  setLanguage(item);
                  setStatusText(copy[item].resultPrompt);
                  setAssistantAnswer('');
                }}
                style={[styles.languageButton, language === item && styles.languageButtonActive]}
              >
                <Text style={[styles.languageText, language === item && styles.languageTextActive]}>
                  {item.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </>
    );
  }

  function renderSearchBox() {
    const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.3] });
    const pulseOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] });

    return (
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <TextInput
            value={searchText}
            onChangeText={setSearchText}
            onSubmitEditing={() => runSearch()}
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
          <Animated.View
            style={{
              transform: [{
                scale: listening
                  ? pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] })
                  : 1,
              }],
            }}
          >
            <Pressable
              onPress={startVoiceSearch}
              style={[styles.micButton, listening && styles.micButtonActive]}
            >
              <Text style={styles.micSymbol}>{listening ? '■' : '●'}</Text>
              <View style={styles.micStem} />
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
            {product.imageUrl ? (
              <Image source={{ uri: product.imageUrl }} style={[styles.productImage, { height: cardWidth }]} />
            ) : (
              <View style={[styles.productImage, styles.productFallback, { height: cardWidth }]}> 
                <Image source={require('../../assets/logo.png')} style={styles.fallbackLogo} />
              </View>
            )}
            <View style={styles.productBody}>
              <Text numberOfLines={2} style={styles.productTitle}>{product.title}</Text>
              <Text style={styles.productPrice}>
                {product.price ? `${product.price} ${product.currencyCode ?? 'EUR'}` : t.noPrice}
              </Text>
              <Text style={styles.productStock}>{product.availableForSale ? t.inStock : t.outOfStock}</Text>
              <Pressable
                disabled={!product.availableForSale || !product.variantId || addingVariantId === product.variantId}
                onPress={() => addProduct(product)}
                style={[styles.addButton, (!product.availableForSale || !product.variantId) && styles.disabled]}
              >
                <Text numberOfLines={1} style={styles.addButtonText}>
                  {addingVariantId === product.variantId ? t.adding : t.add}
                </Text>
              </Pressable>
            </View>
          </View>
        ))}
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
        <Text style={styles.greeting}>{t.greeting}</Text>
        <Text style={styles.intro}>{t.intro}</Text>
        {renderSearchBox()}

        <Text style={styles.recentTitle}>{t.recent}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {recentSearches.map((item) => (
            <Pressable key={item} onPress={() => runSearch(item)} style={styles.chip}>
              <Text style={styles.chipText}>{item}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.heroCard}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>Frank Eiselt AI</Text>
            <Text style={styles.heroTitle}>Aradığın ürüne</Text>
            <Text style={styles.heroAccent}>akıllı çözümler</Text>
            <View style={styles.heroFeature}><Text style={styles.heroIcon}>⌕</Text><Text style={styles.heroFeatureText}>Akıllı ürün arama</Text></View>
            <View style={styles.heroFeature}><Text style={styles.heroIcon}>✓</Text><Text style={styles.heroFeatureText}>Güvenli Shopify ödeme</Text></View>
            <View style={styles.heroFeature}><Text style={styles.heroIcon}>→</Text><Text style={styles.heroFeatureText}>Hızlı teslimat</Text></View>
          </View>
          <View style={styles.heroRobot}>
            <Image source={require('../../assets/logo.png')} style={styles.heroLogo} />
            <View style={styles.eyes}><View style={styles.eye} /><View style={styles.eye} /></View>
          </View>
        </View>

        {searchProducts.length > 0 || loadingSearch ? (
          <>
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>{statusText}</Text>
              {loadingSearch ? <ActivityIndicator size="small" /> : null}
            </View>
            {renderProducts(searchProducts)}
          </>
        ) : null}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>✦ {t.recommendations}</Text>
          <Pressable onPress={() => setActiveTab('search')}>
            <Text style={styles.seeAll}>{t.seeAll} ›</Text>
          </Pressable>
        </View>
        {loadingSale ? <ActivityIndicator style={styles.loader} /> : renderProducts(saleProducts)}

        <View style={styles.assistantCard}>
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
              onSubmitEditing={askAssistant}
              placeholder={t.assistantPlaceholder}
              placeholderTextColor="#7D8999"
              style={styles.assistantInput}
              returnKeyType="send"
            />
            <Pressable onPress={askAssistant} style={styles.askButton}>
              <Text style={styles.askButtonText}>{loadingAssistant ? '…' : t.ask}</Text>
            </Pressable>
          </View>
          {assistantAnswer ? <Text style={styles.answer}>{assistantAnswer}</Text> : null}
        </View>

        <View style={styles.legalFooter}>
          {legalLinks.map((item) => (
            <Pressable key={item.label} onPress={() => Linking.openURL(item.url)}>
              <Text style={styles.legalLink}>{item.label}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  function renderCategories() {
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}> 
        {renderHeader()}
        <Text style={styles.pageTitle}>{t.categoriesTitle}</Text>
        <Text style={styles.pageText}>{t.categoriesText}</Text>
        {loadingCollections ? <ActivityIndicator style={styles.loader} /> : null}
        <View style={styles.collectionGrid}>
          {collections.map((collection) => (
            <Pressable
              key={collection.id}
              onPress={() => Linking.openURL(`${SHOP_URL}/collections/${collection.handle}`)}
              style={styles.collectionCard}
            >
              {collection.imageUrl ? (
                <Image source={{ uri: collection.imageUrl }} style={styles.collectionImage} />
              ) : (
                <View style={[styles.collectionImage, styles.productFallback]}>
                  <Image source={require('../../assets/logo.png')} style={styles.collectionLogo} />
                </View>
              )}
              <Text numberOfLines={2} style={styles.collectionTitle}>{collection.title}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    );
  }

  function renderAccount(type: 'orders' | 'profile') {
    const orders = type === 'orders';
    return (
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 110 + insets.bottom }]}> 
        {renderHeader()}
        <View style={styles.accountCard}>
          <Text style={styles.accountIcon}>{orders ? '▣' : '○'}</Text>
          <Text style={styles.accountTitle}>{orders ? t.ordersTitle : t.profileTitle}</Text>
          <Text style={styles.accountText}>{orders ? t.ordersText : t.profileText}</Text>
          <Pressable onPress={() => Linking.openURL(ACCOUNT_URL)} style={styles.accountButton}>
            <Text style={styles.accountButtonText}>{t.openAccount}</Text>
          </Pressable>
        </View>
      </ScrollView>
    );
  }

  const navItems: Array<{ key: AppTab; icon: string; label: string }> = [
    { key: 'home', icon: '⌂', label: t.home },
    { key: 'categories', icon: '▦', label: t.categories },
    { key: 'search', icon: '✦', label: t.search },
    { key: 'orders', icon: '▣', label: t.orders },
    { key: 'profile', icon: '○', label: t.profile },
  ];

  return (
    <View style={styles.root}>
      <View style={styles.screen}>
        {activeTab === 'home' ? renderHome() : null}
        {activeTab === 'categories' ? renderCategories() : null}
        {activeTab === 'search' ? <ChatScreen /> : null}
        {activeTab === 'orders' ? renderAccount('orders') : null}
        {activeTab === 'profile' ? renderAccount('profile') : null}
      </View>

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, 8) }]}> 
        {navItems.map((item) => {
          const isCenter = item.key === 'search';
          const active = activeTab === item.key;
          return (
            <Pressable key={item.key} onPress={() => setActiveTab(item.key)} style={styles.navItem}>
              <View style={[styles.navIconWrap, isCenter && styles.centerNav, active && !isCenter && styles.activeNavIcon]}>
                <Text style={[styles.navIcon, active && styles.navIconActive]}>{item.icon}</Text>
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
  root: { flex: 1, backgroundColor: '#12262F' },
  screen: { flex: 1 },
  content: { paddingHorizontal: 14, paddingTop: 8, backgroundColor: '#12262F' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  logo: { width: 42, height: 42, resizeMode: 'contain', marginRight: 8 },
  brand: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  brandAccent: { color: '#007ABB' },
  languages: { flexDirection: 'row', gap: 4 },
  languageButton: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: '#111C27' },
  languageButtonActive: { backgroundColor: '#007ABB' },
  languageText: { color: '#8C9AAD', fontSize: 10, fontWeight: '800' },
  languageTextActive: { color: '#FFFFFF' },
  greeting: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  intro: { color: '#B4BECC', fontSize: 15, lineHeight: 22, marginTop: 6, marginBottom: 16 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', borderRadius: 28, borderWidth: 1, borderColor: '#244054', backgroundColor: '#0B1620', paddingHorizontal: 16 },
  searchIcon: { color: '#98A7B8', fontSize: 26, marginRight: 10 },
  searchInput: { flex: 1, color: '#FFFFFF', fontSize: 14 },
  micWrap: { width: 58, height: 58, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#007ABB' },
  micButton: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#007ABB' },
  micButtonActive: { backgroundColor: '#0E6780' },
  micSymbol: { color: '#FFFFFF', fontSize: 13 },
  micStem: { width: 14, height: 8, marginTop: 2, borderBottomWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: '#FFFFFF', borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  recentTitle: { color: '#8795A8', marginTop: 16, marginBottom: 8, fontSize: 12 },
  chips: { gap: 8, paddingRight: 12 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, borderWidth: 1, borderColor: '#91410E', backgroundColor: '#0A151E' },
  chipText: { color: '#E7EDF4', fontSize: 12 },
  heroCard: { minHeight: 250, borderRadius: 22, marginTop: 18, padding: 18, overflow: 'hidden', flexDirection: 'row', borderWidth: 1, borderColor: '#17435C', backgroundColor: '#07141E' },
  heroCopy: { flex: 1, zIndex: 2 },
  heroEyebrow: { color: '#CAD6E2', fontSize: 12 },
  heroTitle: { color: '#FFFFFF', fontSize: 26, fontWeight: '900', marginTop: 6 },
  heroAccent: { color: '#007ABB', fontSize: 27, fontWeight: '900', marginBottom: 15 },
  heroFeature: { flexDirection: 'row', alignItems: 'center', marginTop: 10 },
  heroIcon: { width: 26, color: '#007ABB', fontSize: 18, fontWeight: '900' },
  heroFeatureText: { color: '#CED7E1', fontSize: 12, flex: 1 },
  heroRobot: { width: 112, height: 112, borderRadius: 56, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#0E2331', shadowColor: '#007ABB', shadowOpacity: 0.55, shadowRadius: 20 },
  heroLogo: { width: 62, height: 62, resizeMode: 'contain' },
  eyes: { position: 'absolute', top: 38, flexDirection: 'row', gap: 18 },
  eye: { width: 8, height: 18, borderRadius: 4, backgroundColor: '#007ABB' },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 10 },
  statusText: { color: '#DCE4ED', fontSize: 13, flex: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  seeAll: { color: '#007ABB', fontSize: 13 },
  loader: { marginVertical: 24 },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  productCard: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: '#3A2619', backgroundColor: '#0A151E' },
  productImage: { width: '100%', resizeMode: 'contain', backgroundColor: '#EDF0F2' },
  productFallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackLogo: { width: 54, height: 54, resizeMode: 'contain' },
  productBody: { padding: 8 },
  productTitle: { color: '#FFFFFF', minHeight: 34, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  productPrice: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', marginTop: 6 },
  productStock: { color: '#8C9AAD', fontSize: 10, marginTop: 3 },
  addButton: { minHeight: 34, borderRadius: 10, marginTop: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: '#007ABB' },
  addButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  assistantCard: { marginTop: 22, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: '#17435C', backgroundColor: '#07141E' },
  assistantHead: { flexDirection: 'row', alignItems: 'center' },
  assistantAvatar: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#0D202C' },
  assistantLogo: { width: 42, height: 42, resizeMode: 'contain' },
  assistantCopy: { flex: 1, marginLeft: 12 },
  assistantTitle: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  assistantText: { color: '#9DAABA', fontSize: 12, lineHeight: 17, marginTop: 4 },
  assistantInputRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  assistantInput: { flex: 1, minHeight: 46, borderRadius: 14, paddingHorizontal: 13, color: '#FFFFFF', backgroundColor: '#101D27' },
  askButton: { minWidth: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB' },
  askButtonText: { color: '#FFFFFF', fontWeight: '900' },
  answer: { color: '#DDE6EF', fontSize: 13, lineHeight: 19, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: '#101D27' },
  legalFooter: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 14, marginTop: 26, paddingTop: 20, borderTopWidth: 1, borderTopColor: '#182A37' },
  legalLink: { color: '#8493A6', fontSize: 11 },
  pageTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginTop: 8 },
  pageText: { color: '#9DAABA', fontSize: 14, lineHeight: 21, marginTop: 6, marginBottom: 18 },
  collectionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  collectionCard: { width: '48.5%', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#1D3648', backgroundColor: '#0A151E' },
  collectionImage: { width: '100%', height: 125, resizeMode: 'cover', backgroundColor: '#EDF0F2' },
  collectionLogo: { width: 64, height: 64, resizeMode: 'contain' },
  collectionTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', padding: 12 },
  accountCard: { marginTop: 55, padding: 24, borderRadius: 22, alignItems: 'center', borderWidth: 1, borderColor: '#17435C', backgroundColor: '#07141E' },
  accountIcon: { color: '#007ABB', fontSize: 58 },
  accountTitle: { color: '#FFFFFF', fontSize: 25, fontWeight: '900', marginTop: 12 },
  accountText: { color: '#9DAABA', fontSize: 14, lineHeight: 21, textAlign: 'center', marginTop: 10 },
  accountButton: { minHeight: 52, alignSelf: 'stretch', borderRadius: 15, alignItems: 'center', justifyContent: 'center', marginTop: 20, backgroundColor: '#007ABB' },
  accountButtonText: { color: '#FFFFFF', fontWeight: '900' },
  bottomNav: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 78, flexDirection: 'row', alignItems: 'flex-end', paddingTop: 8, paddingHorizontal: 5, borderTopWidth: 1, borderTopColor: '#183141', backgroundColor: '#07131C' },
  navItem: { flex: 1, alignItems: 'center' },
  navIconWrap: { width: 36, height: 34, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  activeNavIcon: { backgroundColor: '#162B38' },
  centerNav: { width: 58, height: 58, borderRadius: 29, marginTop: -28, borderWidth: 2, borderColor: '#007ABB', backgroundColor: '#007ABB' },
  navIcon: { color: '#8493A6', fontSize: 24, fontWeight: '900' },
  navIconActive: { color: '#007ABB' },
  navLabel: { color: '#8493A6', fontSize: 9, marginTop: 3 },
  navLabelActive: { color: '#007ABB', fontWeight: '800' },
});