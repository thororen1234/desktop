import { describe, it } from 'node:test'
import assert from 'node:assert'
import { existsSync } from 'fs'
import { readFile } from 'fs/promises'

import { revertCommit, revertCommits } from '../../../src/lib/git/revert'
import { getCommits } from '../../../src/lib/git'
import { setupEmptyRepository } from '../../helpers/repositories'
import { makeCommit } from '../../helpers/repository-scaffolding'
import { getTipOrError } from '../../helpers/git'

describe('git/revert', () => {
  describe('revertCommit', () => {
    it('reverts a simple commit', async t => {
      const repo = await setupEmptyRepository(t)

      // Create an initial commit with a file
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'initial content' }],
        commitMessage: 'initial commit',
      })

      // Create a second commit that modifies the file
      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'modified content' }],
        commitMessage: 'modify file',
      })

      // Get the tip commit (the one to revert)
      const tip = await getTipOrError(repo)

      // Revert the second commit
      await revertCommit(repo, tip, null)

      // Verify a new revert commit was created
      const commits = await getCommits(repo, 'HEAD', 3)
      assert.equal(commits.length, 3)
      assert.ok(commits[0].summary.startsWith('Revert'))
      assert.equal(
        await readFile(`${repo.path}/file.txt`, 'utf8'),
        'initial content'
      )
    })

    it('reverts a commit that adds a new file', async t => {
      const repo = await setupEmptyRepository(t)

      // Create initial commit
      await makeCommit(repo, {
        entries: [{ path: 'initial.txt', contents: 'initial' }],
        commitMessage: 'initial commit',
      })

      // Create commit that adds a new file
      await makeCommit(repo, {
        entries: [
          { path: 'initial.txt', contents: 'initial' },
          { path: 'new-file.txt', contents: 'new content' },
        ],
        commitMessage: 'add new file',
      })

      const tip = await getTipOrError(repo)
      await revertCommit(repo, tip, null)

      // Verify the revert commit exists
      const commits = await getCommits(repo, 'HEAD', 3)
      assert.equal(commits.length, 3)
      assert.ok(commits[0].summary.startsWith('Revert'))
      assert.equal(existsSync(`${repo.path}/new-file.txt`), false)
    })
  })

  describe('revertCommits', () => {
    it('reverts multiple commits into a single new commit', async t => {
      const repo = await setupEmptyRepository(t)

      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'initial content' }],
        commitMessage: 'initial commit',
      })

      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'second content' }],
        commitMessage: 'second commit',
      })

      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'third content' }],
        commitMessage: 'third commit',
      })

      // Revert the two most recent commits, newest first, matching the
      // order the app passes them in.
      const commits = await getCommits(repo, 'HEAD', 3)
      await revertCommits(repo, [commits[0], commits[1]], null)

      // Verify only a single new commit was created for both reverts
      const afterRevert = await getCommits(repo, 'HEAD', 4)
      assert.equal(afterRevert.length, 4)
      assert.ok(afterRevert[0].summary.startsWith('Revert'))
      assert.ok(afterRevert[0].body.includes(commits[0].sha))
      assert.ok(afterRevert[0].body.includes(commits[1].sha))
      assert.equal(
        await readFile(`${repo.path}/file.txt`, 'utf8'),
        'initial content'
      )
    })

    it('falls back to a single revert commit when given one commit', async t => {
      const repo = await setupEmptyRepository(t)

      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'initial content' }],
        commitMessage: 'initial commit',
      })

      await makeCommit(repo, {
        entries: [{ path: 'file.txt', contents: 'modified content' }],
        commitMessage: 'modify file',
      })

      const tip = await getTipOrError(repo)
      await revertCommits(repo, [tip], null)

      const commits = await getCommits(repo, 'HEAD', 3)
      assert.equal(commits.length, 3)
      assert.ok(commits[0].summary.startsWith('Revert'))
      assert.equal(
        await readFile(`${repo.path}/file.txt`, 'utf8'),
        'initial content'
      )
    })
  })
})
