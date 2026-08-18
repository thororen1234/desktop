/**
 * Helpers for converting between a Gitea/Forgejo/Codeberg instance's browser
 * URL (e.g. `https://codeberg.org`) and its API base URL (e.g.
 * `https://codeberg.org/api/v1`), mirroring the dotcom/GHE `endpoint` vs
 * `htmlURL` convention used for GitHub accounts.
 *
 * Kept dependency-free (no `Account` import) so both `models/account.ts` and
 * `lib/api/gitea-provider.ts` can use it without introducing a cycle.
 */

const giteaAPIPathSegment = 'api/v1'

/** Given an instance's browser URL, return its API base URL. */
export function getGiteaAPIURL(instanceURL: string): string {
  const trimmed = instanceURL.replace(/\/+$/, '')
  return trimmed.endsWith(`/${giteaAPIPathSegment}`)
    ? trimmed
    : `${trimmed}/${giteaAPIPathSegment}`
}

/** Given an API base URL, return the instance's browser URL. */
export function getGiteaHTMLURL(endpoint: string): string {
  const suffix = `/${giteaAPIPathSegment}`
  return endpoint.endsWith(suffix)
    ? endpoint.slice(0, -suffix.length)
    : endpoint
}
