import * as React from 'react'
import { WelcomeStep } from './welcome'
import { Button } from '../lib/button'
import { SignIn } from '../lib/sign-in'
import { Dispatcher } from '../dispatcher'
import { SignInState, SignInStep } from '../../lib/stores'

interface ISignInEnterpriseProps {
  readonly dispatcher: Dispatcher
  readonly advance: (step: WelcomeStep) => void
  readonly signInState: SignInState | null
}

const isGiteaStep = (state: SignInState) =>
  state.kind === SignInStep.GiteaEndpointEntry ||
  state.kind === SignInStep.TokenEntry

/** The Welcome flow step to login to an Enterprise instance. */
export class SignInEnterprise extends React.Component<
  ISignInEnterpriseProps,
  {}
> {
  public render() {
    const state = this.props.signInState

    if (!state) {
      return null
    }

    const title = isGiteaStep(state)
      ? 'Sign in to another Git host'
      : 'Sign in to your GitHub Enterprise'

    return (
      <section id="sign-in-enterprise" aria-label={title}>
        <h1 className="welcome-title">{title}</h1>

        <SignIn signInState={state} dispatcher={this.props.dispatcher}>
          <Button onClick={this.cancel}>Cancel</Button>
        </SignIn>
      </section>
    )
  }

  private cancel = () => {
    this.props.advance(WelcomeStep.Start)
  }
}
