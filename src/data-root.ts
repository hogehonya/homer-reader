export function dataRootFromBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}
