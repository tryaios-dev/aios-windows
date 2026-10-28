import { Component, type ReactNode } from "react";

/** Never shows message content in an error screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override render() {
    return this.state.failed ? <p role="alert">Something went wrong. Restart the application.</p> : this.props.children;
  }
}
