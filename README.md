# Notes Sidebar

A Chrome extension that records any selected content into a side panel.

## Features

- Select any text on a page and save it automatically.
- Detect formulas and save them as LaTeX when the page exposes TeX source (common with KaTeX / MathJax / MathML-based pages).
- Normalize saved content so everything appears in a unified style in the side panel.
- Copy individual saved notes.
- Use the side panel scratch pad to paste or write anything else.
- Works on Google Search pages and most normal websites.

## Install locally

1. Open `chrome://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Choose this folder.
5. Pin the extension if desired.

## How to use

1. Click the extension icon to open the side panel.
2. Keep **Auto-capture on mouse selection** enabled.
3. On any page, including Google Search, drag the mouse to select text.
4. The selected content is stored in the side panel automatically.
5. For formulas, the extension tries to extract LaTeX. If the page does not expose TeX, it stores a readable fallback instead.
6. You can also right-click selected text and choose **Save selection to sidebar**.

## Notes on formula support

This extension does not perform OCR. It extracts formula source only when the page already includes machine-readable formula metadata. That is the most reliable browser-extension approach for web formulas.

Good targets:
- KaTeX-rendered pages
- MathJax-rendered pages
- Some MathML-based pages
- Images whose alt text already contains LaTeX

## Publish to Chrome Web Store

1. Create a Chrome Web Store developer account.
2. Zip the extension folder.
3. Go to the Chrome Web Store Developer Dashboard.
4. Upload the zip package.
5. Fill listing details, screenshots, privacy disclosures, and category.
6. Submit for review.

## Privacy

Everything is stored locally with `chrome.storage.local`. No remote server is used in this version.


## v1.1 changes
- floating mini toolbar after selection: copy or save
- fixed right-click save fallback when selection gets lost
- side panel now opens by default after saving
