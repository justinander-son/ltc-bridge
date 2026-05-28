#!/bin/bash
# LTC Chase — one-time setup script.
# Run this once after copying the project folder to your Mac:
#   bash ~/ltc-bridge/install.sh

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="$SCRIPT_DIR/ltc-bridge"
PANEL_SRC="$SCRIPT_DIR/ltc-chase"
PANEL_ID="com.studio59.ltcchase"

USER_CEP=~/Library/Application\ Support/Adobe/CEP/extensions
APP_BUNDLE_26="/Applications/Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app/Contents/CEP/extensions"

# ── 0. Pre-flight checks ──────────────────────────────────────────────────────

if ! command -v npm &>/dev/null; then
  echo ""
  echo "ERROR: npm (Node.js) is not installed."
  echo "  Run: brew install node"
  echo "  Then re-run this script."
  exit 1
fi

# ── 1. Bridge dependencies ────────────────────────────────────────────────────

echo ""
echo "Installing bridge dependencies..."
cd "$BRIDGE_DIR"
npm install --silent
echo "  Done."

# ── 2. Premiere debug mode (allows unsigned extensions) ───────────────────────

echo ""
echo "Enabling Premiere extension debug mode..."
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
echo "  Done."

# ── 3. Install panel — user level (Premiere 25 and earlier) ──────────────────

echo ""
echo "Installing panel (user level)..."
mkdir -p "$USER_CEP"
cp -rX "$PANEL_SRC" "$USER_CEP/$PANEL_ID"
echo "  Done -> $USER_CEP/$PANEL_ID"

# ── 4. Install panel — app bundle (Premiere 2026) ────────────────────────────

if [ -d "$APP_BUNDLE_26" ]; then
  echo ""
  echo "Premiere 2026 detected — installing into app bundle (requires password)..."
  if sudo cp -rX "$PANEL_SRC" "$APP_BUNDLE_26/$PANEL_ID" 2>/dev/null; then
    echo "  Done -> $APP_BUNDLE_26/$PANEL_ID"
  else
    echo "  Skipped (run manually if needed):"
    echo "  sudo cp -rX \"$PANEL_SRC\" \"$APP_BUNDLE_26/$PANEL_ID\""
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo "------------------------------------------------------------"
echo "  Setup complete."
echo ""
echo "  Next steps:"
echo "  1. Restart Premiere Pro (full quit, Cmd+Q)"
echo "  2. Open Window -> Extensions -> LTC Chase"
echo "  3. Start the bridge: cd $BRIDGE_DIR && npm start"
echo "------------------------------------------------------------"
echo ""
