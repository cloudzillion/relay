#!/usr/bin/env bash
set -e

APP_VERSION=$(node -p "require('./package.json').version")
OUTPUT_DIR="./dist/bin"

echo "==> Building cz-relay (v${APP_VERSION})..."

mkdir -p dist
mkdir -p "${OUTPUT_DIR}"

# 1. Bundle TypeScript to a single standalone CommonJS file
npx esbuild src/index.ts --bundle --platform=node --target=node20 --outfile=dist/bundle.cjs --format=cjs

# 2. Prepare Node SEA blob
cat <<EOF > dist/sea-config.json
{
  "main": "dist/bundle.cjs",
  "output": "dist/sea-prep.blob"
}
EOF

node --experimental-sea-config dist/sea-config.json

# 3. Detect current platform and arch tuple for binary naming
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"

case "$OS_NAME" in
  Linux*) PLATFORM="linux" ;;
  Darwin*) PLATFORM="darwin" ;;
  *) echo "Unsupported OS: $OS_NAME"; exit 1 ;;
esac

case "$ARCH_NAME" in
  x86_64|amd64) ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *) echo "Unsupported Architecture: $ARCH_NAME"; exit 1 ;;
esac

TARGET_NAME="cz-relay-${PLATFORM}-${ARCH}"
BINARY_OUT="${OUTPUT_DIR}/${TARGET_NAME}"

# 4. Inject blob into Node runtime binary
cp $(command -v node) "${BINARY_OUT}"
npx --yes postject "${BINARY_OUT}" NODE_SEA_BLOB dist/sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

chmod +x "${BINARY_OUT}"

# Also generate a clean local alias
cp -f "${BINARY_OUT}" "${OUTPUT_DIR}/cz-relay"

# 5. Generate SHA256 checksums
(cd "${OUTPUT_DIR}" && sha256sum "${TARGET_NAME}" > "${TARGET_NAME}.sha256")

echo "✓ Successfully compiled ${TARGET_NAME} (v${APP_VERSION}) to ${BINARY_OUT}"