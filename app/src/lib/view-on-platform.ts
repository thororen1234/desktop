import { GitHubRepository } from '../models/github-repository'
import { isDotCom, isGitea } from './endpoint-capabilities'

/**
 * A human-friendly name for the forge a `GitHubRepository` is hosted on, for
 * use in "View on X" style labels/menu items. Gitea/Forgejo/Codeberg don't
 * share one product name, so this falls back to the repository's hostname
 * for them (e.g. "codeberg.org").
 */
export function getForgeDisplayName(gitHubRepository: GitHubRepository) {
  const { endpoint, htmlURL } = gitHubRepository

  if (isDotCom(endpoint)) {
    return 'GitHub'
  }

  if (isGitea(endpoint)) {
    try {
      return htmlURL ? new URL(htmlURL).hostname : 'Git host'
    } catch {
      return 'Git host'
    }
  }

  return 'GitHub Enterprise'
}

/** Returns e.g. "View on GitHub" or "View on codeberg.org" */
export function getViewOnPlatformLabel(gitHubRepository: GitHubRepository) {
  return `View on ${getForgeDisplayName(gitHubRepository)}`
}
