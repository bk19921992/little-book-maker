# Book design overhaul spec (21 Nov 2026)

The illustrations are already doing the hard work. The cover gives us a child, a fox and a place we want to explore. What makes the pages feel generated is the layout around them: the cover stacks a square image, a heavy title and a tiny genre label; the story page starts at the trim edge and ends with “play?” stranded on its own line; the back cover leaves a large gap between two groups of small text.

I’d make the cover title feel like part of the story, give the interior a fixed reading area, and use a small illustration to connect the back-cover copy to the front.

Redesign spec, in priority order

All coordinates below are in mm from the top-left of the trimmed page. Text positions specify baselines, and type sizes and leading are in points. The reference page is 210 × 210 mm.

1. Give the front cover a designed title

What to change. Put the title above the illustration and typeset it as two lines with distinct roles. Remove the standalone “Adventure” label.

Why. The current title is split where the template appears to have run out of room. The short name and long second line both carry the same heavy weight, and the little label underneath makes the composition feel like a product card. A short, deliberate title lock-up will read better at thumbnail size and give the artwork room to breathe.

Element	Exact spec
Title line 1	Pip, Fraunces SemiBold, 45 pt, tracking −10/1000 em, centred on x 105, baseline y 25
Title line 2	and the Red Fox, Fraunces SemiBold, 31 pt, tracking −5/1000 em, centred on x 105, baseline y 40
Title bounds	174 mm maximum width. Use sentence case and colour #25392D
Illustration	150 × 150 mm, x 30, y 48. Preserve the square artwork and use a clean edge with no border
Personalised name fitting	Measure the rendered name. Reduce line 1 in 1 pt steps to 32 pt. If it still overflows, wrap at a word boundary and switch to a three-line template with baselines 17 / 29 / 41 mm, at 32 / 32 / 27 pt. Flag any unbreakable name that still overflows for review

For this cover, keep the child, fox and lighthouse in the frame. Together they tell the story before anyone reads the title.

2. Make the split interior easy to read aloud

What to change. Use a wider illustration frame, establish a shared left edge for the art and story, and set the prose in a generous, ragged-right column.

Why. The current illustration touches the top edge but has wide paper margins at the sides. The prose then narrows again, forcing the final word onto a fifth line of its own. A consistent frame and a wider measure will make the page feel composed and improve the read-aloud rhythm.

Element	Exact spec
Page margins	20 mm at the binding edge, 16 mm at the outer edge, mirrored on left and right pages
Illustration	174 × 118 mm, y 12. Align its left edge to the page margin: x 16 on left pages and x 20 on right pages
Story column	Same left edge as the art, 158 mm wide. First baseline y 147
Story type	Source Sans 3 Regular, 23/30 pt, tracking 0, colour #282822. Left align, ragged right. No automatic hyphenation
Copy budget	Design for four or five lines. If a page exceeds five, reflow at 22/28 pt, then 21/27 pt. If it still exceeds five lines, flag it for editing or repagination
Line breaking	Measure actual glyph widths. Keep the child’s name together where practical. Reject single-word final lines when another break fits, and favour phrase boundaries over perfectly even line lengths

I’d aim for this reading rhythm on the supplied page. Use measured reflow for each personalised version.

A red fox peeks from long grass.
Pip feels excited and a bit brave.
Gentle sea breeze tickles Pip’s face.
Will the fox come out and play?

The 174 × 118 mm frame requires a wider crop than the existing square art. For this scene, protect Pip’s head and feet, the fox’s face and the lighthouse. If that crop loses an important detail, use a 118 × 118 mm square centred within the frame and keep the story area fixed. For new split-page illustrations, commission or generate against the wider frame from the start.

3. Make overlay pages use the same reading system

What to change. Give full-bleed pages a solid cream text band with the same type and alignment as split pages.

Why. Grass, waves and brushwork compete with letter shapes. A solid band makes the text predictable to read and makes it easier to compose illustrations around the story.

Element	Exact spec
Full-bleed art	Extend to the printer’s required bleed. Use 3 mm as the generator default, configurable per supplier
Bottom band	Solid #F2EFE9, full width and extended into side and bottom bleed. Top edge y 140 for up to four lines, y 130 for five
Text	Same x position, 158 mm measure and 23/30 pt type as split. First baseline 14 mm below the band’s top edge
Illustration safe zone	Keep essential faces and action above y 122 when copy length is variable. Use the split layout if the band would cover meaningful action

Use one overlay band style throughout the book. Shadows, outlines and translucent panels introduce extra variables without improving this design.

4. Build the back around the story

What to change. Keep the deep green, add a small story illustration, and arrange the blurb, personalised sign-off and imprint on one vertical axis.

Why. The current back puts small copy near the top and commercial branding near the bottom, with little to connect them. A lighthouse or fox vignette makes the back feel like the last part of the book. A narrower, left-aligned blurb makes the copy easier to scan.

Element	Exact spec
Background	#1E4333 to bleed, with cream #F2EFE9 type. Keep #52704F as the accent on cream pages
Story vignette	44 × 38 mm bounding box, centred at x 105, top y 24. Use a small standalone lighthouse, fox or coastal illustration with an irregular edge
Blurb	116 mm wide, x 47, first baseline y 79. Source Sans 3 Regular 17/23 pt, tracking 0, left aligned. Aim for four or five lines, with a maximum of six
Personalised sign-off	Centred, Fraunces Medium Italic 15/19 pt, baseline y 145. “Made especially for Pip.”
Imprint lock-up	Centre the mark and wordmark as a group, maximum 62 mm wide. Use a 6 mm icon, 3 mm icon-to-wordmark gap, and a wordmark baseline at y 176
Attribution	“by The Children’s Library”, Source Sans 3 Regular 10/13 pt, centred, baseline y 184

I’d give the blurb a concrete hook from the illustrated scene. For example, “Pip spots a flash of red in the grass. A little fox is watching from behind the dunes. Will it come out to play?” If a story has no vignette asset, move the first blurb baseline to y 67 and the sign-off to y 133. Keep the imprint anchored.

5. Reduce typography and furniture to a few repeatable rules

What to change. Use a warm serif for display, a humanist sans for reading, and hide folios by default.

Why. The current rounded type gives the title and story a similar voice. The tiny “2” then sits far outside the layout it belongs to. Two clear type roles and less page furniture give the art more presence.

Rule	Exact spec
Font files	Embed static TTFs for Fraunces SemiBold, Fraunces Medium Italic and Source Sans 3 Regular. Check glyph coverage against the actual personalised text before export
Page numbers	Off by default. If enabled, use Source Sans 3 Regular 9 pt, #596255 on cream, baseline y 201, aligned to the outer art edge. Mirror on left and right pages. Omit on covers and dedication pages
Spacing rhythm	Use 4 mm increments for most spacing decisions. Reserve 4–8 mm for elements that belong together and 12–16 mm for transitions between groups
Colour roles	Paper #F2EFE9, story ink #282822, title ink #25392D, accent #52704F, back-cover field #1E4333
6. Reflow for other formats

What to change. Build portrait and landscape templates around the same type roles and reading width.

Why. Scaling the square page to fit A5 shrinks the text quickly. Stretching the layout across A4 landscape creates lines that are too long for the same read-aloud pacing.

Format	Starting values
A5 portrait	Body 19/25 pt, text width 112–120 mm, inner/outer margins 15/12 mm, cover title 36 pt with second line 25 pt
A4 portrait	Body 24/32 pt, text width 150–162 mm, inner/outer margins 20/16 mm, cover title 48 pt with second line 34 pt. Give most of the extra height to art and spacing
A4 landscape	Body 23/30 pt, text width 150–165 mm. Keep the split story block aligned with the art’s left edge. For overlay, extend the band to bleed and keep the reading column within that width

Before export, check title and story overflow, missing glyphs, art crops, mirrored margins and bleed coverage. Proof one copy at actual size with a short name, a long name and the longest story page. The most important visual test is whether the title reads as one composition with the illustration and whether you can read the story aloud without stumbling over the line breaks.



---

Source: ChatGPT (GPT-6.2) art-direction critique of rendered cover/story/back pages, commissioned 21 Nov 2026 after the owner judged the output "not professional". Implementation status: Phase 1 shipped (commit 9a80d3d) - fonts (Source Serif 4 replaces the spec's Fraunces, whose available build renders with in-word gaps under pdf-lib/fontkit), colours, folios off, back cover layout. Phase 2 outstanding: cover title lock-up above art, wider art crop with shared left edge, mirrored binding margins, overlay band repositioning, orphan-word control, per-format type tables.


---

# Pass 2: A framed storybook with a cream title cartouche (bolder direction, 21 Nov 2026)

ChatGPT said:
Pass 2: A framed storybook with a cream title cartouche

Give the cover a deep pine-green field, a fine double frame and a large cream title cartouche that overlaps the illustration. Carry the same frame and a small three-leaf ornament through the interior and back. At thumbnail size, the green field and cream cartouche should be the first differences you see.

All measurements are for a 210 × 210 mm trimmed page, from the top-left. Text coordinates are baselines. Sizes and leading are in points. Centred elements use x = 105 mm unless specified.

Colour	Value	Use
Pine	#1E4333	Front and back fields, display type
Cream	#F2EFE9	Cartouche, interior paper, reversed text
Moss	#52704F	Interior initials and ornaments
Ochre	#B68A55	Cover and back framing lines
Ink	#282822	Story text
1. Front cover: put the title inside the composition

What to change. Frame the illustration on green and overlap its upper edge with a wide, shaped cream cartouche. Give the child’s name the largest type on the book.

Why. The current cover reads as a sequence of separate blocks. Here, the cartouche interrupts the art frame and sits over the sky. The title, picture and border become one recognisable silhouette.

Element	Exact spec
Cover field	Pine to bleed. Use 3 mm as the default bleed, subject to the printer’s spec
Double frame	First rectangle x 8, y 8, w 194, h 194, ochre 0.35 mm stroke. Second rectangle x 10.5, y 10.5, w 189, h 189, ochre 0.18 mm stroke. Square corners
Illustration	x 16, y 24, w 178, h 170 mm, crop to fill. Add a 0.35 mm ochre border centred on the image edge
Cartouche	Cream fill, 0.50 mm ochre stroke, drawn over the art and its border. Bounds x 27–183, y 13–70 mm. Use the path below
Title, first line	Pip, Source Serif 4 Bold, 55 pt, tracking −12/1000 em, pine, centred at x 105, baseline y 40
Title, second line	and the Red Fox, Source Serif 4 Semibold, 28 pt, tracking −5/1000 em, pine, centred at x 105, baseline y 54
Ornament	One 8 × 4 mm moss sprig centred at (105, 62). Flank it with ochre rules from x 84–96 and x 114–126, both at y 62, 0.20 mm thick
M 42 17 H 79
Q 105 9 131 17
H 168 Q 168 27 183 30
V 53 Q 168 56 168 66
H 130 Q 105 74 80 66
H 42 Q 42 56 27 53
V 30 Q 42 27 42 17 Z

For the crop, use the plate path as an occlusion mask. The centre of the illustration is covered down to y 70, while the sides stay visible. Position Pip’s face below the plate, keep the fox clear, and let the lighthouse sit off to the right. Score candidate crops against those three areas before choosing one. For new art, pass the plate mask to the illustrator or image generator.

Personalisation rule. Measure shaped text including tracking. Fit each line to 126 mm. Reduce the name from 55 to 35 pt and the second line from 28 to 23 pt, in 1 pt steps. If either needs two lines, use baselines 31 / 43 / 55 mm, with 30 pt for name lines and 23 pt for subtitle lines. Flag any title that still overflows. Drop the “Adventure” label.

2. Interior: a mounted illustration and a visible reading entrance

What to change. Set the picture into a cream mount. Mark the first story page and genuine scene openings with a two-line initial. Use a small sprig and rule on each split page.

Why. You’ll see the change before reading a word. The mount makes the illustration feel deliberately placed, while the initial gives the reader a clear place to begin. Reserving initials for openings gives them a job across the book.

Element	Exact spec
Page grid	20 mm binding margin, 16 mm outer margin. Set x₀ = 20 on right-hand pages and x₀ = 16 on left-hand pages
Outer mount	x x₀, y 11, w 174, h 123 mm. Cream fill, 0.25 mm moss stroke
Illustration opening	x x₀ + 3, y 14, w 168, h 117 mm. Crop to fill, with a 0.20 mm moss keyline centred on its edge
Divider	Centred over the 158 mm story column at y 141. Moss sprig 8 × 4 mm, with two 14 mm moss rules, 0.20 mm thick, each starting 9 mm from the centre
Story	x x₀, w 158 mm, first baseline y 155. Source Sans 3 Regular 22/27 pt, tracking 0, ink, left-aligned with a ragged right edge
Opening initial	Source Serif 4 Semibold 52 pt, moss. Align its visible cap top with the body cap top on line 1. Reserve 18 mm at the start of lines 1 and 2, widening the reserve to the initial’s ink width plus 3 mm for wider letters
Continuation pages	Use the full 158 mm measure from line 1. Keep the divider and first baseline in the same position
Folios	Off by default. If needed, 9 pt Source Sans 3 Regular, moss, baseline y 202, aligned to the outer edge of the mount

Use actual glyph bounds for the initial. If the story starts with a quotation mark or a glyph that will not fit the two-line space, use the normal paragraph opening. Wrap against the actual line widths, allow five lines maximum, and penalise single-word final lines. For a crowded opening, try the full-width paragraph first, then 21/26 pt. Flag anything still over five lines for repagination.

For the supplied illustration, protect Pip’s feet, the fox’s face and the lighthouse. If all three cannot survive the wide crop, place a 117 × 117 mm square inside the same mount, centred horizontally, and move its keyline to the actual image edge.

Overlay variant. Run the image to bleed. Use a solid cream panel x x₀, y 128, w 174, h 69 mm, with a 0.25 mm moss border. Place the divider at y 135 and the first story baseline at y 147, with 8 mm side insets for the same 158 mm measure. Use regular paragraph openings on overlays. Protect essential action above y 122, or use the split template for that scene.

3. Back cover: a framed vignette and one clear reading order

What to change. Repeat the pine field and double border. Set a round lighthouse vignette above the blurb, with the personalised sign-off and imprint grouped below.

Why. The back will read as the other side of the same book. The circular mount contrasts with the large rectangular front image and gives the eye a clear starting point.

Element	Exact spec
Field and border	Same as front, including bleed
Vignette mount	Circle centred at (105, 51), cream fill, radius 28 mm, 0.40 mm ochre stroke. Clip the lighthouse image to radius 24 mm and put a 0.20 mm ochre ring at that edge
Blurb	x 43, w 124 mm, first baseline y 96. Source Sans 3 Regular 17/22 pt, cream, ragged right. Aim for four to five lines, maximum six
Personalised sign-off	“Made especially for Pip.” Source Serif 4 Semibold Italic 16 pt, cream, centred, baseline y 151. Allow 140 mm width. For two lines, use y 147 / 154
Imprint divider	Ochre rule x 87–123, y 165, 0.25 mm thick
Imprint	Centre the logo and wordmark as a group, maximum 62 mm wide. Use a 6 mm logo mark, 3 mm gap, Source Sans 3 Semibold 12 pt, baseline y 177. Centre “by The Children’s Library” beneath it at 10 pt, baseline y 185

Keep the vignette focused on one subject. For this book, use the lighthouse against a small patch of sky and sea. Crop from the existing art if the lighthouse reads cleanly at 48 mm across. Here’s the blurb I’d use:

Pip spots a flash of red in the grass. A little fox is watching from behind the dunes. Will it come out to play?

4. Repeat one ornament

What to change. Use one three-leaf sprig on the cover plate, story dividers and title page. Use it alone at genuine section breaks.

Why. A repeated ornament helps the pages feel like one book. Keeping it small lets the illustrations carry the detail.

Define the sprig in an 8 × 4 mm viewBox. Fill the leaves in moss on cream and use cream on pine. Draw the stem with a 0.20 mm stroke and round caps.

<!-- Stem -->
M 0.7 3.5 Q 3.9 3.2 7.3 1.2

<!-- Filled leaves -->
M 2.8 3.2 Q 0.8 2.7 1.2 1.0 Q 3.0 1.2 2.8 3.2 Z
M 4.5 2.7 Q 2.8 1.8 3.7 0.4 Q 5.3 0.8 4.5 2.7 Z
M 5.7 2.2 Q 6.0 0.5 7.8 0.4 Q 7.8 1.8 5.7 2.2 Z

Title page. Use cream paper. Centre a 16 × 8 mm moss sprig at (105, 56). Set the name at 42 pt Source Serif 4 Bold, baseline y 81, and the rest of the title at 26 pt Semibold, baseline y 96. Add a 38 mm diameter circular crop of a story detail centred at (105, 133), with a 0.25 mm moss ring. Place the imprint at y 184, 10 pt. Use a single 8 mm sprig for section breaks, centred with 6 mm clear space above and below.

5. Scale the ornament and cover geometry. Reflow the story type.
Trim	Cover and back	Interior
A5 portrait, 148 × 210	Scale square composition coordinates, paths and display type by 148/210. Centre the composition vertically with +31 mm on y. Keep the pine field to bleed. Back blurb 13/17 pt in the scaled 87 mm column. Allow six lines and a seventh only if it clears the sign-off by 8 mm	Binding/outer margins 15/12 mm. Mount 121 × 117 mm, top y 12, with 2.5 mm inset. Divider y 137. Story 19/24 pt, 115 mm wide, first baseline y 150. Initial 43 pt. Allow six lines
A4 portrait, 210 × 297	Use the square composition at 1×, with +43.5 mm on y. Pine to bleed	Use the square horizontal grid. Mount 174 × 163 mm, top y 17. Divider y 192. Story 24/31 pt, first baseline y 208. Initial 56 pt
A4 landscape, 297 × 210	Use the square composition at 1×, with +43.5 mm on x. Pine to bleed	Centre the square split or overlay grid horizontally with +43.5 mm on x. Keep 22/27 pt story type and the 158 mm column. Use the side space for full-bleed art on overlay pages

For portrait overlays, use the split template’s horizontal grid. In A5 use a 121 × 74 mm cream panel at y 127, with 3 mm side insets and first baseline y 146. In A4 use a 174 × 82 mm panel at y 204, with 8 mm side insets and first baseline y 226. Keep the divider 8 mm below the panel top.

Acceptance test. Put the old and new covers side by side at 120 px wide. The pine field, cream cartouche and title hierarchy should register before the copy is legible. Then print the interior at 100% and test an opening, a continuation and a long personalised name. Check that the sprig and fine rules hold in print, the title clears the illustration’s focal points, and the story reads aloud without awkward breaks.


