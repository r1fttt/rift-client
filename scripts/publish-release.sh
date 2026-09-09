#!/usr/bin/env bash
set -euo pipefail
version=$(node -p "require('./package.json').version")
if [[ "$BUILD_REF_TYPE" == tag ]]; then
  tag="$BUILD_REF_NAME"
else
  tag="v${version}-build.${BUILD_NUMBER}"
fi
cd release-assets
shopt -s nullglob
# Never publish a partial release if an artifact was missing.
for extension in exe msi dmg pkg deb rpm snap flatpak AppImage; do
  matches=( *."$extension" )
  if (( ${#matches[@]} == 0 )); then
    echo "Missing required installer: $extension" >&2
    exit 1
  fi
done
sha256sum -- *.exe *.msi *.dmg *.pkg *.deb *.rpm *.snap *.flatpak *.AppImage > SHA256SUMS
notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
cat > "$notes" <<NOTES
R1FT Client ${version}, built from commit ${BUILD_SHA} by [GitHub Actions](${BUILD_URL}).

Downloads include Windows EXE/MSI, macOS Intel and Apple Silicon DMG/PKG, and Linux AppImage/DEB/RPM/Snap/Flatpak. SHA256SUMS contains checksums for every installer.

Windows and macOS installers are unsigned. macOS installers are not notarized. The Flatpak download is a standalone bundle; no hosted Flatpak repository is provided by this release.
NOTES
if ! gh release view "$tag" > /dev/null 2>&1; then
  gh release create "$tag" --target "$BUILD_SHA" --title "R1FT Client ${version} (build ${BUILD_NUMBER})" --notes-file "$notes" --draft
fi
gh release upload "$tag" --clobber -- *.exe *.msi *.dmg *.pkg *.deb *.rpm *.snap *.flatpak *.AppImage SHA256SUMS
gh release edit "$tag" --draft=false --latest --notes-file "$notes"
echo "Published release: $tag"
