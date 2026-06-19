import type { CSSProperties } from "react";

/**
 * Google Material Symbols (Rounded) glyph. The font is loaded via the
 * stylesheet in index.html; the glyph is selected by ligature name.
 *
 * Size follows the surrounding text by default (see index.css); pass `size`
 * to override. `filled` swaps to the solid variant via the FILL axis.
 */
export function Icon({
  name,
  className = "",
  filled = false,
  weight,
  size,
  style,
}: {
  name: string;
  className?: string;
  filled?: boolean;
  weight?: number;
  size?: number;
  style?: CSSProperties;
}) {
  const settings = [
    `'FILL' ${filled ? 1 : 0}`,
    weight != null ? `'wght' ${weight}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <span
      aria-hidden="true"
      className={`material-symbols-rounded ${className}`}
      style={{
        fontVariationSettings: settings,
        fontSize: size,
        ...style,
      }}
    >
      {name}
    </span>
  );
}
