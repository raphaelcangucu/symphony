import { Component, type ErrorInfo, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface AssistantSessionErrorBoundaryProps {
  /** Localized heading shown when a render error is caught. */
  title: string;
  /** Localized secondary text explaining the recovery action. */
  description: string;
  /** Localized label for the retry button. */
  retryLabel: string;
  /** Invoked after the boundary resets, so the parent can refresh transcript state. */
  onReset?: () => void;
  children: ReactNode;
}

interface AssistantSessionErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates transcript rendering failures. A single malformed tool/markdown block
 * must not crash navigation or the composer, which live outside this boundary.
 * Recovery remounts the subtree via an incrementing key and surfaces an explicit
 * retry affordance instead of a blank screen.
 */
export class AssistantSessionErrorBoundary extends Component<
  AssistantSessionErrorBoundaryProps,
  AssistantSessionErrorBoundaryState
> {
  private resetCount = 0;

  constructor(props: AssistantSessionErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): AssistantSessionErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface for diagnostics without taking the app down.
    console.error("Assistant session render error", error, info.componentStack);
  }

  private handleRetry = (): void => {
    this.resetCount += 1;
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="mx-auto my-6 flex max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center"
        >
          <p className="text-sm font-medium text-destructive">{this.props.title}</p>
          <p className="text-xs text-muted-foreground">{this.props.description}</p>
          <Button type="button" size="sm" variant="outline" onClick={this.handleRetry}>
            {this.props.retryLabel}
          </Button>
        </div>
      );
    }

    return <div key={this.resetCount}>{this.props.children}</div>;
  }
}
