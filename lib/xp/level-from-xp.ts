const MAX_LEVEL = 100;

/**
 * Per-level XP cost to advance from `level` to `level + 1` (while level < MAX_LEVEL).
 * Slightly increasing curve; early levels feel quick on typical milestone totals.
 */
function xpCostToNextLevel(level: number): number {
  if (level < 1) return 60;
  return Math.min(5000, 55 + level * 12);
}

export type LevelProgress = {
  level: number;
  /** XP accumulated toward the next level (0 <= xpIntoLevel < xpToNext when not max). */
  xpIntoLevel: number;
  /** XP needed to complete the current level band; null at max level. */
  xpToNext: number | null;
};

/**
 * Map total lifetime XP to a level and progress within that level.
 */
export function levelProgressFromTotalXp(totalXpRaw: number): LevelProgress {
  const totalXp = Math.max(0, Math.floor(Number(totalXpRaw) || 0));
  let level = 1;
  let pool = totalXp;
  while (level < MAX_LEVEL) {
    const need = xpCostToNextLevel(level);
    if (pool < need) {
      return { level, xpIntoLevel: pool, xpToNext: need };
    }
    pool -= need;
    level++;
  }
  return { level: MAX_LEVEL, xpIntoLevel: pool, xpToNext: null };
}
