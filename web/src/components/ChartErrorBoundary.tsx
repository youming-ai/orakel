import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
	fallback?: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

export class ChartErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	render() {
		if (this.state.hasError) {
			return (
				this.props.fallback ?? (
					<div className="h-full flex flex-col items-center justify-center text-xs text-muted-foreground gap-2">
						<span className="text-red-400">Chart failed to render</span>
						<button
							type="button"
							aria-label="Retry rendering chart"
							onClick={() => this.setState({ hasError: false, error: undefined })}
							className="px-2 py-1 text-[11px] rounded bg-muted hover:bg-accent transition-colors"
						>
							Retry
						</button>
					</div>
				)
			);
		}

		return this.props.children;
	}
}
