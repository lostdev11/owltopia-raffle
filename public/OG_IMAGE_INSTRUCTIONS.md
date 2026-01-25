# Open Graph Image Instructions

## Creating an Optimized Social Media Preview Image

For the best link preview experience on social media platforms (Twitter, Facebook, LinkedIn, Discord, etc.), create an optimized Open Graph image.

## Recommended Specifications

- **File name:** `og-image.png` (place in the `public` folder)
- **Dimensions:** 1200 x 630 pixels (1.91:1 aspect ratio)
- **Format:** PNG or JPG
- **File size:** Under 1MB (ideally under 300KB)
- **Content:** Your logo/branding with a clean, readable design

## Quick Steps

1. Create or export your logo/branding image at 1200x630 pixels
2. Save it as `og-image.png` in the `public` folder
3. The metadata is already configured to use this file automatically

## Alternative: Using Existing Images

If you don't create `og-image.png`, the system will automatically fall back to `icon.png`. However, for best results on social media, a properly sized `og-image.png` is recommended.

## Testing Your Image

After deploying, test your link preview using:
- [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/)
- [Twitter Card Validator](https://cards-dev.twitter.com/validator)
- [LinkedIn Post Inspector](https://www.linkedin.com/post-inspector/)

Note: Social media platforms cache previews, so you may need to clear the cache or wait a few minutes for changes to appear.
