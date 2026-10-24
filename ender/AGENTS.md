# ender — Agent Notes

## DGX Spark over SSH: always use an attachable tmux session

The Spark is reached with `ssh asus@172.20.13.192` (see `finetuning/README.md`).

**Rule:** any task run on the DGX Spark over SSH must run inside a named tmux session, so I can attach and visually watch the progress of whatever the Spark is running.

- Create a named session and run the task inside it:

  ```bash
  ssh asus@172.20.13.192 'tmux new-session -d -s endersbench && tmux send-keys -t endersbench "<command>" Enter'
  ```

- Always tell me the session name so I can watch it myself:

  ```bash
  ssh asus@172.20.13.192 'tmux attach -t endersbench'
  ```

- Do not run long-running work (training, downloads, llama.cpp builds, servers) in a bare non-interactive SSH command or backgrounded with `nohup` where I cannot see its output.
- Do not kill or detach a running session without saying so; detach politely if you attached (`Ctrl+B`, then `D`).
- Reuse an existing session with `tmux send-keys` instead of spawning a duplicate one for the same task.
