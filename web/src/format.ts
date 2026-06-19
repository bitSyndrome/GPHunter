import type { GhostTier } from "@gph/shared";

export interface TierStyle {
  /** Short, emoji-free label (icon carries the visual). */
  label: string;
  /** Material Symbols icon name for the tier. */
  icon: string;
  /** Text/accent color for the tier. */
  color: string;
  /** Dim the whole card (buried). */
  dim: boolean;
}

const TIER_META: Record<GhostTier, Omit<TierStyle, "dim">> = {
  fresh: { label: "생생함", icon: "local_fire_department", color: "#7ee787" },
  cooling: { label: "식는 중", icon: "ac_unit", color: "#a8c7fa" },
  ghost: { label: "유령화", icon: "blur_on", color: "#c2e7ff" },
  buried: { label: "무덤", icon: "block", color: "#6b7076" },
};

export function tierStyle(tier: GhostTier): TierStyle {
  return { ...TIER_META[tier], dim: tier === "buried" };
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
