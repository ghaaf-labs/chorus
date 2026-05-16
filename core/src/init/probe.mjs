import { detectAll } from "../capability.mjs";

export function probeInstall() {
  const hosts = detectAll();
  return {
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    hosts,
    available: Object.entries(hosts)
      .filter(([, info]) => info.available)
      .map(([name]) => name)
  };
}
