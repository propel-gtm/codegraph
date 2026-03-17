import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_CACHE_PATH = join(homedir(), ".codegraph", "update-check.json");
const REGISTRY_BASE_URL = "https://registry.npmjs.org";
const PACKAGE_METADATA_URL = new URL("../package.json", import.meta.url);

interface PackageMetadata {
  name?: string;
  version?: string;
}

interface UpdateCache {
  checkedAt: string;
  latestVersion: string | null;
  packageName: string;
}

function parseVersion(value: string): number[] | null {
  const normalized = value.trim().replace(/^v/, "");
  const coreVersion = normalized.split("-", 1)[0];

  if (!coreVersion || !/^\d+(\.\d+)*$/.test(coreVersion)) {
    return null;
  }

  return coreVersion.split(".").map((segment) => Number.parseInt(segment, 10));
}

export function compareVersions(current: string, latest: string): number {
  const currentParts = parseVersion(current);
  const latestParts = parseVersion(latest);

  if (!currentParts || !latestParts) {
    return 0;
  }

  const length = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < length; index += 1) {
    const currentPart = currentParts[index] ?? 0;
    const latestPart = latestParts[index] ?? 0;

    if (latestPart > currentPart) {
      return 1;
    }

    if (latestPart < currentPart) {
      return -1;
    }
  }

  return 0;
}

async function readPackageMetadata(): Promise<PackageMetadata | null> {
  try {
    const raw = await readFile(PACKAGE_METADATA_URL, "utf8");
    return JSON.parse(raw) as PackageMetadata;
  } catch {
    return null;
  }
}

async function readCache(): Promise<UpdateCache | null> {
  try {
    const raw = await readFile(UPDATE_CACHE_PATH, "utf8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

export async function writeUpdateCache(value: {
  checkedAt: string;
  latestVersion: string | null;
  packageName: string;
}, cachePath = UPDATE_CACHE_PATH): Promise<void> {
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } catch {
    // Cache writes are best-effort and should not block successful commands.
  }
}

async function fetchLatestVersion(packageName: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1200);

  try {
    const response = await fetch(
      `${REGISTRY_BASE_URL}/${encodeURIComponent(packageName)}/latest`,
      {
        headers: {
          accept: "application/json",
        },
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { version?: string };

    return typeof payload.version === "string" ? payload.version : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getUpgradeNotice(): Promise<string | null> {
  if (process.env.CODEGRAPH_DISABLE_UPDATE_CHECK === "1") {
    return null;
  }

  const metadata = await readPackageMetadata();
  const packageName = metadata?.name?.trim();
  const currentVersion = metadata?.version?.trim();

  if (!packageName || !currentVersion) {
    return null;
  }

  const cached = await readCache();
  const now = Date.now();
  const cachedAt = cached ? Date.parse(cached.checkedAt) : Number.NaN;
  const cacheIsFresh =
    cached?.packageName === packageName &&
    Number.isFinite(cachedAt) &&
    now - cachedAt < UPDATE_CACHE_TTL_MS;

  let latestVersion = cacheIsFresh ? cached?.latestVersion ?? null : null;

  if (!cacheIsFresh) {
    latestVersion = await fetchLatestVersion(packageName);

    await writeUpdateCache({
      checkedAt: new Date(now).toISOString(),
      latestVersion,
      packageName,
    });
  }

  if (!latestVersion || compareVersions(currentVersion, latestVersion) >= 0) {
    return null;
  }

  return [
    `A newer version of ${packageName} is available: ${currentVersion} -> ${latestVersion}.`,
    `Upgrade with: npm i -g ${packageName}`,
    `Or run the latest directly: npx ${packageName}@latest`,
  ].join("\n");
}
