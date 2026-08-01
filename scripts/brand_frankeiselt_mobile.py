from __future__ import annotations

from pathlib import Path
import json
import re
import shutil

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"

if not MOBILE.exists():
    raise SystemExit("mobile klasoru bulunamadi. Once HausONE mobile klasorunu kopyalayin.")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def write(path: Path, value: str) -> None:
    path.write_text(value, encoding="utf-8")


def replace_required(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Beklenen hedef bulunamadi: {label}")
    return text.replace(old, new)


# Generated web bundle must never be copied between brands.
shutil.rmtree(MOBILE / "dist", ignore_errors=True)

# ---------------------------------------------------------------------------
# package.json
# ---------------------------------------------------------------------------
package_path = MOBILE / "package.json"
package = json.loads(read(package_path))
package["name"] = "frankeiselt-ai-shop-mobile"
write(package_path, json.dumps(package, ensure_ascii=False, indent=2) + "\n")

lock_path = MOBILE / "package-lock.json"
if lock_path.exists():
    lock = json.loads(read(lock_path))
    lock["name"] = "frankeiselt-ai-shop-mobile"
    if isinstance(lock.get("packages"), dict) and "" in lock["packages"]:
        lock["packages"][""]["name"] = "frankeiselt-ai-shop-mobile"
    write(lock_path, json.dumps(lock, ensure_ascii=False, indent=2) + "\n")

# ---------------------------------------------------------------------------
# Expo app configuration. A new EAS project id will be inserted by eas init.
# ---------------------------------------------------------------------------
app_path = MOBILE / "app.json"
app_data = json.loads(read(app_path))
expo = app_data["expo"]
expo["name"] = "Frank Eiselt"
expo["slug"] = "frankeiselt-ai-shop"
expo["scheme"] = "de.frankeiselt.aishop"
expo["backgroundColor"] = "#FFFFFF"

expo.setdefault("ios", {})["bundleIdentifier"] = "de.frankeiselt.aishop"
expo["ios"]["supportsTablet"] = False
expo["ios"]["infoPlist"] = {
    "NSSpeechRecognitionUsageDescription": "Frank Eiselt benötigt die Spracherkennung, um gesprochene Produktnamen zu suchen.",
    "NSMicrophoneUsageDescription": "Frank Eiselt benötigt das Mikrofon für die sprachgesteuerte Produktsuche.",
    "NSPhotoLibraryUsageDescription": "Frank Eiselt benötigt Zugriff auf Ihre Fotomediathek, wenn Sie in einem Kontakt- oder Supportformular ein Bild auswählen und hochladen.",
    "ITSAppUsesNonExemptEncryption": False,
}
expo["ios"]["config"] = {"usesNonExemptEncryption": False}

android = expo.setdefault("android", {})
android["package"] = "de.frankeiselt.aishop"
android["adaptiveIcon"] = {
    "foregroundImage": "./assets/adaptive-icon.png",
    "backgroundColor": "#FFFFFF",
}
android["intentFilters"] = [
    {
        "action": "VIEW",
        "autoVerify": False,
        "data": [{"scheme": "de.frankeiselt.aishop", "host": "callback"}],
        "category": ["BROWSABLE", "DEFAULT"],
    }
]
android["permissions"] = ["android.permission.RECORD_AUDIO"]
android["softwareKeyboardLayoutMode"] = "resize"

extra = expo.setdefault("extra", {})
extra["apiUrl"] = "https://frankeiselt-api-663036738401.europe-west3.run.app"
extra.pop("eas", None)

# Replace plugin permission text while keeping existing plugin structure.
plugins = expo.get("plugins", [])
for plugin in plugins:
    if isinstance(plugin, list) and plugin and plugin[0] == "expo-speech-recognition":
        options = plugin[1] if len(plugin) > 1 and isinstance(plugin[1], dict) else {}
        options["microphonePermission"] = "Frank Eiselt benötigt das Mikrofon für die sprachgesteuerte Produktsuche."
        options["speechRecognitionPermission"] = "Frank Eiselt benötigt die Spracherkennung, um gesprochene Produktnamen zu suchen."
        if len(plugin) > 1:
            plugin[1] = options
        else:
            plugin.append(options)

write(app_path, json.dumps(app_data, ensure_ascii=False, indent=2) + "\n")

# ---------------------------------------------------------------------------
# Source branding and main colors.
# ---------------------------------------------------------------------------
text_files = [
    MOBILE / "App.tsx",
    MOBILE / "src/api/client.ts",
    MOBILE / "src/components/CustomerOrderDetails.tsx",
    MOBILE / "src/screens/ChatScreen.tsx",
    MOBILE / "src/screens/HomeScreen.tsx",
    MOBILE / "src/screens/HomeScreenV2.tsx",
    MOBILE / "src/screens/LegalScreen.tsx",
    MOBILE / "src/services/customerAccount.ts",
    MOBILE / "store/RELEASE_CHECKLIST.md",
    MOBILE / "store/PRIVACY_POLICY_ADDENDUM_DE.md",
    MOBILE / "store/STORE_METADATA_DE.md",
]

brand_replacements = [
    ("HAUSONE", "FRANK EISELT"),
    ("HausONE", "Frank Eiselt"),
    ("HausOne", "Frank Eiselt"),
    ("Hausone", "Frank Eiselt"),
    ("https://hausone.de", "https://frankeiselt.de"),
    ("https://aishop-api-663036738401.europe-west3.run.app", "https://frankeiselt-api-663036738401.europe-west3.run.app"),
    ("de.hausone.aishop", "de.frankeiselt.aishop"),
    ("shop.70487802124.hausoneaishop", "de.frankeiselt.aishop"),
    ("hausone-ai-shop-cart-id", "frankeiselt-ai-shop-cart-id"),
    ("hausone-ai-shop-app-mode", "frankeiselt-ai-shop-app-mode"),
    ("hausone-customer-account-session", "frankeiselt-customer-account-session"),
]

color_replacements = {
    "#106181": "#007ABB",
    "#136382": "#007ABB",
    "#0E7890": "#007ABB",
    "#2457D6": "#007ABB",
    "#19D7F2": "#007ABB",
    "#FF9315": "#007ABB",
    "#F47C20": "#007ABB",
    "#D9630C": "#007ABB",
    "#F6A13A": "#007ABB",
    "#15313F": "#12262F",
    "#17313F": "#12262F",
    "#172D38": "#12262F",
    "#132F3D": "#12262F",
    "#050B12": "#12262F",
    "#0B1220": "#12262F",
}

for path in text_files:
    if not path.exists():
        continue
    text = read(path)
    for old, new in brand_replacements:
        text = text.replace(old, new)
    for old, new in color_replacements.items():
        text = text.replace(old, new).replace(old.lower(), new.lower())
    write(path, text)

# ---------------------------------------------------------------------------
# API and public storefront image fallback addresses.
# ---------------------------------------------------------------------------
client_path = MOBILE / "src/api/client.ts"
client_text = read(client_path)
client_text = client_text.replace(
    "lower.includes('hausone-logo') ||",
    "lower.includes('hausone-logo') ||\n      lower.includes('frankeiselt-logo') ||",
)
write(client_path, client_text)

# ---------------------------------------------------------------------------
# Home screen: remove HausONE collection ids and load the first six live
# Frank Eiselt collections from the backend. The copied HausONE banner slider
# is disabled until Frank Eiselt-specific banners are added.
# ---------------------------------------------------------------------------
home_path = MOBILE / "src/screens/HomeScreenV2.tsx"
home = read(home_path)

home = re.sub(
    r"const HOME_CATEGORY_CONFIGS: HomeCategoryConfig\[\] = \[[\s\S]*?\nfunction shuffleProducts",
    "const HOME_CATEGORY_LIMIT = 6;\nconst CATEGORY_SLIDES: CategorySlide[] = [];\n\nfunction shuffleProducts",
    home,
    count=1,
)

home = replace_required(
    home,
    "  const [homeCategoryProducts, setHomeCategoryProducts] = useState<Record<string, Product[]>>({});",
    "  const [homeCategories, setHomeCategories] = useState<HomeCategoryConfig[]>([]);\n  const [homeCategoryProducts, setHomeCategoryProducts] = useState<Record<string, Product[]>>({});",
    "home category state",
)

home = replace_required(
    home,
    "  useEffect(() => {\n    const sliderWidth = Math.max(1, width - pagePadding * 2);",
    "  useEffect(() => {\n    if (CATEGORY_SLIDES.length === 0) return;\n\n    const sliderWidth = Math.max(1, width - pagePadding * 2);",
    "empty slider guard",
)

home = replace_required(
    home,
    "  function renderCategorySlider() {\n    const sliderWidth = Math.max(1, width - pagePadding * 2);",
    "  function renderCategorySlider() {\n    if (CATEGORY_SLIDES.length === 0) return null;\n\n    const sliderWidth = Math.max(1, width - pagePadding * 2);",
    "slider render guard",
)

home = home.replace("{HOME_CATEGORY_CONFIGS.map((category) => {", "{homeCategories.map((category) => {")

load_home_pattern = re.compile(
    r"  async function loadHomeSections\(\) \{[\s\S]*?\n\n  async function loadMenu\(\)",
)
load_home_replacement = '''  async function loadHomeSections() {
    setLoadingHomeSections(true);
    setHydratingHomeCategories(true);
    setHomeCategoryProducts({});

    try {
      const collections = await getCollections(50).catch(() => []);
      const availableHomeCategories = collections
        .slice(0, HOME_CATEGORY_LIMIT)
        .map((collection) => ({
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
        }));

      setHomeCategories(availableHomeCategories);

      const [entries, saleProducts] = await Promise.all([
        Promise.all(
          availableHomeCategories.map(async (category): Promise<[string, Product[]]> => {
            try {
              const result = await getCollectionProducts(category.id, category.handle, 10);
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

  async function loadMenu()'''

home, count = load_home_pattern.subn(load_home_replacement, home, count=1)
if count != 1:
    raise RuntimeError("loadHomeSections blogu guncellenemedi")

home = re.sub(
    r"const PRODUCT_IMAGE_FALLBACKS_BY_SKU: Record<string, string\[\]> = \{[\s\S]*?\n\};",
    "const PRODUCT_IMAGE_FALLBACKS_BY_SKU: Record<string, string[]> = {};",
    home,
    count=1,
)

write(home_path, home)

# ---------------------------------------------------------------------------
# Customer Account API values are store-specific. Keep a visible placeholder
# until the Frank Eiselt Headless channel client id is supplied.
# ---------------------------------------------------------------------------
account_path = MOBILE / "src/services/customerAccount.ts"
account = read(account_path)
account = re.sub(
    r"const CLIENT_ID = '[^']+';",
    "const CLIENT_ID = 'REPLACE_WITH_FRANKEISELT_CUSTOMER_ACCOUNT_CLIENT_ID';",
    account,
    count=1,
)
account = account.replace("invoiceHausone", "invoiceFrankEiselt")
account = account.replace('namespace: "hausone"', 'namespace: "frankeiselt"')
write(account_path, account)

# ---------------------------------------------------------------------------
# Release checker and store documentation.
# ---------------------------------------------------------------------------
check_path = ROOT / "scripts/check_mobile_release.py"
if check_path.exists():
    check = read(check_path)
    check = check.replace("app.get('name') == 'HausONE'", "app.get('name') == 'Frank Eiselt'")
    check = check.replace("App name must be HausONE", "App name must be Frank Eiselt")
    check = check.replace("de.hausone.aishop", "de.frankeiselt.aishop")
    write(check_path, check)

metadata_path = MOBILE / "store/STORE_METADATA_DE.md"
if metadata_path.exists():
    metadata = read(metadata_path)
    metadata = metadata.replace("https://frankeiselt.de/pages/kontakt", "https://frankeiselt.de/pages/kontakt")
    metadata = metadata.replace("https://frankeiselt.de/policies/privacy-policy", "https://frankeiselt.de/policies/privacy-policy")
    metadata = re.sub(
        r"- Konto-löschen-URL[^\n]*",
        "- Konto-löschen-URL: vor der Store-Freigabe nach Einrichtung des Frank-Eiselt-Kundenkontos ergänzen",
        metadata,
    )
    write(metadata_path, metadata)

print("Frank Eiselt mobile branding migration completed.")
print("Next required item: configure the Frank Eiselt Customer Account API client id.")
print("The copied HausONE category slider is intentionally disabled.")
