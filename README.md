# Luke McWatters — academic website

A single-page static site hosted free on GitHub Pages.

- **Live URL (after publishing):** https://lukemcw.github.io
- **Files:** `index.html` (content), `style.css` (styling), `particles.js` (animated hero background)

## Editing

Everything is in `index.html`. To add a publication, copy an existing `<li>` block
inside the relevant `<ul class="pub-list">` and edit the title, link, date and authors.
Changes pushed to the `main` branch go live automatically within a minute or two.

## The animated hero

The dark banner runs a self-contained **product-space** animation (`particles.js`, no
external libraries), in the spirit of the Hoberg–Phillips text-network product space:
firms are points in a latent two-characteristic space, proximity means product similarity
(so nearby firms are linked competitors), and product characteristics evolve endogenously
— firms differentiate away from close rivals, cluster around drifting demand pockets, and
enter/exit/reposition over time. Hover highlights a firm's competitors; click launches a
new product there. It pauses off-screen and falls back to a static frame under reduced
motion. Tune the dynamics via the constants near the top of `particles.js` (`SIM_DIST`,
`R_REPEL`, `REPEL_K`, `ATTRACT_K`, `MAX_V`) and the entry/exit/reposition intervals.

## Using a custom domain (optional, not free)

GitHub Pages is free; a custom domain (e.g. `lukemcwatters.com`) costs ~£10/year from a
registrar. Once you own one, add a `CNAME` file containing the domain and set it under
the repository's **Settings → Pages → Custom domain**.
