import {
  BoxGeometry,
  Mesh,
  MeshNormalMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { showVersion } from './version.js';

showVersion(document.getElementById('version'));

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x1b1f2a);
document.body.appendChild(renderer.domElement);

const scene = new Scene();
const cube = new Mesh(new BoxGeometry(1, 1, 1), new MeshNormalMaterial());
cube.rotation.set(0.5, 0.7, 0);
scene.add(cube);

const camera = new PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
}

window.addEventListener('resize', resize);
resize();
