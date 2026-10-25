# Unattended financial run — 2026-10-24

Attach: `ssh -t asus@172.20.13.192 'tmux attach -t ender-sft-demo'`.
Training and queued follow-up work run in `hour-train`; `live-gpu` shows utilization.

## Goal and current configuration

`DESIGN_SPEC.md` calls for ethical **and effective** tool decisions and comparisons
against base on matched scenarios. Lower training loss alone does not meet that goal.
Its 30–60-minute training estimate assumed an 8B model, not the selected Qwen3.8-27B.
The current dataset contains 4,770 supervised training rows and 561 validation rows.
This is unattended supervised fine-tuning, not unsupervised learning or self-labeling.

Native int8, upper-16 attention-only rank-16 LoRA, response-only loss, Liger and
stride-2 checkpointing remain selected. Retep consumes negated primary gradients
without another training forward/backward pass. It remains experimental.

## Scheduled work

1. `outputs/financial-hour-direct-20261024T225752Z` runs the requested hour.
2. `logs/finish-direct-hour.sh` evaluates that saved result.
3. Queued `logs/finish-unattended-epoch.sh` invokes `finish_financial_epoch.py`,
   restoring the final recovery checkpoint into a new `financial-epoch-resume-*`
   run and completing the **remaining portion of the same epoch**.
4. Full validation runs once on the loaded model after training. The matched loss
   canary and development response comparisons then run sequentially and save reports.

Primary optimizer, sister optimizer, scheduler, RNG and data position are restored.
The CPU Trainer integration test on Spark passed with **bit-identical primary and
sister parameters versus uninterrupted training**. Primary resume uses a root-file
checkpoint view: Transformers otherwise discovers the nested sister as another PEFT
adapter. Previous checkpoints are retained. No endless epoch loop or automatic claim
of a quality improvement is configured. Failures stop the stage and preserve logs.

The early concurrent evaluation was interrupted and its partial results retained:
sharing the GPU slowed inference substantially. Future evaluations are sequential.
At step 14, cumulative training throughput was approximately 452 input tokens/s;
the full 17.47M-token epoch remains roughly an 11-hour training workload at that rate.

## Access outside the LAN

Host: `gx10-b29c`; Unix user: `asus`. Tailscale was installed but reported
`NeedsLogin`, no Tailscale IP, and `RunSSH: false`. Passwordless sudo is unavailable.
The owner must run `sudo tailscale up` on Spark and complete the displayed login.
After that, obtain the address with `tailscale ip -4` and connect from another
authenticated tailnet device using `ssh asus@<tailscale-ip>`. Ordinary OpenSSH can
operate over Tailscale without enabling the separate Tailscale SSH feature.
MagicDNS hostname access depends on the tailnet configuration and was not verified.

## Remaining quality evidence

The eight inspected prompts are development checks, not an independent benchmark.
Spec-level proof still requires matched tool trajectories, violation rates and useful
task completion/reward against base. Training completion does not establish those.
