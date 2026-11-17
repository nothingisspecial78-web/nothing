let pendingTransition = false;

export function markSignInTransition(): void {
  pendingTransition = true;
}

export function isSignInTransitionPending(): boolean {
  return pendingTransition;
}

export function clearSignInTransition(): void {
  pendingTransition = false;
}
