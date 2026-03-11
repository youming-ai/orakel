import { Component, type ReactNode } from "react";

interface Props {
	children: ReactNode;
}

interface State {
	hasError: boolean;
	error?: Error;
}

export class AppErrorBoundary extends Component<Props, State> {
	state: State = { hasError: false };

	static getDerivedStateFromError(error: Error): State {
		return { hasError: true, error };
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
					<div className="space-y-4 max-w-md">
						<h2 className="text-lg font-semibold text-red-400">Something went wrong</h2>
						<p className="text-sm text-muted-foreground">
							{this.state.error?.message ?? "An unexpected error occurred in the dashboard."}
						</p>
						<button
							type="button"
							aria-label="Reload dashboard"
							onClick={() => this.setState({ hasError: false, error: undefined })}
							className="px-4 py-2 text-sm rounded-md bg-muted hover:bg-accent transition-colors"
						>
							Try Again
						</button>
					</div>
				</div>
			);
		}

		return this.props.children;
	}
}
