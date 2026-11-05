# Generated pixel art

Created with the built-in `image_gen` tool. Original raster files were copied into the project without editing.

## Miami hero

File: `public/assets/miami-hero.png` (1536 × 1024)

Prompt:

> Use case: stylized-concept.
> Asset type: landscape hero illustration for a funny browser multiplayer pixel-art game, wide 1536x1024 composition.
> Primary request: Miami at sunset meets Roboflow's cute Lenny raccoon mascot, arcade action and cooperative chaos.
> Scene: pastel art-deco Miami Beach hotels with stepped roofs, turquoise ocean and canals, tall curved palm trees, huge peach sunset disk and pink clouds. A large funny green crocodile taxi races along the foreground boardwalk carrying a small gray raccoon with a gold crown and mint shirt. Other expressive gray raccoons with black eye masks and striped tails wear coral and aqua shirts; one has huge sunglasses and a tiny jetpack, another joyfully runs carrying a glowing blue data cube. Characters are prominent, cute mischievous and readable. Confetti and glowing squares suggest friendly competition.
> Style: expertly crafted 16-bit pixel art, visible crisp square pixels, dark navy pixel outlines, limited saturated palette, strong side-scrolling platformer composition, layered parallax depth, warm peach and pink sky contrasted with mint turquoise and deep purple shadows.
> Composition: scene fills frame, main crocodile and raccoons centered in the lower two thirds, generous sky above, all bodies intact. Delightful premium indie game cover art. No lettering, no labels, no logos, no watermark, no gradients or smooth vector curves.

## Lenny and crocodile atlas

File: `public/assets/lenny-sprites.png` (1254 × 1254, RGBA with transparency)

The eight generated sprites were visually inspected. The generator changed the requested resolution and did not keep exact equal cell padding. Use the following source rectangles to crop at render time; the original file has not been edited.

| Sprite        |   x |   y | width | height |
| ------------- | --: | --: | ----: | -----: |
| Aqua idle     |  24 | 202 |   256 |    316 |
| Aqua running  | 324 | 202 |   275 |    307 |
| Aqua captain  | 628 | 172 |   281 |    345 |
| Aqua warrior  | 970 | 202 |   260 |    315 |
| Coral idle    |  24 | 798 |   257 |    316 |
| Coral running | 315 | 797 |   277 |    307 |
| Coral captain | 613 | 764 |   280 |    350 |
| Crocodile     | 903 | 887 |   350 |    180 |

Prompt:

> Use case: stylized-concept.
> Asset type: production sprite atlas for a Miami pixel-art raccoon browser game.
> Create a square 1024x1024 transparent PNG sprite sheet organized into EXACTLY 4 equal columns and 2 equal rows, eight invisible cells of 256 pixels wide and 512 pixels tall. Each sprite centered in its own cell with generous transparent padding, isolated no touching or overlapping cells. No visible grid or cell background.
> Style: consistent cute 16-bit pixel art, crisp square pixels, limited colors and dark navy pixel outlines. Raccoons resemble a cute gray Lenny mascot with black eye mask, small pointed ears, rounded face, striped gray tail, little hands and feet. All raccoons face to the right in clear side/three-quarter view, full body, same scale. Avoid smooth vector art or shading gradients.
> TOP ROW left to right: 1. gray raccoon mint/aqua T-shirt idle standing; 2. same mint-shirt raccoon in energetic running pose; 3. same raccoon wearing a gold crown and mint cape, captain stance; 4. mint-shirt raccoon with oversized dark sunglasses and small jetpack, warrior stance.
> BOTTOM ROW left to right: 1. same gray raccoon coral-pink T-shirt idle standing; 2. coral-shirt raccoon energetic running pose; 3. coral-shirt raccoon gold crown and coral cape captain stance; 4. a funny lime-green crocodile taxi, whole elongated horizontal body facing right, little legs, long snout with friendly teeth, gold saddle with black-and-yellow taxi checker trim.
> The sprites should have roughly 16 native-pixel character height with nearest-neighbor upscaled pixel blocks for crisp game use, not hundreds of tiny details. Sprite character width about 160px each and height about 200px, aligned vertically in center of each 512px tall cell. Crocodile width about 220px. Truly transparent background alpha. NO text, numbers, labels, frames, logos, shadow cast on background, or watermark.

## Roboflow purple update

Built-in `image_gen` edits; original assets retained. All edited outputs visually inspected.

- `public/assets/lenny-sprites-purple.png`: 1254 × 1254 RGBA; unchanged atlas layout and crop rectangles. Four top-row characters now wear purple Roboflow-themed shirts with white pixel R; captain cape is purple.
- `public/assets/miami-hero-purple.png`: 1536 × 1024; purple team shirts and R emblems.
- `public/assets/miami-hero-ai1.png`: 1536 × 1024; final hero using purple shirts plus the AI1 camera jetpack. Product appearance follows the user-provided Roboflow AI1 photograph.

### Purple sprite edit prompt

> Use case: precise-object-edit. Edit target: the provided transparent 1254x1254 pixel-art character sprite sheet. Change ONLY the clothing colors on the FOUR RACCOONS IN THE TOP ROW: their mint/aqua/teal shirts and the third character's teal cape must become vibrant Roboflow purple (#7851e8) with lavender highlights and dark purple shadows. Add a small simple WHITE PIXEL CAPITAL R on the chest of each top-row raccoon's shirt where visible, as Roboflow-themed team shirts. Preserve gray fur, black eye masks, poses, faces, tails, crowns, sunglasses and orange flames. Preserve ALL bottom-row coral raccoons and green crocodile exactly. Preserve original canvas dimensions 1254x1254, sprite positions, silhouettes, alpha transparency and the exact 4-column2-row atlas arrangement: no moving, rescaling, zooming, cropping or adding characters. Background remains genuinely transparent. Keep crisp square pixels and dark outlines. No text anywhere except tiny white R chest emblems.

### Purple hero edit prompt

> Use case: precise-object-edit. Edit target: provided 1536x1024 Miami pixel-art hero illustration. Change ONLY every mint/aqua T-shirt worn by raccoons to vibrant Roboflow PURPLE (#7851e8) with lavender highlights and deep purple shadows: the main crowned raccoon riding the crocodile, the foreground left cheering raccoon, the background balcony and bridge mint-shirt raccoons. Add a small simple WHITE PIXEL CAPITAL R chest emblem wherever the purple shirt chest is visible, as Roboflow-themed shirts. Keep all coral-shirt raccoons coral, and add a tiny white pixel R on visible coral shirts too. Preserve the full exact composition, character sizes/poses, gray fur, black eye masks, gold crown, giant green crocodile taxi, palms, ocean, art deco buildings, sky, shadows and all scenery colors. Do not recolor aqua ocean or architecture. Same1536x1024 landscape canvas. Maintain crisp16-bit pixel-art style. No text except the tiny white R emblems, no labels, no watermark.

### AI1 camera hero edit prompt

> Use case: precise-object-edit.
> Image1 is the EDIT TARGET: a1536x1024pixel-art Miami hero illustration with raccoons in purple and coral Roboflow R shirts.
> Image2 is PRODUCT REFERENCE ONLY: the Roboflow AI1 industrial camera.
> Make ONE targeted edit in Image1: replace the generic cyan rocket backpack worn by the flying sunglasses raccoon in the UPPER RIGHT with a recognizable PIXEL-ART ROBOfLOW AI1 CAMERA backpack based on Image2. The new backpack has a chunky black rectangular industrial body; square front lens panel with a big round black lens surrounded by eight small white LEDs; purple vertical side stripe marked tiny AI1 if readable; lower black cooling fins. Face the camera lens slightly toward the viewer so the product identity is recognizable. Mount camera on the raccoon's back, approximately the old rocket's size or only slightly larger for readability. Keep the orange jet flame below as whimsical game propulsion.
> Preserve all other Image1 content exactly:1536x1024canvas, full composition and framing, raccoon pose and size, sunglasses, coral shirt with white R, gray fur, every other raccoon and purple/coral shirt, crocodile, crown, ocean, palms, sunset, art deco buildings and all pixel-art details. The ONLY changed region is the flying raccoon's backpack and its immediate flame connection. No new text except tiny AI1 on the backpack. Keep crisp16-bit pixel art, no photographic patch, no giant camera elsewhere.
