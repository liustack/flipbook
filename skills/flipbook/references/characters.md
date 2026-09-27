# Characters

When a story needs someone to act it out, build a cut-out puppet: parts on bones, posed at every t. The runtime draws it, inks one outline around each group of parts so no joint shows, and gives you walking, breathing, waving, blinking and talking as pure functions of t. Draw the parts in code, or cut them from a picture of the parts (see [Parts from a picture](#parts-from-a-picture)).

## What to draw

Code draws a character well when the viewer knows it by its outline, one main color and one prop, not by the face or the fingers. Pick one of these:

| Form | What it looks like |
|---|---|
| cut paper, big head | a big round head, dot eyes, a pink cheek, a one-line mouth, mitten hands, seen from the side or the front |
| silhouette, shadow puppet | one flat color in profile, eyes and buttons cut out as holes |
| geometric mascot | a block, a star, an ink blot, a crumpled ball, whose mood lives in two or three eye and mouth shapes |
| a thing that lives | a paper boat, a letter, a pencil, a seed, with two dot eyes or none. Many stories need no person |
| flat animal | a cat, a bird, a fish, a frog in profile, known by one feature (ears, tail, fin) |
| far figures, crowds | round heads with no face, seen from behind, told apart by posture and color. Move them out of step |
| hand-drawn line figure | single lines with a hand wobble. Fill the head: an open circle shows the background through it |

Keep away from what code draws badly:

- **Faces** get dot eyes, a cheek and a one-line mouth, or no face at all. Feelings go into the pose and the hands.
- **Views** are the profile or the front. Never a three-quarter face. A turn is a hard cut between two or three drawn views, never a turn in between.
- **Hands** are mittens or hidden behind a prop or in a pocket. A gesture swaps the whole hand: fist, open, pointing. No fingers drawn one by one.
- **Not at all**: a real person's portrait, a close-up of a hand gripping something, realistic proportions, a camera circling a character, dancing, fighting. Stage around them: far away, in silhouette, from behind, off screen.

## Parts and bones

Draw each part once with `part(width, height, pivot, draw, { sockets })`: a canvas of `width` by `height` CSS px, the joint it hangs from (`pivot`) and the joints its children hang from (`sockets`), all in its own px. Paint color and the lines inside the part only. Leave out the outer outline: the puppet inks it.

`biped(parts)` gives the bones of a person in profile facing right: `torso` (the root, hanging at the hip), `head`, `armBack` / `foreBack` / `handBack`, `thighBack` / `shinBack`, `thighFront` / `shinFront`, `armFront` / `foreFront` / `handFront`. It needs these sockets: the torso's `neck`, `shoulder` and `hip`, each upper arm's `elbow`, each forearm's `wrist`, each thigh's `knee`. Name the parts like the bones, or map shared ones: `biped({ armFront: 'arm', armBack: 'arm' })`.

`puppet({ parts, bones, scale, outline })` builds it. `scale` is CSS px per part px (default 1). `outline` is `{ width, color }` (default 3 px at scale 1, a warm black), or `false` to draw the parts as they are. Give every bone a unique name and every part a size above 0.

- **Joints stay hidden** because a child hangs under its parent: forearm under upper arm, shin under thigh, head under the collar. The biped already orders them. Give a part a round end where its child tucks in.
- **One outline per group**: the biped groups the back arm, the back leg, the front leg, the body with the head, and the front arm. Parts in one group meet with no line between them. Where one group lies over another (the arm over the coat, the coat over the legs) the edge is inked. Keep a group's bones next to each other in `z`.
- A part drawn on its side takes `angle` (degrees) so it points the way its bone points. A part a little too long takes `fit: [sx, sy]`.

## Posing it

`man.draw(ctx, x, y, { pose, swap, flip })` puts the root's pivot at (x, y). `pose` maps bone names to degrees added to the rest angle, plus `x` and `y` to shift the root in part px. Names that are no bone of this puppet are left alone, so a biped pose can drive a puppet with fewer bones. Limbs hang down, so a limb swinging forward is a negative angle and a knee bending back is positive. `swap` maps a bone to another part for this frame: a closed-eyes head, an open hand. The children of a swapped part hang from its own sockets. `flip: true` faces left.

| Helper | Returns |
|---|---|
| `walk(t, { thigh, shin, cadence, step, lift, arm, lean, steps })` | `{ pose, distance, standing }`: a profile walk and how far the hips moved, in part px. Draw the root at leg length above the floor plus `distance`: one foot stays planted where it landed while the other swings, the knees solved from the feet. Give `...man.legs()` for `thigh` and `shin`. `step` is heel to heel (default 0.55 of the leg, at most 1.6 of it), `cadence` steps a second (default 1.8), `lift` how high the swinging foot rises (default 0.1 of the leg), `arm` the arm swing in degrees (22), `lean` the torso's lean (3). Without `thigh` and `shin`, `leg` (default 300) is split evenly. With `steps: n` (a whole number) it stops: in one more step's time the hips slow to a halt half a step on and the back foot comes up beside the front one. It stands from `walkTime(options)` seconds, `(n + 1) / cadence`. Lengths, `cadence` and `step` must be above 0, `lift` 0 or more: anything else throws. A very high `lift` or very unequal thigh and shin can ask for more than the leg reaches, and the foot then rises less |
| `man.legs()` | `{ thigh, shin }`: the biped's leg lengths in part px, for `walk` |
| `idle(t)` | a standing pose that breathes |
| `wave(t, start, end, { reach, elbow, swing, rate, rise })` | `{ pose, raised }`: the front arm waving. Lay `pose` over yours while `raised > 0`, swap in an open hand once it passes 0.5 |
| `blink(t, { seed, length })` | true while the eyes are shut (`length`, default 0.12 s), every 2.5 to 5.5 seconds |
| `talk(t, start, end, { seed })` | true while the mouth is open, syllable by syllable |
| `lookAt([x, y], [tx, ty], limit)` | the head angle that turns a profile head toward a point, at most `limit` degrees (default 25) each way. Positive tilts the face down |
| `blendPose(a, b, u)` | the pose between two, for settling from a walk into `idle` |
| `man.joint(bone, x, y, frame, at)` | where a bone (or point `at` of its part) lands: where a letter leaves the hand, where a hat sits |

With a big head and short arms, raise a waving hand forward and away from the face (`reach` near -85, `elbow` near -40), not up past it: an arm raised high covers the face.

## Making it move well

- **On twos**: pose from `onTwos(t, fps)`. The whole frame holds for two frames, like paper under a camera, and moves as one: shake the whole frame with `boil()`, never one part against another.
- **Out of step**: two arms never move together, the back arm trails the front one, and a crowd never marches in step.
- **Anticipate and settle**: a small move the other way before a big one, a little overshoot after it, and `blendPose` into `idle` once a walk stands.
- **Swap, do not stretch**: mouths, hands and eyes change by swapping parts.

It looks cheap when joint breaks show, when tweening is smooth and even, when both sides of the body mirror each other, and when parts only slide around without a single swap.

## Example

<!-- snippet-timeline -->
```json
{
    "version": 1,
    "width": 640,
    "height": 360,
    "fps": 12,
    "seed": 6,
    "bpm": 120,
    "beatsPerBar": 4,
    "scenes": [{ "id": "walk", "bars": 2 }]
}
```

<!-- check: pass -->
```js
import { biped, blendPose, blink, composition, ease, idle, onTwos, part, progress, puppet, setupCanvas, timeline, walk, walkTime, wave } from '/__flipbook/runtime.js';

const tl = await timeline();
const ctx = setupCanvas(document.getElementById('stage'), tl.width, tl.height);
const fill = (color, draw) => (c) => { c.fillStyle = color; c.beginPath(); draw(c); c.fill(); };
const limb = (w, len) => (c) => { c.arc(w / 2, w / 2, w / 2, Math.PI, 0); c.lineTo(w, len); c.arc(w / 2, len, w / 2, 0, Math.PI); c.closePath(); };
const head = (eyes) => part(70, 76, [34, 70], (c) => {
  fill('#f1c9a3', (g) => { g.arc(34, 40, 28, 0, Math.PI * 2); g.rect(26, 60, 16, 16); })(c);
  fill('#35507a', (g) => { g.moveTo(8, 34); g.quadraticCurveTo(34, -4, 60, 30); g.lineTo(70, 36); g.lineTo(8, 38); })(c);
  c.fillStyle = '#2a2320';
  if (eyes) c.fillRect(49, 40, 4, 5); else c.fillRect(46, 43, 9, 2);
});
const parts = {
  torso: part(60, 84, [30, 76], fill('#35507a', (g) => g.roundRect(6, 4, 48, 78, [20, 20, 6, 6])), { sockets: { neck: [30, 8], shoulder: [32, 20], hip: [30, 76] } }),
  head: head(true),
  headBlink: head(false),
  arm: part(18, 40, [9, 9], fill('#35507a', limb(18, 31)), { sockets: { elbow: [9, 31] } }),
  fore: part(16, 36, [8, 8], fill('#35507a', limb(16, 28)), { sockets: { wrist: [8, 28] } }),
  hand: part(18, 20, [9, 5], fill('#f1c9a3', (g) => g.ellipse(9, 10, 8, 9, 0, 0, Math.PI * 2))),
  thigh: part(22, 40, [11, 10], fill('#28394f', limb(22, 30)), { sockets: { knee: [11, 30] } }),
  shin: part(40, 46, [11, 9], fill('#28394f', (g) => { limb(20, 32)(g); g.rect(4, 32, 34, 12); })),
};
const man = puppet({
  parts,
  scale: 1,
  bones: biped({ armBack: 'arm', armFront: 'arm', foreBack: 'fore', foreFront: 'fore', handBack: 'hand', handFront: 'hand', thighBack: 'thigh', thighFront: 'thigh', shinBack: 'shin', shinFront: 'shin' }),
  outline: { width: 2.5 },
});
const legs = man.legs();
const LEG = legs.thigh + legs.shin;
const steps = { ...legs, cadence: 1.8, steps: 4 };
const stop = walkTime(steps);

composition({
  seek(time) {
    const t = onTwos(time, tl.fps);
    ctx.fillStyle = '#e9e3d6';
    ctx.fillRect(0, 0, tl.width, tl.height);
    const w = walk(t, steps);
    let pose = t < stop ? w.pose : blendPose(w.pose, idle(t - stop), ease.outCubic(progress(t, stop, stop + 0.4)));
    const hi = wave(t, stop + 0.6, tl.durationSec - 0.2, { reach: -85, elbow: -40 });
    if (hi.raised > 0) pose = { ...pose, ...hi.pose };
    man.draw(ctx, 120 + w.distance, 300 - LEG, {
      pose,
      swap: { head: blink(t, { seed: 3 }) ? 'headBlink' : 'head' },
    });
  },
});
```

The full example, a postman who loses a letter to the wind, is `examples/postman/` in the flipbook repository.

## Parts from a picture

When the story wants a character drawn by hand (a woodcut, a gouache, a crayon line), take its parts from a picture instead of drawing them in code: a sheet the user made, or one an image model made. `cutout` cuts the sheet into pieces and `puppet` turns the pieces into a rig.

### The sheet

- One character, every part apart from the others with wide gaps, on one flat ground color. All parts at one scale, in profile facing right.
- The parts of a biped: the torso without arms, the head (plus a blinking head and a talking head to swap in), two upper arms, two forearms, a hand (plus a fist and an open hand), two thighs, two shins with the shoe.
- **Joints**: where a part tucks under its parent (the top of the forearm, the thigh, the shin, the hand's wrist, the neck), it ends in a round tab of plain fill with no outline around it. The parent's end over it (the elbow, the knee, the collar, the cuff) is drawn with its outline, round, and covers the tab. A tab with an outline, or a ball drawn as a separate knob, shows as a ring at the joint.
- Also ask for the whole character standing, as a reference to compare the rig with.

To an image model, say it plainly: "a cut-out animation puppet parts sheet", the parts and their count row by row, "every hidden insertion tab is a round extension of solid fill with no black outline", "the upper part's outlined end covers the tab", "background perfectly flat", "no text, labels, guides or fasteners". Give the reference picture of the character along with it. Write the tool and the whole prompt into `assets/SOURCES.json` (see below).

### Rigging it

1. Cut it: `cutout <dir> assets/postman-parts.png --max 20`, and open `out/cutout/postman-parts.png`. The pieces are numbered biggest first.
2. Write `assets/puppets/<name>/puppet.json`: which piece is which part, and where each joint is.
3. Rig it: `puppet <dir> <name>`, and open `out/puppet/<name>.png`. It shows every part with its pivot (red) and sockets (blue), and the puppet standing, mid-stride, with its legs passing, mid-stride on the other foot and waving, next to the reference. Fix puppet.json until the joints sit in the tabs and the poses look whole.
4. Load it in the page with `loadRig()` and build the puppet from it.

An excerpt of the postman's puppet.json, four of its fifteen parts (the whole file is `examples/postman-print/assets/puppets/postman/puppet.json` in the flipbook repository):

```json
{
    "version": 1,
    "reference": "assets/postman-reference.png",
    "parts": {
        "torso": {
            "image": "assets/cut/postman-parts/postman-parts-01.png",
            "pivot": [165, 240],
            "sockets": { "neck": [160, 14], "shoulder": [145, 45], "hip": [165, 240] }
        },
        "head": { "image": "assets/cut/postman-parts/postman-parts-04.png", "pivot": "bottom" },
        "armFront": { "image": "assets/cut/postman-parts/postman-parts-08.png", "pivot": "top", "sockets": { "elbow": "bottom" } },
        "thighFront": { "image": "assets/cut/postman-parts/postman-parts-13.png", "pivot": "top", "sockets": { "knee": "bottom" }, "fit": [1, 1.35] }
    },
    "bones": "biped",
    "map": { "handFront": "hand", "handBack": "hand" }
}
```

| Field | Meaning |
|---|---|
| `parts.<part>.image` | The cut piece, under `assets/` |
| `pivot`, `sockets.<name>` | `"top"`, `"bottom"`, `"left"` or `"right"`: the round tab at that end, found for you. Or `[x, y]` in the piece's own pixels, for an end that is not round (square, slanted, pointed, a flat cuff), a tab under about 8 px across, or a point in the middle (the torso's neck, shoulder and hip). A point shallower than about 1 in 2 still reads as a rounded end: check the sheet |
| `angle`, `fit` | As for `part()`: a piece drawn on its side, a piece a little too long |
| `bones` | `"biped"`, or an array of bones as for `puppet()`: each with `name`, `part`, `z`, and `parent` and `socket` except the one root |
| `map` | With `"biped"`: bones shown by a part named otherwise, such as both hands by `hand` |
| `outline` | The width of the outline printed on the pieces, a whole number of pixels. Left out, each part loses the outline it shows itself: an edge of dark ink with lighter fill inside, at most a quarter of the picture's shorter side. A part that shows none (dark all through, no ink at its edge, or under about 12 px across, too small to measure) keeps its pixels, printed line included. Given, it comes off every part, and a part it would shave away entirely is refused |
| `reference` | The picture of the whole character, shown on the sheet |

The command shaves the printed outline off every piece that shows one (the puppet inks its own, one per group), writes the pieces to `assets/puppets/<name>/parts/`, and writes `assets/puppets/<name>/rig.json`. `puppet-joint-missing` means an end has no round tab: give that joint as `[x, y]`.

```js
const rig = await loadRig('assets/puppets/postman/rig.json');
const man = puppet({ ...rig, scale: 0.6, outline: { width: 5, color: '#1e1a1c' } });
const legs = man.legs();
```

Everything else is as for parts drawn in code: `walk()` with `...legs`, `swap` for the blinking head and the open hand.

### Where the pictures came from

Every picture under `assets/` needs its entry in `assets/SOURCES.json`, or check fails with `asset-unlicensed`. A picture an image model made has `"license": "generated"`, the `tool` that made it and the whole `prompt`:

```json
{
    "postman-parts.png": {
        "source": "made with an image model from postman-reference.png",
        "license": "generated",
        "tool": "<the model or app>",
        "prompt": "<the whole prompt>"
    }
}
```

`cutout` and `puppet` write the entries of the pieces and parts for you, each with `cutFrom` pointing at the picture it came from, where the tool and prompt are.

The full example, the same postman cut from a generated woodcut sheet, is `examples/postman-print/` in the flipbook repository.
