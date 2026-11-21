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
