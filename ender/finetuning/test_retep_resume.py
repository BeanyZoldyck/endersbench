"""Check actual Trainer interruption/resume against uninterrupted paired training."""
import importlib.util
import os
import tempfile
import unittest
from pathlib import Path


@unittest.skipUnless(importlib.util.find_spec("peft"), "requires training dependencies")
class ResumeIntegrationTest(unittest.TestCase):
    def test_trainer_resume_matches_uninterrupted_primary_and_sister(self):
        import torch
        from peft import get_peft_model, LoraConfig
        from safetensors.torch import load_file
        from transformers import GPT2Config, GPT2LMHeadModel, Trainer, TrainerCallback, TrainingArguments
        from retep_shadow import retep_callback
        torch.set_num_threads(2)

        def model():
            torch.manual_seed(42)
            return get_peft_model(GPT2LMHeadModel(GPT2Config(vocab_size=16, n_positions=8,
                n_embd=8, n_layer=1, n_head=1, resid_pdrop=0., embd_pdrop=0., attn_pdrop=0.)),
                LoraConfig(r=2, lora_alpha=4, target_modules=["c_attn"]))

        data = [{"input_ids": torch.tensor([1, 2, i % 8 + 3, 4]),
                 "labels": torch.tensor([1, 2, i % 8 + 3, 4])} for i in range(16)]

        class StopAtTwo(TrainerCallback):
            def on_step_end(self, args, state, control, **kwargs):
                if state.global_step == 2:
                    control.should_training_stop = True
                    control.should_save = True
                return control

        def train(output, resume=None, stop=False):
            sister_path = resume/"retep" if resume else None
            if resume:
                view = output/"primary-resume"
                view.mkdir(parents=True)
                for path in resume.iterdir():
                    if path.is_file():
                        os.link(path, view/path.name)
                resume = view
            callbacks = [retep_callback(initial_adapter=sister_path, resume_checkpoint=resume)]
            if stop:
                callbacks.append(StopAtTwo())
            args = TrainingArguments(output_dir=str(output), use_cpu=True, max_steps=4,
                per_device_train_batch_size=2, learning_rate=.001, optim="adamw_torch",
                save_steps=2, report_to="none", disable_tqdm=True, seed=42)
            trainer = Trainer(model=model(), args=args, train_dataset=data, callbacks=callbacks)
            trainer.train(resume_from_checkpoint=str(resume) if resume else None)
            return trainer.model

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = train(root/"reference")
            train(root/"interrupted", stop=True)
            resumed = train(root/"resumed", resume=root/"interrupted/checkpoint-2")
            for name, value in reference.named_parameters():
                torch.testing.assert_close(value, dict(resumed.named_parameters())[name], rtol=0, atol=0)
            one = load_file(root/"reference/retep/adapter_model.safetensors")
            two = load_file(root/"resumed/retep/adapter_model.safetensors")
            for name in one:
                torch.testing.assert_close(one[name], two[name], rtol=0, atol=0)


if __name__ == "__main__":
    unittest.main()
