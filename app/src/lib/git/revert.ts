import { git, IGitStringExecutionOptions } from './core'

import { Repository } from '../../models/repository'
import { Commit } from '../../models/commit'
import { IRevertProgress } from '../../models/progress'

import { executionOptionsWithProgress } from '../progress/from-process'
import { RevertProgressParser } from '../progress/revert'
import {
  envForRemoteOperation,
  getFallbackUrlForProxyResolve,
} from './environment'
import { IRemote } from '../../models/remote'

/**
 * Creates a new commit that reverts the changes of a previous commit
 *
 * @param repository  - The repository to update
 *
 * @param commit         - The SHA of the commit to be reverted
 */
export async function revertCommit(
  repository: Repository,
  commit: Commit,
  currentRemote: IRemote | null,
  progressCallback?: (progress: IRevertProgress) => void
) {
  const args = ['revert']
  if (commit.parentSHAs.length > 1) {
    args.push('-m', '1')
  }

  args.push(commit.sha)

  let opts: IGitStringExecutionOptions = {}
  if (progressCallback) {
    const env = await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, currentRemote)
    )
    opts = await executionOptionsWithProgress(
      { env, trackLFSProgress: true },
      new RevertProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const title = progress.kind === 'progress' ? progress.details.title : ''
        const value = progress.percent

        progressCallback({ kind: 'revert', description, value, title })
      }
    )
  }

  await git(args, repository.path, 'revert', opts)
}

/**
 * Reverts the changes of multiple commits, combining them into a single new
 * commit rather than creating one revert commit per selected commit.
 *
 * The commits are reverted in the order provided, so callers should list
 * them newest-first (matching git's own recommendation for reverting a
 * sequence of commits) to minimize the chance of conflicts.
 *
 * @param repository  - The repository to update
 *
 * @param commits     - The commits to be reverted, newest first
 */
export async function revertCommits(
  repository: Repository,
  commits: ReadonlyArray<Commit>,
  currentRemote: IRemote | null,
  progressCallback?: (progress: IRevertProgress) => void
) {
  if (commits.length === 0) {
    return
  }

  if (commits.length === 1) {
    return revertCommit(repository, commits[0], currentRemote, progressCallback)
  }

  const args = ['revert', '--no-commit']
  if (commits.some(c => c.parentSHAs.length > 1)) {
    args.push('-m', '1')
  }

  args.push(...commits.map(c => c.sha))

  let opts: IGitStringExecutionOptions = {}
  if (progressCallback) {
    const env = await envForRemoteOperation(
      getFallbackUrlForProxyResolve(repository, currentRemote)
    )
    opts = await executionOptionsWithProgress(
      { env, trackLFSProgress: true },
      new RevertProgressParser(),
      progress => {
        const description =
          progress.kind === 'progress' ? progress.details.text : progress.text
        const title = progress.kind === 'progress' ? progress.details.title : ''
        const value = progress.percent

        progressCallback({ kind: 'revert', description, value, title })
      }
    )
  }

  await git(args, repository.path, 'revert', opts)

  const message = getRevertCommitsMessage(commits)
  await git(
    ['commit', '-F', '-', '--cleanup=strip'],
    repository.path,
    'revertCommits',
    { stdin: message }
  )
}

function getRevertCommitsMessage(commits: ReadonlyArray<Commit>): string {
  const [first] = commits
  const summary =
    commits.length === 2
      ? `Revert "${first.summary}" and 1 more commit`
      : `Revert "${first.summary}" and ${commits.length - 1} more commits`

  const description = commits
    .map(c => `This reverts commit ${c.sha}.`)
    .join('\n\n')

  return `${summary}\n\n${description}`
}
