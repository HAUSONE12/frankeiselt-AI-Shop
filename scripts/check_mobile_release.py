from pathlib import Path
import json
import sys

root = Path(__file__).resolve().parents[1]
mobile = root / 'mobile'
errors = []

app = json.loads((mobile / 'app.json').read_text(encoding='utf-8'))['expo']
package = json.loads((mobile / 'package.json').read_text(encoding='utf-8'))

checks = [
    (app.get('name') == 'Frank Eiselt', 'App name must be Frank Eiselt'),
    (app.get('ios', {}).get('bundleIdentifier') == 'de.frankeiselt.aishop', 'iOS bundle identifier is incorrect'),
    (app.get('android', {}).get('package') == 'de.frankeiselt.aishop', 'Android package is incorrect'),
    (app.get('ios', {}).get('supportsTablet') is False, 'iPad support must be disabled for the first release'),
    (app.get('ios', {}).get('config', {}).get('usesNonExemptEncryption') is False, 'iOS encryption declaration is missing'),
    ('android.permission.RECORD_AUDIO' in app.get('android', {}).get('permissions', []), 'Android microphone permission is missing'),
    ('@shopify/checkout-sheet-kit' in package.get('dependencies', {}), 'Shopify Checkout Kit is missing'),
    ((mobile / 'src/types/error-constructor.d.ts').exists(), 'Checkout Kit TypeScript compatibility declaration is missing'),
    ((mobile / 'store/STORE_METADATA_DE.md').exists(), 'Store metadata draft is missing'),
    ((mobile / 'store/PRIVACY_POLICY_ADDENDUM_DE.md').exists(), 'Privacy policy addendum is missing'),
]

for ok, message in checks:
    if not ok:
        errors.append(message)

for relative in [
    'assets/icon.png',
    'assets/adaptive-icon.png',
    'assets/splash-icon.png',
    'assets/logo.png',
]:
    if not (mobile / relative).exists():
        errors.append(f'Missing asset: {relative}')

if errors:
    print('Release check failed:')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('Android and iOS release configuration checks passed.')
