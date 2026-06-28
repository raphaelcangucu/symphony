import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useExecutionShortcuts } from "@/hooks/useExecutionShortcuts";

function press(
  target: EventTarget,
  init: KeyboardEventInit,
): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
}

describe("useExecutionShortcuts", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("dispatches the matched handler on a global combo", () => {
    const onStop = vi.fn();
    renderHook(() => useExecutionShortcuts({ onStop }));

    press(document.body, { key: ".", ctrlKey: true });

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("ignores combos with no handler", () => {
    const onResume = vi.fn();
    renderHook(() => useExecutionShortcuts({ onResume }));

    press(document.body, { key: "r", metaKey: true, shiftKey: true });

    expect(onResume).not.toHaveBeenCalled();
  });

  it("allows resume (mod+enter) while typing in a textarea", () => {
    const onResume = vi.fn();
    renderHook(() => useExecutionShortcuts({ onResume }));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    press(textarea, { key: "Enter", metaKey: true });

    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("blocks destructive restart while typing in a textarea", () => {
    const onRestart = vi.fn();
    renderHook(() => useExecutionShortcuts({ onRestart }));

    const textarea = document.createElement("textarea");
    document.body.appendChild(textarea);
    press(textarea, { key: "r", metaKey: true, shiftKey: true });

    expect(onRestart).not.toHaveBeenCalled();
  });

  it("respects the enabled flag", () => {
    const onStop = vi.fn();
    renderHook(() => useExecutionShortcuts({ onStop, enabled: false }));

    press(document.body, { key: ".", ctrlKey: true });

    expect(onStop).not.toHaveBeenCalled();
  });
});
