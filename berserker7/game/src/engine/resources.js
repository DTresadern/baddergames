// A scene's list of three.js objects that hold GPU memory: geometries,
// materials, textures, render targets. Garbage collection never frees GPU
// memory, so a scene tracks each such object here and disposes the list when it
// unloads.

export function createResourceList() {
  let items = [];
  return {
    track(obj) {
      items.push(obj);
      return obj;
    },
    // Disposes in reverse order of tracking and empties the list.
    disposeAll() {
      const list = items;
      items = [];
      for (let i = list.length - 1; i >= 0; i--) list[i].dispose();
    },
    count() {
      return items.length;
    },
  };
}
