/**
 * Reshaping a trend series before it is drawn. Pure and import-free, so
 * `trend-series.test.ts` runs it under `node --test`.
 */

export type TrendPoint = { bucket: string; value: number };

/**
 * Month buckets folded into one point per year, each that year's average per
 * month. Averaged over the months the series covers, which run from the first
 * month with history, so a year only half lived in compares fairly with a
 * full one. Buckets are `YYYY-MM-DD`; the year comes back as `YYYY`.
 */
export function averagePerMonthByYear(points: readonly TrendPoint[]): {
    years: TrendPoint[];
    /** The average per month over the whole series. */
    overall: number;
} {
    const byYear = new Map<string, { sum: number; months: number }>();
    for (const point of points) {
        const year = point.bucket.slice(0, 4);
        const entry = byYear.get(year) ?? { sum: 0, months: 0 };
        entry.sum += point.value;
        entry.months += 1;
        byYear.set(year, entry);
    }
    const total = points.reduce((sum, point) => sum + point.value, 0);
    return {
        years: [...byYear].map(([year, { sum, months }]) => ({
            bucket: year,
            value: sum / months,
        })),
        overall: points.length > 0 ? total / points.length : 0,
    };
}
