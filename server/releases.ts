import type { ReleaseCheck } from "./types.js";

const repositoryReleasesUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const repositoryTagsUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/tags?per_page=1";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";

function normalizeVersion(version: string | undefined) {
  return version?.replace(/^v/i, "").trim();
}

export async function checkRepositoryRelease(currentVersion: string): Promise<ReleaseCheck> {
  const checkedAt = new Date().toISOString();

  try {
    const releaseResponse = await fetch(repositoryReleasesUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (!releaseResponse.ok) {
      return {
        available: false,
        currentVersion,
        checkedAt,
        error: `GitHub antwortet mit HTTP ${releaseResponse.status}.`
      };
    }

    const releases = (await releaseResponse.json()) as Array<{ tag_name?: string; html_url?: string }>;
    const latestRelease = releases[0];
    const latestVersion = normalizeVersion(latestRelease?.tag_name);

    if (latestVersion) {
      return {
        available: latestVersion !== normalizeVersion(currentVersion),
        currentVersion,
        latestVersion,
        source: "release",
        url: latestRelease?.html_url,
        checkedAt
      };
    }

    const tagResponse = await fetch(repositoryTagsUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (!tagResponse.ok) {
      return {
        available: false,
        currentVersion,
        checkedAt,
        error: `GitHub-Tags antworten mit HTTP ${tagResponse.status}.`
      };
    }

    const tags = (await tagResponse.json()) as Array<{ name?: string; commit?: { url?: string } }>;
    const latestTag = tags[0];
    const latestTagVersion = normalizeVersion(latestTag?.name);

    return {
      available: Boolean(latestTagVersion && latestTagVersion !== normalizeVersion(currentVersion)),
      currentVersion,
      latestVersion: latestTagVersion,
      source: latestTagVersion ? "tag" : undefined,
      url: latestTagVersion ? `${repositoryUrl}/releases/tag/${latestTag?.name}` : repositoryUrl,
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
