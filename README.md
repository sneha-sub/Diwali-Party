# Diwali Party Photo Booth 🪔

A virtual photo booth for the Diwali Party 2026 that uses the
[Diwali Party brand identity](https://www.designbysneha.com/work/diwali-party): diyas, sparklers,
rangoli, jalebi, samosa, the gift-box wordmark, and the Marigold / Magenta / Indigo / Leaf / Gold / Rose palette.

Guests open the booth, pick a filter, add stickers, and strike a pose. **Let's get LIT!**

## Features

- **Live camera** preview, mirrored for selfies, with front/back camera flip
- **7 filters** built from the brand assets:
  | Filter | Look |
  | --- | --- |
  | Let's get LIT | Magenta polka-dot frame, lit diya, fizzing sparkler, wordmark |
  | Gift Wrap | Colour-blocked wrapping-paper frame with a gold ribbon and bow |
  | Rangoli | Indigo dotted frame with slowly spinning rangoli badges, "Shubh Deepavali" |
  | Snack Attack | Leaf-green frame with a spinning jalebi and samosa, "Sweet & Savory" |
  | Festival of Lights | Warm glow, floating lights, a row of diyas |
  | Sparklers | Two sparklers with animated sparks |
  | Clean | Just a small wordmark in the corner |
- **Warm lighting**: every photo gets clean, sharp, warm evening light (no grain or blur): deep blacks, golden highlights, natural warm skin, and cool/blue casts removed
- **Lettering rule**: each design uses either the "Lets get LIT!" colour-block banner (drawn in code, Outfit ExtraBold) or the Diwali Party wordmark, never both. Each filter has a `mark` setting for this
- **Stickers**: tap to add any brand illustration. Drag to move, pinch (or scroll) to resize,
  two-finger twist (or shift+scroll) to rotate, double-tap (or Delete) to remove
- **Booth-style shooting**: press the shutter and it takes 3 photos, each with a 3-2-1 timer, beep, shutter sound and flash, filling a film tray as it goes. Press Space to shoot on a laptop
- **Printing**: the strip feeds out of a brand-styled booth printer and develops from a pale blank into full colour. Photos sit straight on the strip, which takes the filter's colours, with the wordmark and "Let's get LIT!" once at the bottom. Single mode prints one framed photo the same way
- **Save to Camera Roll**: opens the phone share sheet (on iPhone, "Save Image" puts it in Photos); downloads on desktop. Plus a gallery of this visit's photos
- **Use a photo** if the camera isn't available

Photos are processed entirely in the browser. Nothing is uploaded.

## Running it

It's a static site with no build step:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Browsers only allow camera access on `https://` or `localhost`, so host it somewhere with HTTPS
(GitHub Pages, Netlify, Vercel, etc.) for guests to use it on their phones.

## Files

- `index.html`: screens (welcome, booth, result, gallery)
- `style.css`: brand styling
- `app.js`: camera, filter drawing, stickers, capture
- `assets/brand/`: brand illustrations from designbysneha.com

To add a filter, add an entry to the `FILTERS` array in `app.js` with a `name`, a CSS `swatch`,
and a `draw(ctx, t)` function that paints over the 1080×1350 photo (`t` is time in seconds, for animation).

## Poster

`poster/` has a printable poster with a QR code to the booth, in two sizes:
- A4: `diwali-photo-booth-poster-a4.pdf` (and `.png`)
- US Letter: `diwali-photo-booth-poster.pdf` (and `.png`)

Print the PDF full bleed; the PNG is for sharing. Open `poster.html?size=a4` for the A4 layout.
`poster.html` is the source. To regenerate the QR code for a different URL:
`python3 -c "import segno; segno.make('URL', error='h').save('poster/qr.svg', scale=10, border=0, dark='#14124a', light=None)"`
then print `poster.html` from a browser with background graphics on.

There's also a matching **"Lounge booked for a private event"** sign:
`poster/lounge-sign-a4.pdf` (A4) and `poster/lounge-sign.pdf` (US Letter), source `poster/lounge-sign.html`.
