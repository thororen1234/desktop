import { describe, it } from 'node:test'
import assert from 'node:assert'
import { groupRepositories } from '../../src/ui/repositories-list/group-repositories'
import { Repository, ILocalRepositoryState } from '../../src/models/repository'
import { CloningRepository } from '../../src/models/cloning-repository'
import { gitHubRepoFixture } from '../helpers/github-repo-builder'
import { registerGiteaEndpoint } from '../../src/lib/endpoint-capabilities'

const codebergEndpoint = 'https://codeberg.org/api/v1'
registerGiteaEndpoint(codebergEndpoint)

describe('repository list grouping', () => {
  const repositories: Array<Repository | CloningRepository> = [
    new Repository('repo1', 1, null, false),
    new Repository(
      'repo2',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'my-repo2' }),
      false
    ),
    new Repository(
      'repo3',
      3,
      gitHubRepoFixture({
        owner: '',
        name: 'my-repo3',
        endpoint: 'https://github.big-corp.com/api/v3',
      }),
      false
    ),
  ]

  const cache = new Map<number, ILocalRepositoryState>()

  it('groups repositories by dotcom/Enterprise/Other', () => {
    const grouped = groupRepositories(repositories, cache, [])
    assert.equal(grouped.length, 3)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal(grouped[0].items.length, 1)

    let item = grouped[0].items[0]
    assert.equal(item.kind, 'repository')
    assert(item.kind === 'repository')
    assert.equal(item.repository.path, 'repo2')

    assert.equal(grouped[1].identifier.kind, 'enterprise')
    assert.equal(grouped[1].items.length, 1)

    item = grouped[1].items[0]
    assert(item.kind === 'repository')
    assert.equal(item.repository.path, 'repo3')

    assert.equal(grouped[2].identifier.kind, 'other')
    assert.equal(grouped[2].items.length, 1)

    item = grouped[2].items[0]
    assert(item.kind === 'repository')
    assert.equal(item.repository.path, 'repo1')
  })

  it('sorts repositories alphabetically within each group', () => {
    const repoA = new Repository('a', 1, null, false)
    const repoB = new Repository(
      'b',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'b' }),
      false
    )
    const repoC = new Repository('c', 2, null, false)
    const repoD = new Repository(
      'd',
      2,
      gitHubRepoFixture({ owner: 'me', name: 'd' }),
      false
    )
    const repoZ = new Repository('z', 3, null, false)

    const grouped = groupRepositories(
      [repoC, repoB, repoZ, repoD, repoA],
      cache,
      []
    )
    assert.equal(grouped.length, 2)

    assert.equal(grouped[0].identifier.kind, 'dotcom')
    // Only one owner ('me') is present, so no owner sub-header is expected.
    assert.equal(grouped[0].items.length, 2)

    let items = grouped[0].items
    assert(items[0].kind === 'repository')
    assert(items[1].kind === 'repository')
    assert.equal(items[0].repository.path, 'b')
    assert.equal(items[1].repository.path, 'd')

    assert.equal(grouped[1].identifier.kind, 'other')
    assert.equal(grouped[1].items.length, 3)

    items = grouped[1].items
    assert(items[0].kind === 'repository')
    assert(items[1].kind === 'repository')
    assert(items[2].kind === 'repository')
    assert.equal(items[0].repository.path, 'a')
    assert.equal(items[1].repository.path, 'c')
    assert.equal(items[2].repository.path, 'z')
  })

  it('adds an owner sub-header when a host group has repos from more than one account', () => {
    const repoA = new Repository(
      'repo',
      1,
      gitHubRepoFixture({ owner: 'user1', name: 'repo' }),
      false
    )
    const repoB = new Repository(
      'repo',
      2,
      gitHubRepoFixture({ owner: 'user2', name: 'repo' }),
      false
    )
    const repoC = new Repository(
      'enterprise-repo',
      3,
      gitHubRepoFixture({
        owner: 'business',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )
    const repoD = new Repository(
      'enterprise-repo',
      4,
      gitHubRepoFixture({
        owner: 'silliness',
        name: 'enterprise-repo',
        endpoint: 'https://ghe.io/api/v3',
      }),
      false
    )

    const grouped = groupRepositories([repoA, repoB, repoC, repoD], cache, [])
    assert.equal(grouped.length, 2)

    // Both dotcom repos are now under a single 'dotcom' group, split into
    // per-owner sub-headers since there are two distinct owners.
    assert.equal(grouped[0].identifier.kind, 'dotcom')
    assert.equal(grouped[0].items.length, 4)

    const [dotcomHeader1, dotcomRepo1, dotcomHeader2, dotcomRepo2] =
      grouped[0].items
    assert.equal(dotcomHeader1.kind, 'owner-header')
    assert(dotcomHeader1.kind === 'owner-header')
    assert.equal(dotcomHeader1.owner, 'user1')
    assert(dotcomRepo1.kind === 'repository')
    assert.equal(dotcomRepo1.repository.path, 'repo')

    assert.equal(dotcomHeader2.kind, 'owner-header')
    assert(dotcomHeader2.kind === 'owner-header')
    assert.equal(dotcomHeader2.owner, 'user2')
    assert(dotcomRepo2.kind === 'repository')
    assert.equal(dotcomRepo2.repository.path, 'repo')

    // Same story for the single GHE host, split by owner.
    assert.equal(grouped[1].identifier.kind, 'enterprise')
    assert.equal(grouped[1].items.length, 4)

    const [entHeader1, entRepo1, entHeader2, entRepo2] = grouped[1].items
    assert.equal(entHeader1.kind, 'owner-header')
    assert(entHeader1.kind === 'owner-header')
    assert.equal(entHeader1.owner, 'business')
    assert(entRepo1.kind === 'repository')
    assert.equal(entRepo1.repository.path, 'enterprise-repo')

    assert.equal(entHeader2.kind, 'owner-header')
    assert(entHeader2.kind === 'owner-header')
    assert.equal(entHeader2.owner, 'silliness')
    assert(entRepo2.kind === 'repository')
    assert.equal(entRepo2.repository.path, 'enterprise-repo')
  })

  it('groups Gitea/Forgejo/Codeberg repositories separately from Enterprise, by host', () => {
    const repoA = new Repository(
      'repo-a',
      1,
      gitHubRepoFixture({
        owner: 'thororen',
        name: 'repo-a',
        endpoint: codebergEndpoint,
      }),
      false
    )
    const repoB = new Repository(
      'repo-b',
      2,
      gitHubRepoFixture({
        owner: 'someone-else',
        name: 'repo-b',
        endpoint: codebergEndpoint,
      }),
      false
    )

    const grouped = groupRepositories([repoA, repoB], cache, [])
    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].identifier.kind, 'gitea')
    assert.equal((grouped[0].identifier as any).host, 'codeberg.org')

    // Two distinct owners on the same instance -> owner sub-headers.
    assert.equal(grouped[0].items.length, 4)
    const [header1, item1, header2, item2] = grouped[0].items
    assert.equal(header1.kind, 'owner-header')
    assert(header1.kind === 'owner-header')
    assert.equal(header1.owner, 'someone-else')
    assert(item1.kind === 'repository')
    assert.equal(item1.repository.path, 'repo-b')

    assert.equal(header2.kind, 'owner-header')
    assert(header2.kind === 'owner-header')
    assert.equal(header2.owner, 'thororen')
    assert(item2.kind === 'repository')
    assert.equal(item2.repository.path, 'repo-a')
  })

  it('does not add an owner sub-header when a host group has only one account', () => {
    const repoA = new Repository(
      'repo-a',
      1,
      gitHubRepoFixture({
        owner: 'thororen',
        name: 'repo-a',
        endpoint: codebergEndpoint,
      }),
      false
    )
    const repoB = new Repository(
      'repo-b',
      2,
      gitHubRepoFixture({
        owner: 'thororen',
        name: 'repo-b',
        endpoint: codebergEndpoint,
      }),
      false
    )

    const grouped = groupRepositories([repoA, repoB], cache, [])
    assert.equal(grouped.length, 1)
    assert.equal(grouped[0].identifier.kind, 'gitea')
    assert.equal(grouped[0].items.length, 2)
    assert(grouped[0].items.every(item => item.kind === 'repository'))
  })
})
