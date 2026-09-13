import { Task, TaskRecurrence } from '../types/vault';

/**
 * Moteur de règles des tâches : matrice d'Eisenhower, récurrences,
 * dépendances et rappels. Fonctions pures, sans accès au store ni au DOM.
 */

export type EisenhowerQuadrant = 'do' | 'plan' | 'delegate' | 'eliminate';

export type NewTaskInput = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

export interface TaskCompletionPlan {
  /** Tâches encore ouvertes qui empêchent la complétion */
  blockers: Task[];
  updates: Partial<Task>;
  /** Prochaine occurrence à créer pour une tâche récurrente */
  nextOccurrence?: NewTaskInput;
  /** Tâches bloquées qui deviennent actionnables une fois celle-ci terminée */
  unblockedIds: string[];
}

const DAY_MS = 86_400_000;

/** Seuil (en jours) sous lequel une échéance rend la tâche « urgente » */
export const URGENCY_WINDOW_DAYS = 2;

export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function daysUntil(iso: string, now = new Date()): number {
  return Math.round((parseIsoDate(iso).getTime() - parseIsoDate(toIsoDate(now)).getTime()) / DAY_MS);
}

export function getEisenhowerQuadrant(task: Task, now = new Date()): EisenhowerQuadrant {
  const important = task.priority === 'high' || task.priority === 'urgent';
  const urgent = task.priority === 'urgent' || (!!task.dueDate && daysUntil(task.dueDate, now) <= URGENCY_WINDOW_DAYS);
  if (important && urgent) return 'do';
  if (important) return 'plan';
  if (urgent) return 'delegate';
  return 'eliminate';
}

/**
 * Calcule la prochaine échéance. Les récurrences mensuelles/annuelles
 * sont ramenées au dernier jour du mois (31 janv. → 28/29 févr.).
 * Retourne null si la date dépasse `until`.
 */
export function computeNextDueDate(dueDate: string, rule: TaskRecurrence): string | null {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const base = parseIsoDate(dueDate);
  let next: Date;

  switch (rule.freq) {
    case 'daily':
      next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + interval);
      break;
    case 'weekly':
      next = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 7 * interval);
      break;
    case 'monthly':
    case 'yearly': {
      const months = rule.freq === 'monthly' ? interval : 12 * interval;
      const target = new Date(base.getFullYear(), base.getMonth() + months, 1);
      const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      next = new Date(target.getFullYear(), target.getMonth(), Math.min(base.getDate(), lastDay));
      break;
    }
    default:
      return null;
  }

  const iso = toIsoDate(next);
  if (rule.until && iso > rule.until) return null;
  return iso;
}

export function getOpenBlockers(task: Task, tasks: Task[]): Task[] {
  return (task.dependsOn ?? [])
    .map(id => tasks.find(t => t.id === id))
    .filter((t): t is Task => !!t && t.status !== 'completed');
}

export function getDependents(taskId: string, tasks: Task[]): Task[] {
  return tasks.filter(t => t.dependsOn?.includes(taskId));
}

/** Vrai si faire dépendre `taskId` de `dependsOn` créerait un cycle */
export function wouldCreateDependencyCycle(tasks: Task[], taskId: string, dependsOn: string[]): boolean {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const stack = [...dependsOn];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(byId.get(id)?.dependsOn ?? []));
  }
  return false;
}

export function planTaskCompletion(task: Task, tasks: Task[], now = new Date()): TaskCompletionPlan {
  const blockers = getOpenBlockers(task, tasks);
  if (blockers.length > 0) {
    return { blockers, updates: {}, unblockedIds: [] };
  }

  const updates: Partial<Task> = { status: 'completed', completedAt: now.getTime() };
  let nextOccurrence: NewTaskInput | undefined;

  if (task.recurrence) {
    const baseDue = task.dueDate ?? toIsoDate(now);
    const nextDue = computeNextDueDate(baseDue, task.recurrence);
    // La récurrence passe à la nouvelle occurrence : rouvrir puis re-terminer ne la duplique pas
    updates.recurrence = undefined;
    if (nextDue) {
      const shift = parseIsoDate(nextDue).getTime() - parseIsoDate(baseDue).getTime();
      nextOccurrence = {
        vaultId: task.vaultId,
        title: task.title,
        description: task.description,
        status: 'todo',
        priority: task.priority,
        dueDate: nextDue,
        linkedCredentialId: task.linkedCredentialId,
        tags: [...task.tags],
        subtasks: task.subtasks?.map(s => ({ ...s, isDone: false })),
        notes: task.notes,
        recurrence: { ...task.recurrence },
        reminderAt: task.reminderAt !== undefined ? task.reminderAt + shift : undefined,
        reminderSent: false
      };
    }
  }

  const unblockedIds = tasks
    .filter(t => t.status === 'blocked' && t.dependsOn?.includes(task.id))
    .filter(t => getOpenBlockers(t, tasks).every(b => b.id === task.id))
    .map(t => t.id);

  return { blockers: [], updates, nextOccurrence, unblockedIds };
}

export function getDueReminders(tasks: Task[], now = Date.now()): Task[] {
  return tasks.filter(t =>
    t.reminderAt !== undefined && t.reminderAt <= now && !t.reminderSent && t.status !== 'completed'
  );
}

export function describeRecurrence(rule: TaskRecurrence, locale: 'fr' | 'en'): string {
  const n = Math.max(1, Math.floor(rule.interval || 1));
  let text: string;
  if (locale === 'fr') {
    const single = { daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois', yearly: 'Chaque année' };
    const plural = { daily: `Tous les ${n} jours`, weekly: `Toutes les ${n} semaines`, monthly: `Tous les ${n} mois`, yearly: `Tous les ${n} ans` };
    text = n === 1 ? single[rule.freq] : plural[rule.freq];
    if (rule.until) text += ` jusqu'au ${rule.until}`;
  } else {
    const unit = { daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' }[rule.freq];
    text = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
    if (rule.until) text += ` until ${rule.until}`;
  }
  return text;
}
