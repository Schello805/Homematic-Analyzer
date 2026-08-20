export function decodeBase64Lines(encodedLines?: string[]) {
  return encodedLines?.flatMap((encodedLine) => {
    try {
      return [Buffer.from(encodedLine, "base64").toString("utf8").replace(/\0/g, "")];
    } catch {
      return [];
    }
  });
}

export function parseCollectorAddons(lines?: string[]): Array<{ name: string; version: string }> | undefined {
  if (!lines || lines.length === 0) return undefined;

  const addons: Array<{ name: string; version: string }> = [];
  for (const line of lines) {
    const match = line.match(/^ADDON\|name=([^|]+)\|version=(.+)$/);
    if (!match) continue;

    const name = match[1].trim();
    const version = match[2].trim();
    if (name && version && !addons.some((addon) => addon.name.toLowerCase() === name.toLowerCase())) {
      addons.push({ name, version });
    }
  }

  return addons.length > 0 ? addons : undefined;
}
