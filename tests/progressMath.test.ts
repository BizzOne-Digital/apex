import { describe, it, expect } from 'vitest';
import {
  cardioMet, kcalFor, summarizeDay, lastDays, currentStreak, localDate, MET_STRENGTH,
  type ProgressEntry,
} from '../../mobile/src/services/progressMath';

const entry = (date: string, over: Partial<ProgressEntry> = {}): ProgressEntry => ({
  id: Math.random().toString(36), date, at: 0, kind: 'strength', key: 'k' + Math.random(), name: 'x', minutes: 3, kcal: 20, ...over,
});

const daysAgo = (n: number) => {
  const now = new Date();
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
};

describe('calorie maths', () => {
  it('uses weight x MET x hours', () => {
    expect(kcalFor(5, 70, 60)).toBe(350);
    expect(kcalFor(MET_STRENGTH, 80, 3)).toBe(20);
  });
  it('treadmill MET grows with speed and stays in a sane range', () => {
    const walk = cardioMet('treadmill', 5);
    const jog = cardioMet('treadmill', 8);
    const run = cardioMet('treadmill', 12);
    expect(walk).toBeLessThan(jog);
    expect(jog).toBeLessThan(run);
    expect(walk).toBeGreaterThan(3);
    expect(run).toBeLessThan(15);
  });
  it('bike, elliptical and heart-rate fallbacks are sane', () => {
    expect(cardioMet('bike', 20)).toBeGreaterThan(cardioMet('bike', 12));
    expect(cardioMet('elliptical')).toBe(5);
    expect(cardioMet('treadmill', undefined, 150)).toBeGreaterThan(cardioMet('treadmill', undefined, 100));
    expect(cardioMet('treadmill')).toBe(6);
  });
  it('a 30 minute 6.5 km/h session at 68 kg is about 180 kcal', () => {
    const k = kcalFor(cardioMet('treadmill', 6.5), 68, 30);
    expect(k).toBeGreaterThan(150);
    expect(k).toBeLessThan(210);
  });
});

describe('day summaries and streaks', () => {
  it('sums a day and averages heart rate / speed only over logged values', () => {
    const d = '2026-10-28';
    const s = summarizeDay(
      [
        entry(d, { kcal: 100, minutes: 30, kind: 'cardio', avgHr: 130, speedKmh: 6, distanceKm: 3 }),
        entry(d, { kcal: 150, minutes: 30, kind: 'cardio', avgHr: 150, speedKmh: 8, distanceKm: 4 }),
        entry(d, { kcal: 20, minutes: 3 }),
        entry('2026-10-27', { kcal: 999 }),
      ],
      d
    );
    expect(s).toMatchObject({ exercises: 3, kcal: 270, minutes: 63, distanceKm: 7, avgHr: 140, avgSpeed: 7, maxSpeed: 8 });
    expect(summarizeDay([], d)).toMatchObject({ exercises: 0, kcal: 0, avgHr: null, avgSpeed: null, maxSpeed: null });
  });
  it('lastDays returns n consecutive days ending today', () => {
    const days = lastDays([entry(localDate(), { kcal: 50 })], 7);
    expect(days).toHaveLength(7);
    expect(days[6].date).toBe(localDate());
    expect(days[6].kcal).toBe(50);
    expect(days[0].kcal).toBe(0);
  });
  it('streak counts back from today, or from yesterday when today is empty', () => {
    expect(currentStreak([])).toBe(0);
    expect(currentStreak([entry(daysAgo(0)), entry(daysAgo(1)), entry(daysAgo(2))])).toBe(3);
    expect(currentStreak([entry(daysAgo(1)), entry(daysAgo(2))])).toBe(2);
    expect(currentStreak([entry(daysAgo(0)), entry(daysAgo(2))])).toBe(1);
    expect(currentStreak([entry(daysAgo(3))])).toBe(0);
  });
});
