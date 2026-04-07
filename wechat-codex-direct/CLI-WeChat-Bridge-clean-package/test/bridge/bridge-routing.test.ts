import { describe, expect, test } from "bun:test";

import {
  completeIndependentOnce,
  followBoundSession,
  lockBoundSession,
  normalizeBridgeRoutingState,
  observeSharedSession,
  switchToBound,
  switchToIndependent,
} from "../../src/bridge/bridge-routing.ts";

describe("bridge routing state", () => {
  test("defaults to bound routing when a shared session already exists", () => {
    const route = normalizeBridgeRoutingState({
      sharedSessionId: "thread-bound",
    });

    expect(route.routeMode).toBe("bound");
    expect(route.independentOnce).toBe(false);
    expect(route.boundSessionId).toBe("thread-bound");
  });

  test("switchToIndependent preserves the bound session and arms the first temporary turn", () => {
    const route = switchToIndependent(
      normalizeBridgeRoutingState({
        sharedSessionId: "thread-bound",
      }),
    );

    expect(route.routeMode).toBe("independent");
    expect(route.independentOnce).toBe(true);
    expect(route.boundSessionId).toBe("thread-bound");
  });

  test("completeIndependentOnce disarms the first temporary-turn flag without leaving independent mode", () => {
    const route = completeIndependentOnce({
      routeMode: "independent",
      independentOnce: true,
      boundSessionId: "thread-bound",
    });

    expect(route.routeMode).toBe("independent");
    expect(route.independentOnce).toBe(false);
    expect(route.boundSessionId).toBe("thread-bound");
  });

  test("followBoundSession updates the bound session only while bound routing is active", () => {
    const boundRoute = followBoundSession(
      {
        routeMode: "bound",
        independentOnce: false,
        boundSessionId: "thread-old",
      },
      "thread-new",
    );
    const independentRoute = followBoundSession(
      {
        routeMode: "independent",
        independentOnce: true,
        boundSessionId: "thread-old",
      },
      "thread-new",
    );

    expect(boundRoute.boundSessionId).toBe("thread-new");
    expect(independentRoute.boundSessionId).toBe("thread-old");
  });

  test("observeSharedSession preserves an existing bound session lock", () => {
    const route = observeSharedSession(
      {
        routeMode: "bound",
        independentOnce: false,
        boundSessionId: "thread-locked",
      },
      "thread-followed-locally",
    );

    expect(route.routeMode).toBe("bound");
    expect(route.boundSessionId).toBe("thread-locked");
  });

  test("lockBoundSession replaces the previous bound session explicitly", () => {
    const route = lockBoundSession(
      {
        routeMode: "bound",
        independentOnce: false,
        boundSessionId: "thread-old",
      },
      "thread-new",
    );

    expect(route.routeMode).toBe("bound");
    expect(route.independentOnce).toBe(false);
    expect(route.boundSessionId).toBe("thread-new");
  });

  test("switchToBound keeps the previously bound session ready for reuse", () => {
    const route = switchToBound({
      routeMode: "independent",
      independentOnce: true,
      boundSessionId: "thread-bound",
    });

    expect(route.routeMode).toBe("bound");
    expect(route.independentOnce).toBe(false);
    expect(route.boundSessionId).toBe("thread-bound");
  });
});
