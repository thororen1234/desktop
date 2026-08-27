import {
  Repository,
  ILocalRepositoryState,
  nameOf,
  isRepositoryWithGitHubRepository,
  RepositoryWithGitHubRepository,
} from '../../models/repository'
import { CloningRepository } from '../../models/cloning-repository'
import { getHTMLURL } from '../../lib/api'
import { getGiteaHTMLURL } from '../../lib/api/gitea-endpoint'
import { caseInsensitiveCompare, compare } from '../../lib/compare'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { IAheadBehind } from '../../models/branch'
import { assertNever } from '../../lib/fatal-error'
import { isDotCom, isGitea } from '../../lib/endpoint-capabilities'

export type RepositoryListGroup =
  | {
      kind: 'recent' | 'other' | 'dotcom'
    }
  | {
      kind: 'enterprise' | 'gitea'
      host: string
    }

/**
 * Returns a unique grouping key (string) for a repository group. Doubles as a
 * case sensitive sorting key (i.e the case sensitive sort order of the keys is
 * the order in which the groups will be displayed in the repository list).
 */
export const getGroupKey = (group: RepositoryListGroup) => {
  const { kind } = group
  switch (kind) {
    case 'recent':
      return `0:recent`
    case 'dotcom':
      return `1:dotcom`
    case 'enterprise':
      return `2:enterprise:${group.host}`
    case 'gitea':
      return `3:gitea:${group.host}`
    case 'other':
      return `4:other`
    default:
      assertNever(group, `Unknown repository group kind ${kind}`)
  }
}
export type Repositoryish = Repository | CloningRepository

interface IBaseRepositoryListRow extends IFilterListItem {
  readonly text: ReadonlyArray<string>
  readonly id: string
}

/** A row representing an actual repository, selectable and actionable. */
export interface IRepositoryListItem extends IBaseRepositoryListRow {
  readonly kind: 'repository'
  readonly repository: Repositoryish
  readonly needsDisambiguation: boolean
  readonly aheadBehind: IAheadBehind | null
  readonly changedFilesCount: number
}

/**
 * A non-selectable sub-header row nested within a host group, labeling the
 * account (owner login) that the repositories immediately following it
 * belong to. Only present when a host group contains repositories from more
 * than one account.
 */
export interface IRepositoryListOwnerHeader extends IBaseRepositoryListRow {
  readonly kind: 'owner-header'
  readonly owner: string
}

export type RepositoryListRow = IRepositoryListItem | IRepositoryListOwnerHeader

const recentRepositoriesThreshold = 7

const getHostForRepository = (repo: RepositoryWithGitHubRepository) => {
  const { endpoint } = repo.gitHubRepository
  const htmlURL = isGitea(endpoint)
    ? getGiteaHTMLURL(endpoint)
    : getHTMLURL(endpoint)
  return new URL(htmlURL).host
}

const getGroupForRepository = (repo: Repositoryish): RepositoryListGroup => {
  if (repo instanceof Repository && isRepositoryWithGitHubRepository(repo)) {
    const { endpoint } = repo.gitHubRepository

    if (isDotCom(endpoint)) {
      return { kind: 'dotcom' }
    }

    return isGitea(endpoint)
      ? { kind: 'gitea', host: getHostForRepository(repo) }
      : { kind: 'enterprise', host: getHostForRepository(repo) }
  }
  return { kind: 'other' }
}

type RepoGroupItem = { group: RepositoryListGroup; repos: Repositoryish[] }

export function groupRepositories(
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  recentRepositories: ReadonlyArray<number>
): ReadonlyArray<IFilterListGroup<RepositoryListRow, RepositoryListGroup>> {
  const includeRecentGroup = repositories.length > recentRepositoriesThreshold
  const recentSet = includeRecentGroup ? new Set(recentRepositories) : undefined
  const groups = new Map<string, RepoGroupItem>()

  const addToGroup = (group: RepositoryListGroup, repo: Repositoryish) => {
    const key = getGroupKey(group)
    let rg = groups.get(key)
    if (!rg) {
      rg = { group, repos: [] }
      groups.set(key, rg)
    }

    rg.repos.push(repo)
  }

  for (const repo of repositories) {
    if (recentSet?.has(repo.id) && repo instanceof Repository) {
      addToGroup({ kind: 'recent' }, repo)
    }

    addToGroup(getGroupForRepository(repo), repo)
  }

  return Array.from(groups)
    .sort(([xKey], [yKey]) => compare(xKey, yKey))
    .map(([, { group, repos }]) => ({
      identifier: group,
      items: toSortedListRows(group, repos, localRepositoryStateLookup, groups),
    }))
}

// Returns the display title for a repository, which is either the alias
// (if available) or the name.
const getDisplayTitle = (r: Repositoryish) =>
  r instanceof Repository && r.alias != null ? r.alias : r.name

// The owner login for a repository, or null if it doesn't have an
// associated GitHub-shaped repository (and therefore no owner to group by).
const getOwnerLogin = (r: Repositoryish): string | null =>
  r instanceof Repository && isRepositoryWithGitHubRepository(r)
    ? r.gitHubRepository.owner.login
    : null

// Host-scoped groups may span multiple signed-in accounts on the same host
// (e.g. two different Gitea accounts on the same instance, or several GitHub
// Enterprise orgs), so repositories within them are further split into
// per-owner sub-headers.
const supportsOwnerHeaders = (kind: RepositoryListGroup['kind']) =>
  kind === 'dotcom' || kind === 'enterprise' || kind === 'gitea'

const toRepositoryItem = (
  r: Repositoryish,
  needsDisambiguation: boolean,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>
): IRepositoryListItem => {
  const repoState = localRepositoryStateLookup.get(r.id)
  const title = getDisplayTitle(r)

  return {
    kind: 'repository',
    text: r instanceof Repository ? [title, nameOf(r)] : [title],
    id: r.id.toString(),
    repository: r,
    needsDisambiguation,
    aheadBehind: repoState?.aheadBehind ?? null,
    changedFilesCount: repoState?.changedFilesCount ?? 0,
  }
}

const toSortedListRows = (
  group: RepositoryListGroup,
  repositories: ReadonlyArray<Repositoryish>,
  localRepositoryStateLookup: ReadonlyMap<number, ILocalRepositoryState>,
  groups: Map<string, RepoGroupItem>
): RepositoryListRow[] => {
  const allNames = new Map<string, number>()

  for (const groupItem of groups.values()) {
    // All items in the recent group are by definition present in another
    // group and therefore we don't want to count them.
    if (groupItem.group.kind === 'recent') {
      continue
    }

    for (const title of groupItem.repos.map(getDisplayTitle)) {
      allNames.set(title, (allNames.get(title) ?? 0) + 1)
    }
  }

  if (!supportsOwnerHeaders(group.kind)) {
    return repositories
      .map(r =>
        toRepositoryItem(
          r,
          // If the repository is in the 'recent' group and has a duplicate
          // name in any group, we need to disambiguate it.
          group.kind === 'recent' &&
            (allNames.get(getDisplayTitle(r)) ?? 0) > 1,
          localRepositoryStateLookup
        )
      )
      .sort(({ repository: x }, { repository: y }) =>
        caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
      )
  }

  const repositoriesByOwner = new Map<string, Repositoryish[]>()
  for (const repo of repositories) {
    const owner = getOwnerLogin(repo) ?? ''
    const forOwner = repositoriesByOwner.get(owner) ?? []
    forOwner.push(repo)
    repositoriesByOwner.set(owner, forOwner)
  }

  const sortedOwners = Array.from(repositoriesByOwner.keys()).sort(
    caseInsensitiveCompare
  )

  // Only show per-owner sub-headers when this host actually has repos from
  // more than one account -- otherwise it's just noise.
  const showOwnerHeaders = sortedOwners.length > 1

  const rows: RepositoryListRow[] = []
  for (const owner of sortedOwners) {
    if (showOwnerHeaders) {
      rows.push({
        kind: 'owner-header',
        id: `${getGroupKey(group)}:owner:${owner}`,
        text: [owner],
        owner,
      })
    }

    const sortedRepos = repositoriesByOwner
      .get(owner)!
      .slice()
      .sort((x, y) =>
        caseInsensitiveCompare(getDisplayTitle(x), getDisplayTitle(y))
      )

    rows.push(
      ...sortedRepos.map(r =>
        toRepositoryItem(r, false, localRepositoryStateLookup)
      )
    )
  }

  return rows
}
