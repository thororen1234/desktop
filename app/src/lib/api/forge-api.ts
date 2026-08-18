import {
  IAPIFullRepository,
  IAPIIssue,
  IAPIPullRequest,
  IAPIRefCheckRuns,
  IAPIRefStatus,
  IAPIRepository,
  IAPIRepositoryCloneInfo,
} from '../api'
import { GitProtocol } from '../remote-parsing'

/**
 * The subset of `API`'s (GitHub) surface that has an equivalent
 * implementation for other forges. Stores that only need this subset
 * (`PullRequestStore`, `CommitStatusStore`) can be written against
 * `IForgeApi` and work unchanged regardless of which provider
 * `getApiForAccount` returns for a given account.
 *
 * Both `API` and `GiteaApi` satisfy this structurally, so neither needs to
 * declare `implements IForgeApi` explicitly.
 */
export interface IForgeApi {
  fetchRepository(
    owner: string,
    name: string
  ): Promise<IAPIFullRepository | null>

  fetchRepositoryCloneInfo(
    owner: string,
    name: string,
    protocol: GitProtocol | undefined
  ): Promise<IAPIRepositoryCloneInfo | null>

  fetchUserRepositories(
    callback: (repos: ReadonlyArray<IAPIRepository>) => void
  ): Promise<void>

  fetchAllOpenPullRequests(
    owner: string,
    name: string
  ): Promise<ReadonlyArray<IAPIPullRequest>>

  fetchUpdatedPullRequests(
    owner: string,
    name: string,
    since: Date,
    maxResults?: number
  ): Promise<ReadonlyArray<IAPIPullRequest>>

  fetchIssues(
    owner: string,
    name: string,
    state: 'open' | 'closed' | 'all',
    since: Date | null
  ): Promise<ReadonlyArray<IAPIIssue>>

  fetchCombinedRefStatus(
    owner: string,
    name: string,
    ref: string,
    reloadCache?: boolean
  ): Promise<IAPIRefStatus | null>

  fetchRefCheckRuns(
    owner: string,
    name: string,
    ref: string,
    reloadCache?: boolean
  ): Promise<IAPIRefCheckRuns | null>
}
