import fs from "node:fs";
import path from "node:path";
import { adapterSource, chorusRoot, packageVersion, resolveHome } from "./paths.mjs";
import { atomicWriteFile, installToDest, removeDest } from "./fs-util.mjs";

export function chorusStateDir(home) {
  return path.join(home, ".chorus");
}

export function marketplaceDir(home, host) {
  return path.join(chorusStateDir(home), "marketplaces", host);
}

export function pluginDir(home, host) {
  return path.join(marketplaceDir(home, host), "plugins", "chorus");
}

function manifestPath(host) {
  if (host === "codex") return [".agents", "plugins", "marketplace.json"];
  return [".claude-plugin", "marketplace.json"];
}

function pluginManifest() {
  return {
    name: "chorus",
    description: "Delegate review, research, architecture, and devil's-advocate critique to a buddy CLI without poisoning your context.",
    author: { name: "Ghaaf" },
    source: "./plugins/chorus",
    version: packageVersion(),
    category: "development",
    homepage: "https://github.com/ghaaf-labs/chorus",
    repository: "https://github.com/ghaaf-labs/chorus",
    license: "MIT"
  };
}

export function claudeMarketplaceManifest() {
  return {
    name: "chorus",
    description: "Chorus — multi-CLI agent collaboration toolkit",
    owner: { name: "Ghaaf", email: "dev@ghaaf.org" },
    plugins: [pluginManifest()]
  };
}

export function codexMarketplaceManifest() {
  const m = claudeMarketplaceManifest();
  m.interface = { displayName: "Chorus" };
  m.plugins = [{
    ...pluginManifest(),
    source: { source: "local", path: "./plugins/chorus" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }
  }];
  return m;
}

export function buildMarketplace({ home: homeOverride, host, mode = "copy" }) {
  const home = resolveHome(homeOverride);
  if (!home) throw new Error("no $HOME");
  const root = marketplaceDir(home, host);
  const pluginDest = pluginDir(home, host);
  const manifest = host === "codex" ? codexMarketplaceManifest() : claudeMarketplaceManifest();
  installToDest({ src: adapterSource(host), dest: pluginDest, mode });
  const segs = manifestPath(host);
  atomicWriteFile(path.join(root, ...segs), JSON.stringify(manifest, null, 2) + "\n");
  return { marketplace: root, plugin: pluginDest };
}

export function removeMarketplace({ home: homeOverride, host }) {
  const home = resolveHome(homeOverride);
  if (!home) return;
  removeDest(marketplaceDir(home, host));
}

export function marketplaceExists({ home: homeOverride, host }) {
  const home = resolveHome(homeOverride);
  if (!home) return false;
  const segs = manifestPath(host);
  return fs.existsSync(path.join(marketplaceDir(home, host), ...segs));
}

export { chorusRoot };
