import { useRef } from 'react';
import type { World } from '../module_bindings/types';
import { gameTime } from './contract';

export type ReadGameTime = () => number;
export function useGameClock(world: World, connected: boolean): ReadGameTime {
  const snapshot = useRef({ world, receivedAt: performance.now(), connected });
  if (snapshot.current.world.gameTimeMs !== world.gameTimeMs || snapshot.current.world.running !== world.running || snapshot.current.world.timeScale !== world.timeScale || snapshot.current.connected !== connected) {
    snapshot.current = { world, receivedAt: performance.now(), connected };
  }
  const read = useRef(() => gameTime(snapshot.current.world, snapshot.current.receivedAt, performance.now(), snapshot.current.connected));
  return read.current;
}
