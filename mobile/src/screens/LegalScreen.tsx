import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { AppLanguage } from '../api/client';

type LegalScreenProps = {
  language: AppLanguage;
};

const copy = {
  tr: {
    title: 'Yasal bilgiler',
    intro: 'Frank Eiselt mağazasına ait yasal sayfaları görüntülemek için aşağıdaki bağlantıları açın.',
    open: 'Sayfayı aç',
  },
  de: {
    title: 'Rechtliche Informationen',
    intro: 'Öffnen Sie die rechtlichen Seiten des Frank-Eiselt-Shops über die folgenden Links.',
    open: 'Seite öffnen',
  },
  en: {
    title: 'Legal information',
    intro: 'Open the legal pages of the Frank Eiselt store using the links below.',
    open: 'Open page',
  },
} as const;

const PAGES = [
  {
    title: 'Datenschutz',
    description: 'Informationen zum Datenschutz und zur Verarbeitung personenbezogener Daten.',
    url: 'https://frankeiselt.de/policies/privacy-policy',
  },
  {
    title: 'AGB',
    description: 'Allgemeine Geschäftsbedingungen für Bestellungen im Frank-Eiselt-Shop.',
    url: 'https://frankeiselt.de/policies/terms-of-service',
  },
  {
    title: 'Impressum',
    description: 'Anbieterkennzeichnung, Kontakt- und Unternehmensdaten der Frank Eiselt GmbH.',
    url: 'https://frankeiselt.de/pages/impressum',
  },
  {
    title: 'Widerrufsrecht',
    description: 'Widerrufsbelehrung, Fristen und Hinweise zur Rückgabe.',
    url: 'https://frankeiselt.de/pages/widerrufsrecht',
  },
];

export function LegalScreen({ language }: LegalScreenProps) {
  const t = copy[language];

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>{t.title}</Text>
      <Text style={styles.intro}>{t.intro}</Text>

      <View style={styles.list}>
        {PAGES.map((page) => (
          <View key={page.url} style={styles.card}>
            <Text style={styles.cardTitle}>{page.title}</Text>
            <Text style={styles.cardDescription}>{page.description}</Text>
            <Pressable onPress={() => Linking.openURL(page.url)} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
              <Text style={styles.buttonText}>{t.open}</Text>
            </Pressable>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 20, paddingBottom: 40, backgroundColor: '#12262F' },
  title: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  intro: { color: '#A9B6CF', fontSize: 16, lineHeight: 24, marginTop: 10 },
  list: { gap: 14, marginTop: 24 },
  card: { backgroundColor: '#152038', borderRadius: 18, padding: 18 },
  cardTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800' },
  cardDescription: { color: '#A9B6CF', fontSize: 15, lineHeight: 22, marginTop: 8 },
  button: { alignSelf: 'flex-start', marginTop: 16, paddingHorizontal: 15, paddingVertical: 11, borderRadius: 12, backgroundColor: '#007ABB' },
  buttonText: { color: '#FFFFFF', fontWeight: '800' },
  pressed: { opacity: 0.78 },
});
