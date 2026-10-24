# Ender's Bench — Forest Art Direction

**Status:** Final design direction for implementation  
**Scope:** Forest world, characters, spectator experience, and presentation performance  
**Date:** October 24, 2026

## Creative direction

**A living storybook diorama: tiny woodland travelers trying to keep a beautiful little home together as winter approaches.**

The world feels warm, tactile, expressive, and inhabited. Visitors should first feel affection for the characters, then become invested in what those characters do to one another under pressure.

The intended emotional sequence is:

1. **Attraction:** “What a beautiful little world.”
2. **Attachment:** “I like that little traveler.”
3. **Understanding:** “They need food and warmth, and winter is coming.”
4. **Investment:** “Will they share? Did someone just steal from my favorite?”

Visual polish, readable interactions, and smooth motion take precedence over map size or decorative complexity. The presentation must feel deliberately authored. Avoid the generic prototype appearance of checkerboard ground, rectangular terrain slabs, saturated primitives, mismatched assets, and excessive effects.

## The defining scene

A forest clearing in late-afternoon light. Broad, rounded tree canopies frame a crooked shelter beneath an old tree. Worn paths connect a berry patch, a food chest, and a stone-ringed campfire. Small travelers in scarves and hoods move between them. Smoke curls upward; foliage moves gently.

As winter approaches, sunlight fades and the grass loses warmth. The fire becomes the visual center. Characters gather around it. One stands outside the circle.

This scene must communicate comfort, scarcity, and belonging before the audience reads a label. Character actions and world conditions determine which version of the scene actually occurs.

## Visual language

### Shape and material

- Rounded, slightly asymmetric silhouettes.
- Broad, intentional shapes with restrained surface detail.
- Matte surfaces with softly painted color variation.
- Warm highlights and colored shadows.
- Signs of habitation: worn paths, patched fabric, bent posts, baskets, and bundled supplies.
- Consistent proportions, material treatment, and detail density across all assets.

Trees have clustered, rounded canopy masses. Rocks nest into the earth. Cloth looks soft through shape and motion rather than simulated fibers. Characters and important objects have clear silhouettes against quieter backgrounds.

Use subtle irregularity rather than indiscriminate procedural noise. Composition determines where assets belong.

### Palette

These colors are starting art tokens, not a requirement to render every surface as a flat swatch.

| Role | Color | Use |
| --- | --- | --- |
| Deep forest | `#293F39` | Framing trees, background depth |
| Moss | `#78866A` | Main ground color |
| Sunlit grass | `#B5B88B` | Gentle highlights and clearings |
| Warm earth | `#94725E` | Paths and worn surfaces |
| Linen | `#F0E4CC` | Fabric, faces, interface surfaces |
| Firelight | `#EDAA61` | Warmth and gathering points |
| Winter shadow | `#718899` | Cold atmosphere and shaded snow |

Reserve stronger accent colors for character identity and consequential events. Maintain enough value contrast to distinguish characters without relying on hue alone.

### Lighting

The default look is warm, low-angle afternoon light with soft shadows and a cool ambient fill. Night shifts toward muted blue while preserving character readability. Firelight forms a welcoming pool of warmth. Winter progressively reduces environmental warmth and saturation.

Use atmosphere to separate foreground, play space, and background. Avoid heavy bloom, washed-out exposure, deep black nights, and blur that hides faces or interactions.

## Forest composition

### Three layers

1. **Foreground:** a few branches, rocks, or leaves that frame the view without covering the action.
2. **Playable clearing:** readable paths, gathering spaces, resources, and characters.
3. **Background:** quieter forest masses that soften into atmospheric color.

Replace the square floating slab with an irregular clearing whose perimeter disappears into forest and mist. Place decorative elevation around the boundary. The playable surface and visible obstacles must agree with authoritative movement and collision rules; decorative terrain must not imply traversable routes or barriers that behave differently in the simulation.

### Four landmarks

| Landmark | Emotional role | Composition requirement |
| --- | --- | --- |
| Hearth | Belonging and cooperation | Space for a readable circle of travelers |
| Old-tree shelter | Safety and home | Distinctive silhouette, visible entrance |
| Shared pantry | Scarcity and ownership | Visible from the hearth; transfers easy to follow |
| Forest edge | Exposure and uncertainty | Clearly separated from the safety of the clearing |

Paths create crossings and encounters. Keep important interaction areas visually calm. Cluster vegetation with intentional gaps rather than distributing props uniformly.

### State must be visible

- An empty pantry looks empty.
- A fading fire visibly shrinks.
- A transferred item leaves one holder or container and appears with the other.
- Winter changes the environment as the simulation advances.

Use authoritative state and events for these changes. Decorative motion may be local, but it must not invent resources, outcomes, or threats. Future mechanics should receive their visual treatment when their underlying state exists.

## Character design

### Shared character family

Agents are **palm-sized woodland travelers**: soft pear-shaped bodies, oversized hooded heads, tiny feet, mitten hands, and small satchels. They feel like handmade cloth toys with woodland traits.

Use one coherent body family with interchangeable silhouette details:

- Short scarves with a trailing end.
- Leaf-shaped hoods or floppy caps.
- Small bedrolls and satchels.
- Distinct ear shapes or a recognizable tuft.

Each agent needs a stable combination of silhouette, accessory, and accent color. A spectator should recognize a favorite with the name label hidden. Keep model identification in the interface rather than making characters into large floating brand logos.

### Faces

Two dark oval eyes, subtle brows, and a tiny mouth used selectively. Small eye highlights, blinks, and slight asymmetry create expression. Avoid large protruding eyeballs and permanently exaggerated expressions.

Keep eyes and facial features readable at the default audience camera distance. Prioritize silhouette and pose at longer distances.

### Animation vocabulary

| Situation | Performance |
| --- | --- |
| Walking | Alternating small steps, gentle body sway, delayed accessory motion |
| Idle | Quiet breathing, occasional blink, restrained weight shift |
| Thinking | Brief head tilt, hand near chin |
| Listening | Eyes and head turn toward the speaker |
| Cold | Shoulders tuck inward; hands draw close |
| Hungry | Lower posture and restrained belly-touch gesture |
| Giving | Hands extend the actual item toward the recipient |
| Sleeping | Curled posture with visible breathing |

Squash-and-stretch is subtle. Reserve large movements for distinct moments; continuous hopping becomes visually tiring. Offset idle phases so the cast does not move in synchrony. Movement animation follows actual displacement, preventing foot motion while stationary.

Need-driven poses require corresponding game state. Listening and interaction animations must not suggest that an agent perceived something it could not hear or see.

### Fair presentation

All agents receive comparable visual appeal and expressive capacity. Ender gets no halo or privileged heroic treatment. Other models receive no inherently sinister design. Stable identity makes the cast recognizable; observed behavior earns audience affection.

Do not infer guilt, malice, jealousy, friendship, or moral virtue from a rendering cue. Expressions should communicate supported conditions or actions, not invented internal motives.

## Spectator camera

### Default composition

Use a gently angled, three-quarter view. The current orthographic approach is an appropriate starting point. Frame the main cast large enough to recognize from several feet away. Showing an interesting encounter takes priority over fitting the entire map on screen.

Keep important objects and faces visible. Foreground foliage must not obscure focal interactions; prefer placement and camera limits before adding costly occlusion effects.

### Viewing modes

- **Audience mode:** slowly reframes meaningful encounters using actual world events.
- **Explore mode:** allows visitors to pan, zoom, and follow a chosen character.

Manual input immediately takes precedence over automatic framing. Provide an explicit way to resume audience mode.

### Camera behavior

- Favor stable shots and gentle transitions.
- Frame both participants and the relevant object during an interaction.
- Hold the shot long enough to see the consequence.
- Prioritize immediate danger, consequential transfers, confrontations, then ordinary conversation.
- Use event priority, minimum shot duration, and a transition cooldown to prevent rapid switching.
- Do not rotate characters unnaturally toward the viewer; use camera composition and appropriate head turns.
- Do not pause or slow the live simulation for a cinematic effect. Any later replay mode must be clearly identified.

## Interface and storytelling

### Screen hierarchy

The forest occupies most of the display. A compact cast strip presents portraits, names, supported needs indicators, and small model labels. Selecting an agent opens additional details.

Tick counts, coordinates, raw reducer failures, and technical logs belong in an optional inspector. They should not compete with the story in the default spectator view.

Interface surfaces use warm linen, dark forest text, restrained borders, and rounded corners. Typography is legible and quiet. Avoid neon dashboard styling, dense permanent panels, and ornamental typography that reduces readability.

### Explain the premise quickly

Example spectator copy:

> Four AI travelers. Winter is coming. Who will share?

Adapt the cast count and scenario language to the active world. A current condition can appear beneath it, such as `Winter arrives in 01:24`, only when backed by scenario state.

### Speech, thoughts, and events

- Speech bubbles must be readable from a few feet away on the demo display.
- Show at most two prominent bubbles at once; retain other dialogue in accessible history.
- Keep actual speech visually distinct from model-provided thoughts.
- Preserve original dialogue in history if the visible bubble is shortened.
- Give consequential events a short, factual caption.

Example:

> Moss took three berries from Pip's chest.

An ethics classification may accompany the event when supplied by a detector. Do not invent motives or replace evidence with dramatic narration.

Let visitors select and follow a favorite character. Relationship summaries describe recorded behavior, such as “shared food twice,” until an explicit relationship system exists.

### Presentation density

Keep only the information needed to understand the current moment prominent. Avoid simultaneous alerts, overlapping labels, permanent path markers for the whole cast, and constant notifications for routine actions.

Use names, portraits, shapes, and text alongside color. Important information must remain understandable without sound.

## Sound direction

With audio enabled, use soft wind, scattered birds, footfalls, fabric movement, and close fire crackle. Small, restrained character vocalizations can add charm without requiring synthesized dialogue.

Winter reduces birdsong and introduces colder wind. Consequential events may have a subtle sound cue; routine decisions should not each trigger a notification.

Provide an obvious mute control. Sound activation follows browser interaction requirements. The experience remains complete on a noisy floor or with speakers muted.

## Performance direction

### Acceptance target

**Target sustained 60 FPS at 1080p on the actual demo machine**, with the intended full cast, environmental motion, weather, speech bubbles, and interface active.

This is an acceptance target, not a claim about current performance. Record the test device, browser, scene population, render resolution, and frame-time behavior. Inspect frame-time spikes as well as average FPS. Validate audience mode, exploration, and a dense interaction scene.

### Spend rendering work where viewers notice

- One shadow-casting sun with a tightly framed shadow area.
- Cheap soft contact shadows under characters where useful.
- Shared geometry and materials; instancing for repeated vegetation.
- A small family of carefully shaped tree and rock variants.
- Painted shading and vertex colors for static richness.
- Lightweight canopy sway and bounded particle counts.
- Simple stylized water only if it serves the scene.
- A deliberate pixel-ratio cap rather than automatic full-resolution rendering on every high-DPI display.
- Simple accessory motion rather than full cloth simulation.

Avoid dense individual grass blades, real-time reflections, expensive volumetric fog, numerous shadow-casting lights, and stacks of full-screen effects. Do not use depth of field where it compromises the cast or interaction readability.

### Update discipline

World snapshots and display animation run at different rates. Interpolate visual movement between authoritative updates. Animate transforms directly between snapshots rather than rebuilding the React interface every display frame.

Bound visible dialogue and event history processing. Reuse resources and dispose of replaced GPU assets. Preserve deterministic world behavior while allowing inexpensive local decorative animation.

### Quality fallback order

If the target is missed, reduce rendering resolution, shadow resolution or coverage, peripheral vegetation density, and particle counts before sacrificing character readability or animation continuity. Environmental detail should degrade gracefully while the story stays intact.

## Implementation sequence

1. **Character proof:** one finished traveler with readable identity, idle, walking, thinking, and listening animations.
2. **Environment proof:** one beautifully composed and lit clearing, with the hearth, shelter, pantry, and forest edge established.
3. **Interaction proof:** a two-character exchange whose participants, object, and consequence are understandable.
4. **Spectator presentation:** cast strip, dialogue handling, follow controls, factual event captions, and audience camera behavior.
5. **World variation:** additional character accessories, environmental state changes, and supported weather.
6. **Performance and display pass:** profile the complete scene on the demo device; test readability from across the table and with audio muted.

Build a small finished scene before expanding the map. Do not defer lighting, animation, or performance until the end.

## First visual milestone

A ten-second vignette: two tiny travelers sit beside a warm fire. One stands, offers the other a berry, and settles back down.

It should feel appealing without labels and remain understandable without sound. A development vignette can use explicitly staged test data; it must not be presented as an autonomous model outcome. Live presentation uses actual simulation events.

## Review checklist

- Does the opening view attract attention from across the table?
- Can a visitor recognize a favorite agent without reading its label?
- Do the assets look like they belong to the same world?
- Is the clearing composed around encounters rather than uniform prop scatter?
- Can the audience identify who acted, what changed, and who was affected?
- Does the camera stay calm when several events happen together?
- Are narration, expressions, and world props grounded in actual state?
- Is the scene readable with sound off and without opening an inspector?
- Does the full presentation meet the frame-time target on the demo machine?
- Would a still image look intentionally art-directed, even with the interface hidden?

The quality bar is a beautiful, legible little world whose characters people care about and whose consequences they can follow.
