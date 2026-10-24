# Transcript — Fine Tuning on NVIDIA DGX Spark

Source: https://www.youtube.com/watch?v=RD55BQlygUk
Captions: English (auto-generated)

| Time | Transcript |
|------|------------|
| 0:04 | In this video, we're showing DGX Spark finetuning in action. We've prefilled the Llama factory interface |
| 0:11 | with everything we need to fine-tune the Llama 3.18 billion instruct model on the alpaca data set. |
| 0:22 | Our plan is a full fine-tuning run with torch sdpa, a batch size of 8, and a sequence length of 1,000 tokens. |
| 0:35 | We're also enabling mixed precision training and torch compile to help the workload run more efficiently. |
| 0:45 | With everything set, we hit the start button. The pipeline spins up, pulling the model, the data set, and initializing the training loop. |
| 0:54 | As training begins, we monitor the loss curve to confirm stability. The logs show each step completing as |
| 1:01 | expected with no interruptions. The fine-tuning job has |
| 1:11 | finished, and we're averaging about 2.2 samples a second. The model has converged over the epoch and we've observed consistent training throughout |
| 1:20 | the run. That was a quick look at fine-tuning on DGX Spark. If you're excited to explore everything DGX Spark has to offer, visit nvidia.com. |

## Full plain text

In this video, we're showing DGX Spark finetuning in action. We've prefilled the Llama factory interface with everything we need to fine-tune the Llama 3.18 billion instruct model on the alpaca data set. Our plan is a full fine-tuning run with torch sdpa, a batch size of 8, and a sequence length of 1,000 tokens. We're also enabling mixed precision training and torch compile to help the workload run more efficiently. With everything set, we hit the start button. The pipeline spins up, pulling the model, the data set, and initializing the training loop. As training begins, we monitor the loss curve to confirm stability. The logs show each step completing as expected with no interruptions. The fine-tuning job has finished, and we're averaging about 2.2 samples a second. The model has converged over the epoch and we've observed consistent training throughout the run. That was a quick look at fine-tuning on DGX Spark. If you're excited to explore everything DGX Spark has to offer, visit nvidia.com.
