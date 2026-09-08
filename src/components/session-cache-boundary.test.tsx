import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionCacheBoundary } from "./session-cache-boundary";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), unsubscribe: vi.fn(), subscribe: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { onAuthStateChange: mocks.subscribe } }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("private navigation cache", () => {
  it("invalidates on account switches and sign-out, but retains pages on token refresh", () => {
    let notify: (event: string, session: { user: { id: string } } | null) => void;
    mocks.subscribe.mockImplementation(callback => {
      notify = callback;
      return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
    });
    const { unmount } = render(<SessionCacheBoundary />);
    act(() => notify("INITIAL_SESSION", { user: { id: "owner-a" } }));
    act(() => notify("TOKEN_REFRESHED", { user: { id: "owner-a" } }));
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => notify("SIGNED_IN", { user: { id: "owner-b" } }));
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() => notify("SIGNED_OUT", null));
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });
});
