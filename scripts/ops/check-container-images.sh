#!/usr/bin/env bash
# Builds the API and web images from the Dockerfile and proves that each one starts
# safely. The containers get no configuration and no secrets. The API image runs with
# no network access; the web container is reachable only on the loopback port this
# check publishes.
#
#   scripts/ops/check-container-images.sh
#
# VALO_IMAGE_TAG picks the image tag (default: check). VALO_SKIP_IMAGE_BUILD=1 checks
# images that were already built with that tag.
set -euo pipefail
cd "$(dirname "$0")/../.."

tag="${VALO_IMAGE_TAG:-check}"
api="valo-api:$tag"
web="valo-web:$tag"
web_port="${VALO_IMAGE_CHECK_PORT:-3000}"

if [ "${VALO_SKIP_IMAGE_BUILD:-}" != "1" ]; then
  docker build --target api -t "$api" .
  docker build --target web -t "$web" .
fi

echo "Both images run as a non-root user."
for image in "$api" "$web"; do
  if [ "$(docker run --rm --network none "$image" id -u)" = "0" ]; then
    echo "$image runs as root" >&2
    exit 1
  fi
done

echo "The API image renders a PDF with its own Chromium, libraries and fonts."
docker run --rm --network none "$api" node --input-type=module -e '
  import { chromium } from "playwright";
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH });
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.setContent("<h1>Synthetic container check</h1><p>Naira ₦ and accents é.</p>");
  const pdf = await page.pdf({ format: "A4" });
  await browser.close();
  if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("Chromium did not produce a PDF");
  console.log(`Rendered a ${pdf.length}-byte PDF.`);
'

echo "Without configuration the API and the worker refuse to start."
for entry in dist/index.mjs dist/export-worker.mjs; do
  if output=$(docker run --rm --network none "$api" node "$entry" 2>&1); then
    echo "$entry started without configuration" >&2
    exit 1
  fi
  if ! grep -q "DATABASE_URL must be set" <<<"$output"; then
    echo "$entry failed for an unexpected reason:" >&2
    echo "$output" | tail -20 >&2
    exit 1
  fi
done

echo "The web image serves the home page with its security headers."
container=$(docker run -d -p "127.0.0.1:$web_port:3000" "$web")
trap 'docker rm -f "$container" >/dev/null' EXIT
for _ in $(seq 1 60); do
  if curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$web_port/" 2>/dev/null; then break; fi
  sleep 1
done
headers=$(curl -fsS --noproxy '*' -D - -o /dev/null "http://127.0.0.1:$web_port/")
for header in "content-security-policy:" "strict-transport-security: max-age=" "x-robots-tag: noindex"; do
  if ! grep -qi "^$header" <<<"$headers"; then
    echo "Missing response header: $header" >&2
    exit 1
  fi
done

echo "Container images checked."
