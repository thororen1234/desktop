import { Account } from '../../models/account'
import { API } from '../api'
import { IForgeApi } from './forge-api'
import { GiteaApi } from './gitea-provider'

/**
 * Get the API client for the forge the given account authenticates
 * against. Callers that only need `IForgeApi`'s surface (pull requests,
 * checks) work unchanged whether the account is a GitHub, Gitea, Forgejo,
 * or Codeberg account.
 */
export function getApiForAccount(account: Account): IForgeApi {
  return account.source === 'gitea'
    ? GiteaApi.fromAccount(account)
    : API.fromAccount(account)
}
