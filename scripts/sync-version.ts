/**
 * Sync a version string into all version files.
 * Used by the release workflow to set the version from the git tag.
 *
 * Usage: npx tsx scripts/sync-version.ts 0.11.0
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const ROOT = resolve(import.meta.dirname, "..");

interface VersionFile {
  path: string;
  update: (content: string, version: string) => string;
}

const VERSION_FILES: VersionFile[] = [
  {
    path: "apps/desktop/src-tauri/tauri.conf.json",
    update: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: "apps/desktop/package.json",
    update: (content, version) => {
      const json = JSON.parse(content);
      json.version = version;
      return JSON.stringify(json, null, 2) + "\n";
    },
  },
  {
    path: "apps/desktop/src/main.tsx",
    update: (content, version) =>
      content.replace(/sts2-replay@[\d.]+/, `sts2-replay@${version}`),
  },
  {
    path: "packages/shared/lib/error-reporter.ts",
    update: (content, version) =>
      content.replace(
        /const APP_VERSION = "[\d.]+"/,
        `const APP_VERSION = "${version}"`
      ),
  },
];

/**
 * Pure function: apply version to file content.
 * Exported for testing.
 */
export function applyVersion(
  fileContent: string,
  version: string,
  updater: (content: string, version: string) => string
): string {
  return updater(fileContent, version);
}

/**
 * Sync version to all files on disk.
 */
export function syncVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format: "${version}". Expected X.Y.Z`);
  }

  for (const file of VERSION_FILES) {
    const fullPath = resolve(ROOT, file.path);
    const content = readFileSync(fullPath, "utf-8");
    const updated = file.update(content, version);
    writeFileSync(fullPath, updated);
    console.log(`  ✓ ${file.path} → ${version}`);
  }
}

// CLI entrypoint
if (process.argv[1]?.endsWith("sync-version.ts")) {
  const version = process.argv[2];
  if (!version) {
    console.error("Usage: npx tsx scripts/sync-version.ts <version>");
    process.exit(1);
  }
  console.log(`Syncing version ${version}...`);
  syncVersion(version);
  console.log("Done.");
}
