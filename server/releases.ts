import type { CentralReleaseCheck, ReleaseCheck } from "./types.js";

const repositoryReleasesUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const repositoryTagsUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/tags?per_page=1";
const repositoryPackageUrl = "https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/package.json";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";
const openCcuLatestReleaseApiUrl = "https://api.github.com/repos/OpenCCU/OpenCCU/releases/latest";
const openCcuLatestReleaseUrl = "https://github.com/OpenCCU/OpenCCU/releases/latest";
const openCcuReleasesUrl = "https://github.com/OpenCCU/OpenCCU/releases";
const releaseCacheDurationMs = 10 * 60 * 1000;

type ReleaseCandidate = {
  version: string;
  source: NonNullable<ReleaseCheck["source"]>;
  url: string;
};

let cachedCandidate: ReleaseCandidate | undefined;
let cachedAt = 0;
let cachedOpenCcuCandidate: { version: string; url: string } | undefined;
let cachedOpenCcuAt = 0;

function normalizeVersion(version: string | undefined) {
  return version?.replace(/^v/i, "").trim();
}

function versionParts(version: string | undefined) {
  return normalizeVersion(version)?.split(".").map((part) => Number(part.replace(/\D.*$/, ""))) ?? [];
}

export function compareVersions(left: string | undefined, right: string | undefined) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;
    if (leftPart !== rightPart) return leftPart - rightPart;
  }

  return 0;
}

export function normalizeCentralVersion(version: string | undefined): string | undefined {
  const match = version?.match(/\d+\.\d+\.\d+\.\d+/);
  return match?.[0];
}

export function isOpenCcuFamilyProduct(product: string | undefined): boolean {
  if (!product?.trim()) return true;
  return /\b(openccu|raspmatic|raspberrymatic)\b/i.test(product);
}

async function fetchJson(url: string, accept: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Accept: accept,
      "User-Agent": "Homematic-Analyzer-Update-Check"
    },
    signal: AbortSignal.timeout(5000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function readMainCandidate(): Promise<ReleaseCandidate | undefined> {
  const packageJson = await fetchJson(repositoryPackageUrl, "application/json") as { version?: string };
  const version = normalizeVersion(packageJson.version);
  return version
    ? { version, source: "main", url: `${repositoryUrl}/tree/main` }
    : undefined;
}

async function readTagCandidate(): Promise<ReleaseCandidate | undefined> {
  const tags = await fetchJson(repositoryTagsUrl, "application/vnd.github+json") as Array<{ name?: string }>;
  const latestTag = tags[0]?.name;
  const version = normalizeVersion(latestTag);
  return version && latestTag
    ? { version, source: "tag", url: `${repositoryUrl}/releases/tag/${latestTag}` }
    : undefined;
}

async function readReleaseCandidate(): Promise<ReleaseCandidate | undefined> {
  const releases = await fetchJson(repositoryReleasesUrl, "application/vnd.github+json") as Array<{ tag_name?: string; html_url?: string }>;
  const latestRelease = releases[0];
  const version = normalizeVersion(latestRelease?.tag_name);
  return version
    ? { version, source: "release", url: latestRelease?.html_url ?? repositoryUrl }
    : undefined;
}

export async function checkRepositoryRelease(currentVersion: string): Promise<ReleaseCheck> {
  const checkedAt = new Date().toISOString();

  if (cachedCandidate && Date.now() - cachedAt < releaseCacheDurationMs) {
    return {
      available: compareVersions(cachedCandidate.version, currentVersion) > 0,
      currentVersion,
      latestVersion: cachedCandidate.version,
      source: cachedCandidate.source,
      url: cachedCandidate.url,
      checkedAt
    };
  }

  const results = await Promise.allSettled([
    readMainCandidate(),
    readTagCandidate(),
    readReleaseCandidate()
  ]);
  const candidates = results
    .filter((result): result is PromiseFulfilledResult<ReleaseCandidate | undefined> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((candidate): candidate is ReleaseCandidate => Boolean(candidate))
    .sort((left, right) => compareVersions(right.version, left.version));
  const latestCandidate = candidates[0];

  if (latestCandidate) {
    cachedCandidate = latestCandidate;
    cachedAt = Date.now();
    return {
      available: compareVersions(latestCandidate.version, currentVersion) > 0,
      currentVersion,
      latestVersion: latestCandidate.version,
      source: latestCandidate.source,
      url: latestCandidate.url,
      checkedAt
    };
  }

  if (cachedCandidate) {
    return {
      available: compareVersions(cachedCandidate.version, currentVersion) > 0,
      currentVersion,
      latestVersion: cachedCandidate.version,
      source: cachedCandidate.source,
      url: cachedCandidate.url,
      checkedAt
    };
  }

  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

  return {
    available: false,
    currentVersion,
    checkedAt,
    url: repositoryUrl,
    error: errors.length > 0
      ? `GitHub konnte nicht geprüft werden (${errors[0]}).`
      : "GitHub lieferte keine Versionsinformation."
  };
}

async function readOpenCcuCandidate() {
  try {
    const release = await fetchJson(openCcuLatestReleaseApiUrl, "application/vnd.github+json") as { tag_name?: string; html_url?: string };
    const version = normalizeCentralVersion(release.tag_name);
    if (version) return { version, url: release.html_url ?? openCcuReleasesUrl };
  } catch {
  }

  const response = await fetch(openCcuLatestReleaseUrl, {
    headers: { "User-Agent": "Homematic-Analyzer-OpenCCU-Release-Check" },
    redirect: "follow",
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const version = normalizeCentralVersion(response.url);
  return version ? { version, url: response.url } : undefined;
}

export async function checkOpenCcuRelease(installedVersion?: string, product?: string): Promise<CentralReleaseCheck> {
  const checkedAt = new Date().toISOString();
  const normalizedInstalledVersion = normalizeCentralVersion(installedVersion);

  try {
    let candidate = cachedOpenCcuCandidate;
    if (!candidate || Date.now() - cachedOpenCcuAt >= releaseCacheDurationMs) {
      candidate = await readOpenCcuCandidate();
      if (candidate) {
        cachedOpenCcuCandidate = candidate;
        cachedOpenCcuAt = Date.now();
      }
    }

    if (!candidate) {
      return {
        available: false,
        installedVersion: normalizedInstalledVersion,
        product,
        url: openCcuReleasesUrl,
        checkedAt,
        error: "OpenCCU lieferte keine Versionsinformation."
      };
    }

    return {
      available: Boolean(normalizedInstalledVersion && compareVersions(candidate.version, normalizedInstalledVersion) > 0),
      installedVersion: normalizedInstalledVersion,
      latestVersion: candidate.version,
      product,
      url: candidate.url,
      checkedAt
    };
  } catch (error) {
    return {
      available: false,
      installedVersion: normalizedInstalledVersion,
      product,
      url: openCcuReleasesUrl,
      checkedAt,
      error: error instanceof Error ? `OpenCCU konnte nicht geprüft werden (${error.message}).` : "OpenCCU konnte nicht geprüft werden."
    };
  }
}
