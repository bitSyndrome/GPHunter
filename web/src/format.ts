import { GHOST_TIER_LABELS, type GhostTier } from "@gph/shared";

export interface TierStyle {
  label: string;
  /** Text/accent color for the tier. */
  color: string;
  /** Dim the whole card (buried). */
  dim: boolean;
}

const TIER_COLORS: Record<GhostTier, string> = {
  fresh: "#7ee787", // alive green
  cooling: "#a8c7fa", // mystic blue (accent)
  ghost: "#c2e7ff", // ghost cyan
  buried: "#6b7076", // faded gray
};

export function tierStyle(tier: GhostTier): TierStyle {
  return {
    label: GHOST_TIER_LABELS[tier],
    color: TIER_COLORS[tier],
    dim: tier === "buried",
  };
}

export function relativeDays(days: number): string {
  if (days < 1) return "오늘";
  const d = Math.floor(days);
  if (d === 1) return "어제";
  if (d < 7) return `${d}일 전`;
  if (d < 30) return `${Math.floor(d / 7)}주 전`;
  if (d < 365) return `${Math.floor(d / 30)}개월 전`;
  return `${Math.floor(d / 365)}년 전`;
}
