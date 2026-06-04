import type { ReleaseCheck } from "./types.js";

const repositoryReleasesUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";

function normalizeVersion(version: string | undefined) {
  return version?.replace(/^v/i, "").trim();
}

export async function checkRepositoryRelease(currentVersion: string): Promise<ReleaseCheck> {
  const checkedAt = new Date().toISOString();

  try {
    const response = await fetch(repositoryReleasesUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (!response.ok) {
      return {
        available: false,
        currentVersion,
        checkedAt,
        error: `GitHub antwortet mit HTTP ${response.status}.`
      };
    }

    const releases = (await response.json()) as Array<{ tag_name?: string; html_url?: string }>;
    const latestRelease = releases[0];
    const latestVersion = normalizeVersion(latestRelease?.tag_name);

    return {
      available: Boolean(latestVersion && latestVersion !== normalizeVersion(currentVersion)),
      currentVersion,
      latestVersion,
      url: latestRelease?.html_url,
      checkedAt
    };
  } catch {
    return {
      available: false,
      currentVersion,
      checkedAt,
      error: "GitHub konnte nicht erreicht werden."
    };
  }
}
