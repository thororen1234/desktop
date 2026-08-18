import { Account } from '../../models/account'
import {
  IAPIEmail,
  IAPIFullIdentity,
  IAPIFullRepository,
  IAPIIssue,
  IAPIPullRequest,
  IAPIRefCheckRuns,
  IAPIRefStatus,
  IAPIRepositoryCloneInfo,
  MaxResultsError,
} from '../api'
import { GitProtocol } from '../remote-parsing'
import { parsedResponse, request, urlWithQueryString } from '../http'
import { getGiteaHTMLURL } from './gitea-endpoint'

/**
 * A thin REST client for the Gitea API, which Forgejo and Codeberg also
 * implement (Forgejo forked from Gitea and has kept the same
 * Swagger-generated API shape). Response shapes are mapped onto the
 * existing GitHub-shaped `IAPI*` interfaces so that call sites written
 * against `API` (pull-request-store, commit-status-store, etc.) can accept
 * either provider without changes.
 */

interface IGiteaUser {
  readonly id: number
  readonly login: string
  readonly full_name: string
  readonly email: string
  readonly avatar_url: string
  readonly html_url?: string
}

interface IGiteaEmail {
  readonly email: string
  readonly primary: boolean
  readonly verified: boolean
}

interface IGiteaPermission {
  readonly admin: boolean
  readonly push: boolean
  readonly pull: boolean
}

interface IGiteaRepository {
  readonly name: string
  readonly owner: IGiteaUser
  readonly private: boolean
  readonly fork: boolean
  readonly html_url: string
  readonly ssh_url: string
  readonly clone_url: string
  readonly default_branch: string
  readonly updated_at: string
  readonly has_issues: boolean
  readonly archived: boolean
  readonly permissions?: IGiteaPermission
  readonly parent?: IGiteaRepository | null
}

interface IGiteaPRBranchInfo {
  readonly label: string
  readonly ref: string
  readonly sha: string
  readonly repo: IGiteaRepository | null
}

interface IGiteaPullRequest {
  readonly number: number
  readonly title: string
  readonly body: string
  readonly state: 'open' | 'closed'
  readonly draft: boolean
  readonly created_at: string
  readonly updated_at: string
  readonly user: IGiteaUser
  readonly base: IGiteaPRBranchInfo
  readonly head: IGiteaPRBranchInfo
}

interface IGiteaIssue {
  readonly number: number
  readonly title: string
  readonly state: 'open' | 'closed'
  readonly updated_at: string
  readonly pull_request?: unknown
}

type GiteaCommitStatusState =
  | 'pending'
  | 'success'
  | 'error'
  | 'failure'
  | 'warning'

interface IGiteaCommitStatus {
  readonly id: number
  readonly status: GiteaCommitStatusState
  readonly target_url: string | null
  readonly description: string
  readonly context: string
}

interface IGiteaCombinedStatus {
  readonly state: GiteaCommitStatusState
  readonly total_count: number
  readonly statuses: ReadonlyArray<IGiteaCommitStatus>
}

const giteaStateToAPIRefState = (
  state: GiteaCommitStatusState
): IAPIRefStatus['state'] => {
  switch (state) {
    case 'success':
      return 'success'
    case 'pending':
      return 'pending'
    case 'error':
      return 'error'
    case 'warning':
    case 'failure':
    default:
      return 'failure'
  }
}

const toIAPIRepository = (
  repo: IGiteaRepository,
  htmlBase: string
): IAPIFullRepository => ({
  clone_url: repo.clone_url,
  ssh_url: repo.ssh_url,
  html_url: repo.html_url,
  name: repo.name,
  owner: toIAPIIdentity(repo.owner, htmlBase),
  private: repo.private,
  fork: repo.fork,
  default_branch: repo.default_branch,
  pushed_at: repo.updated_at,
  has_issues: repo.has_issues,
  archived: repo.archived,
  parent: repo.parent ? toIAPIRepository(repo.parent, htmlBase) : undefined,
  permissions: repo.permissions
    ? {
        admin: repo.permissions.admin,
        push: repo.permissions.push,
        pull: repo.permissions.pull,
      }
    : undefined,
})

const toIAPIIdentity = (user: IGiteaUser, htmlBase: string) => ({
  id: user.id,
  login: user.login,
  avatar_url: user.avatar_url,
  html_url: user.html_url ?? `${htmlBase}/${user.login}`,
  type: 'User' as const,
})

const toIAPIPullRequest = (
  pr: IGiteaPullRequest,
  htmlBase: string
): IAPIPullRequest => ({
  number: pr.number,
  title: pr.title,
  created_at: pr.created_at,
  updated_at: pr.updated_at,
  user: toIAPIIdentity(pr.user, htmlBase),
  body: pr.body ?? '',
  state: pr.state,
  draft: pr.draft,
  head: {
    ref: pr.head.ref,
    sha: pr.head.sha,
    repo: pr.head.repo ? toIAPIRepository(pr.head.repo, htmlBase) : null,
  },
  base: {
    ref: pr.base.ref,
    sha: pr.base.sha,
    repo: pr.base.repo ? toIAPIRepository(pr.base.repo, htmlBase) : null,
  },
})

export class GiteaApi {
  public static fromAccount(account: Account): GiteaApi {
    return new GiteaApi(account.endpoint, account.token)
  }

  private readonly htmlBase: string

  public constructor(
    public readonly endpoint: string,
    private readonly token: string
  ) {
    this.htmlBase = getGiteaHTMLURL(endpoint)
  }

  private async giteaRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    query?: { [key: string]: string }
  ) {
    const url = query ? urlWithQueryString(path, query) : path
    const customHeaders: { [key: string]: string } = {
      Accept: 'application/json',
    }
    if (this.token) {
      customHeaders.Authorization = `token ${this.token}`
    }
    return request(this.endpoint, null, method, url, undefined, customHeaders)
  }

  public async fetchAccount(): Promise<IAPIFullIdentity> {
    const response = await this.giteaRequest('GET', 'user')
    const user = await parsedResponse<IGiteaUser>(response)
    return {
      id: user.id,
      html_url: user.html_url ?? `${this.htmlBase}/${user.login}`,
      login: user.login,
      avatar_url: user.avatar_url,
      name: user.full_name || null,
      email: user.email || null,
      type: 'User',
    }
  }

  public async fetchEmails(): Promise<ReadonlyArray<IAPIEmail>> {
    try {
      const response = await this.giteaRequest('GET', 'user/emails')
      const emails = await parsedResponse<ReadonlyArray<IGiteaEmail>>(response)
      return emails.map(e => ({
        email: e.email,
        verified: e.verified,
        primary: e.primary,
        visibility: null,
      }))
    } catch (e) {
      log.warn(`fetchEmails: failed with endpoint ${this.endpoint}`, e)
      return []
    }
  }

  public async fetchRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository | null> {
    try {
      const response = await this.giteaRequest('GET', `repos/${owner}/${name}`)
      if (response.status === 404) {
        return null
      }
      const repo = await parsedResponse<IGiteaRepository>(response)
      return toIAPIRepository(repo, this.htmlBase)
    } catch (e) {
      log.warn(`fetchRepository: an error occurred for '${owner}/${name}'`, e)
      return null
    }
  }

  public async fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ): Promise<IAPIRepositoryCloneInfo | null> {
    const response = await this.giteaRequest('GET', `repos/${owner}/${name}`)

    if (response.status === 404) {
      return null
    }

    const repo = await parsedResponse<IGiteaRepository>(response)
    return {
      url: protocol === 'ssh' ? repo.ssh_url : repo.clone_url,
      defaultBranch: repo.default_branch,
    }
  }

  /**
   * Fetch all repositories the user has explicit permission to access, in a
   * streaming fashion. The callback is invoked once per page of results.
   *
   * Unlike GitHub, Gitea/Forgejo/Codeberg's `/user/repos` endpoint already
   * returns everything the user can see (owned, collaborator, and org
   * repos) in one paginated listing, so there's no need for the
   * affiliation-sharded fan-out `API.fetchUserRepositories` does for
   * GitHub.
   */
  public async fetchUserRepositories(
    callback: (repos: ReadonlyArray<IAPIFullRepository>) => void
  ) {
    const itemsPerPage = 50
    try {
      for (let page = 1; ; page++) {
        const response = await this.giteaRequest('GET', 'user/repos', {
          page: String(page),
          limit: String(itemsPerPage),
        })
        const items = await parsedResponse<ReadonlyArray<IGiteaRepository>>(
          response
        )
        callback(items.map(repo => toIAPIRepository(repo, this.htmlBase)))
        if (items.length < itemsPerPage) {
          break
        }
      }
    } catch (e) {
      log.warn(
        `fetchUserRepositories: failed with endpoint ${this.endpoint}`,
        e
      )
    }
  }

  private async fetchAllPages<T>(
    path: string,
    itemsPerPage = 50
  ): Promise<ReadonlyArray<T>> {
    const results: T[] = []
    for (let page = 1; ; page++) {
      const response = await this.giteaRequest('GET', path, {
        page: String(page),
        limit: String(itemsPerPage),
      })
      const items = await parsedResponse<ReadonlyArray<T>>(response)
      results.push(...items)
      if (items.length < itemsPerPage) {
        break
      }
    }
    return results
  }

  /** Fetch all open pull requests in the given repository. */
  public async fetchAllOpenPullRequests(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPIPullRequest>> {
    try {
      const path = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
        state: 'open',
      })
      const prs = await this.fetchAllPages<IGiteaPullRequest>(path)
      return prs.map(pr => toIAPIPullRequest(pr, this.htmlBase))
    } catch (e) {
      log.warn(`failed fetching open PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch all pull requests in the given repository that have been updated
   * on or after the provided date. Gitea's `pulls` endpoint doesn't support
   * a `since` filter, so, like the GitHub REST provider, this sorts by
   * `updated_at` descending and stops once results fall behind `since`,
   * bailing out to `MaxResultsError` if there's more than `maxResults`.
   */
  public async fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    maxResults = 320
  ): Promise<ReadonlyArray<IAPIPullRequest>> {
    const sinceTime = since.getTime()
    const itemsPerPage = 50
    const results: IAPIPullRequest[] = []

    try {
      for (let page = 1; ; page++) {
        const path = urlWithQueryString(`repos/${owner}/${name}/pulls`, {
          state: 'all',
          sort: 'recentupdate',
          page: String(page),
          limit: String(itemsPerPage),
        })
        const response = await this.giteaRequest('GET', path)
        const prs = await parsedResponse<ReadonlyArray<IGiteaPullRequest>>(
          response
        )

        for (const pr of prs) {
          results.push(toIAPIPullRequest(pr, this.htmlBase))
        }

        if (results.length >= maxResults) {
          throw new MaxResultsError('got max pull requests, aborting')
        }

        const last = prs.at(-1)
        const reachedEnd =
          prs.length < itemsPerPage ||
          last === undefined ||
          Date.parse(last.updated_at) < sinceTime
        if (reachedEnd) {
          break
        }
      }

      return results.filter(pr => Date.parse(pr.updated_at) >= sinceTime)
    } catch (e) {
      log.warn(`failed fetching updated PRs for repository ${owner}/${name}`, e)
      throw e
    }
  }

  public async fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all',
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>> {
    try {
      const query: { [key: string]: string } = { state, type: 'issues' }
      if (since && !isNaN(since.getTime())) {
        query.since = since.toISOString()
      }
      const path = urlWithQueryString(`repos/${owner}/${name}/issues`, query)
      const issues = await this.fetchAllPages<IGiteaIssue>(path)
      return issues
        .filter(i => !i.pull_request)
        .map(i => ({
          number: i.number,
          title: i.title,
          state: i.state,
          updated_at: i.updated_at,
        }))
    } catch (e) {
      log.warn(`fetchIssues: failed for repository ${owner}/${name}`, e)
      throw e
    }
  }

  /**
   * Fetch the combined commit status for a ref. Forgejo/Gitea Actions run
   * status is also reflected here since Actions publishes commit statuses
   * for each workflow job, so this alone gives basic CI check parity
   * without needing a separate Actions API integration.
   */
  public async fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string
  ): Promise<IAPIRefStatus | null> {
    try {
      const safeRef = encodeURIComponent(ref)
      const response = await this.giteaRequest(
        'GET',
        `repos/${owner}/${name}/commits/${safeRef}/status`,
        { per_page: '100' }
      )
      const combined = await parsedResponse<IGiteaCombinedStatus>(response)
      return {
        state: giteaStateToAPIRefState(combined.state),
        total_count: combined.total_count,
        statuses: combined.statuses.map(s => ({
          state: giteaStateToAPIRefState(s.status),
          target_url: s.target_url,
          description: s.description,
          context: s.context,
          id: s.id,
        })),
      }
    } catch (err) {
      log.debug(
        `Failed fetching commit status for ref ${ref} (${owner}/${name})`,
        err
      )
      return null
    }
  }

  /**
   * Gitea/Forgejo check-run (Actions) results aren't mapped in this
   * milestone — Actions job status is still reflected through commit
   * statuses (see `fetchCombinedRefStatus`), just without the in-app
   * job-step drill-down GitHub Actions gets. Always returns `null` so
   * callers written against `API`'s check-runs + statuses pairing keep
   * working unchanged.
   */
  public async fetchRefCheckRuns(
    _owner: string,
    _name: string,
    _ref: string,
    _reloadCache = false
  ): Promise<IAPIRefCheckRuns | null> {
    return null
  }

  /** Fetch the current user's feature flags. Gitea has no equivalent. */
  public async fetchFeatureFlags(): Promise<ReadonlyArray<string> | undefined> {
    return undefined
  }

  /** Gitea has no Copilot equivalent. */
  public async fetchUserCopilotInfo() {
    return undefined
  }
}

/** Fetch the user authenticated by the token from a Gitea/Forgejo instance. */
export async function fetchGiteaUser(
  endpoint: string,
  token: string
): Promise<Account> {
  const api = new GiteaApi(endpoint, token)
  const [user, fetchedEmails] = await Promise.all([
    api.fetchAccount(),
    api.fetchEmails(),
  ])

  // `/user/emails` can come back empty on some instances/tokens even though
  // the account has a primary email -- fall back to the primary email
  // already present on the `/user` response so the account always has at
  // least one usable email (e.g. for the git config author-email picker).
  const emails =
    fetchedEmails.length > 0
      ? fetchedEmails
      : user.email
      ? [{ email: user.email, verified: true, primary: true, visibility: null }]
      : []

  return new Account(
    user.login,
    endpoint,
    token,
    emails,
    user.avatar_url,
    user.id,
    user.name || user.login,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'gitea'
  )
}
