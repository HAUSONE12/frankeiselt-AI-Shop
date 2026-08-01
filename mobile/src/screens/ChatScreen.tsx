import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
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
import { addToCart, sendChat, type AppLanguage } from '../api/client';
import type { Product } from '../types';

const localeByLanguage: Record<AppLanguage, string> = {
  tr: 'tr-TR',
  de: 'de-DE',
  en: 'en-US',
};

const copy = {
  tr: {
    headline: 'Ürünleri isimlerine göre arayabilirsiniz',
    helper: 'Türkçe yazın veya konuşun. Aramanız Almancaya çevrilerek ürünlerde aranır.',
    placeholder: 'Ürün adı yazın...',
    send: 'Ara',
    inStock: 'Stokta',
    outOfStock: 'Yok',
    noPrice: 'Fiyat yok',
    cart: 'Satın al',
    adding: 'Ekleniyor...',
    details: 'Ürün açıklaması',
    noDescription: 'Bu ürün için açıklama bulunmuyor.',
    close: 'Kapat',
    connectionError: 'Bağlantı kurulamadı. Lütfen tekrar deneyin.',
    voiceError: 'Sesli arama başlatılamadı.',
    startPrompt: 'Aramak istediğiniz ürünün adını yazın veya mikrofona söyleyin.',
  },
  de: {
    headline: 'Sie können Produkte nach ihrem Namen suchen',
    helper: 'Schreiben oder sprechen Sie auf Deutsch. Die Produktsuche erfolgt direkt im Shop.',
    placeholder: 'Produktnamen eingeben...',
    send: 'Suchen',
    inStock: 'Lager',
    outOfStock: 'Ausverkauft',
    noPrice: 'Kein Preis',
    cart: 'Kaufen',
    adding: 'Wird hinzugefügt...',
    details: 'Produktbeschreibung',
    noDescription: 'Für dieses Produkt ist keine Beschreibung verfügbar.',
    close: 'Schließen',
    connectionError: 'Verbindung fehlgeschlagen. Bitte erneut versuchen.',
    voiceError: 'Sprachsuche konnte nicht gestartet werden.',
    startPrompt: 'Geben Sie einen Produktnamen ein oder sprechen Sie ihn ins Mikrofon.',
  },
  en: {
    headline: 'You can search for products by name',
    helper: 'Write or speak in English. Your search is translated into German before matching products.',
    placeholder: 'Enter product name...',
    send: 'Search',
    inStock: 'In stock',
    outOfStock: 'Sold out',
    noPrice: 'No price',
    cart: 'Buy',
    adding: 'Adding...',
    details: 'Product description',
    noDescription: 'No description is available for this product.',
    close: 'Close',
    connectionError: 'Connection failed. Please try again.',
    voiceError: 'Voice search could not be started.',
    startPrompt: 'Type a product name or say it into the microphone.',
  },
} as const;

export function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [language, setLanguage] = useState<AppLanguage>('tr');
  const [input, setInput] = useState('');
  const [statusText, setStatusText] = useState<string>(copy.tr.startPrompt);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [cartId, setCartId] = useState<string>();
  const [addingVariantId, setAddingVariantId] = useState<string>();

  const t = copy[language];
  const canSend = useMemo(() => input.trim().length >= 2 && !loading, [input, loading]);
  const gridGap = 8;
  const pagePadding = 12;
  const cardWidth = Math.max(96, (width - pagePadding * 2 - gridGap * 2) / 3);

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('end', () => setListening(false));
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results[0]?.transcript?.trim();
    if (!transcript) return;
    setInput(transcript);
    if (event.isFinal) void runSearch(transcript);
  });
  useSpeechRecognitionEvent('error', () => setListening(false));

  async function runSearch(rawText?: string) {
    const text = (rawText ?? input).trim();
    if (text.length < 2 || loading) return;

    setProducts([]);
    setInput('');
    setLoading(true);
    setStatusText(text);

    try {
      const result = await sendChat(text, language);
      setProducts(result.products);
      setStatusText(result.reply);
    } catch {
      setStatusText(t.connectionError);
    } finally {
      setLoading(false);
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

  function changeLanguage(next: AppLanguage) {
    setLanguage(next);
    setInput('');
    setProducts([]);
    setStatusText(copy[next].startPrompt);
  }

  async function handleAddToCart(product: Product) {
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

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <View style={styles.brandTextWrap}>
            <Text style={styles.brand}>Frank Eiselt AI</Text>
            <Text style={styles.headline}>{t.headline}</Text>
          </View>
        </View>

        <View style={styles.languages}>
          {(['tr', 'de', 'en'] as AppLanguage[]).map((item) => (
            <Pressable
              key={item}
              onPress={() => changeLanguage(item)}
              style={[styles.languageButton, language === item && styles.languageButtonActive]}
            >
              <Text style={[styles.languageText, language === item && styles.languageTextActive]}>
                {item.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.helper}>{t.helper}</Text>
      </View>

      <View style={styles.statusRow}>
        <Text style={styles.statusText}>{statusText}</Text>
        {loading ? <ActivityIndicator size="small" /> : null}
      </View>

      <FlatList
        data={products}
        key="three-column-grid"
        keyExtractor={(item) => item.id}
        numColumns={3}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.grid}
        columnWrapperStyle={styles.gridRow}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => setSelectedProduct(item)}
            style={({ pressed }) => [
              styles.productCard,
              { width: cardWidth },
              pressed && styles.pressedCard,
            ]}
          >
            {item.imageUrl ? (
              <Image source={{ uri: item.imageUrl }} style={[styles.productImage, { height: cardWidth }]} />
            ) : (
              <View style={[styles.productImage, styles.imageFallback, { height: cardWidth }]}>
                <Text style={styles.imageFallbackText}>1</Text>
              </View>
            )}

            <View style={styles.productBody}>
              <Text numberOfLines={2} style={styles.productTitle}>{item.title}</Text>
              <Text style={styles.price}>
                {item.price ? `${item.price} ${item.currencyCode ?? 'EUR'}` : t.noPrice}
              </Text>
              <Text style={styles.stock}>{item.availableForSale ? t.inStock : t.outOfStock}</Text>
              <Pressable
                disabled={!item.availableForSale || !item.variantId || addingVariantId === item.variantId}
                onPress={(event) => {
                  event.stopPropagation();
                  void handleAddToCart(item);
                }}
                style={[styles.cartButton, (!item.availableForSale || !item.variantId) && styles.disabledButton]}
              >
                <Text numberOfLines={1} style={styles.cartButtonText}>
                  {addingVariantId === item.variantId ? t.adding : t.cart}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={!loading ? <View style={styles.emptySpace} /> : null}
      />

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 10) + 8 }]}>
        <Pressable onPress={startVoiceSearch} style={[styles.micButton, listening && styles.micButtonActive]}>
          <Text style={styles.micText}>{listening ? '■' : '🎤'}</Text>
        </Pressable>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => runSearch()}
          placeholder={t.placeholder}
          placeholderTextColor="#7F8AA3"
          style={styles.input}
          returnKeyType="search"
        />
        <Pressable disabled={!canSend} onPress={() => runSearch()} style={[styles.sendButton, !canSend && styles.disabledButton]}>
          <Text style={styles.sendButtonText}>{t.send}</Text>
        </Pressable>
      </View>

      <Modal
        visible={Boolean(selectedProduct)}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedProduct(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              {selectedProduct?.imageUrl ? (
                <Image source={{ uri: selectedProduct.imageUrl }} style={styles.modalImage} />
              ) : null}
              <Text style={styles.modalTitle}>{selectedProduct?.title}</Text>
              <Text style={styles.modalHeading}>{t.details}</Text>
              <Text style={styles.modalDescription}>
                {selectedProduct?.description?.trim() || t.noDescription}
              </Text>
              <Pressable onPress={() => setSelectedProduct(null)} style={styles.closeButton}>
                <Text style={styles.closeButtonText}>{t.close}</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#12262F' },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1D2940' },
  brandRow: { flexDirection: 'row', alignItems: 'center' },
  logo: { width: 56, height: 56, resizeMode: 'contain', marginRight: 10 },
  brandTextWrap: { flex: 1 },
  brand: { color: '#FFFFFF', fontSize: 25, fontWeight: '900' },
  headline: { color: '#007ABB', marginTop: 2, fontSize: 14, fontWeight: '700' },
  languages: { flexDirection: 'row', gap: 6, marginTop: 10 },
  languageButton: { minWidth: 44, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: '#152038' },
  languageButtonActive: { backgroundColor: '#007ABB' },
  languageText: { color: '#8FA2C8', fontWeight: '800', fontSize: 12 },
  languageTextActive: { color: '#FFFFFF' },
  helper: { color: '#9AA8C4', marginTop: 9, fontSize: 12, lineHeight: 17 },
  statusRow: { minHeight: 48, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusText: { color: '#FFFFFF', flex: 1, paddingRight: 10, fontSize: 14 },
  grid: { paddingHorizontal: 12, paddingBottom: 18 },
  gridRow: { gap: 8, marginBottom: 8 },
  productCard: { borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  pressedCard: { opacity: 0.8 },
  productImage: { width: '100%', resizeMode: 'contain', backgroundColor: '#F2F4F7' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  imageFallbackText: { color: '#007ABB', fontSize: 38, fontWeight: '900' },
  productBody: { padding: 8 },
  productTitle: { color: '#111827', minHeight: 34, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  price: { color: '#111827', marginTop: 5, fontSize: 13, fontWeight: '900' },
  stock: { color: '#4B5563', marginTop: 3, fontSize: 11 },
  cartButton: { marginTop: 7, minHeight: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, backgroundColor: '#111827' },
  cartButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  disabledButton: { opacity: 0.4 },
  emptySpace: { minHeight: 160 },
  composer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 9, paddingHorizontal: 9, borderTopWidth: 1, borderTopColor: '#1D2940', backgroundColor: '#12262F' },
  input: { flex: 1, minHeight: 48, borderRadius: 14, paddingHorizontal: 13, color: '#FFFFFF', backgroundColor: '#152038' },
  micButton: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#152038' },
  micButtonActive: { backgroundColor: '#B91C1C' },
  micText: { fontSize: 20, color: '#FFFFFF' },
  sendButton: { minHeight: 48, borderRadius: 14, justifyContent: 'center', paddingHorizontal: 13, backgroundColor: '#007ABB' },
  sendButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  modalBackdrop: { flex: 1, padding: 20, justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.72)' },
  modalCard: { maxHeight: '82%', borderRadius: 20, overflow: 'hidden', backgroundColor: '#FFFFFF' },
  modalContent: { padding: 18 },
  modalImage: { width: '100%', height: 220, resizeMode: 'contain', backgroundColor: '#F2F4F7', borderRadius: 14 },
  modalTitle: { marginTop: 16, color: '#111827', fontSize: 22, fontWeight: '900' },
  modalHeading: { marginTop: 18, color: '#007ABB', fontSize: 15, fontWeight: '800' },
  modalDescription: { marginTop: 8, color: '#374151', fontSize: 15, lineHeight: 22 },
  closeButton: { marginTop: 20, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  closeButtonText: { color: '#FFFFFF', fontWeight: '800' },
});