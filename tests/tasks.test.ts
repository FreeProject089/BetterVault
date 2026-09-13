import { describe, it, expect } from 'vitest';
import {
  computeNextDueDate,
  describeRecurrence,
  getDueReminders,
  getEisenhowerQuadrant,
  planTaskCompletion,
  wouldCreateDependencyCycle
} from '../src/tasks/taskEngine';
import { Task } from '../src/types/vault';

const baseTask = (overrides: Partial<Task>): Task => ({
  id: 't',
  vaultId: 'v1',
  title: 'Tâche',
  status: 'todo',
  priority: 'medium',
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...overrides
});

describe('Task Engine (Eisenhower, récurrences, dépendances, rappels)', () => {
  const now = new Date(2026, 8, 13); // 13 sept. 2026

  it('classe les tâches dans les quadrants d’Eisenhower', () => {
    expect(getEisenhowerQuadrant(baseTask({ priority: 'urgent' }), now)).toBe('do');
    expect(getEisenhowerQuadrant(baseTask({ priority: 'high', dueDate: '2026-09-14' }), now)).toBe('do');
    expect(getEisenhowerQuadrant(baseTask({ priority: 'high', dueDate: '2026-10-30' }), now)).toBe('plan');
    expect(getEisenhowerQuadrant(baseTask({ priority: 'low', dueDate: '2026-09-10' }), now)).toBe('delegate');
    expect(getEisenhowerQuadrant(baseTask({ priority: 'low' }), now)).toBe('eliminate');
  });

  it('calcule les prochaines échéances avec ajustement de fin de mois', () => {
    expect(computeNextDueDate('2026-09-13', { freq: 'daily', interval: 3 })).toBe('2026-09-16');
    expect(computeNextDueDate('2026-09-13', { freq: 'weekly', interval: 2 })).toBe('2026-09-27');
    expect(computeNextDueDate('2026-01-31', { freq: 'monthly', interval: 1 })).toBe('2026-02-28');
    expect(computeNextDueDate('2028-02-29', { freq: 'yearly', interval: 1 })).toBe('2029-02-28');
    expect(computeNextDueDate('2026-12-30', { freq: 'daily', interval: 5 })).toBe('2027-01-04');
    expect(computeNextDueDate('2026-09-13', { freq: 'weekly', interval: 1, until: '2026-09-15' })).toBeNull();
  });

  it('refuse de terminer une tâche dont les dépendances sont ouvertes', () => {
    const dep = baseTask({ id: 'dep', title: 'Prérequis' });
    const task = baseTask({ id: 'main', dependsOn: ['dep'] });
    const plan = planTaskCompletion(task, [dep, task], now);
    expect(plan.blockers.map(b => b.id)).toEqual(['dep']);
    expect(plan.updates).toEqual({});
  });

  it('génère la prochaine occurrence et décale le rappel', () => {
    const reminderAt = new Date(2026, 8, 13, 9, 0).getTime();
    const task = baseTask({
      id: 'rec',
      dueDate: '2026-09-13',
      recurrence: { freq: 'monthly', interval: 1 },
      reminderAt,
      reminderSent: true,
      subtasks: [{ id: 's1', title: 'Étape', isDone: true }]
    });
    const plan = planTaskCompletion(task, [task], now);
    expect(plan.updates.status).toBe('completed');
    expect(plan.updates.recurrence).toBeUndefined();
    expect(plan.nextOccurrence?.dueDate).toBe('2026-10-13');
    expect(plan.nextOccurrence?.status).toBe('todo');
    expect(plan.nextOccurrence?.reminderSent).toBe(false);
    expect(plan.nextOccurrence?.reminderAt).toBe(new Date(2026, 9, 13, 9, 0).getTime());
    expect(plan.nextOccurrence?.subtasks?.[0].isDone).toBe(false);
  });

  it('débloque les tâches dépendantes dont c’était le dernier prérequis', () => {
    const a = baseTask({ id: 'a' });
    const b = baseTask({ id: 'b', status: 'completed' });
    const blocked = baseTask({ id: 'c', status: 'blocked', dependsOn: ['a', 'b'] });
    const stillBlocked = baseTask({ id: 'd', status: 'blocked', dependsOn: ['a', 'x'] });
    const x = baseTask({ id: 'x' });
    const plan = planTaskCompletion(a, [a, b, blocked, stillBlocked, x], now);
    expect(plan.unblockedIds).toEqual(['c']);
  });

  it('détecte les cycles de dépendances', () => {
    const tasks = [
      baseTask({ id: 'a', dependsOn: ['b'] }),
      baseTask({ id: 'b', dependsOn: ['c'] }),
      baseTask({ id: 'c' })
    ];
    expect(wouldCreateDependencyCycle(tasks, 'c', ['a'])).toBe(true);
    expect(wouldCreateDependencyCycle(tasks, 'c', ['c'])).toBe(true);
    expect(wouldCreateDependencyCycle(tasks, 'a', ['c'])).toBe(false);
  });

  it('retourne les rappels échus non envoyés', () => {
    const tasks = [
      baseTask({ id: 'due', reminderAt: 1000 }),
      baseTask({ id: 'sent', reminderAt: 1000, reminderSent: true }),
      baseTask({ id: 'future', reminderAt: 5000 }),
      baseTask({ id: 'done', reminderAt: 1000, status: 'completed' })
    ];
    expect(getDueReminders(tasks, 2000).map(t => t.id)).toEqual(['due']);
  });

  it('décrit les récurrences en français et en anglais', () => {
    expect(describeRecurrence({ freq: 'weekly', interval: 2 }, 'fr')).toBe('Toutes les 2 semaines');
    expect(describeRecurrence({ freq: 'monthly', interval: 1, until: '2027-01-01' }, 'fr')).toBe("Chaque mois jusqu'au 2027-01-01");
    expect(describeRecurrence({ freq: 'daily', interval: 3 }, 'en')).toBe('Every 3 days');
  });
});
