"""Graceful wall-time budget, checked only at completed optimizer boundaries."""

import math
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path


def budget_state(elapsed, seconds):
    if not math.isfinite(seconds) or seconds <= 0 or not math.isfinite(elapsed) or elapsed < 0:
        raise ValueError("Expected a positive finite budget and nonnegative elapsed time")
    return {"training_elapsed_seconds": elapsed, "budget_seconds": seconds,
            "remaining_seconds": max(0., seconds-elapsed), "budget_reached": elapsed >= seconds}


def deadline_callback(seconds):
    from transformers import TrainerCallback
    from run_sft_demo import write_json
    budget_state(0., seconds)

    class Deadline(TrainerCallback):
        def on_train_begin(self, args, state, control, **kwargs):
            self.started = time.perf_counter()
            self.started_utc = datetime.now(timezone.utc)
            self.output = Path(args.output_dir).parent / "deadline-progress.json"
            self.update(state)
            print(f"[training budget] {seconds:.0f} seconds from training start; "
                  "stop/save at the first completed optimizer boundary after the deadline.", flush=True)

        def update(self, state, finished=False):
            status = budget_state(time.perf_counter()-self.started, seconds)
            status.update(optimizer_steps=state.global_step, finished=finished,
                          training_started_at=self.started_utc.isoformat(),
                          target_deadline=(self.started_utc+timedelta(seconds=seconds)).isoformat(),
                          updated_at=datetime.now(timezone.utc).isoformat())
            write_json(self.output, status)
            return status

        def on_step_end(self, args, state, control, **kwargs):
            status = self.update(state)
            if state.global_step == 1:
                control.should_save = True
            if status["budget_reached"]:
                control.should_training_stop = True
                control.should_save = True
                print("[training budget] Deadline reached; saving both adapters and optimizer checkpoint.", flush=True)
            return control

        def on_train_end(self, args, state, control, **kwargs):
            self.update(state, finished=True)

    return Deadline()
