import { describe, it, expect } from 'vitest';
import { addToDate, parseNaturalDate, toIsoDate, toIsoDateTime } from '../src/ui/naturalDate';

// Mercredi 15 septembre 2027, 10 h
const NOW = new Date(2027, 8, 15, 10, 0);
const day = (text: string) => {
  const parsed = parseNaturalDate(text, NOW);
  return parsed ? toIsoDate(parsed.date) : null;
};

describe('Saisie libre des dates', () => {
  it('comprend les délais en français et en anglais', () => {
    expect(day('demain')).toBe('2027-09-16');
    expect(day('tomorrow')).toBe('2027-09-16');
    expect(day('dans 2 jours')).toBe('2027-09-17');
    expect(day('In 2 days')).toBe('2027-09-17');
    expect(day('+3 semaines')).toBe('2027-10-06');
    expect(day('dans un mois')).toBe('2027-10-15');
    expect(day('2 years')).toBe('2029-09-15');
    expect(day('3 days ago')).toBe('2027-09-12');
    expect(day('il y a 3 jours')).toBe('2027-09-12');
    expect(day('semaine prochaine')).toBe('2027-09-22');
    expect(day('next month')).toBe('2027-10-15');
  });

  it('comprend les jours de la semaine et les dates écrites', () => {
    expect(day('lundi')).toBe('2027-09-20');
    expect(day('wednesday')).toBe('2027-09-22');
    expect(day('15/03/2028')).toBe('2028-03-15');
    expect(day('01/02')).toBe('2028-02-01');
    expect(day('20/09')).toBe('2027-09-20');
    expect(day('2027-12-31')).toBe('2027-12-31');
    expect(day('31/02/2028')).toBeNull();
    expect(day('n’importe quoi')).toBeNull();
  });

  it('lit l’heure quand elle est donnée', () => {
    const parsed = parseNaturalDate('demain 9h30', NOW)!;
    expect(parsed.hasTime).toBe(true);
    expect(toIsoDateTime(parsed.date)).toBe('2027-09-16T09:30');
    expect(toIsoDateTime(parseNaturalDate('tomorrow 3pm', NOW)!.date)).toBe('2027-09-16T15:00');
    expect(parseNaturalDate('dans 2 jours', NOW)!.hasTime).toBe(false);
  });

  it('ajoute des mois sans déborder sur le mois suivant', () => {
    expect(toIsoDate(addToDate(new Date(2027, 0, 31), 1, 'month'))).toBe('2027-02-28');
    expect(toIsoDate(addToDate(new Date(2028, 1, 29), 1, 'year'))).toBe('2029-02-28');
  });
});
