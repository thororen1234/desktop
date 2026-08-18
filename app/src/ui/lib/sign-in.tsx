import * as React from 'react'
import { AuthenticationForm } from './authentication-form'
import { assertNever } from '../../lib/fatal-error'
import { EnterpriseServerEntry } from '../lib/enterprise-server-entry'
import { TokenServerEntry } from '../lib/token-server-entry'
import { Dispatcher } from '../dispatcher'
import {
  SignInState,
  SignInStep,
  IEndpointEntryState,
  IAuthenticationState,
  IExistingAccountWarning,
  IGiteaEndpointEntryState,
  ITokenEntryState,
} from '../../lib/stores'
import { Ref } from './ref'
import { getHTMLURL } from '../../lib/api'
import { LinkButton } from './link-button'

interface ISignInProps {
  readonly signInState: SignInState
  readonly dispatcher: Dispatcher
}

/**
 * The sign in flow for GitHub.
 *
 * Provide `children` elements to render additional buttons in the active form.
 */
export class SignIn extends React.Component<ISignInProps, {}> {
  private onEndpointEntered = (url: string) => {
    this.props.dispatcher.setSignInEndpoint(url)
  }

  private onBrowserSignInRequested = () => {
    this.props.dispatcher.requestBrowserAuthentication()
  }

  private onGiteaEndpointEntered = (url: string) => {
    this.props.dispatcher.setSignInGiteaEndpoint(url)
  }

  private onTokenEntered = (token: string) => {
    this.props.dispatcher.setSignInToken(token)
  }

  private onGiteaSignInInstead = () => {
    this.props.dispatcher.beginGiteaSignIn()
  }

  private renderExistingAccountWarningStep(state: IExistingAccountWarning) {
    return (
      <>
        <p className="existing-account-warning">
          You're already signed in to{' '}
          <Ref>{new URL(getHTMLURL(state.endpoint)).host}</Ref> with the account{' '}
          <Ref>{state.existingAccount.login}</Ref>. If you continue, you will
          first be signed out.
        </p>
        {this.renderAuthenticationStep(state)}
      </>
    )
  }

  private renderEndpointEntryStep(
    state: IEndpointEntryState | IExistingAccountWarning
  ) {
    const children = this.props.children as ReadonlyArray<JSX.Element>
    return (
      <>
        <EnterpriseServerEntry
          loading={state.loading}
          error={state.error}
          onSubmit={this.onEndpointEntered}
          additionalButtons={children}
        />
        <p>
          Not GitHub Enterprise?{' '}
          <LinkButton onClick={this.onGiteaSignInInstead}>
            Sign in to another Git host instead
          </LinkButton>
          .
        </p>
      </>
    )
  }

  private renderGiteaEndpointEntryStep(state: IGiteaEndpointEntryState) {
    const children = this.props.children as ReadonlyArray<JSX.Element>
    return (
      <EnterpriseServerEntry
        loading={state.loading}
        error={state.error}
        onSubmit={this.onGiteaEndpointEntered}
        additionalButtons={children}
        label="Instance address"
        placeholder="https://codeberg.org"
      />
    )
  }

  private renderTokenEntryStep(state: ITokenEntryState) {
    const children = this.props.children as ReadonlyArray<JSX.Element>
    return (
      <TokenServerEntry
        endpoint={state.endpoint}
        loading={state.loading}
        error={state.error}
        onSubmit={this.onTokenEntered}
        additionalButtons={children}
      />
    )
  }

  private renderAuthenticationStep(
    state: IAuthenticationState | IExistingAccountWarning
  ) {
    const children = this.props.children as ReadonlyArray<JSX.Element>

    return (
      <AuthenticationForm
        additionalButtons={children}
        onBrowserSignInRequested={this.onBrowserSignInRequested}
      />
    )
  }

  public render() {
    const state = this.props.signInState
    const stepText = this.props.signInState.kind

    switch (state.kind) {
      case SignInStep.EndpointEntry:
        return this.renderEndpointEntryStep(state)
      case SignInStep.ExistingAccountWarning:
        return this.renderExistingAccountWarningStep(state)
      case SignInStep.Authentication:
        return this.renderAuthenticationStep(state)
      case SignInStep.GiteaEndpointEntry:
        return this.renderGiteaEndpointEntryStep(state)
      case SignInStep.TokenEntry:
        return this.renderTokenEntryStep(state)
      case SignInStep.Success:
        return null
      default:
        return assertNever(state, `Unknown sign-in step: ${stepText}`)
    }
  }
}
