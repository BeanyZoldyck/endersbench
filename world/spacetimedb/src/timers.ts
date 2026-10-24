import { ScheduleAt } from 'spacetimedb';
import type { Ctx } from './ctx';

const TICK_MICROS = 50_000n;
const BRAIN_MICROS = 250_000n;

export function startTimers(ctx: Ctx) {
  if (ctx.db.tickTimer.count() === 0n) {
    ctx.db.tickTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(TICK_MICROS) });
  }
  if (ctx.db.brainTimer.count() === 0n) {
    ctx.db.brainTimer.insert({ scheduledId: 0n, scheduledAt: ScheduleAt.interval(BRAIN_MICROS) });
  }
}

// With no timers the world stops entirely and spends no Maincloud energy.
export function stopTimers(ctx: Ctx) {
  for (const timer of [...ctx.db.tickTimer.iter()]) ctx.db.tickTimer.scheduledId.delete(timer.scheduledId);
  for (const timer of [...ctx.db.brainTimer.iter()]) ctx.db.brainTimer.scheduledId.delete(timer.scheduledId);
}
