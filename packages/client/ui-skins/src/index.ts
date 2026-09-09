/**
 * Host half of the skins pack. Pure client feature — nothing to register on
 * the Node side; the Loader row exists so the client-modules scan can serve
 * the browser bundle (`dsh.client` declaration lives in package.json).
 */

export const name = 'dsh-client-ui-skins'

export function apply(): void {
  // Browser-side skin pack; see src/client for the feature.
}
