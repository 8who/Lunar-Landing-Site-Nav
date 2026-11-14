// Minimal typing for the one Node API the terrain validation test uses, so the
// browser-only tsconfig does not need @types/node.
declare module 'node:fs' {
  export function readFileSync(path: string | URL): Uint8Array
}
