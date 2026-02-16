# Open Graph Image Instructions

## Where the image lives

The site uses **Next.js file convention**: `app/opengraph-image.png` is served at `/opengraph-image` and used for link previews. A copy is also kept in `public/og-image.png` for reference.

## Recommended specs for the image

- **Dimensions:** 1200 x 630 pixels (1.91:1 aspect ratio)
- **Format:** PNG or JPG
- **File size:** Under 1MB (ideally under 300KB)
- **Content:** Logo/branding, clean and readable

## Updating the preview image

1. Replace `app/opengraph-image.png` with your new image (1200x630).
2. Optionally update `app/opengraph-image.alt.txt` for the image alt text.

## If link previews still show the old image

Platforms cache previews. After deploying:

1. **Facebook:** [Sharing Debugger](https://developers.facebook.com/tools/debug/) → enter your URL → click **Scrape Again**.
2. **Twitter/X:** [Card Validator](https://cards-dev.twitter.com/validator) → enter URL → validate again.
3. **LinkedIn:** [Post Inspector](https://www.linkedin.com/post-inspector/).
4. **Discord:** Previews can take time to refresh; try sharing in a new channel or wait 24–48 hours.

Always use your **live site URL** (e.g. `https://www.owltopia.xyz`) when testing; localhost and preview URLs won’t show the correct preview.
