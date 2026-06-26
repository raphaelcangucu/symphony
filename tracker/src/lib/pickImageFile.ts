const CANCEL_FALLBACK_MS = 500;

/**
 * Opens the native file picker for a single image and resolves with the chosen
 * `File`, or `null` when the user cancels.
 *
 * The input element is created off-DOM and removed once settled so repeated
 * calls never leak nodes. Cancellation is detected via the modern `cancel`
 * event with a window-focus fallback for browsers that do not emit it.
 */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.style.height = "0";
    input.style.width = "0";
    input.tabIndex = -1;

    let settled = false;

    const cleanup = () => {
      input.removeEventListener("change", onChange);
      input.removeEventListener("cancel", onCancel);
      window.removeEventListener("focus", onFocus, true);
      input.remove();
    };

    const settle = (file: File | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(file);
    };

    const onChange = () => settle(input.files?.[0] ?? null);
    const onCancel = () => settle(null);
    const onFocus = () => {
      // The change event fires slightly after focus returns, so defer the
      // cancellation check long enough to let a real selection win.
      window.setTimeout(() => {
        if (!input.files || input.files.length === 0) settle(null);
      }, CANCEL_FALLBACK_MS);
    };

    input.addEventListener("change", onChange);
    input.addEventListener("cancel", onCancel);
    window.addEventListener("focus", onFocus, true);

    document.body.appendChild(input);
    input.click();
  });
}
