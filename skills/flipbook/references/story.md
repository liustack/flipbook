# Story

Every film tells one story. Write it as `story.json` before the timeline: the story decides the scenes, the device, what moves and how long each part takes. check and render read it next to `timeline.json` and fail without it.

## The story in one sentence

Write the story as one sentence with four slots, and fill all four:

> **Who** wants (or fears losing) **what**, **because** of what, and in the end **gets it, loses it, or becomes something else**.

| Field | Write | An ant, for example |
|---|---|---|
| `who` | who the story is about | an ant |
| `wants` | what it wants, or fears losing | to get its crumb home |
| `because` | what stands in the way, or the event that turns things | a raindrop turns the path ahead into a puddle |
| `becomes` | how it ends up | it crosses on a leaf and gets the crumb home |
| `leave` | one sentence: what the viewer feels or remembers at the end | The small relief of getting something home |
| `device` | `what`: the one visual device that runs through the film. `why`: why it fits this story | One straight path runs across the frame to the hole, so every stop and detour the ant makes shows against it |
| `beats` | 3 to 6 beats, in order | below |

Each slot is `{ "what": one sentence, "where": ... }`, and `where` says where the viewer finds it (see "Where each slot lands" below). The slots are linked by cause: it ends that way because of that event, not "and then, and then". A film of 10 to 60 seconds holds one such sentence. Two make two weak films: pick one.

### Who

The one the story is about, not the viewer watching it. It has a will, which means all three of these hold:

1. It chooses: at least two ways lie open and it takes one.
2. The outcome changes it: the viewer can tell what winning and losing would mean for it.
3. Its intent can be perceived: seen in the picture (it looks toward something, reaches, hesitates, turns back), heard (the "I" of a song says it), written down (a real person in a record), or remembered (the viewer's own past, see "from memory" below).

Counts: a person. An object acting like one (a desk lamp leaning toward something it wants to reach). A "we", such as the "we" of a song, once what it wants is said or shown. A real person from history.

Doesn't count: things that only change (an egg becoming a fly, a stain spreading, a tree growing), the product itself, "the world", "the times".

### Wants

1. Specific: you can tell on screen whether it got it. "Keep her", "reach that letter", "weave a pattern that fine" are specific. "Happiness" and "growth" are not.
2. It costs something: not getting it means losing something.
3. Something stands in the way: it is not had for the asking. The obstacle can be outside (distance, time, other people) or inside (fear, not knowing how, a misunderstanding).
4. It may differ from what the who needs, and the ending often gives the need rather than the want.

Fearing a loss counts: wanting to keep something.

### Check the four slots

Before going on, check each slot: cover it and read what the other three make. If that reads like one of these, the slot you covered is empty or too weak. Fill it before writing the timeline:

| Covered | What is left | For example |
|---|---|---|
| who | a process: things change and nobody cares how they end up | an egg to a fly to its death, an empty room painted into a fantasy (a show of technique) |
| wants | an encounter: things happen to someone who doesn't mind, so nothing is won or lost | someone walks down a street and it rains |
| because | a wish: wanted and had, told in one line, nothing in between | he wants an apple, picks it up, eats it |
| becomes | an opening: it stops halfway with no outcome | a trailer, set-up only |

### What flipbook does not make

- A product film that introduces one feature after another.
- Technique for its own sake: things morph, crush and glow while nobody wants anything.
- A made-up fable: it has the form of a story and gives the viewer no reason to care. Retelling a known tale, fable or piece of history is fine.
- A music video that is all performance or concept, with no story in its lyrics.
- An explainer that lists how something works, "X explained in three minutes", a system walkthrough, a ramble from one subject to the next, or a lesson held up by a presenter's personality. A science film is made only when it fits the sentence: someone (a character, a thing acting like one, or a real person) wants an answer or a result, a specific wrong belief or hard problem stands in the way, and by the end one claim about the world is replaced by another. The viewer is never the who.
- A process or a life that only goes "and then", with nobody striving for anything.

## Where each slot lands

Each slot's `where` is one of three:

- `{ "beat": id, "via": [...] }`: on stage, in that beat. `via` lists the ways it reaches the viewer: `"picture"`, `"words"` (the beat's words on screen) and `"sound"` (the beat's sound effect).
- `"record"`: off stage, filled in by the viewer from a written story.
- `"memory"`: off stage, filled in by the viewer from their own life.

The stage follows from the slots: all four in beats is a film on stage, any slot left to the record makes it a film told from a record, any left to memory makes it a film told from memory. A film uses the record or memory, never both.

### On stage

All four slots are in the film. The picture leads, but words, lyrics and sound are on stage too and can carry slots. A music video is a film on stage: the lyrics hold the sentence and the picture and sound together must show it. Footage cut to the beat that never shows the lyric's story is not what flipbook makes.

check: every slot names a beat. A slot through `words` needs `text` in that beat, one through `sound` needs a `sound`, and one through the picture alone cannot sit in the `hold` beat. Otherwise `story-slot`.

### Off stage, from a record

The story is a real piece of history or a known tale, and it is not played out in the picture. Viewers who know it fill in the gaps from the fragments on screen. Viewers who don't are drawn in by how it is told, follow the clue the film ends on, and the story finishes when they find it. Write the `record` block: `story` (the story in short), `sources` (where it is written), `key` (the clue to search) and `materials` (every file in `assets/SOURCES.json` and which part of the story it is).

Miss any of these and the film fails:

1. A real story, and it fits the sentence. A loom: Jacquard wanted to weave patterns too fine to set by hand, used punched cards to lift the threads, and those holes later became programs.
2. Every material belongs to the story: you can say which part it is. Nothing is there to decorate.
3. The device running through the film matches the story's core change. The loom: the holes pass from thread to card to flower.
4. The film ends on a clue a viewer can search: a name, a year, an object. Searching it finds this story directly.

check covers 1 (the block is written), 2 (`story-record` when a file has no line in `materials`: files that `cutout`, `puppet` or `sprite` cut from a picture count with that picture) and 4 (`story-record` when no words of the last beat contain `key`). For 3, before delivery say in one sentence how the device matches the core change. If you can't, change the device.

The test: someone who knows the story can name it, and someone who doesn't can find it from the clue and wants to.

### Off stage, from memory

The film shows one or two slots, and the viewer fills in the rest from their own life. Rain knocking blossoms to the ground shows only how it ends (a path covered in petals): who and what they wanted come from the viewer. A watermelon lowered into a water barrel shows only the wanting (waiting for it to cool): the viewer knows how it ends, that summer passed. Write the `memory` block: `detail`, the detail that brings it back.

Miss any of these and the film fails:

1. At least one slot is shown concretely, and you can say which (usually wants or becomes). check refuses a film that leaves all four to memory.
2. The detail is specific enough that a viewer thinks "I've been there". "Summer" brings back nothing, "a watermelon cooling in the water barrel" does. The more specific it is, the more people recognize it.
3. Many people have lived it: the seasons, childhood, waiting, parting. Not something only the maker went through.
4. Don't fill it in for the viewer: no captions saying what it evokes, whose story it is or what happened. At most name a who, never the events.

The test: after watching, a viewer could say "it reminds me of that year when...", and that sentence has a person in it. If all they can say is "beautiful", the film is a show of technique.

## Which way each slot reaches the viewer

Each way is good at some slots. Use this to decide `via`:

| Way | Good at | Poor at |
|---|---|---|
| picture | who (a figure), how it ends (a before and an after), actions and choices | wants (what is inside), because (cause and effect across time) |
| words (lyrics, captions) | wants, because ("later", "three years on", "so") | being there |
| sound (ambience, effects) | bringing memories back: rain, cicadas, a page turning | making any slot clear on its own |
| music | making the viewer care. It carries no slot | |

flipbook's figures have no faces to act with, so wants and because often go to the words: the figure does the action, and a few words say what it wants and why, the way shadow puppets have a singer and comics have captions.

## Making the viewer care

This measures how well a story is told, not whether it is one. A viewer cares when they stop watching idly and have something riding on it: they hope the who gets what it wants (feeling, drawn from what the who has at stake), they want to know how it works out (curiosity, drawn from an obstacle or cause shown late), or the picture and sound hold them (the telling itself). The more of these a film earns, the better. A film with only the last, and no story behind it, is not what flipbook makes.

## Find the turn

A story runs: once upon a time, every day, but one day, because of that, until finally. The beat roles follow it:

| Role | The part it plays |
|---|---|
| `opening` | once upon a time, every day: the world as it is |
| `turn` | but one day: something goes wrong or changes course |
| `build` | because of that: what follows from the turn |
| `resolution` | until finally: the new state, often an answer to the opening |

The first beat is `opening`, the last is `resolution`, and at least one `turn` lies between. Parts that sit side by side (sun, then rain, then snow) are a list, not a story, and check refuses them with `story-arc`. The turn is usually where `because` lands: ask what goes wrong, what is at stake, what the who loses or wins.

A film about a product or a brand works the same way. The product is what moves the story, not its who: show what it lets someone get, in one sentence. Don't parade its features one after another.

## Write the beats

Each beat is `{ id, role, at, change }`, plus `text`, `sound`, `callback` or `hold` when needed.

- `at` is where the beat starts: a scene id (the scene's first beat) or `{ "scene": id, "beat": n }` for a moment inside a scene, counted like a cue's `beat`. A beat lasts until the next one starts and must hold at least one frame. The first beat starts at the first scene.
- `change` is `{ "from", "to" }`: what the picture shows as the beat starts and as it ends. Write things you will draw, not feelings. The change must be on screen: check compares each beat's first and last frame and warns with `story-static-beat` when they look the same.
- `text` lists the words on screen in that beat, exactly as its text cues show them, in order. Words carry only what the picture cannot. When a beat's words take longer to read than the beat lasts, check warns with `story-text-fast`.
- `sound` names the sfx cue that marks the beat. `callback` names an earlier beat this one answers: an ending that returns to the opening. `hold: true` marks the one beat that stands still on purpose, at most one.
- A slot on stage names the beat it lands in. Several slots may share a beat.
- No times in the story: bars and beats live in the timeline only.

## Land the ending

The ending is where the viewer decides what they felt, and a rushed ending is the most common flaw: the last words appear and the film cuts off. Give it room.

- Show the resolution, then stay on it. Once the last change lands, keep the picture on screen before the film stops: at least 2 seconds after the last words settle, longer before a title or a brand. check warns with `story-ending-short` when the film stops sooner, or, with no words, when the last beat is shorter than 2.5 seconds (both scaled down for a very short film).
- Answer the opening. The strongest endings come back to an image from the start, changed: the same window now lit, the same road now walked. Mark that beat with `callback`.
- After the main action, one small last action tells the viewer the story is over: a blink, a leaf settling, a door clicking shut. Keep it small: a new event at the end starts a new story.
- Let the movement come to rest instead of stopping: the camera eases to a stop, the light dims or warms a little, the last moving thing settles. Something small may keep living in the hold (snow falling, a flame, a breath), which also keeps render's `freeze` check quiet. Don't end mid-motion, and don't let a cut or a fade to black stand in for an ending.
- A title or end card comes after the story, not over the last action, and is made of the film's own material: the same paper, ink or pixels. Hold it at least 2 seconds, 3 to 5 for a brand. An end card that stands still on purpose gets its own scene with `"hold": true` in the timeline.
- The music ends on its home chord (the key's first chord, as in C for C major), reached from the chord a fifth above it (G in C major), and the last bar or two let it ring out instead of starting new notes.
- Don't put words on what the picture already shows. A caption saying "made it" over a picture of it making it takes the moment away from the viewer.

## Order of work

1. Write `story.json`.
2. When the user is there, show them the four slots, what it leaves, the device and the beats in one message, and go on once they agree. When they said to just make it, go on with your own.
3. Write `timeline.json`: a scene or two per beat, text and sfx cues where the beats need them.
4. Write `index.html`. Run `check`: `story-invalid`, `story-slot`, `story-record`, `story-coverage`, `story-arc` and `story-text` name the field to fix.
5. Before delivery, read the contact sheet against the story, slot by slot where each lands. A slot through the picture must be visible in that beat's pictures. A slot through the words must be readable in that beat's words. A slot through the sound: play that beat of the video and listen. The sound effect itself must carry the slot (the splash of the drop that makes the puddle), and the music never counts as carrying one. A slot left to the record or to memory must pass the tests for it above. Then check each beat: do its first and last pictures show its `change`? A slot you cannot find where the story says it lands is missing from the film too.

Change the story only when the user changes it. Once the timeline is written, the timeline and the video are what count.

## Example

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 11,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [
        { "id": "path", "bars": 2 },
        { "id": "puddle", "bars": 2 },
        { "id": "leaf", "bars": 1 },
        { "id": "home", "bars": 3 }
    ],
    "cues": [
        { "id": "go", "scene": "path", "beat": 1, "kind": "text", "text": "搬回家", "settleBeats": 1 },
        { "id": "drop", "scene": "puddle", "beat": 0, "kind": "sfx", "sfx": "drop" }
    ]
}
```

<!-- snippet-file: story.json -->
```json
{
    "version": 2,
    "who": { "what": "an ant", "where": { "beat": "carry", "via": ["picture"] } },
    "wants": { "what": "to get its crumb home", "where": { "beat": "carry", "via": ["picture", "words"] } },
    "because": { "what": "a raindrop turns the path ahead into a puddle", "where": { "beat": "puddle", "via": ["picture", "sound"] } },
    "becomes": { "what": "it crosses on a leaf and gets the crumb home", "where": { "beat": "home", "via": ["picture"] } },
    "leave": "The small relief of getting something home",
    "device": {
        "what": "one straight path runs across the frame to the hole",
        "why": "every stop and detour the ant makes shows against the straight line"
    },
    "beats": [
        { "id": "carry", "role": "opening", "at": "path", "change": { "from": "the ant sets off with a crumb bigger than its head", "to": "it is halfway along the path and the sky has greyed" }, "text": ["搬回家"] },
        { "id": "puddle", "role": "turn", "at": "puddle", "change": { "from": "a drop hits the path ahead", "to": "a puddle lies across the path and the ant stops at its edge, turning one way, then the other" }, "sound": "drop" },
        { "id": "leaf", "role": "build", "at": "leaf", "change": { "from": "the ant steps onto a fallen leaf at the puddle's edge", "to": "the leaf has carried it across" } },
        { "id": "home", "role": "resolution", "at": "home", "change": { "from": "the ant walks the last stretch in the rain", "to": "the crumb and the ant have gone into the hole and the sky has cleared" }, "callback": "carry" }
    ]
}
```

The ant chooses at the puddle: it stops, looks one way and the other, and takes the leaf instead of turning back. The words say only what the picture cannot, what it wants. The ending answers the wanting: the crumb goes home. No words go over the ending, the picture already shows it.

<!-- check: pass -->
```js
import { composition, ease, progress, rand, setupCanvas, timeline, cueProgress } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const [path, puddle, leaf, home] = tl.scenes;
const GROUND = 250;
const HOLE = 560;
const words = Object.assign(document.createElement('p'), { textContent: '搬回家' });
words.style.cssText = 'position:absolute;left:0;right:0;top:40px;margin:0;text-align:center;font:600 44px "Noto Serif SC";color:#2b2622';
document.body.append(words);

// Where the ant is, which way it faces, and how far into the hole it has gone.
function ant(t) {
  if (t < puddle.start) return { x: 60 + 165 * progress(t, path.start, path.end), face: 1, gone: 0 };
  if (t < leaf.start) {
    const x = 225 + 10 * ease.outSine(progress(t, puddle.start, puddle.start + 0.8));
    // Stopped at the edge: it looks back, ahead, back, then ahead at the leaf.
    const look = t > puddle.start + 1.5 && Math.floor((t - puddle.start - 1.5) * 1.5) % 2 === 0 ? -1 : 1;
    return { x, face: look, gone: 0 };
  }
  if (t < leaf.start + 0.5) return { x: 235 + 55 * progress(t, leaf.start, leaf.start + 0.5), face: 1, gone: 0 };
  if (t < home.start) return { x: 290 + 110 * ease.inOutSine(progress(t, leaf.start + 0.5, leaf.end)), face: 1, gone: 0, raft: true };
  return { x: 400 + (HOLE - 400) * progress(t, home.start, home.start + 3), face: 1, gone: progress(t, home.start + 3, home.start + 4) };
}

composition({
  seek(t) {
    const grey = progress(t, path.start + 1, path.end) * (1 - progress(t, home.start + 3.5, home.end - 1));
    ctx.fillStyle = `rgb(${214 - 90 * grey}, ${226 - 80 * grey}, ${236 - 60 * grey})`;
    ctx.fillRect(0, 0, tl.width, tl.height);
    ctx.fillStyle = '#8a6a48';
    ctx.fillRect(0, GROUND, tl.width, tl.height - GROUND);
    ctx.fillStyle = '#2b2622';
    ctx.beginPath(); ctx.ellipse(HOLE + 14, GROUND + 3, 22, 6, 0, 0, Math.PI * 2); ctx.fill();
    // The puddle spreads from the first drop.
    const spread = ease.outCubic(progress(t, puddle.start, puddle.start + 1.2));
    ctx.fillStyle = '#4f7391';
    ctx.beginPath(); ctx.ellipse(345, GROUND + 4, 1 + 70 * spread, 1 + 8 * spread, 0, 0, Math.PI * 2); ctx.fill();
    const a = ant(t);
    // The leaf lies at the puddle's edge until the ant rides it across.
    const leafX = a.raft ? a.x : t < home.start ? 290 : 400;
    ctx.fillStyle = '#5d8a3c';
    ctx.beginPath(); ctx.ellipse(leafX, GROUND + 2, 30, 7, 0, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 40 && t >= puddle.start && t < home.start + 3.5; i++) {
      const x = rand(tl.seed, 'x', i) * tl.width;
      const y = (rand(tl.seed, 'y', i) * GROUND + t * 300) % GROUND;
      ctx.fillStyle = '#3d5566';
      ctx.fillRect(x, y, 2, 10);
    }
    if (a.gone < 1) {
      const y = GROUND - 8 + (a.raft || Math.abs(a.x - 290) < 30 ? -5 : 0) + 16 * a.gone;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, tl.width, GROUND - 2 + (a.gone > 0 ? 0 : 20)); ctx.clip();
      ctx.fillStyle = '#1c1a17';
      for (const [dx, r] of [[-11, 6], [0, 4], [9, 5]]) {
        ctx.beginPath(); ctx.arc(a.x + dx * a.face, y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = '#f1e2b8';
      ctx.fillRect(a.x + 8 * a.face - 8, y - 22, 16, 13);
      ctx.restore();
    }
    words.style.opacity = String(cueProgress(tl, t, 'go') * (1 - progress(t, puddle.start - 0.5, puddle.start)));
  },
});
```
