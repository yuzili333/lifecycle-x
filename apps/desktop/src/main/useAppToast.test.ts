import { describe, expect, it, vi } from "vitest";
import { promoteToastViewportAboveDialogs } from "../renderer/src/useAppToast";

describe("app toast layering", () => {
  it("re-promotes the shared toast viewport above an open dialog", () => {
    const viewport = {
      hidePopover: vi.fn(),
      showPopover: vi.fn(),
    };
    const root = {
      querySelector: vi.fn(() => viewport),
    };

    promoteToastViewportAboveDialogs(root as unknown as ParentNode);

    expect(root.querySelector).toHaveBeenCalledWith(
      '[role="region"][aria-label="Notifications"][popover="manual"]',
    );
    expect(viewport.hidePopover).toHaveBeenCalledOnce();
    expect(viewport.showPopover).toHaveBeenCalledOnce();
    expect(viewport.hidePopover.mock.invocationCallOrder[0]).toBeLessThan(
      viewport.showPopover.mock.invocationCallOrder[0],
    );
  });

  it("does not interrupt toast delivery when the viewport is unavailable", () => {
    const root = {
      querySelector: vi.fn(() => null),
    };

    expect(() => promoteToastViewportAboveDialogs(root as unknown as ParentNode)).not.toThrow();
  });
});
