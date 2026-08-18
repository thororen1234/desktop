import * as React from 'react'
import { Loading } from './loading'
import { Form } from './form'
import { TextBox } from './text-box'
import { Button } from './button'
import { Errors } from './errors'
import { Ref } from './ref'

interface ITokenServerEntryProps {
  /** The API endpoint the token will be validated against. */
  readonly endpoint: string

  /**
   * An error which, if present, is presented to the user in close
   * proximity to the actions or input fields related to the current step.
   */
  readonly error: Error | null

  /**
   * A value indicating whether or not the sign in store is busy processing
   * a request. While this value is true all form inputs and actions save
   * for a cancel action will be disabled.
   */
  readonly loading: boolean

  /**
   * A callback which is invoked once the user has entered a personal
   * access token and submitted it either by clicking on the submit button
   * or by submitting the form through other means (ie hitting Enter).
   */
  readonly onSubmit: (token: string) => void

  /** An array of additional buttons to render after the "Sign in" button. */
  readonly additionalButtons?: ReadonlyArray<JSX.Element>
}

interface ITokenServerEntryState {
  readonly token: string
}

/** An entry form for a personal access token. */
export class TokenServerEntry extends React.Component<
  ITokenServerEntryProps,
  ITokenServerEntryState
> {
  public constructor(props: ITokenServerEntryProps) {
    super(props)
    this.state = { token: '' }
  }

  public render() {
    const disableEntry = this.props.loading
    const disableSubmission =
      this.state.token.length === 0 || this.props.loading

    return (
      <Form onSubmit={this.onSubmit}>
        <p>
          Create a personal access token on{' '}
          <Ref>{new URL(this.props.endpoint).hostname}</Ref> and paste it below.
          Desktop needs a token with access to your repositories, issues, and
          pull requests.
        </p>
        <TextBox
          label="Personal access token"
          type="password"
          autoFocus={true}
          disabled={disableEntry}
          onValueChanged={this.onTokenChanged}
        />

        {this.props.error ? <Errors>{this.props.error.message}</Errors> : null}

        <div className="actions">
          <Button type="submit" disabled={disableSubmission}>
            {this.props.loading ? <Loading /> : null} Sign in
          </Button>
          {this.props.additionalButtons}
        </div>
      </Form>
    )
  }

  private onTokenChanged = (token: string) => {
    this.setState({ token })
  }

  private onSubmit = () => {
    this.props.onSubmit(this.state.token)
  }
}
