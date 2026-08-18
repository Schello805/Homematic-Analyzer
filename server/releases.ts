import type { AddonReleaseCheck, CentralReleaseCheck, ReleaseCheck } from "./types.js";

const repositoryReleasesUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const repositoryTagsUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/tags?per_page=1";
const repositoryPackageUrl = "https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/package.json";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";
const openCcuLatestReleaseApiUrl = "https://api.github.com/repos/OpenCCU/OpenCCU/releases/latest";
const openCcuLatestReleaseUrl = "https://github.com/OpenCCU/OpenCCU/releases/latest";
const openCcuReleasesUrl = "https://github.com/OpenCCU/OpenCCU/releases";
const officialCcu3UpdateUrl = "https://ccu3-update.homematic.com/firmware/download";
const officialCcu3DownloadsUrl = "https://homematic-ip.com/de/downloads";
const releaseCacheDurationMs = 10 * 60 * 1000;

type KnownAddon = {
  name: string;
  repo: string;
  releasesUrl: string;
  namePatterns: RegExp[];
};

const knownAddons: KnownAddon[] = [
  {
    name: "CUxD",
    repo: "jens-maus/cuxd",
    releasesUrl: "https://github.com/jens-maus/cuxd/releases",
    namePatterns: [/cuxd/i, /cux.daemon/i]
  },
  {
    name: "XML-API",
    repo: "homematic-community/XML-API",
    releasesUrl: "https://github.com/homematic-community/XML-API/releases",
    namePatterns: [/xml.?api/i, /xmlapi/i]
  },
  {
    name: "JP-HB-Devices Addon",
    repo: "jp112sdl/JP-HB-Devices-addon",
    releasesUrl: "https://github.com/jp112sdl/JP-HB-Devices-addon/releases",
    namePatterns: [/jp.hb.devices/i, /jp112sdl/i]
  },
  {
    name: "CCU-Historian",
    repo: "mdzio/ccu-historian",
    releasesUrl: "https://github.com/mdzio/ccu-historian/releases",
    namePatterns: [/historian/i]
  },
  {
    name: "E-Mail Addon",
    repo: "jens-maus/hm_email",
    releasesUrl: "https://github.com/jens-maus/hm_email/releases",
    namePatterns: [/email/i, /e-mail/i, /hm_email/i]
  },
  {
    name: "RedMatic",
    repo: "rdmtc/RedMatic",
    releasesUrl: "https://github.com/rdmtc/RedMatic/releases",
    namePatterns: [/redmatic/i, /node-red/i]
  },
  {
    name: "HAP-HomeMatic",
    repo: "thkl/hap-homematic",
    releasesUrl: "https://github.com/thkl/hap-homematic/releases",
    namePatterns: [/hap-homematic/i, /homekit/i]
  },
  {
    name: "hm-pdetect",
    repo: "jens-maus/hm-pdetect",
    releasesUrl: "https://github.com/jens-maus/hm-pdetect/releases",
    namePatterns: [/hm.?pdetect/i, /pdetect/i]
  }
];

const addonReleaseCache = new Map<string, { version: string; url: string; cachedAt: number }>();


type ReleaseCandidate = {
  version: string;
  source: NonNullable<ReleaseCheck["source"]>;
  url: string;
};

let cachedCandidate: ReleaseCandidate | undefined;
let cachedAt = 0;
let cachedOpenCcuCandidate: { version: string; url: string } | undefined;
let cachedOpenCcuAt = 0;
let cachedCcu3Candidate: { version: string; url: string } | undefined;
let cachedCcu3At = 0;

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
  const match = version?.match(/\d+\.\d+\.\d+(?:\.\d+)?/);
  return match?.[0];
}

export function isOpenCcuFamilyProduct(product: string | undefined): boolean {
  if (!product?.trim()) return true;
  return /\b(openccu|raspmatic|raspberrymatic)\b/i.test(product);
}

export function isOfficialCcu3Product(product: string | undefined): boolean {
  return /\b(hm-ccu3|ccu3)\b/i.test(product ?? "");
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
        source: "openccu",
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
      source: "openccu",
      url: candidate.url,
      checkedAt
    };
  } catch (error) {
    return {
      available: false,
      installedVersion: normalizedInstalledVersion,
      product,
      source: "openccu",
      url: openCcuReleasesUrl,
      checkedAt,
      error: error instanceof Error ? `OpenCCU konnte nicht geprüft werden (${error.message}).` : "OpenCCU konnte nicht geprüft werden."
    };
  }
}

async function readOfficialCcu3Candidate(installedVersion?: string) {
  const url = new URL(officialCcu3UpdateUrl);
  url.searchParams.set("cmd", "check_version");
  url.searchParams.set("version", normalizeCentralVersion(installedVersion) ?? "0.0.0");
  url.searchParams.set("serial", "0000000000");
  url.searchParams.set("lang", "de");
  url.searchParams.set("product", "HM-CCU3");

  const response = await fetch(url, {
    headers: { "User-Agent": "Homematic-Analyzer-CCU3-Release-Check" },
    redirect: "follow",
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const version = normalizeCentralVersion(await response.text());
  return version ? { version, url: officialCcu3DownloadsUrl } : undefined;
}

export async function checkOfficialCcu3Release(installedVersion?: string, product?: string): Promise<CentralReleaseCheck> {
  const checkedAt = new Date().toISOString();
  const normalizedInstalledVersion = normalizeCentralVersion(installedVersion);

  try {
    let candidate = cachedCcu3Candidate;
    if (!candidate || Date.now() - cachedCcu3At >= releaseCacheDurationMs) {
      candidate = await readOfficialCcu3Candidate(normalizedInstalledVersion);
      if (candidate) {
        cachedCcu3Candidate = candidate;
        cachedCcu3At = Date.now();
      }
    }

    if (!candidate) {
      return {
        available: false,
        installedVersion: normalizedInstalledVersion,
        product,
        source: "ccu3",
        url: officialCcu3DownloadsUrl,
        checkedAt,
        error: "Der offizielle CCU3-Dienst lieferte keine Versionsinformation."
      };
    }

    return {
      available: Boolean(normalizedInstalledVersion && compareVersions(candidate.version, normalizedInstalledVersion) > 0),
      installedVersion: normalizedInstalledVersion,
      latestVersion: candidate.version,
      product,
      source: "ccu3",
      url: candidate.url,
      checkedAt
    };
  } catch (error) {
    return {
      available: false,
      installedVersion: normalizedInstalledVersion,
      product,
      source: "ccu3",
      url: officialCcu3DownloadsUrl,
      checkedAt,
      error: error instanceof Error ? `CCU3 konnte nicht geprüft werden (${error.message}).` : "CCU3 konnte nicht geprüft werden."
    };
  }
}
async function fetchLatestAddonRelease(addon: KnownAddon): Promise<{ version: string; url: string } | undefined> {
  const cached = addonReleaseCache.get(addon.repo);
  if (cached && Date.now() - cached.cachedAt < releaseCacheDurationMs) {
    return { version: cached.version, url: cached.url };
  }

  const apiUrl = `https://api.github.com/repos/${addon.repo}/releases/latest`;
  try {
    const release = await fetchJson(apiUrl, "application/vnd.github+json") as { tag_name?: string; html_url?: string };
    const version = normalizeVersion(release.tag_name);
    if (!version) return undefined;
    const url = release.html_url ?? addon.releasesUrl;
    addonReleaseCache.set(addon.repo, { version, url, cachedAt: Date.now() });
    return { version, url };
  } catch {
    try {
      const releases = await fetchJson(
        `https://api.github.com/repos/${addon.repo}/releases?per_page=1`,
        "application/vnd.github+json"
      ) as Array<{ tag_name?: string; html_url?: string }>;
      const latest = releases[0];
      const version = normalizeVersion(latest?.tag_name);
      if (!version) return undefined;
      const url = latest?.html_url ?? addon.releasesUrl;
      addonReleaseCache.set(addon.repo, { version, url, cachedAt: Date.now() });
      return { version, url };
    } catch {
      return undefined;
    }
  }
}

function matchAddon(installedName: string): KnownAddon | undefined {
  return knownAddons.find((addon) =>
    addon.namePatterns.some((pattern) => pattern.test(installedName))
  );
}

export async function checkKnownAddonUpdates(
  installedAddons: Array<{ name: string; version: string }>
): Promise<AddonReleaseCheck[]> {
  const checkedAt = new Date().toISOString();

  const matched: Array<{ addon: KnownAddon; installedVersion: string }> = [];
  for (const installed of installedAddons) {
    const known = matchAddon(installed.name);
    if (known && !matched.some((m) => m.addon.repo === known.repo)) {
      matched.push({ addon: known, installedVersion: normalizeVersion(installed.version) ?? installed.version });
    }
  }

  if (matched.length === 0) {
    return [];
  }

  return Promise.all(
    matched.map(async ({ addon, installedVersion }): Promise<AddonReleaseCheck> => {
      try {
        const latest = await fetchLatestAddonRelease(addon);
        if (!latest) {
          return {
            name: addon.name,
            installedVersion,
            available: false,
            url: addon.releasesUrl,
            checkedAt,
            error: `GitHub lieferte keine Versionsinformation für ${addon.name}.`
          };
        }
        return {
          name: addon.name,
          installedVersion,
          latestVersion: latest.version,
          available: compareVersions(latest.version, installedVersion) > 0,
          url: latest.url,
          checkedAt
        };
      } catch (error) {
        return {
          name: addon.name,
          installedVersion,
          available: false,
          url: addon.releasesUrl,
          checkedAt,
          error: error instanceof Error
            ? `${addon.name} konnte nicht geprüft werden (${error.message}).`
            : `${addon.name} konnte nicht geprüft werden.`
        };
      }
    })
  );
}
