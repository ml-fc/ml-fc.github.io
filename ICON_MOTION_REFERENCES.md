# Icon movement references

The popup uses original, hand-keyed stylized animation. These publisher clips
were reviewed to inform the action phases; this is not motion capture or a
frame-for-frame reproduction. Original footage is linked from each popup and
is not downloaded or redistributed with the website.

| Icon | Publisher / original clip | Choreography |
| --- | --- | --- |
| CR7 | [UEFA: overhead kick from all angles](https://www.youtube.com/watch?v=Nt8198a0acA) | Back to goal; supporting leg compression; raised left leg; right-leg scissor contact; continued rotation; low landing and recovery. |
| Messi | [FC Barcelona: Getafe, 2007](https://www.youtube.com/watch?v=_OlTuc_t_BY) | Receive and turn; short left-foot touches; acceleration between defenders; goalkeeper rounding; left-foot finish. |
| Neymar | [Santos TV: Puskás-winning solo goal, 2011](https://www.youtube.com/watch?v=aV3W_DLMko8) | Cut inside; pass and return; two changes of direction; controlled finish. Santos white kit and mohawk in the action. |
| R9 | [FIFA: 2002 final](https://www.youtube.com/watch?v=O8dUhMGtUtw) | Incoming square pass; right-foot receive; set and low right-foot finish, replacing the unrelated stepover. |
| Maradona | [FIFA: Goal of the Century, 1986](https://www.youtube.com/watch?v=Da_CDPRG2j0) | Initial turn; low running posture; distinct close-control cuts; goalkeeper rounding; left-foot finish. |
| Ronaldinho | [UEFA: Chelsea goal, 2005](https://www.youtube.com/watch?v=fygu4KrxJqc) | Stationary ball; alternating shoulder/body feints; minimal backswing; low toe-poke, replacing the elastico. |
| Pelé | [FIFA: Sweden final goal, 1958](https://www.youtube.com/watch?v=TYNsrKtV6Mc) | Chest control; right-foot flick; forward steps under the falling ball; grounded volley, replacing the aerial kick. |

`src/ui/icon_motion.js` owns the shared, deterministic body, feet and ball
tracks. Both WebGL and the SVG fallback use those tracks, including scrubbing,
slow motion and replay. The 9-second popup time compresses the longer dribbles
and expands the brief kicks so the signature beats remain visible. Existing
theme portraits and palettes remain independent of the action references.

The playback beat map is separate from the pose map: CR7's take-off through
landing occupies 0.72 seconds at normal speed, with a short deceleration around
contact. Celebrations settle into a held final pose. The hips, deforming shirt,
shoulders and head have independent transforms, with counter-rotation through
the gait and bounded ball tracking through the neck. Body motion is sampled
directly from timeline time rather than accumulated from previous frames.
