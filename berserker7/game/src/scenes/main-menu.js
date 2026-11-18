// Main menu placeholder: the poster drawn like CSS `cover`, a mostly-opaque black panel
// where the menu will go, and the title music. No menu items yet.

import { Mesh, MeshBasicMaterial, OrthographicCamera, PlaneGeometry, Scene, SRGBColorSpace, TextureLoader } from 'three';

export const PANEL_WIDTH = 480;
export const PANEL_HEIGHT = 560;
export const PANEL_OPACITY = 0.85;
// Relative paths (no leading slash) so they work under any base path.
export const POSTER_URL = 'content/textures/posters/berserkerguy-classic.png';
export const MUSIC_URL = 'content/audio/music/titlescreen-1.mp3';

// Size of the image scaled to cover the view, drawn centred (the crop is equal on both sides).
export function coverSize(viewWidth, viewHeight, imageWidth, imageHeight) {
  const scale = Math.max(viewWidth / imageWidth, viewHeight / imageHeight);
  return { width: imageWidth * scale, height: imageHeight * scale };
}

// Size of the black panel: at most 480 x 560, and at most 90% of the width and 80% of the height.
export function panelSize(viewWidth, viewHeight) {
  return {
    width: Math.min(PANEL_WIDTH, 0.9 * viewWidth),
    height: Math.min(PANEL_HEIGHT, 0.8 * viewHeight),
  };
}

export function initMainMenu() {
  return { ticks: 0 };
}

export function tickMainMenu(state) {
  state.ticks += 1;
  return state;
}

export function createMainMenu({ music }) {
  let scene, camera, poster, panel, imageWidth, imageHeight;
  return {
    settings: { tick: 'uncovered', drawCovered: true, leave: 'suspend' },
    async load({ track }) {
      const texture = track(await new TextureLoader().loadAsync(POSTER_URL));
      texture.colorSpace = SRGBColorSpace;
      imageWidth = texture.image.width;
      imageHeight = texture.image.height;
      const geometry = track(new PlaneGeometry(1, 1));
      const posterMaterial = track(new MeshBasicMaterial({ map: texture }));
      const panelMaterial = track(
        new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: PANEL_OPACITY, depthWrite: false }),
      );
      poster = new Mesh(geometry, posterMaterial);
      panel = new Mesh(geometry, panelMaterial);
      panel.position.z = 1; // in front of the poster
      scene = new Scene();
      scene.add(poster, panel);
      camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
    },
    enter: () => {
      music.play(MUSIC_URL);
      return initMainMenu();
    },
    resume: () => music.play(MUSIC_URL),
    suspend: () => music.stop(),
    exit: () => music.stop(),
    tick: tickMainMenu,
    draw(state, view) {
      // CSS pixel units. Compared with the camera itself, not a cached size, because
      // load() builds a new camera after an unload or snapshot leave.
      const { width, height } = view;
      if (camera.right !== width / 2 || camera.top !== height / 2) {
        camera.left = -width / 2;
        camera.right = width / 2;
        camera.top = height / 2;
        camera.bottom = -height / 2;
        camera.updateProjectionMatrix();
      }
      const cover = coverSize(width, height, imageWidth, imageHeight);
      poster.scale.set(cover.width, cover.height, 1);
      const box = panelSize(width, height);
      panel.scale.set(box.width, box.height, 1);
      view.renderer.render(scene, camera);
    },
  };
}
