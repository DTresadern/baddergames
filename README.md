# Badder Games

Browser games. Each game lives in its own folder and is published to GitHub Pages under its folder name.

| Game | Folder | Play |
| --- | --- | --- |
| Technophage: online co-op side-scrolling shooter | [`technophage/`](technophage/) | https://dtresadern.github.io/baddergames/technophage/ |

## Publishing

`.github/workflows/pages.yml` runs on every push to `main`. It copies each game's runtime files into a site folder and deploys it with GitHub Pages; concept art, references and tools are not published.

To add a game: put it in a new folder with its own `index.html`, using relative paths only, then add a copy step for it in the workflow and a link in the root `index.html`.

## Running locally

`python3 -m http.server 8000 # run in this folder`

Then open `http://localhost:8000/technophage/`.
