#!/usr/bin/env sh
set -eu

VERSION="${CHORUS_VERSION:-latest}"
PACKAGE="@chorus/cli"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "chorus installer: missing required command '$1'" >&2
    exit 1
  }
}

need node
need npm

node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  console.error("Chorus requires Node.js >=22.14; found " + process.versions.node);
  process.exit(1);
}
'

if [ "$VERSION" = "latest" ]; then
  npm install -g "$PACKAGE"
else
  npm install -g "$PACKAGE@$VERSION"
fi

chorus version
chorus doctor
