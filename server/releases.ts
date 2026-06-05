import type { ReleaseCheck } from "./types.js";

const repositoryReleasesUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/releases?per_page=1";
const repositoryTagsUrl = "https://api.github.com/repos/Schello805/Homematic-Analyzer/tags?per_page=1";
const repositoryPackageUrl = "https://raw.githubusercontent.com/Schello805/Homematic-Analyzer/main/package.json";
const repositoryUrl = "https://github.com/Schello805/Homematic-Analyzer";

function normalizeVersion(version: string | undefined) {
  return version?.replace(/^v/i, "").trim();
}

function versionParts(version: string | undefined) {
  return normalizeVersion(version)?.split(".").map((part) => Number(part.replace(/\D.*$/, ""))) ?? [];
}

function compareVersions(left: string | undefined, right: string | undefined) {
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

export async function checkRepositoryRelease(currentVersion: string): Promise<ReleaseCheck> {
  const checkedAt = new Date().toISOString();

  try {
    const candidates: Array<{ version?: string; source: ReleaseCheck["source"]; url?: string }> = [];
    const errors: string[] = [];

    const packageResponse = await fetch(repositoryPackageUrl, {
      headers: { Accept: "application/json" }
    });

    if (packageResponse.ok) {
      const packageJson = (await packageResponse.json()) as { version?: string };
      const mainVersion = normalizeVersion(packageJson.version);
      if (mainVersion) {
        candidates.push({ version: mainVersion, source: "main", url: `${repositoryUrl}/tree/main` });
      }
    } else {
      errors.push(`GitHub-Raw antwortet mit HTTP ${packageResponse.status}.`);
    }

    const tagResponse = await fetch(repositoryTagsUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (tagResponse.ok) {
      const tags = (await tagResponse.json()) as Array<{ name?: string; commit?: { url?: string } }>;
      const latestTag = tags[0];
      const latestTagVersion = normalizeVersion(latestTag?.name);

      if (latestTagVersion) {
        candidates.push({ version: latestTagVersion, source: "tag", url: `${repositoryUrl}/releases/tag/${latestTag?.name}` });
      }
    } else {
      errors.push(`GitHub-Tags antworten mit HTTP ${tagResponse.status}.`);
    }

    const releaseResponse = await fetch(repositoryReleasesUrl, {
      headers: { Accept: "application/vnd.github+json" }
    });

    if (releaseResponse.ok) {
      const releases = (await releaseResponse.json()) as Array<{ tag_name?: string; html_url?: string }>;
      const latestRelease = releases[0];
      const latestVersion = normalizeVersion(latestRelease?.tag_name);

      if (latestVersion) {
        candidates.push({ version: latestVersion, source: "release", url: latestRelease?.html_url });
      }
    } else {
      errors.push(`GitHub-Releases antworten mit HTTP ${releaseResponse.status}.`);
    }

    const latestCandidate = candidates
      .filter((candidate) => candidate.version)
      .sort((left, right) => compareVersions(right.version, left.version))[0];

    return {
      available: Boolean(latestCandidate?.version && compareVersions(latestCandidate.version, currentVersion) > 0),
      currentVersion,
      latestVersion: latestCandidate?.version,
      source: latestCandidate?.source,
      url: latestCandidate?.url ?? repositoryUrl,
      checkedAt,
      error: latestCandidate ? undefined : errors[0]
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
