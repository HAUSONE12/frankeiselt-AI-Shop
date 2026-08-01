import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type {
  CustomerAddress,
  CustomerOrder,
  CustomerOrderMoney,
} from '../services/customerAccount';

type Props = {
  order: CustomerOrder;
  bottomInset: number;
  onBack: () => void;
};

type WebDocument = {
  title: string;
  url: string;
};

function money(value?: CustomerOrderMoney | null): string {
  if (!value) return '–';
  const amount = Number(value.amount);
  if (!Number.isFinite(amount)) return `${value.amount} ${value.currencyCode}`;

  try {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: value.currencyCode,
    }).format(amount);
  } catch {
    return `${value.amount} ${value.currencyCode}`;
  }
}

function formatDate(value?: string | null): string {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('de-DE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function statusLabel(value?: string | null): string {
  if (!value) return 'Unbekannt';
  return value
    .toLocaleLowerCase('de-DE')
    .split('_')
    .map((part) => part.charAt(0).toLocaleUpperCase('de-DE') + part.slice(1))
    .join(' ');
}

function addressLines(address?: CustomerAddress | null): string[] {
  if (!address) return [];
  return [
    [address.firstName, address.lastName].filter(Boolean).join(' '),
    address.company,
    address.address1,
    address.address2,
    [address.zip, address.city].filter(Boolean).join(' '),
    [address.zoneCode, address.territoryCode].filter(Boolean).join(' · '),
  ].filter((line): line is string => Boolean(line?.trim()));
}

function AddressCard({ title, address }: { title: string; address?: CustomerAddress | null }) {
  const lines = addressLines(address);
  if (lines.length === 0) return null;

  return (
    <View style={styles.addressCard}>
      <Text style={styles.cardTitle}>{title}</Text>
      {lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.addressLine}>{line}</Text>
      ))}
    </View>
  );
}

export function CustomerOrderDetails({ order, bottomInset, onBack }: Props) {
  const [webDocument, setWebDocument] = useState<WebDocument>();

  const trackingEntries = useMemo(
    () => order.fulfillments.flatMap((fulfillment) =>
      fulfillment.trackingInformation.map((tracking) => ({ fulfillment, tracking })),
    ),
    [order.fulfillments],
  );

  return (
    <View style={styles.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: 110 + bottomInset }]}
      >
        <View style={styles.header}>
          <Image source={require('../../assets/logo.png')} style={styles.logo} />
          <Text style={styles.brand}>Frank Eiselt</Text>
        </View>

        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹ Bestellungen</Text>
        </Pressable>

        <View style={styles.heroCard}>
          <View style={styles.heroTopRow}>
            <View style={styles.heroCopy}>
              <Text style={styles.eyebrow}>Bestellung</Text>
              <Text style={styles.orderName}>{order.name}</Text>
              <Text style={styles.orderDate}>{formatDate(order.processedAt || order.createdAt)}</Text>
            </View>
            <Text style={styles.orderTotal}>{money(order.totalPrice)}</Text>
          </View>

          <View style={styles.statusRow}>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeLabel}>Zahlung</Text>
              <Text style={styles.statusBadgeValue}>{statusLabel(order.financialStatus)}</Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeLabel}>Versand</Text>
              <Text style={styles.statusBadgeValue}>{statusLabel(order.fulfillmentStatus)}</Text>
            </View>
          </View>

          {order.confirmationNumber ? (
            <Text style={styles.confirmation}>Bestätigung: {order.confirmationNumber}</Text>
          ) : null}
          {order.poNumber ? <Text style={styles.confirmation}>Bestellnummer: {order.poNumber}</Text> : null}
        </View>

        <Text style={styles.sectionTitle}>Sendungsverfolgung</Text>
        {trackingEntries.length === 0 ? (
          <View style={styles.infoCard}>
            <Text style={styles.infoText}>
              Sobald die Bestellung versendet wurde, erscheinen hier Versanddienstleister und Sendungsnummer.
            </Text>
          </View>
        ) : (
          trackingEntries.map(({ fulfillment, tracking }, index) => (
            <View key={`${fulfillment.id}-${tracking.number ?? index}`} style={styles.trackingCard}>
              <View style={styles.trackingHeader}>
                <Text style={styles.cardTitle}>{tracking.company || 'Versand'}</Text>
                <Text style={styles.trackingStatus}>
                  {statusLabel(fulfillment.latestShipmentStatus || fulfillment.status)}
                </Text>
              </View>
              {tracking.number ? <Text style={styles.trackingNumber}>{tracking.number}</Text> : null}
              {fulfillment.estimatedDeliveryAt ? (
                <Text style={styles.muted}>Voraussichtliche Zustellung: {formatDate(fulfillment.estimatedDeliveryAt)}</Text>
              ) : null}
              {tracking.url ? (
                <Pressable
                  onPress={() => setWebDocument({ title: 'Sendungsverfolgung', url: tracking.url! })}
                  style={styles.primaryButton}
                >
                  <Text style={styles.primaryButtonText}>Sendung in der App verfolgen</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Artikel</Text>
        <View style={styles.itemsCard}>
          {order.lineItems.map((line) => (
            <View key={line.id} style={styles.lineItem}>
              {line.imageUrl ? (
                <Image source={{ uri: line.imageUrl }} style={styles.lineImage} resizeMode="contain" />
              ) : (
                <View style={[styles.lineImage, styles.imageFallback]}>
                  <Image source={require('../../assets/logo.png')} style={styles.fallbackLogo} />
                </View>
              )}
              <View style={styles.lineCopy}>
                <Text style={styles.lineName}>{line.name}</Text>
                {line.variantTitle ? <Text style={styles.muted}>{line.variantTitle}</Text> : null}
                {line.sku ? <Text style={styles.muted}>Art.-Nr.: {line.sku}</Text> : null}
                {line.price ? <Text style={styles.linePrice}>{money(line.price)}</Text> : null}
              </View>
              <View style={styles.lineRight}>
                <Text style={styles.quantity}>×{line.quantity}</Text>
                {line.totalPrice ? <Text style={styles.lineTotal}>{money(line.totalPrice)}</Text> : null}
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Zusammenfassung</Text>
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Zwischensumme</Text><Text style={styles.summaryValue}>{money(order.subtotal)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Versand</Text><Text style={styles.summaryValue}>{money(order.totalShipping)}</Text></View>
          <View style={styles.summaryRow}><Text style={styles.summaryLabel}>MwSt.</Text><Text style={styles.summaryValue}>{money(order.totalTax)}</Text></View>
          {Number(order.totalRefunded?.amount ?? 0) > 0 ? (
            <View style={styles.summaryRow}><Text style={styles.summaryLabel}>Erstattet</Text><Text style={styles.summaryValue}>− {money(order.totalRefunded)}</Text></View>
          ) : null}
          <View style={[styles.summaryRow, styles.summaryTotalRow]}>
            <Text style={styles.summaryTotalLabel}>Gesamt</Text>
            <Text style={styles.summaryTotal}>{money(order.totalPrice)}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Kundendaten</Text>
        <AddressCard title="Lieferadresse" address={order.shippingAddress} />
        <AddressCard title="Rechnungsadresse" address={order.billingAddress} />
        {order.email || order.phone ? (
          <View style={styles.infoCard}>
            {order.email ? <Text style={styles.infoText}>E-Mail: {order.email}</Text> : null}
            {order.phone ? <Text style={styles.infoText}>Telefon: {order.phone}</Text> : null}
          </View>
        ) : null}

        <Text style={styles.sectionTitle}>Rechnung</Text>
        <View style={styles.invoiceCard}>
          {order.invoiceUrl ? (
            <>
              <Text style={styles.cardTitle}>Rechnung verfügbar</Text>
              <Text style={styles.infoText}>Die Rechnung kann direkt in der Frank Eiselt App geöffnet werden.</Text>
              <Pressable
                onPress={() => setWebDocument({ title: `Rechnung ${order.name}`, url: order.invoiceUrl! })}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryButtonText}>Rechnung öffnen</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardTitle}>Noch keine Rechnung verfügbar</Text>
              <Text style={styles.infoText}>
                Sobald eine Rechnungsdatei mit dieser Bestellung verknüpft wurde, erscheint sie automatisch hier.
              </Text>
            </>
          )}
        </View>

        {order.note ? (
          <View style={styles.infoCard}>
            <Text style={styles.cardTitle}>Hinweis zur Bestellung</Text>
            <Text style={styles.infoText}>{order.note}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(webDocument)} animationType="slide" onRequestClose={() => setWebDocument(undefined)}>
        <View style={styles.modalRoot}>
          <View style={[styles.modalHeader, { paddingTop: Math.max(bottomInset, 12) }]}> 
            <Text style={styles.modalTitle}>{webDocument?.title}</Text>
            <Pressable onPress={() => setWebDocument(undefined)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Schließen</Text>
            </Pressable>
          </View>
          {webDocument ? (
            <WebView
              source={{ uri: webDocument.url }}
              style={styles.webView}
              setSupportMultipleWindows={false}
              startInLoadingState
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: 14, paddingTop: 8 },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  logo: { width: 42, height: 42, resizeMode: 'contain', marginRight: 8 },
  brand: { color: '#12262F', fontSize: 25, fontWeight: '900' },
  backButton: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', marginBottom: 8 },
  backText: { color: '#007ABB', fontSize: 14, fontWeight: '800' },
  heroCard: { padding: 17, borderRadius: 21, borderWidth: 1, borderColor: '#D8E3E8', backgroundColor: '#FFFFFF' },
  heroTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroCopy: { flex: 1, paddingRight: 12 },
  eyebrow: { color: '#6B7D87', fontSize: 11, fontWeight: '800', textTransform: 'uppercase' },
  orderName: { color: '#12262F', fontSize: 26, fontWeight: '900', marginTop: 3 },
  orderDate: { color: '#6B7D87', fontSize: 12, marginTop: 5 },
  orderTotal: { color: '#007ABB', fontSize: 18, fontWeight: '900' },
  statusRow: { flexDirection: 'row', gap: 8, marginTop: 15 },
  statusBadge: { flex: 1, padding: 11, borderRadius: 13, backgroundColor: '#EEF5F7' },
  statusBadgeLabel: { color: '#6B7D87', fontSize: 10, fontWeight: '700' },
  statusBadgeValue: { color: '#12262F', fontSize: 12, fontWeight: '900', marginTop: 3 },
  confirmation: { color: '#516873', fontSize: 12, marginTop: 10 },
  sectionTitle: { color: '#12262F', fontSize: 19, fontWeight: '900', marginTop: 24, marginBottom: 10 },
  infoCard: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF', marginBottom: 10 },
  infoText: { color: '#536A76', fontSize: 13, lineHeight: 19, marginTop: 4 },
  trackingCard: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF', marginBottom: 10 },
  trackingHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  trackingStatus: { color: '#25845A', fontSize: 11, fontWeight: '900' },
  trackingNumber: { color: '#12262F', fontSize: 16, fontWeight: '900', marginTop: 8 },
  muted: { color: '#70818B', fontSize: 11, lineHeight: 16, marginTop: 3 },
  cardTitle: { color: '#12262F', fontSize: 15, fontWeight: '900' },
  primaryButton: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007ABB', marginTop: 13, paddingHorizontal: 14 },
  primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  itemsCard: { borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  lineItem: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#E7ECEF' },
  lineImage: { width: 62, height: 62, borderRadius: 11, backgroundColor: '#F2F6F8' },
  imageFallback: { alignItems: 'center', justifyContent: 'center' },
  fallbackLogo: { width: 34, height: 34, resizeMode: 'contain' },
  lineCopy: { flex: 1, marginLeft: 11 },
  lineName: { color: '#12262F', fontSize: 13, lineHeight: 17, fontWeight: '800' },
  linePrice: { color: '#007ABB', fontSize: 12, fontWeight: '900', marginTop: 5 },
  lineRight: { alignItems: 'flex-end', marginLeft: 8 },
  quantity: { color: '#007ABB', fontSize: 14, fontWeight: '900' },
  lineTotal: { color: '#12262F', fontSize: 11, fontWeight: '800', marginTop: 8 },
  summaryCard: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  summaryLabel: { color: '#657782', fontSize: 13 },
  summaryValue: { color: '#12262F', fontSize: 13, fontWeight: '800' },
  summaryTotalRow: { marginTop: 8, paddingTop: 13, borderTopWidth: 1, borderTopColor: '#DCE5E9' },
  summaryTotalLabel: { color: '#12262F', fontSize: 16, fontWeight: '900' },
  summaryTotal: { color: '#007ABB', fontSize: 18, fontWeight: '900' },
  addressCard: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#DCE5E9', backgroundColor: '#FFFFFF', marginBottom: 10 },
  addressLine: { color: '#536A76', fontSize: 13, lineHeight: 19, marginTop: 3 },
  invoiceCard: { padding: 15, borderRadius: 17, borderWidth: 1, borderColor: '#D5E1E6', backgroundColor: '#F7FAFB', marginBottom: 10 },
  modalRoot: { flex: 1, backgroundColor: '#FFFFFF' },
  modalHeader: { minHeight: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: '#DCE5E9' },
  modalTitle: { flex: 1, color: '#12262F', fontSize: 18, fontWeight: '900' },
  modalClose: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 12, backgroundColor: '#007ABB' },
  modalCloseText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  webView: { flex: 1, backgroundColor: '#FFFFFF' },
});
