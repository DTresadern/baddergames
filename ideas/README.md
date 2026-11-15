# Idea cloud

A folder of game-design ideas and a page that draws them as a network graph. Each idea is a circle. Ideas that share tags are joined by a line, and the more tags they share, the closer together and the thicker the line.

No build step, no libraries, no network requests. Just `index.html`, `style.css`, `app.js` and `ideas.json`.

## View it

Serve the repository with any static web server. From the repository root:

`python3 -m http.server`

Then open `http://localhost:8000/ideas/`.

Controls:

- Click an idea to open its details. Click a related idea in the details to jump to it.
- Drag empty space to pan. Scroll wheel zooms towards the cursor. On touch, pinch to zoom and drag to pan.
- Drag an idea to move it. It stays where you drop it and its neighbours adjust.
- "Fit view" (or key `0` with the graph focused) shows everything again.

## ideas.json format

The file is an object with one key, `ideas`, holding a list of ideas.

| Field | Required | Type | Notes |
|---|---|---|---|
| `id` | yes | string | Unique, kebab-case, for example `procedural-levels` |
| `title` | yes | string | Shown as the label in the graph |
| `description` | no | string | One to three sentences, shown in the details |
| `tags` | no | array of strings | Lowercase. Missing means no tags |
| `links` | no | array of ids | Connect to other ideas even without shared tags |

Rules:

- Ids must be unique. If an id appears twice, the first one is kept.
- Ideas without an `id` or `title` are skipped.
- `links` must reference ids that exist. Unknown ids are ignored.
- A link only needs to be listed on one of the two ideas.

Example:

```json
{
  "ideas": [
    {
      "id": "procedural-levels",
      "title": "Procedural levels",
      "description": "Levels stitched together from hand-made chunks.",
      "tags": ["procedural", "level-design"],
      "links": ["pixel-art-style"]
    }
  ]
}
```

## Add an idea

1. Add a new object to the `ideas` list in `ideas.json`.
2. Reload the page. Nothing else needs to change.

## How the layout works

Every idea repels every other idea. Each connection acts as a spring: its rest length shrinks and its stiffness grows with the number of shared tags (an explicit link counts as one). A weak pull towards the centre keeps unconnected ideas on screen. Start positions are fixed (on a circle), so the layout is the same on every reload. The simulation stops once movement dies down, and the view is then fitted to the window.

## Opening from disk

Browsers block `fetch` for files opened directly (`file://`). If you open `index.html` that way, the page shows a message and a "Choose ideas.json" button. Pick the `ideas.json` file and the graph is drawn from it. Serving the folder as described above avoids this.
