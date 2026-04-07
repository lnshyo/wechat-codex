export type BridgeRouteMode = "bound" | "independent";

export type BridgeRoutingState = {
  routeMode: BridgeRouteMode;
  independentOnce: boolean;
  boundSessionId?: string;
};

type NormalizeBridgeRoutingOptions = Partial<BridgeRoutingState> & {
  sharedSessionId?: string;
};

export function normalizeBridgeRoutingState(
  state: NormalizeBridgeRoutingOptions = {},
): BridgeRoutingState {
  const boundSessionId = state.boundSessionId ?? state.sharedSessionId;
  const routeMode = state.routeMode ?? (boundSessionId ? "bound" : "independent");

  return {
    routeMode,
    independentOnce: state.independentOnce ?? false,
    boundSessionId,
  };
}

export function observeSharedSession(
  state: NormalizeBridgeRoutingOptions,
  sessionId: string,
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    return current;
  }

  if (current.boundSessionId) {
    return current;
  }

  return {
    ...current,
    routeMode: "bound",
    independentOnce: false,
    boundSessionId: trimmedSessionId,
  };
}

export function lockBoundSession(
  state: NormalizeBridgeRoutingOptions,
  sessionId: string,
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    return current;
  }

  return {
    ...current,
    routeMode: "bound",
    independentOnce: false,
    boundSessionId: trimmedSessionId,
  };
}

export function switchToIndependent(
  state: NormalizeBridgeRoutingOptions = {},
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  return {
    ...current,
    routeMode: "independent",
    independentOnce: true,
  };
}

export function switchToBound(
  state: NormalizeBridgeRoutingOptions = {},
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  return {
    ...current,
    routeMode: "bound",
    independentOnce: false,
  };
}

export function completeIndependentOnce(
  state: NormalizeBridgeRoutingOptions = {},
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  if (current.routeMode !== "independent" || !current.independentOnce) {
    return current;
  }

  return {
    ...current,
    routeMode: "independent",
    independentOnce: false,
  };
}

export function followBoundSession(
  state: NormalizeBridgeRoutingOptions,
  sessionId: string,
): BridgeRoutingState {
  const current = normalizeBridgeRoutingState(state);
  if (!sessionId.trim()) {
    return current;
  }

  if (current.routeMode !== "bound") {
    return current;
  }

  return {
    ...current,
    boundSessionId: sessionId,
  };
}
