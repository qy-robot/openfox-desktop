# RoboCoding application icon

The approved dark robot artwork is the application icon for both desktop editions. Icon artwork contains no lettering or company subtitle. Product wording and application identities remain separately configured.

The canonical asset in each edition is `build/app-icon.png`: a 1024×1024 RGBA16 PNG with an sRGB ICC profile and a rounded tile. Both editions intentionally use the same artwork.

Each package build derives its assets in this order:

1. `generate-robo-brand-assets.mjs` creates the embedded 128px client icon and the monochrome robot mask in `build/tray-icon.svg` from the canonical PNG. The threshold extracts the bright robot from its dark tile.
2. `generate-mac-app-icon.mjs` keeps the existing 824px artwork / 100px transparent inset convention for macOS Dock and packaging.
3. `generate-tray-icons.mjs` produces native black template and blue tray sizes. Existing filenames remain stable for the runtime.
4. The stable edition's Windows generator creates its existing 16–256px ICO frame set. Small frames use the same robot mask in white on a dark tile. The beta edition retains its PNG packaging configuration.

The client embeds a small PNG data URL so it needs no new asset server or URL routing. Do not edit `src/client/robo-app-icon.ts` directly. After changing the canonical PNG, rebuild both editions and update the approved source digest in each package test.

The source was generated with image_gen and approved for use on 2026-09-15. Generated macOS, tray and ICO files are committed build inputs. Native installation and operating-system icon caches require separate platform validation; headless builds do not prove installation.
