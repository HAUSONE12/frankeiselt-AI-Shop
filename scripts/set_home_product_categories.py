from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HOME_SCREEN = ROOT / "mobile/src/screens/HomeScreenV2.tsx"

CATEGORY_BLOCK = """const HOME_PRODUCT_CATEGORIES: HomeCategoryConfig[] = [
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
];"""

DYNAMIC_CATEGORY_BLOCK = """      const availableHomeCategories = collections
        .slice(0, HOME_CATEGORY_LIMIT)
        .map((collection) => ({
          id: collection.id,
          title: collection.title,
          handle: collection.handle,
        }));

      setHomeCategories(availableHomeCategories);"""

FIXED_CATEGORY_BLOCK = """      const availableHomeCategories = HOME_PRODUCT_CATEGORIES;

      setHomeCategories(availableHomeCategories);"""


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Beklenen kod blogu bulunamadi: {label}")
    return text.replace(old, new, 1)


def main() -> None:
    if not HOME_SCREEN.exists():
        raise SystemExit(f"Dosya bulunamadi: {HOME_SCREEN}")

    text = HOME_SCREEN.read_text(encoding="utf-8")

    if "const HOME_PRODUCT_CATEGORIES" not in text:
        text = replace_once(
            text,
            "const HOME_CATEGORY_LIMIT = 6;",
            CATEGORY_BLOCK,
            "HOME_CATEGORY_LIMIT",
        )

    if DYNAMIC_CATEGORY_BLOCK in text:
        text = text.replace(
            DYNAMIC_CATEGORY_BLOCK,
            FIXED_CATEGORY_BLOCK,
            1,
        )
    elif FIXED_CATEGORY_BLOCK not in text:
        raise RuntimeError("Ana sayfa kategori secim blogu bulunamadi")

    text = text.replace(
        "getCollectionProducts(category.id, category.handle, 10)",
        "getCollectionProducts(category.id, undefined, 10)",
    )
    text = text.replace(
        "getCollectionProducts(category.id, category.handle, 50)",
        "getCollectionProducts(category.id, undefined, 50)",
    )

    if "HOME_CATEGORY_LIMIT" in text:
        raise RuntimeError("Eski HOME_CATEGORY_LIMIT referansi kaldi")

    HOME_SCREEN.write_text(text, encoding="utf-8")

    print("Ana sayfa urun bloklari sabitlendi:")
    print("1. Putzerbedarf - 401311072515")
    print("2. Inneneausbau - 651240866126")
    print("3. Baubedarf - 401312350467")
    print("4. Verputzen Werkzeug - 401311236355")


if __name__ == "__main__":
    main()
