# Logo File Instructions

## Where to Place Your Animated Logo

Place your animated banner logo file in this `public` folder.

## Supported Formats

The logo component supports:
- **Animated GIF** (`.gif`) - Recommended for simple animations
- **Video files** (`.webm`, `.mp4`) - For more complex animations
- **Static images** (`.png`, `.svg`) - As fallback

## File Naming

1. Name your file `logo.gif` (or `logo.webm`, `logo.mp4`, etc.)
2. OR update the `LOGO_FILENAME` constant in `components/Logo.tsx` to match your filename

## Example

If your file is named `owltopia-banner.gif`, either:
- Rename it to `logo.gif`, OR
- Update `components/Logo.tsx` line 11 to: `const LOGO_FILENAME = '/owltopia-banner.gif'`

## File Location

```
public/
  └── logo.gif  (or your filename)
```

The logo will automatically appear in the header of all pages.
