import { withLock } from '../lock.js';
import { findActiveGoal, touchAndWrite } from '../state.js';

export function goalClear(repo: string, id: string): void {
  withLock(repo, () => {
    const goal = findActiveGoal(repo);
    if (!goal || goal.id !== id) throw new Error(`coco: no active goal '${id}'`);
    goal.state = 'cancelled';
    touchAndWrite(repo, goal, 'clear');
  });
}
