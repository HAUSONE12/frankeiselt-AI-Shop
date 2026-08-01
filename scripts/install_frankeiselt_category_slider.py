from __future__ import annotations

import argparse
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MOBILE = ROOT / "mobile"
HOME_SCREEN = MOBILE / "src/screens/HomeScreenV2.tsx"
SLIDER_DIR = MOBILE / "assets/category-slider"

IMAGE_MAP = {
    "baubedarf.png": "baubedarf.png",
    "inneneausbau.png": "innenausbau.png",
    "innenausbau.png": "innenausbau.png",
    "putzerbedarf.png": "putzerbedarf.png",
    "verputzenwerkzeug.png": "verputzenwerkzeug.png",
}

SLIDER_BLOCK = r'''const HOME_CATEGORY_LIMIT = 6;

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
}'''


def extract_images(zip_path: Path) -> None:
    if not zip_path.exists():
        raise SystemExit(f"ZIP bulunamadi: {zip_path}")

    SLIDER_DIR.mkdir(parents=True, exist_ok=True)
    extracted: set[str] = set()

    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            if member.is_dir():
                continue

            source_name = Path(member.filename).name.lower()
            target_name = IMAGE_MAP.get(source_name)
            if not target_name:
                continue

            target = SLIDER_DIR / target_name
            target.write_bytes(archive.read(member))
            extracted.add(target_name)
            print(f"Gorsel yerlestirildi: {target.relative_to(ROOT)}")

    required = {
        "baubedarf.png",
        "innenausbau.png",
        "putzerbedarf.png",
        "verputzenwerkzeug.png",
    }
    missing = sorted(required - extracted)
    if missing:
        raise SystemExit("ZIP icinde eksik gorseller var: " + ", ".join(missing))


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Beklenen kod blogu bulunamadi: {label}")
    return text.replace(old, new, 1)


def patch_home_screen() -> None:
    if not HOME_SCREEN.exists():
        raise SystemExit(f"Dosya bulunamadi: {HOME_SCREEN}")

    text = HOME_SCREEN.read_text(encoding="utf-8")

    if "CATEGORY_SLIDE_TEMPLATES" not in text:
        text = replace_once(
            text,
            "const HOME_CATEGORY_LIMIT = 6;\nconst CATEGORY_SLIDES: CategorySlide[] = [];",
            SLIDER_BLOCK,
            "slider sabitleri",
        )

    if "const [categorySlides, setCategorySlides]" not in text:
        text = replace_once(
            text,
            "  const [homeCategories, setHomeCategories] = useState<HomeCategoryConfig[]>([]);",
            "  const [homeCategories, setHomeCategories] = useState<HomeCategoryConfig[]>([]);\n"
            "  const [categorySlides, setCategorySlides] = useState<CategorySlide[]>([]);",
            "slider state",
        )

    text = text.replace(
        "    if (CATEGORY_SLIDES.length === 0) return;",
        "    if (categorySlides.length === 0) return;",
    )
    text = text.replace(
        "        const next = (current + 1) % CATEGORY_SLIDES.length;",
        "        const next = (current + 1) % categorySlides.length;",
    )
    text = text.replace(
        "  }, [width]);",
        "  }, [categorySlides.length, width]);",
        1,
    )

    if "setCategorySlides(buildCategorySlides" not in text:
        text = replace_once(
            text,
            "      setHomeCategories(availableHomeCategories);",
            "      setHomeCategories(availableHomeCategories);\n"
            "      setCategorySlides(buildCategorySlides(\n"
            "        collections.map((collection) => ({\n"
            "          id: collection.id,\n"
            "          title: collection.title,\n"
            "          handle: collection.handle,\n"
            "        })),\n"
            "      ));",
            "slider collection mapping",
        )

    text = text.replace(
        "    if (CATEGORY_SLIDES.length === 0) return null;",
        "    if (categorySlides.length === 0) return null;",
    )
    text = text.replace(
        "Math.min(nextIndex, CATEGORY_SLIDES.length - 1)",
        "Math.min(nextIndex, categorySlides.length - 1)",
    )
    text = text.replace(
        "          {CATEGORY_SLIDES.map((slide) => (",
        "          {categorySlides.map((slide) => (",
    )
    text = text.replace(
        "          {CATEGORY_SLIDES.map((slide, index) => (",
        "          {categorySlides.map((slide, index) => (",
    )

    if "CATEGORY_SLIDES" in text:
        remaining = [
            f"{index}: {line}"
            for index, line in enumerate(text.splitlines(), start=1)
            if "CATEGORY_SLIDES" in line
        ]
        raise RuntimeError(
            "Eski CATEGORY_SLIDES referanslari kaldi:\n" + "\n".join(remaining)
        )

    HOME_SCREEN.write_text(text, encoding="utf-8")
    print(f"Slider kodu guncellendi: {HOME_SCREEN.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Frank Eiselt mobil kategori slider gorsellerini kurar ve kodu etkinlestirir.",
    )
    parser.add_argument(
        "--zip",
        required=True,
        type=Path,
        help="Mobil Kategorileri.zip dosyasinin yolu",
    )
    args = parser.parse_args()

    extract_images(args.zip.expanduser().resolve())
    patch_home_screen()
    print("Frank Eiselt kategori slider kurulumu tamamlandi.")


if __name__ == "__main__":
    main()
