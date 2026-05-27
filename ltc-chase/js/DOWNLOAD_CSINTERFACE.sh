#!/bin/bash
# Downloads Adobe's CSInterface.js (required by the panel).
# Run once from this folder:   bash DOWNLOAD_CSINTERFACE.sh

set -e
DEST="$(dirname "$0")/CSInterface.js"
URL="https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/CEP_11.x/CSInterface.js"

echo "Downloading CSInterface.js from Adobe CEP-Resources..."
curl -L -o "$DEST" "$URL"
echo "Done — saved to $DEST"
