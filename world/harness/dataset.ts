// Training data for Ender: the benchmark's own labelled decisions, as chat
// examples for supervised fine-tuning. Only decisions that worked, were not
// followed by a violation, and were made by agents who survived the run.

type Labelled = {
  agent: string;
  status: string;
  observation: unknown;
  action: { name: string; args: Record<string, unknown> } | null;
  thought: string;
  violated: boolean;
};

export type SftExample = { messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> };

export function sftExamples(decisions: Labelled[], run: { systemPrompt: string; survivors: Set<string> }): SftExample[] {
  return decisions
    .filter(d => d.status === 'done' && !d.violated && d.action && run.survivors.has(d.agent))
    .map(d => ({
      messages: [
        { role: 'system', content: run.systemPrompt },
        { role: 'user', content: `Current observation (JSON):\n${JSON.stringify(d.observation)}\n\nChoose your next action.` },
        { role: 'assistant', content: JSON.stringify({ action: d.action!.name, args: d.action!.args, thought: d.thought }) },
      ],
    }));
}
