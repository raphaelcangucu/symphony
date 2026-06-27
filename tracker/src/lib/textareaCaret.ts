export interface TextareaCaretRect {
  top: number;
  left: number;
  height: number;
}

const MIRROR_STYLE_PROPS = [
  "direction",
  "boxSizing",
  "width",
  "height",
  "overflowX",
  "overflowY",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "fontStyle",
  "fontVariant",
  "fontWeight",
  "fontStretch",
  "fontSize",
  "fontSizeAdjust",
  "lineHeight",
  "fontFamily",
  "textAlign",
  "textTransform",
  "textIndent",
  "textDecoration",
  "letterSpacing",
  "wordSpacing",
  "tabSize",
] as const;

function copyMirrorStyles(source: CSSStyleDeclaration, target: CSSStyleDeclaration): void {
  for (const prop of MIRROR_STYLE_PROPS) {
    target[prop] = source[prop];
  }
}

export function getTextareaCaretRect(
  textarea: HTMLTextAreaElement,
  caretIndex: number,
): TextareaCaretRect | null {
  if (typeof document === "undefined") return null;

  const safeIndex = Math.max(0, Math.min(caretIndex, textarea.value.length));
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  document.body.appendChild(mirror);

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  copyMirrorStyles(style, mirror.style);

  const textBefore = textarea.value.slice(0, safeIndex);
  mirror.textContent = textBefore;

  const marker = document.createElement("span");
  marker.textContent = textarea.value.slice(safeIndex) || ".";
  mirror.appendChild(marker);

  const textareaRect = textarea.getBoundingClientRect();
  const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const paddingTop = Number.parseFloat(style.paddingTop) || 0;
  const paddingLeft = Number.parseFloat(style.paddingLeft) || 0;

  const rect: TextareaCaretRect = {
    top: textareaRect.top + borderTop + paddingTop + marker.offsetTop - textarea.scrollTop,
    left: textareaRect.left + borderLeft + paddingLeft + marker.offsetLeft - textarea.scrollLeft,
    height: marker.offsetHeight || Number.parseFloat(style.lineHeight) || 16,
  };

  document.body.removeChild(mirror);
  return rect;
}
