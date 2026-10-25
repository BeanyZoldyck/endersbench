Yes. Conveniently, people have now **measured Fireship’s format rather than just describing the vibe**.

A July 2026 analysis measured three longer Fireship videos at **11.8–15.4 hard cuts/minute, 13.3 average, ~3-second median shot length**, with roughly 35% meme/stock inserts, 25% diagrams, 18% code/terminal footage, and effectively no talking-head footage. [PandaStudio](https://www.writepanda.ai/blog/fireship-editing-style-measured/?utm_source=chatgpt.com)

Even more useful for what you want: the `open-edits` project literally reverse-engineered a Fireship Code Report shot-by-shot and turned the measurements into an **agent skill + rendering engine**. Their measured example had a ~2.2-second median shot, visual changes every ~1–1.5 seconds, and narration around **213 WPM**. [GitHub](https://github.com/kevinbadi/open-edits/blob/main/skills/reverse-engineer/SKILL.md?utm_source=chatgpt.com)

So I would **not build the formula from scratch**.

### The pipeline I'd use

```text
TOPIC / RESEARCH
       ↓
┌──────────────────────┐
│ 1. RESEARCH AGENT    │
│ facts + sources      │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ 2. SCRIPT AGENT      │
│ 180–220 WPM          │
│ dense technical VO   │
│ jokes/pattern breaks │
└──────────┬───────────┘
           ↓
      ElevenLabs
           ↓
       voice.wav
           ↓
 Whisper / word timestamps
           ↓
┌──────────────────────┐
│ 3. DIRECTOR AGENT    │
│ VO → shot list       │
│ every ~1–4 sec       │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ 4. ASSET AGENT       │
│ screenshots          │
│ source documents     │
│ logos / code         │
│ memes / footage      │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ 5. VIDEO RENDERER    │
│ Remotion / ffmpeg    │
└──────────┬───────────┘
           ↓
┌──────────────────────┐
│ 6. QA AGENT          │
│ static >1.5 sec?     │
│ wrong visual?        │
│ dead air?            │
│ source mismatch?     │
└──────────────────────┘
           ↓
         MP4
```

The important insight is that **you shouldn't have the LLM directly "make a video."** Have it produce a deterministic intermediate representation, essentially an edit decision list.

For example:

```json
{
  "start": 17.42,
  "end": 19.85,
  "voiceover": "Rust solves this with the borrow checker.",
  "visual": {
    "type": "code",
    "source": "examples/borrow.rs",
    "highlight": "let y = &x;",
    "motion": "slow_push"
  },
  "overlays": [
    {
      "type": "sticker",
      "text": "BORROWED",
      "at": 18.31
    }
  ],
  "transition": "hard_cut"
}
```

Then Remotion/Python/FFmpeg just obeys the JSON. **That separation is what makes this automatable.**

The public `open-edits` implementation does almost exactly this: transcript → word timings → shot list → asset retrieval → composed shots. Their documentation explicitly recommends a shot table of **timestamp | exact VO | literal screen content | source**, and their renderer contains reusable primitives for diagrams, highlighted documents, stickers, tweet-style cards, cutouts, headlines, and meme inserts. [Skills](https://www.skills.sh/kevinbadi/open-edits/fireship-style-edit?utm_source=chatgpt.com)

[Open-edits Fireship reverse-engineering repo](https://github.com/kevinbadi/open-edits?utm_source=chatgpt.com)

There's also another open-source project with a ready-made **Fireship Explainer** specification. It independently converges on 2–5 second visual segments, mostly hard cuts, alternating explanatory and visual-punch segments, zero dead air, and avoiding static frames over ~5 seconds. [GitHub](https://github.com/video-db/agentic-streams/blob/main/content-creator/reference/formats/fireship-explainer.md?utm_source=chatgpt.com)

[Agentic Streams Fireship explainer specification](https://github.com/video-db/agentic-streams/blob/main/content-creator/reference/formats/fireship-explainer.md?utm_source=chatgpt.com)

### What I'd actually give your agent

I wouldn't tell it `"write like Fireship"` every time. Encode the underlying grammar as your own house format:

You are the director and writer of a fast, faceless technical explainer channel.

The objective is maximum useful information per second while remaining understandable.

NARRATION

Target approximately 190–215 spoken words per minute.

Write for speech, not prose.

Assume the viewer is technically literate but does not already understand the subject.

Prefer concrete statements, names, numbers, examples, APIs, code, and mechanisms over generic descriptions.

Remove introductory filler. The first sentence must already contain an interesting fact, claim, conflict, problem, or absurd observation.

Explanations should normally follow:

CLAIM → MECHANISM → EXAMPLE → CONSEQUENCE

Compress explanations aggressively, but never remove information required to understand the next statement.

Use humor as a pattern interrupt. Humor should usually arrive after a technically accurate statement rather than replacing one.

Do not imitate another creator's catchphrases, recurring jokes, branding, characters, or sign-off.

STRUCTURE

Open immediately with the strongest fact or premise.

Within approximately 20–35 seconds, establish:
1. what happened or what the technology is,
2. why the viewer should care,
3. what question the video will answer.

For longer videos, divide the subject into clearly distinct conceptual sections.

When explaining a system, dedicate one sequence to showing the mechanism visually rather than merely describing it.

Continue useful content until immediately before the ending. Do not create a long outro.

PACING

Treat every independent clause as a potential visual beat.

Typical shot duration: 2–5 seconds.

Allow longer shots only when something meaningful changes within the shot, such as:
- code executing,
- a diagram building,
- a document being highlighted,
- a UI interaction,
- an animation explaining a mechanism.

Prefer hard cuts.

Avoid two consecutive shots with substantially identical composition.

Do not leave the screen visually unchanged for more than approximately 1.5–3 seconds unless the viewer is actively following meaningful content.

VISUAL SELECTION

Every visual must represent, prove, demonstrate, or humorously react to the narration occurring at that moment.

Prefer literal visuals in this order:

1. the actual product/person/event being discussed
2. actual source documents or articles
3. actual UI or code
4. explanatory diagrams
5. charts/data
6. metaphorical imagery
7. memes/reaction shots

Never substitute unrelated generic stock footage when a literal visual is available.

Use memes as punctuation, not as the primary explanation.

ON-SCREEN TEXT

Do not subtitle the entire narration.

Use text selectively for:
- names
- dates
- prices
- numbers
- API names
- commands
- important technical terms
- short punchlines

Keep text short enough to understand almost instantly.

SHOT PLANNING

After the narration is finalized and word-level timestamps are available, produce a shot plan.

For every shot output:

start_time
end_time
exact_voiceover_words
visual_type
visual_description
required_asset
asset_search_query
animation_or_motion
overlay_text
transition
reason_for_visual

The screen content must correspond directly to the voiceover words occurring during that interval.

QUALITY CONTROL

Reject the edit if:
- narration contains unsupported factual claims,
- a visual contradicts the narration,
- a source quotation is fabricated,
- a real person's words are fabricated,
- there is unnecessary dead air,
- a static shot remains unchanged for too long,
- multiple consecutive shots repeat the same visual treatment,
- the introduction takes too long to reach the subject,
- humor makes the technical explanation less accurate.

The finished video should feel extremely dense, fast, technically precise, visually varied, and intentionally edited rather than like a narrated slideshow.

That gets you **the mechanics without making your channel a Fireship impersonation**.

And since you already have ElevenLabs, I'd change the usual workflow in one important way: **generate the voice before planning visuals**. You want actual word timings controlling the edit, rather than asking TTS to magically conform to an edit made beforehand.

The Open Edits study actually uses that exact approach: generate/record VO → remove long silences → Whisper word timestamps → construct shots around the actual spoken timing. [Skills Directory](https://www.skillsdirectory.com/skills/kevinbadi-fireship-style-edit?utm_source=chatgpt.com)

The biggest technical challenge is **asset selection**, not TTS or video rendering. A mediocre automatic system hears “Linus Torvalds created Git” and produces matrix-code stock footage. A good one fetches Torvalds, the Git logo, an old kernel mailing-list/document screenshot, and then switches to an actual terminal when Git behavior is discussed. Their reverse-engineering notes specifically call this out as “literal visuals.” [Skills](https://www.skills.sh/kevinbadi/open-edits/fireship-style-edit?utm_source=chatgpt.com)

If I were building this for myself, I'd use **Claude/GPT → ElevenLabs → WhisperX → agent-generated timeline JSON → Remotion → ffmpeg**, with Playwright/browser screenshots and a controlled media library for assets.

Given that you're already building agentic stuff, this is also very compatible with the same sort of architecture as Peeki: the LLM is primarily the **planner**, while deterministic tools actually perform the operations.
