import { GitHubRepository } from '../models/github-repository'
import { isDotCom, isGitea } from './endpoint-capabilities'

/**
 * A human-friendly name for the forge behind a given API endpoint, for use
 * in "View on X" style labels/menu items and misattribution warnings.
 * Gitea/Forgejo/Codeberg don't share one product name, so this falls back
 * to the instance's hostname for them (e.g. "codeberg.org").
 */
export function getForgeDisplayNameForEndpoint(endpoint: string) {
  if (isDotCom(endpoint)) {
    return 'GitHub'
  }

  if (isGitea(endpoint)) {
    try {
      return new URL(endpoint).hostname
    } catch {
      return 'Git host'
    }
  }

  return 'GitHub Enterprise'
}

/** Same as `getForgeDisplayNameForEndpoint`, for a `GitHubRepository`. */
export function getForgeDisplayName(gitHubRepository: GitHubRepository) {
  return getForgeDisplayNameForEndpoint(gitHubRepository.endpoint)
}

/** Returns e.g. "View on GitHub" or "View on codeberg.org" */
export function getViewOnPlatformLabel(gitHubRepository: GitHubRepository) {
  return `View on ${getForgeDisplayName(gitHubRepository)}`
}
