import { describe, it } from 'node:test'
import assert from 'node:assert'
import { GiteaApi, fetchGiteaUser } from '../../src/lib/api/gitea-provider'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function stubGiteaRequest(
  api: GiteaApi,
  handler: (method: string, path: string) => Response
) {
  Reflect.set(api, 'giteaRequest', async (method: string, path: string) =>
    handler(method, path)
  )
}

const giteaUserFixture = {
  id: 42,
  login: 'octocat',
  full_name: 'The Octocat',
  email: 'octocat@example.com',
  avatar_url: 'https://codeberg.org/avatars/octocat',
  html_url: 'https://codeberg.org/octocat',
}

const giteaRepoFixture = {
  name: 'hello-world',
  owner: giteaUserFixture,
  private: false,
  fork: false,
  html_url: 'https://codeberg.org/octocat/hello-world',
  ssh_url: 'git@codeberg.org:octocat/hello-world.git',
  clone_url: 'https://codeberg.org/octocat/hello-world.git',
  default_branch: 'main',
  updated_at: '2026-01-01T00:00:00Z',
  has_issues: true,
  archived: false,
  permissions: { admin: false, push: true, pull: true },
  parent: null,
}

describe('GiteaApi', () => {
  it('fetchAccount maps a Gitea user to IAPIFullIdentity', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')
    stubGiteaRequest(api, () => jsonResponse(giteaUserFixture))

    const identity = await api.fetchAccount()

    assert.equal(identity.id, 42)
    assert.equal(identity.login, 'octocat')
    assert.equal(identity.name, 'The Octocat')
    assert.equal(identity.email, 'octocat@example.com')
    assert.equal(identity.html_url, 'https://codeberg.org/octocat')
  })

  it('fetchRepository maps a Gitea repository to IAPIFullRepository', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')
    stubGiteaRequest(api, () => jsonResponse(giteaRepoFixture))

    const repo = await api.fetchRepository('octocat', 'hello-world')

    assert(repo !== null)
    assert.equal(repo.clone_url, giteaRepoFixture.clone_url)
    assert.equal(repo.owner.login, 'octocat')
    assert.equal(repo.permissions?.push, true)
    assert.equal(repo.parent, undefined)
  })

  it('fetchRepository returns null on a 404', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')
    stubGiteaRequest(api, () => new Response(null, { status: 404 }))

    const repo = await api.fetchRepository('octocat', 'missing')

    assert.equal(repo, null)
  })

  it('fetchAllOpenPullRequests maps Gitea pulls to IAPIPullRequest', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')

    const giteaPR = {
      number: 7,
      title: 'Add feature',
      body: 'Some description',
      state: 'open',
      draft: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      user: giteaUserFixture,
      base: {
        label: 'main',
        ref: 'main',
        sha: 'aaa',
        repo: giteaRepoFixture,
      },
      head: {
        label: 'feature',
        ref: 'feature',
        sha: 'bbb',
        repo: giteaRepoFixture,
      },
    }

    let callCount = 0
    stubGiteaRequest(api, () => {
      callCount++
      // First page has one PR, second page is empty signalling the end.
      return jsonResponse(callCount === 1 ? [giteaPR] : [])
    })

    const prs = await api.fetchAllOpenPullRequests('octocat', 'hello-world')

    assert.equal(prs.length, 1)
    const pr = prs[0]
    assert.equal(pr.number, 7)
    assert.equal(pr.title, 'Add feature')
    assert.equal(pr.state, 'open')
    assert.equal(pr.head.ref, 'feature')
    assert.equal(pr.head.sha, 'bbb')
    assert.equal(pr.base.ref, 'main')
    assert(pr.head.repo !== null)
    assert.equal(pr.head.repo.name, 'hello-world')
    assert.equal(pr.user.login, 'octocat')
  })

  it('fetchCombinedRefStatus maps Gitea commit status states, folding warning into failure', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')

    stubGiteaRequest(api, () =>
      jsonResponse({
        state: 'success',
        total_count: 3,
        statuses: [
          {
            id: 1,
            status: 'success',
            target_url: 'https://codeberg.org/x',
            description: 'passed',
            context: 'ci/build',
          },
          {
            id: 2,
            status: 'warning',
            target_url: null,
            description: 'flaky',
            context: 'ci/lint',
          },
          {
            id: 3,
            status: 'pending',
            target_url: null,
            description: 'running',
            context: 'ci/test',
          },
        ],
      })
    )

    const status = await api.fetchCombinedRefStatus(
      'octocat',
      'hello-world',
      'main'
    )

    assert(status !== null)
    assert.equal(status.state, 'success')
    assert.equal(status.statuses.length, 3)
    assert.equal(status.statuses[0].state, 'success')
    assert.equal(status.statuses[1].state, 'failure')
    assert.equal(status.statuses[2].state, 'pending')
  })

  it('fetchRefCheckRuns always returns null (no Actions check-run mapping yet)', async () => {
    const api = new GiteaApi('https://codeberg.org/api/v1', 'token')
    const result = await api.fetchRefCheckRuns('octocat', 'hello-world', 'main')
    assert.equal(result, null)
  })
})

function withMockedFetch(
  routes: { user: unknown; emails: unknown },
  run: () => Promise<void>
) {
  const originalFetch = global.fetch
  global.fetch = (async (input: RequestInfo | URL) => {
    const url = input.toString()
    return url.endsWith('/user/emails')
      ? jsonResponse(routes.emails)
      : jsonResponse(routes.user)
  }) as typeof fetch

  return run().finally(() => {
    global.fetch = originalFetch
  })
}

describe('fetchGiteaUser', () => {
  it('builds an Account with source "gitea"', () =>
    withMockedFetch({ user: giteaUserFixture, emails: [] }, async () => {
      const account = await fetchGiteaUser(
        'https://codeberg.org/api/v1',
        'sometoken'
      )

      assert.equal(account.login, 'octocat')
      assert.equal(account.endpoint, 'https://codeberg.org/api/v1')
      assert.equal(account.token, 'sometoken')
      assert.equal(account.source, 'gitea')
    }))

  it('uses the /user/emails list when it has entries', () =>
    withMockedFetch(
      {
        user: giteaUserFixture,
        emails: [
          { email: 'octocat@example.com', primary: true, verified: true },
          { email: 'other@example.com', primary: false, verified: true },
        ],
      },
      async () => {
        const account = await fetchGiteaUser(
          'https://codeberg.org/api/v1',
          'sometoken'
        )

        assert.equal(account.emails.length, 2)
        assert(account.emails.some(e => e.email === 'other@example.com'))
      }
    ))

  it('falls back to the primary /user email when /user/emails is empty', () =>
    withMockedFetch({ user: giteaUserFixture, emails: [] }, async () => {
      const account = await fetchGiteaUser(
        'https://codeberg.org/api/v1',
        'sometoken'
      )

      assert.equal(account.emails.length, 1)
      assert.equal(account.emails[0].email, giteaUserFixture.email)
      assert.equal(account.emails[0].verified, true)
    }))
})
