import { StatusBar } from 'expo-status-bar';
import {
  ColorScheme,
  LogLevel,
  ShopifyCheckoutSheetProvider,
  type Configuration,
} from '@shopify/checkout-sheet-kit';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { HomeScreenV2 } from './src/screens/HomeScreenV2';

const checkoutConfiguration: Configuration = {
  title: 'Frank Eiselt AI Shop',
  colorScheme: ColorScheme.dark,
  preloading: true,
  logLevel: LogLevel.error,
  colors: {
    ios: {
      backgroundColor: '#12262F',
      tintColor: '#007ABB',
      closeButtonColor: '#FFFFFF',
    },
    android: {
      backgroundColor: '#12262F',
      progressIndicator: '#007ABB',
      headerBackgroundColor: '#007ABB',
      headerTextColor: '#FFFFFF',
      closeButtonColor: '#FFFFFF',
    },
  },
};

export default function App() {
  return (
    <ShopifyCheckoutSheetProvider configuration={checkoutConfiguration}>
      <SafeAreaProvider>
        <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
          <StatusBar style="light" />
          <HomeScreenV2 />
        </SafeAreaView>
      </SafeAreaProvider>
    </ShopifyCheckoutSheetProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#12262F',
  },
});
