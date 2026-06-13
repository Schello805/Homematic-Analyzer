export function decodeBase64Lines(encodedLines?: string[]) {
  return encodedLines?.flatMap((encodedLine) => {
    try {
      return [Buffer.from(encodedLine, "base64").toString("utf8").replace(/\0/g, "")];
    } catch {
      return [];
    }
  });
}
