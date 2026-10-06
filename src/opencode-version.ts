/** Stable OpenCode versions supported by the plugin's public contract. */
export function supportsOpenCodeVersion(version: string): boolean {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z.-]+)*$/.exec(version)
  return match !== null && Number(match[1]) === 1 && Number(match[2]) >= 18
}
