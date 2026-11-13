import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/vt323/400.css';
import './style.css';

/* =========================================================
   Cidade dos Dados — comparação de tipos de extração
   Carro sujo = dado bruto. No caminho até o banco ele passa por:
   área de pouso (raw) → pedágio (validação de schema) → lava-rápido
   (transformação) → detector de duplicados → posto (enriquecimento)
   → portão de carga (load) → banco de dados.
   Uma coleta aparece por vez; clique nos objetos para entender.
   ========================================================= */

const $ = (s) => document.querySelector(s);
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ---------- layout da cidade ----------
const ROAD_X0 = -26;   // início do seu pipeline (fronteira)
const ROAD_X1 = 36;    // entrada do banco de dados
const S_END = ROAD_X1 - ROAD_X0;
const DEST_X = 38.5;   // primeira vaga do estacionamento do banco
const DB_X = 57;       // prédio do banco
const GAP = 2.3;
const CAR_SPEED = 7;
const DIRTY = 0x7a5c3a;
const RED = 0xd8443c;

// Estações do caminho até o banco. "t: true" = etapa de transformação
// (no modo ELT ela não acontece na estrada, só dentro do banco).
const STATIONS = [
  { id: 'landing', x: -19, stop: 0.45, t: false },
  { id: 'toll', x: -9, stop: 0.5, t: true, rejects: 'schema' },
  { id: 'wash', x: 1, stop: 0.9, t: true, rejects: 'formato' },
  { id: 'dedup', x: 11, stop: 0.45, t: true, rejects: 'duplicado' },
  { id: 'fuel', x: 21, stop: 0.6, t: true },
  { id: 'load', x: 31, stop: 0.35, t: false },
];
const WHERE = { schema: 'na validação de schema', formato: 'no lava-rápido', duplicado: 'no detector de duplicados' };

const LANES = [
  {
    id: 'api', name: 'Coleta via API', z: -40, color: 0x4c8dff, css: '#4c8dff', mud: 1,
    defects: { schema: 0.03, formato: 0.02, duplicado: 0.04 },
    reasons: {
      schema: ['campo obrigatório nulo', 'JSON sem o campo "id"'],
      formato: ['preço "N/A"'],
      duplicado: ['id repetido em duas páginas'],
    },
    extracting: 'Veio na resposta da API, em JSON.',
  },
  {
    id: 'scrap', name: 'Web Scraping', z: 0, color: 0xff8a3d, css: '#ff8a3d', mud: 4,
    defects: { schema: 0.08, formato: 0.12, duplicado: 0.08 },
    reasons: {
      schema: ['HTML quebrado', 'nome vazio'],
      formato: ["preço 'Consulte'", 'data "ontem"'],
      duplicado: ['produto repetido na página 2'],
    },
    extracting: 'É uma cópia do que o robô leu no HTML da página.',
  },
  {
    id: 'batch', name: 'Arquivo em lote', z: 40, color: 0x3ecf7a, css: '#3ecf7a', mud: 2,
    defects: { schema: 0.05, formato: 0.06, duplicado: 0.05 },
    reasons: {
      schema: ['linha com colunas a mais'],
      formato: ['encoding "Ã©"', 'data 31/02'],
      duplicado: ['linha repetida no arquivo'],
    },
    extracting: 'É uma linha do arquivo CSV que chegou no lote.',
  },
];
const LANE = Object.fromEntries(LANES.map((L) => [L.id, L]));

const state = {
  sim: 0, speed: 1, paused: false, mode: 'ETL', active: LANE.api,
  rateLimit: false, siteBroken: false, follow: null,
  genEvery: 1.6, nextGen: 0.5,
  pollEvery: 3, batchEvery: 22,
};

// ---------- renderer ----------
const wrap = $('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap;
wrap.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5d9c44);   // fundo da cor da grama: nunca aparece céu

// ---------- câmera ----------
// MapControls: arrastar = mover pelo mapa · botão direito = girar · scroll = zoom no cursor
const CAM_OFFSET = V(-12, 40, 40);   // posição da câmera relativa ao ponto que ela olha
const CAM_CENTER_X = -14;
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 800);
const controls = new MapControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = false;          // move no plano do chão
controls.zoomToCursor = true;
controls.minZoom = 0.45;
controls.maxZoom = 5;
controls.maxPolarAngle = Math.PI * 0.44;
controls.minPolarAngle = Math.PI * 0.04;
controls.keyPanSpeed = 25;
controls.listenToKeyEvents(window);           // setas do teclado também movem

function resize() {
  const w = wrap.clientWidth, h = wrap.clientHeight;
  renderer.setSize(w, h, false);
  const a = w / h;
  const view = Math.max(20, 54 / a);
  camera.left = -view * a / 2; camera.right = view * a / 2;
  camera.top = view / 2; camera.bottom = -view / 2;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- luz ----------
scene.add(new THREE.HemisphereLight(0xdff2ff, 0x4b6b2a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -66, right: 66, top: 30, bottom: -30, near: 1, far: 220 });
scene.add(sun, sun.target);
function aimSun(z) {
  sun.position.set(-22, 60, z + 25);
  sun.target.position.set(8, 0, z);
}

// ---------- helpers de voxel ----------
const BOX = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();
function M(c) {
  if (!matCache.has(c)) matCache.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return matCache.get(c);
}
function bx(parent, w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(BOX, opts.mat || M(color));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
// marca um objeto como clicável: o clique mostra o texto de OBJ_INFO[key]
function tag(obj, key, L) { obj.userData.info = key; obj.userData.lane = L; return obj; }
function grp(parent, key, L) { const g = new THREE.Group(); tag(g, key, L); parent.add(g); return g; }

// ---------- balões de evento (só da coleta visível) ----------
const labelsEl = $('#labels');
const pops = [];
function popup(L, text, pos, kind = '') {
  if (L !== state.active) return;
  const el = document.createElement('div');
  el.className = 'pop ' + kind;
  el.textContent = text;
  labelsEl.appendChild(el);
  pops.push({ el, pos: pos.clone(), t: 0, life: 2.4 });
}
function clearPops() { for (const p of pops) p.el.remove(); pops.length = 0; }
const tmpV = new THREE.Vector3();
function toScreen(p) {
  tmpV.copy(p).project(camera);
  return [(tmpV.x + 1) / 2 * wrap.clientWidth, (1 - tmpV.y) / 2 * wrap.clientHeight];
}
function updatePops(realDt) {
  for (let i = pops.length - 1; i >= 0; i--) {
    const p = pops[i];
    p.t += realDt;
    const k = p.t / p.life;
    const [x, y] = toScreen(p.pos);
    p.el.style.transform = `translate(${x | 0}px, ${(y - 10 - k * 34) | 0}px) translate(-50%, -100%)`;
    p.el.style.opacity = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    if (k >= 1) { p.el.remove(); pops.splice(i, 1); }
  }
}

// ---------- movimento por caminho ----------
function mover(pts, speed) {
  const segs = []; let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = pts[i].distanceTo(pts[i + 1]);
    segs.push({ a: pts[i], b: pts[i + 1], l }); len += l;
  }
  return { segs, len, d: 0, speed };
}
function stepMover(obj, m, dt) {
  m.d = Math.min(m.len, m.d + m.speed * dt);
  let d = m.d;
  for (let i = 0; i < m.segs.length; i++) {
    const s = m.segs[i];
    if (d <= s.l || i === m.segs.length - 1) {
      const t = s.l > 0 ? Math.min(1, d / s.l) : 1;
      obj.position.x = s.a.x + (s.b.x - s.a.x) * t;
      obj.position.z = s.a.z + (s.b.z - s.a.z) * t;
      if (s.l > 0.01) obj.rotation.y = Math.atan2(-(s.b.z - s.a.z), s.b.x - s.a.x);
      break;
    }
    d -= s.l;
  }
  return m.d >= m.len;
}

// ---------- modelos ----------
const WHEEL = M(0x1d1f26), GLASS = M(0x9fd8ff), LIGHT = M(0xffe28a), MUDM = M(0x4a3420);
function makeCar(rec) {
  const L = rec.L;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: DIRTY });
  bx(g, 1.8, 0.55, 0.95, 0, 0, 0.22, 0, { mat: bodyMat });
  bx(g, 0.95, 0.45, 0.85, 0, -0.12, 0.77, 0, { mat: bodyMat });
  bx(g, 0.06, 0.34, 0.74, 0, 0.37, 0.8, 0, { mat: GLASS, cast: false });
  bx(g, 0.06, 0.3, 0.74, 0, -0.6, 0.8, 0, { mat: GLASS, cast: false });
  for (const [x, z] of [[0.55, 0.45], [-0.55, 0.45], [0.55, -0.45], [-0.55, -0.45]]) bx(g, 0.42, 0.42, 0.18, 0, x, 0, z, { mat: WHEEL });
  bx(g, 0.05, 0.12, 0.2, 0, 0.91, 0.42, 0.3, { mat: LIGHT, cast: false });
  bx(g, 0.05, 0.12, 0.2, 0, 0.91, 0.42, -0.3, { mat: LIGHT, cast: false });
  const mudG = new THREE.Group();
  for (let i = 0; i < L.mud + 1; i++) {
    const s = rnd(0.2, 0.38);
    bx(mudG, s, 0.08, s, 0, rnd(-0.7, 0.7), 0.77, rnd(-0.3, 0.3), { mat: MUDM, cast: false });
  }
  for (let i = 0; i < L.mud; i++) bx(mudG, 0.3, 0.2, 0.04, 0, rnd(-0.6, 0.6), rnd(0.3, 0.55), 0.49, { mat: MUDM, cast: false });
  g.add(mudG);
  // bagageiro amarelo = dado extra que vem do enriquecimento
  const rack = new THREE.Group();
  bx(rack, 0.7, 0.28, 0.6, 0xffd34d, -0.12, 1.22, 0);
  bx(rack, 0.72, 0.06, 0.62, 0xb8901a, -0.12, 1.36, 0);
  rack.visible = false;
  g.add(rack);
  g.userData = { bodyMat, mudG, rack, info: 'car', rec, lane: L };
  L.root.add(g);
  return g;
}
function disposeCar(g) {
  g.parent && g.parent.remove(g);
  g.userData.bodyMat.dispose();
}
function paintCar(rec, color) {
  rec.mesh.userData.bodyMat.color.set(color);
  rec.mesh.userData.mudG.visible = false;
}

function makeVan(L) {
  const g = grp(L.root, 'van', L);
  bx(g, 2.2, 1.3, 1.1, 0xf4f4f4, -0.1, 0.25, 0);
  bx(g, 2.22, 0.22, 1.12, L.color, -0.1, 0.75, 0);
  bx(g, 0.06, 0.45, 0.9, 0, 1.0, 0.95, 0, { mat: GLASS, cast: false });
  for (const [x, z] of [[0.65, 0.5], [-0.75, 0.5], [0.65, -0.5], [-0.75, -0.5]]) bx(g, 0.46, 0.46, 0.18, 0, x, 0, z, { mat: WHEEL });
  bx(g, 0.5, 0.5, 0.5, 0xffd34d, -0.5, 1.55, 0); // "envelope" da requisição
  return g;
}
function makeRobot(L) {
  const g = grp(L.root, 'robot', L);
  bx(g, 0.25, 0.5, 0.25, 0x444a58, 0, 0, 0.22);
  bx(g, 0.25, 0.5, 0.25, 0x444a58, 0, 0, -0.22);
  bx(g, 0.75, 0.75, 0.8, 0xc9ced8, 0, 0.5, 0);
  const head = bx(g, 0.65, 0.5, 0.65, 0xe7ebf2, 0, 1.3, 0);
  bx(g, 0.66, 0.14, 0.5, 0, 0, 1.47, 0, { mat: M(0xff5a3c), cast: false });
  bx(g, 0.06, 0.4, 0.06, 0x444a58, 0, 1.8, 0);
  bx(g, 0.16, 0.16, 0.16, 0xff8a3d, 0, 2.2, 0);
  g.userData.head = head;
  return g;
}
function makeTruck(L) {
  const g = grp(L.root, 'truck', L);
  bx(g, 1.3, 1.3, 1.2, L.color, 2.1, 0.25, 0);
  bx(g, 0.06, 0.45, 1.0, 0, 2.76, 0.95, 0, { mat: GLASS, cast: false });
  bx(g, 3.6, 0.2, 1.2, 0x5b5f6b, -0.4, 0.35, 0);
  bx(g, 3.6, 0.12, 1.2, 0x5b5f6b, -0.4, 1.35, 0);
  for (const x of [-2.1, 1.3]) bx(g, 0.12, 1.1, 0.12, 0x5b5f6b, x, 0.35, 0.55), bx(g, 0.12, 1.1, 0.12, 0x5b5f6b, x, 0.35, -0.55);
  for (const [x, z] of [[2.2, 0.55], [0.6, 0.55], [-1.6, 0.55], [2.2, -0.55], [0.6, -0.55], [-1.6, -0.55]]) bx(g, 0.5, 0.5, 0.2, 0, x, 0, z, { mat: WHEEL });
  const minis = [];
  for (const [x, y] of [[0.5, 0.55], [-0.6, 0.55], [-1.7, 0.55], [0.5, 1.47], [-0.6, 1.47], [-1.7, 1.47]]) {
    const c = new THREE.Group();
    bx(c, 0.95, 0.35, 0.75, DIRTY, 0, 0, 0);
    bx(c, 0.5, 0.25, 0.65, DIRTY, -0.05, 0.35, 0);
    c.position.set(x, y, 0);
    c.visible = false;
    g.add(c); minis.push(c);
  }
  g.userData.minis = minis;
  return g;
}
function makeBeam(L, key, color = 0xff5a3c) {
  const m = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color }));
  m.visible = false;
  tag(m, key, L);
  L.root.add(m);
  return m;
}
function setBeam(beam, a, b) {
  beam.position.copy(a).add(b).multiplyScalar(0.5);
  const d = a.distanceTo(b);
  beam.scale.set(d, 0.08, 0.08);
  beam.lookAt(b); beam.rotateY(Math.PI / 2);
  beam.visible = true;
}

// ---------- cenário (grama e árvores) ----------
bx(scene, 400, 1, 300, 0x6bb04f, 4, -1, 0, { cast: false });
for (let i = 0; i < 260; i++) {
  bx(scene, rnd(1, 3), 0.04, rnd(1, 3), pick([0x62a447, 0x76ba58, 0x5c9a42]), rnd(-120, 130), 0, rnd(-100, 100), { cast: false });
}
function tree(x, z) {
  const h = rnd(0.8, 1.6);
  bx(scene, 0.5, h, 0.5, 0x7a5232, x, 0, z);
  const c = pick([0x3f8f3a, 0x4ea845, 0x357a31]);
  bx(scene, 2, 1.6, 2, c, x, h, z);
  bx(scene, 1.2, 0.9, 1.2, c, x, h + 1.6, z);
}
for (const L of LANES) {
  for (let x = -52; x < 74; x += rnd(4, 7)) { tree(x, L.z + rnd(-13, -10)); tree(x + 2, L.z + rnd(10, 14)); }
  for (let i = 0; i < 6; i++) tree(rnd(-60, -50), L.z + rnd(-9, 9)), tree(rnd(64, 74), L.z + rnd(-9, 9));
}

// ---------- estações do caminho até o banco ----------
function buildStation(L, st) {
  const z = L.z, x = st.x, root = L.root;
  const g = grp(root, st.id, L);
  st.obj = g;
  if (st.id === 'landing') {
    // pórtico sobre a estrada + plataforma com caixas (a cópia bruta)
    bx(g, 0.4, 3, 0.4, 0x9aa3b5, x, 0, z - 1.6); bx(g, 0.4, 3, 0.4, 0x9aa3b5, x, 0, z + 1.6);
    bx(g, 0.6, 0.5, 3.8, L.color, x, 3, z);
    bx(g, 4.6, 0.1, 3.2, 0x7b8494, x, 0, z - 3.9, { cast: false });
    st.crates = [];
    for (let i = 0; i < 12; i++) {
      const c = bx(g, 0.75, 0.6, 0.75, i % 3 === 0 ? 0xb88c55 : 0xc9a46a, x - 1.5 + (i % 4) * 1, Math.floor(i / 8) * 0.6, z - 4.6 + (Math.floor(i / 4) % 2) * 1.2);
      c.visible = false; st.crates.push(c);
    }
    st.count = 0;
  } else if (st.id === 'toll') {
    // cabine + cancela
    bx(g, 1.6, 1.9, 1.5, 0xf2f2f2, x, 0, z - 2.5);
    bx(g, 1.8, 0.3, 1.7, 0xd8443c, x, 1.9, z - 2.5);
    bx(g, 0.08, 0.6, 1.0, 0, x + 0.81, 0.9, z - 2.5, { mat: GLASS, cast: false });
    bx(g, 2.2, 0.06, 4.6, 0xffd34d, x, 0.05, z, { cast: false });
    const arm = new THREE.Group();
    arm.position.set(x + 0.8, 1.0, z - 1.5);
    for (let i = 0; i < 6; i++) bx(arm, 0.14, 0.14, 0.5, i % 2 ? 0xffffff : 0xd8443c, 0, -0.07, 0.25 + i * 0.5);
    g.add(arm);
    st.arm = arm;
    bx(g, 0.3, 1.1, 0.3, 0x444a58, x + 0.8, 0, z - 1.5);
  } else if (st.id === 'wash') {
    for (const [dx, dz] of [[-1.3, -1.65], [1.3, -1.65], [-1.3, 1.65], [1.3, 1.65]]) bx(g, 0.5, 3.2, 0.5, 0xe8e8e8, x + dx, 0, z + dz);
    st.roofMat = new THREE.MeshLambertMaterial({ color: 0x2f9ae0 });
    bx(g, 3.4, 0.6, 3.9, 0, x, 3.2, z, { mat: st.roofMat });
    bx(g, 3.6, 0.2, 4.1, 0xffffff, x, 3.8, z);
    st.brushMat = new THREE.MeshLambertMaterial({ color: 0x3fd0ff });
    st.brushes = [];
    for (const bz of [-1.0, 1.0]) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 2.4, 6), st.brushMat);
      b.position.set(x, 1.5, z + bz); b.castShadow = true;
      g.add(b); st.brushes.push(b);
    }
    st.drops = [];
    for (let i = 0; i < 14; i++) {
      const d = bx(g, 0.12, 0.12, 0.12, 0, x + rnd(-1, 1), rnd(0.5, 3), z + rnd(-1.2, 1.2), { mat: M(0x9fe3ff), cast: false });
      d.visible = false; st.drops.push(d);
    }
  } else if (st.id === 'dedup') {
    // arco com scanner
    bx(g, 0.5, 3.4, 0.5, 0x3a3f4d, x, 0, z - 1.7); bx(g, 0.5, 3.4, 0.5, 0x3a3f4d, x, 0, z + 1.7);
    bx(g, 0.8, 0.6, 4, 0x3a3f4d, x, 3.2, z);
    st.lampMat = new THREE.MeshBasicMaterial({ color: 0x4cff8a });
    bx(g, 0.84, 0.18, 3.2, 0, x, 3.1, z, { mat: st.lampMat, cast: false });
    st.scan = makeBeam(L, 'dedup', 0xff3c3c);
    st.scan.scale.set(0.1, 0.06, 2.6);
    st.scan.position.set(x, 2.8, z);
  } else if (st.id === 'fuel') {
    // posto: cobertura sobre a estrada + bombas
    for (const [dx, dz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) bx(g, 0.35, 3.3, 0.35, 0xf2f2f2, x + dx, 0, z + dz);
    bx(g, 5, 0.5, 4.6, 0xffd34d, x, 3.3, z);
    bx(g, 5.1, 0.18, 4.7, 0xd8443c, x, 3.2, z);
    for (const dx of [-1, 1]) {
      bx(g, 0.7, 1.3, 0.5, 0xd8443c, x + dx, 0, z + 3);
      bx(g, 0.5, 0.35, 0.06, 0, x + dx, 0.75, z + 2.74, { mat: M(0x1d1f26), cast: false });
    }
    st.flash = 0;
  } else if (st.id === 'load') {
    // portão do banco
    bx(g, 0.8, 4, 0.8, 0x4c3878, x, 0, z - 1.9); bx(g, 0.8, 4, 0.8, 0x4c3878, x, 0, z + 1.9);
    bx(g, 1, 0.9, 4.6, 0x6b4fa0, x, 4, z);
    bx(g, 1.02, 0.25, 3.6, 0xffe28a, x, 4.3, z, { cast: false });
    const gate = new THREE.Group();
    for (let i = 0; i < 5; i++) bx(gate, 0.1, 2.4, 0.12, 0x2a2d38, 0, 0.3, -1.4 + i * 0.7);
    bx(gate, 0.12, 0.12, 3.2, 0x2a2d38, 0, 2.5, 0);
    gate.position.set(x + 0.45, 0, z);
    g.add(gate);
    st.gate = gate;
  }
  // quarentena (rejeitados) atrás das estações que reprovam dados
  if (st.rejects) {
    const rj = grp(root, 'reject', L);
    rj.userData.station = st;
    bx(rj, 4.6, 0.08, 3.4, 0x8b5a2b, x, 0, z + 4.4, { cast: false });
    for (const dx of [-2.3, 2.3]) bx(rj, 0.12, 0.5, 3.4, 0xd8443c, x + dx, 0, z + 4.4, { cast: false });
    st.rejPos = [V(x - 1.1, 0, z + 3.6), V(x + 1.1, 0, z + 3.6), V(x - 1.1, 0, z + 5.2), V(x + 1.1, 0, z + 5.2)];
    st.reject = [];
  }
}

// ---------- montagem de cada coleta ----------
for (const L of LANES) {
  const z = L.z;
  const root = L.root = new THREE.Group();
  scene.add(root);
  L.pending = [];
  L.lot = new Array(8).fill(null);
  L.lotPos = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) L.lotPos.push(V(-35 + c * 2.1, 0, z + 2.5 + r * 2));
  L.road = [];
  L.dest = new Array(20).fill(null);
  L.destPos = [];
  for (let c = 4; c >= 0; c--) for (let r = 0; r < 4; r++) L.destPos.push(V(DEST_X + c * 2.6, 0, z - 3.3 + r * 2.2));
  L.stats = { seen: 0, extracted: 0, latSum: 0, latN: 0, requests: 0, fails: 0, rejected: 0, washed: 0 };
  L.stations = STATIONS.map((s) => ({ ...s, s: s.x - ROAD_X0, busy: null, lastPop: -99 }));

  // fronteira origem | pipeline
  const fence = grp(root, 'fence', L);
  for (let zz = z - 7; zz <= z + 7; zz += 1.4) bx(fence, 0.25, 0.7, 0.6, 0xffd34d, -27.3, 0, zz, { cast: false });

  // estrada (seu pipeline)
  const road = grp(root, 'road', L);
  const len = ROAD_X1 + 2 - -38;
  bx(road, len, 0.1, 2.4, 0x3b3f4a, -38 + len / 2, 0, z, { cast: false });
  bx(road, len, 0.12, 0.18, L.color, -38 + len / 2, 0, z - 1.2, { cast: false });
  bx(road, len, 0.12, 0.18, L.color, -38 + len / 2, 0, z + 1.2, { cast: false });
  for (let x = -25; x < ROAD_X1; x += 2.2) bx(road, 1, 0.13, 0.12, 0xf2f2f2, x, 0, z, { cast: false });
  bx(road, 12, 0.1, 1.6, 0x4a4f5c, -33, 0, z - 2.2, { cast: false });
  for (let x = -38; x < -27; x += 1.4) bx(road, 0.6, 0.12, 0.1, L.color, x, 0, z - 2.2, { cast: false });
  // calçadas
  bx(road, ROAD_X1 + 26, 0.18, 0.6, 0xb9bec7, (ROAD_X1 - 26) / 2, 0, z - 1.6, { cast: false });
  bx(road, ROAD_X1 + 26, 0.18, 0.6, 0xb9bec7, (ROAD_X1 - 26) / 2, 0, z + 1.6, { cast: false });

  // estacionamento da origem
  const lot = grp(root, 'lot-src', L);
  bx(lot, 9, 0.08, 4.6, 0x8e949c, -31.85, 0, z + 3.5, { cast: false });
  for (let c = 0; c <= 4; c++) bx(lot, 0.1, 0.1, 4.2, 0xeeeeee, -36.05 + c * 2.1, 0, z + 3.5, { cast: false });

  // estacionamento do banco + prédio do banco de dados
  const dlot = grp(root, 'dest', L);
  bx(dlot, 14, 0.08, 9.6, 0x7d8590, DEST_X + 5.2, 0, z, { cast: false });
  for (let c = 0; c <= 5; c++) bx(dlot, 0.1, 0.1, 9, 0xeeeeee, DEST_X - 1.3 + c * 2.6, 0, z, { cast: false });
  const dw = grp(root, 'dw', L);
  L.dwMat = new THREE.MeshLambertMaterial({ color: 0x6b4fa0 });
  bx(dw, 6, 8, 12, 0, DB_X, 0, z, { mat: L.dwMat });
  bx(dw, 6.4, 0.6, 12.4, 0x4c3878, DB_X, 8, z);
  for (let zz = -4.5; zz <= 4.5; zz += 3) for (let y = 1.5; y < 7; y += 2.4) bx(dw, 0.1, 1, 1.4, 0, DB_X - 3.05, y, z + zz, { mat: M(0xffe28a), cast: false });
  // "cilindros" de banco de dados no telhado
  for (const dz of [-3, 0, 3]) {
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1.6, 8), M(0x8f7bc4));
    cyl.position.set(DB_X, 9.4, z + dz); cyl.castShadow = true; dw.add(cyl);
  }

  // estações
  for (const st of L.stations) buildStation(L, st);

  // torre de monitoramento (logs e alertas)
  const tower = grp(root, 'tower', L);
  bx(tower, 0.5, 6, 0.5, 0x9aa3b5, -3, 0, z - 6.5);
  bx(tower, 1.8, 1.2, 1.8, 0x3a3f4d, -3, 6, z - 6.5);
  bx(tower, 1.82, 0.5, 1.82, 0, -3, 6.4, z - 6.5, { mat: GLASS, cast: false });
  L.alarmMat = new THREE.MeshBasicMaterial({ color: 0x4cff8a });
  bx(tower, 0.4, 0.4, 0.4, 0, -3, 7.2, z - 6.5, { mat: L.alarmMat, cast: false });
  for (const [dx, dz] of [[-0.6, -0.6], [0.6, 0.6]]) bx(tower, 0.15, 6, 0.15, 0x9aa3b5, -3 + dx, 0, z - 6.5 + dz);

  // orquestrador (torre do relógio)
  const clock = grp(root, 'clock', L);
  bx(clock, 2.2, 5.5, 2.2, 0xd9d2c3, -14, 0, z - 6.5);
  bx(clock, 2.6, 0.5, 2.6, 0x8a5a33, -14, 5.5, z - 6.5);
  bx(clock, 1.6, 1.6, 0.1, 0xffffff, -14, 3.4, z - 5.35, { cast: false });
  L.hand = new THREE.Group();
  L.hand.position.set(-14, 4.2, z - 5.28);
  bx(L.hand, 0.1, 0.65, 0.05, 0x1d1f26, 0, 0, 0, { cast: false });
  clock.add(L.hand);

  // construções da origem
  if (L.id === 'api') {
    const b = grp(root, 'api-bld', L);
    bx(b, 5, 6.5, 6.4, 0x5a6f9e, -40.5, 0, z);
    bx(b, 5.2, 0.4, 6.6, 0x3f4f75, -40.5, 6.5, z);
    for (let y = 1.5; y < 6; y += 1.4) for (const zz of [-2, 0, 2]) bx(b, 0.1, 0.7, 1, 0, -37.96, y, z + zz, { mat: M(0xbfe3ff), cast: false });
    bx(b, 0.4, 1.2, 1.6, 0xffd34d, -37.8, 0, z - 2.2);  // guichê
    bx(b, 0.15, 2.2, 0.15, 0x9aa3b5, -41, 6.9, z);
    bx(b, 0.6, 0.15, 0.6, 0xff5a3c, -41, 9.1, z);
    L.van = makeVan(L);
    L.van.position.set(-28.5, 0, z - 2.2);
    L.apiState = { phase: 'wait', t: 1.2, n: 0 };
  } else if (L.id === 'scrap') {
    const b = grp(root, 'site-bld', L);
    bx(b, 5, 5.5, 6.4, 0xdedfe4, -40.5, 0, z);
    bx(b, 0.2, 4, 5.6, 0x23262f, -37.9, 0.8, z);
    bx(b, 0.22, 0.5, 5.6, 0x50545f, -37.85, 4.8, z);
    for (const [zz, c] of [[-2.4, 0xff5f56], [-2, 0xffbd2e], [-1.6, 0x27c93f]]) bx(b, 0.25, 0.22, 0.22, c, -37.8, 4.92, z + zz, { cast: false });
    for (let i = 0; i < 6; i++) bx(b, 0.22, 0.5, rnd(1.5, 4), pick([0xff8a3d, 0x4c8dff, 0x8a8f99]), -37.8, 1.2 + i * 0.6, z + rnd(-0.5, 0.5), { cast: false });
    const glass = grp(root, 'glass', L);
    L.glassMat = new THREE.MeshLambertMaterial({ color: 0x8fe6ff, transparent: true, opacity: 0.32 });
    bx(glass, 8.6, 2.2, 0.12, 0, -31.85, 0, z + 1.35, { mat: L.glassMat, cast: false });
    L.chrome = bx(glass, 8.6, 0.35, 0.16, 0x50545f, -31.85, 2.2, z + 1.35);
    L.robot = makeRobot(L);
    L.robot.position.set(-28.6, 0, z - 0.2);
    L.beam = makeBeam(L, 'robot');
    L.scrapState = { phase: 'wait', t: 1.5, home: L.robot.position.clone() };
  } else {
    const b = grp(root, 'erp-bld', L);
    bx(b, 6, 4.2, 6.4, 0xb9874f, -40.5, 0, z);
    const roof = bx(b, 6.4, 0.6, 4.6, 0x8a5a33, -40.5, 4.0, z - 1.5); roof.rotation.x = 0.55;
    const roof2 = bx(b, 6.4, 0.6, 4.6, 0x8a5a33, -40.5, 4.0, z + 1.5); roof2.rotation.x = -0.55;
    bx(b, 0.12, 2.6, 2.4, 0xd9d2c3, -37.45, 0, z - 2.2);
    for (let y = 0.3; y < 2.6; y += 0.45) bx(b, 0.14, 0.08, 2.4, 0xa89f8f, -37.43, y, z - 2.2, { cast: false });
    L.truck = makeTruck(L);
    L.truck.position.set(-35.5, 0, z - 2.2);
    L.batchState = { phase: 'parked', t: 0, cargo: [] };
    L.nextBatch = state.batchEvery;
  }
}

// ---------- registros (carros) ----------
const fading = [];
const moving = new Set();
const transformQueue = new Set();

function spawnRecord(L) {
  const rec = { L, born: state.sim, mesh: null, slot: -1, phase: 'fonte', defect: null };
  let u = Math.random();
  for (const [k, p] of Object.entries(L.defects)) {
    if (u < p) { rec.defect = k; rec.reason = pick(L.reasons[k]); break; }
    u -= p;
  }
  L.pending.push(rec);
  fillLot(L);
}
function fillLot(L) {
  for (let i = 0; i < Math.min(L.pending.length, 8); i++) {
    const rec = L.pending[i];
    if (rec.mesh) continue;
    const slot = L.lot.indexOf(null);
    if (slot < 0) break;
    L.lot[slot] = rec; rec.slot = slot;
    rec.mesh = makeCar(rec);
    rec.mesh.position.copy(L.lotPos[slot]);
    rec.mesh.rotation.y = Math.PI / 2;
    rec.mesh.scale.setScalar(0.01);
    rec.pop = 0;
  }
}
function releaseSlot(r) {
  if (r.slot >= 0 && r.L.lot[r.slot] === r) r.L.lot[r.slot] = null;
  r.slot = -1;
}
function takePending(L, n, free = true) {
  const out = L.pending.splice(0, n);
  L.stats.seen += out.length;
  if (free) for (const r of out) releaseSlot(r);
  return out;
}
function startToRoad(rec, pts, delay = 0, speed = 6) {
  rec.state = 'path';
  rec.phase = 'extraindo';
  rec.delay = delay;
  rec.mv = mover(pts, speed);
  rec.onDone = () => { releaseSlot(rec); fillLot(rec.L); enterRoad(rec); };
  moving.add(rec);
}
function enterRoad(rec) {
  const L = rec.L;
  const last = L.road[L.road.length - 1];
  let s = rec.mesh.position.x - ROAD_X0;
  if (last) s = Math.min(s, last.s - GAP);
  rec.s = s; rec.state = 'road'; rec.phase = 'estrada'; rec.si = 0;
  rec.mesh.position.set(ROAD_X0 + s, 0, L.z);
  rec.mesh.rotation.y = 0;
  L.road.push(rec);
}
function removeFromRoad(rec) {
  const i = rec.L.road.indexOf(rec);
  if (i >= 0) rec.L.road.splice(i, 1);
}
function fadeOut(mesh) { fading.push({ mesh, t: 0 }); }

function arrive(rec) {
  const L = rec.L;
  rec.lat = state.sim - rec.born;
  L.stats.extracted++;
  L.stats.latSum += rec.lat;
  L.stats.latN++;
}

function parkAtDest(rec) {
  const L = rec.L;
  let slot = L.dest.indexOf(null);
  if (slot < 0) {
    let oldest = 0;
    for (let i = 1; i < L.dest.length; i++) if (L.dest[i].parkedAt < L.dest[oldest].parkedAt) oldest = i;
    fadeOut(L.dest[oldest].mesh);
    L.dest[oldest].phase = 'gone';
    L.dest[oldest] = null; slot = oldest;
  }
  L.dest[slot] = rec;
  rec.parkedAt = Infinity;
  const p = L.destPos[slot];
  rec.state = 'path';
  rec.delay = 0;
  rec.mv = mover([rec.mesh.position.clone(), V(ROAD_X1 + 1.2, 0, p.z), V(p.x, 0, p.z)], CAR_SPEED);
  rec.onDone = () => {
    rec.state = 'parked';
    rec.parkedAt = state.sim;
    rec.mesh.rotation.y = 0;
    arrive(rec);
    if (rec.raw) {
      rec.phase = 'lake';
      rec.transformAt = state.sim + 2.6;
      transformQueue.add(rec);
    } else rec.phase = 'destino';
  };
  moving.add(rec);
}

function toReject(rec, st) {
  const L = rec.L;
  L.stats.rejected++;
  rec.phase = 'rejeitado';
  paintCar(rec, RED);
  popup(L, 'rejeitado: ' + rec.reason, V(st.x, 4.4, L.z + 1.5), 'err');
  if (st.reject.length >= st.rejPos.length) { const old = st.reject.shift(); old.phase = 'gone'; fadeOut(old.mesh); }
  const slot = st.rejPos.find((p) => !st.reject.some((r) => r.rejSlot === p)) || st.rejPos[0];
  rec.rejSlot = slot;
  st.reject.push(rec);
  rec.state = 'path'; rec.delay = 0;
  rec.mv = mover([rec.mesh.position.clone(), V(st.x, 0, L.z + 2.2), V(slot.x, 0, slot.z)], 5);
  rec.onDone = () => { rec.state = 'rejected'; };
  moving.add(rec);
}

// ---------- mecanismos de extração ----------
function updateAPI(L, dt) {
  const st = L.apiState, van = L.van, z = L.z;
  st.t -= dt;
  if (st.phase === 'wait' && st.t <= 0) {
    st.phase = 'go';
    st.mv = mover([van.position.clone(), V(-37, 0, z - 2.2)], 9);
    popup(L, `GET /pedidos?page=${++st.n}`, V(-28.5, 2.4, z - 2.2), 'req');
  } else if (st.phase === 'go') {
    if (stepMover(van, st.mv, dt)) { st.phase = 'at'; st.t = 0.45; }
  } else if (st.phase === 'at' && st.t <= 0) {
    L.stats.requests++;
    let got = [];
    if (state.rateLimit && st.n % 2 === 0) {
      L.stats.fails++;
      popup(L, '429 Too Many Requests', V(-38, 4, z - 2), 'err');
    } else {
      got = takePending(L, 4, false);
      if (got.length) popup(L, `200 OK · ${got.length} ${got.length > 1 ? 'itens' : 'item'}`, V(-38, 4, z - 2), 'ok');
      else popup(L, '200 OK · [] nada novo', V(-38, 4, z - 2), 'meh');
    }
    got.forEach((rec, i) => {
      const p = rec.mesh.position.clone();
      startToRoad(rec, [p, V(p.x, 0, z), V(ROAD_X0 - 0.2, 0, z)], 0.15 + i * 0.35);
    });
    st.phase = 'back';
    st.mv = mover([van.position.clone(), V(-28.5, 0, z - 2.2)], 9);
  } else if (st.phase === 'back') {
    if (stepMover(van, st.mv, dt)) { st.phase = 'wait'; st.t = state.pollEvery; }
  }
}

function updateScrap(L, dt) {
  const st = L.scrapState, rb = L.robot, z = L.z;
  st.t -= dt;
  rb.position.y = Math.abs(Math.sin(state.sim * 10)) * (st.phase === 'go' || st.phase === 'back' ? 0.12 : 0);
  if (st.phase === 'wait' && st.t <= 0) {
    st.phase = 'go';
    st.mv = mover([rb.position.clone(), V(-32, 0, z - 0.2)], 3.2);
  } else if (st.phase === 'go') {
    if (stepMover(rb, st.mv, dt)) { st.phase = 'scan'; st.t = 0; st.count = 0; rb.rotation.y = Math.PI / 2; }
  } else if (st.phase === 'scan' && st.t <= 0) {
    const head = V(rb.position.x, 1.6, rb.position.z);
    if (st.target) {
      // terminou de "ler" o carro: copia ele para o pipeline
      const rec = st.target; st.target = null;
      L.beam.visible = false;
      fadeOut(rec.mesh);
      releaseSlot(rec);
      rec.mesh = makeCar(rec);
      rec.mesh.position.set(rb.position.x - 1.2, 0, z);
      rec.mesh.scale.setScalar(0.01); rec.pop = 0;
      startToRoad(rec, [rec.mesh.position.clone(), V(ROAD_X0 - 0.2, 0, z)], 0.15, 5);
      fillLot(L);
      st.count++;
      st.t = 0.25;
      return;
    }
    if (st.count >= 4) { st.phase = 'back'; return; }
    L.stats.requests++;
    if (state.siteBroken) {
      L.stats.fails++;
      setBeam(L.beam, head, V(rb.position.x, 2.3, z + 1.35));
      popup(L, "seletor 'div.carro' não encontrado", V(-32, 3.6, z), 'err');
      st.t = 0.9; st.count = 99;
      return;
    }
    const rec = L.pending.find((r) => r.mesh);
    if (!rec) {
      if (st.count === 0) popup(L, 'página sem itens novos', V(-32, 3.4, z), 'meh');
      st.phase = 'back'; L.beam.visible = false; return;
    }
    L.pending.splice(L.pending.indexOf(rec), 1);
    L.stats.seen++;
    rec.phase = 'extraindo';
    st.target = rec;
    setBeam(L.beam, head, V(rec.mesh.position.x, 0.9, rec.mesh.position.z));
    if (st.count === 0) popup(L, 'GET /produtos → parse HTML', V(-32, 3.4, z - 0.5), 'req');
    st.t = 0.6;
  } else if (st.phase === 'back') {
    if (!st.mv || st.mv.done !== false) {
      L.beam.visible = false;
      st.mv = mover([rb.position.clone(), st.home.clone()], 3.2); st.mv.done = false;
    }
    if (stepMover(rb, st.mv, dt)) { st.phase = 'wait'; st.t = 2.2; st.mv = null; rb.rotation.y = 0; }
  }
}

function updateBatch(L, dt) {
  const st = L.batchState, tr = L.truck, z = L.z;
  if (st.phase === 'parked' && state.sim >= L.nextBatch) {
    L.nextBatch = state.sim + state.batchEvery;
    L.stats.requests++;
    const recs = takePending(L, L.pending.length);
    const t = Math.floor(state.sim);
    const name = `vendas_${String(Math.floor(t / 60)).padStart(2, '0')}h${String(t % 60).padStart(2, '0')}.csv`;
    popup(L, `${name} · ${recs.length} linhas`, V(-38, 5, z - 2), recs.length ? 'ok' : 'meh');
    for (const r of recs) { if (r.mesh) { disposeCar(r.mesh); r.mesh = null; } r.phase = 'extraindo'; }
    st.cargo = recs;
    tr.userData.minis.forEach((m, i) => (m.visible = i < recs.length));
    st.phase = 'go';
    st.mv = mover([tr.position.clone(), V(-28.8, 0, z - 2.2)], 5);
  } else if (st.phase === 'go') {
    if (stepMover(tr, st.mv, dt)) { st.phase = 'unload'; st.t = 0; st.i = 0; }
  } else if (st.phase === 'unload') {
    st.t -= dt;
    if (st.t <= 0) {
      if (st.i < st.cargo.length) {
        const rec = st.cargo[st.i++];
        rec.mesh = makeCar(rec);
        rec.mesh.position.set(-27.6, 0, z);
        rec.mesh.scale.setScalar(0.01); rec.pop = 0;
        startToRoad(rec, [rec.mesh.position.clone(), V(ROAD_X0 - 0.2, 0, z)], 0, 4);
        const left = st.cargo.length - st.i;
        tr.userData.minis.forEach((m, i) => (m.visible = i < left));
        st.t = 0.28;
      } else {
        st.phase = 'back';
        st.mv = mover([tr.position.clone(), V(-35.5, 0, z - 2.2)], 5);
      }
    }
  } else if (st.phase === 'back') {
    if (stepMover(tr, st.mv, dt)) { st.phase = 'parked'; tr.rotation.y = 0; }
  }
}

// ---------- estrada + estações ----------
const skips = (st) => st.t && state.mode === 'ELT';   // no ELT a transformação fica para o banco

function stationDone(L, st, car) {
  const z = L.z;
  st.busy = null;
  car.si++;
  const throttled = state.sim - st.lastPop > 4;
  if (st.id === 'landing') {
    st.count++;
    st.crates.forEach((c, i) => (c.visible = i < Math.min(12, st.count)));
    if (throttled) { st.lastPop = state.sim; popup(L, `raw/${L.id}/2026-11-12/ salvo`, V(st.x, 3.6, z - 3.5), 'meh'); }
    car.phase = 'estrada';
  } else if (st.rejects && car.defect === st.rejects) {
    removeFromRoad(car);
    toReject(car, st);
    car.rejectedAt = WHERE[st.rejects];
    return;
  } else if (st.id === 'toll') {
    car.phase = 'validado';
  } else if (st.id === 'wash') {
    paintCar(car, L.color);
    L.stats.washed++;
    car.phase = 'tratado';
  } else if (st.id === 'dedup') {
    car.phase = 'tratado';
  } else if (st.id === 'fuel') {
    car.mesh.userData.rack.visible = true;
    car.phase = 'enriquecido';
    st.flash = 0.4;
  } else if (st.id === 'load') {
    if (throttled) { st.lastPop = state.sim; popup(L, 'UPSERT INTO vendas', V(st.x, 5.6, z), 'ok'); }
    car.phase = 'carregando';
  }
}

function updateRoad(L, dt) {
  for (let i = 0; i < L.road.length; i++) {
    const car = L.road[i];
    const ahead = L.road[i - 1];
    let limit = ahead ? ahead.s - GAP : Infinity;
    // pula as estações que não se aplicam (transformação no modo ELT)
    while (car.si < L.stations.length && skips(L.stations[car.si]) && L.stations[car.si].busy !== car && car.s >= L.stations[car.si].s - 0.001) {
      car.si++; car.raw = true;
    }
    const st = L.stations[car.si];
    if (st && !skips(st)) limit = Math.min(limit, st.s);
    car.s = Math.min(car.s + CAR_SPEED * dt, limit);
    car.mesh.position.x = ROAD_X0 + car.s;
    if (st && !skips(st) && car.s >= st.s - 0.001 && !st.busy) {
      st.busy = car; car.stT = st.stop; car.phase = st.id;
    }
  }
  for (const st of L.stations) {
    const car = st.busy;
    if (car) {
      car.stT -= dt;
      animateStation(st, dt, true);
      if (car.stT <= 0) { stationDone(L, st, car); animateStation(st, 0, false); }
    } else animateStation(st, dt, false);
  }
  for (let i = L.road.length - 1; i >= 0; i--) {
    const car = L.road[i];
    if (car.s >= S_END) { L.road.splice(i, 1); parkAtDest(car); }
  }
}

function animateStation(st, dt, active) {
  if (st.id === 'wash') {
    for (const b of st.brushes) b.rotation.y += dt * (active ? 14 : state.mode === 'ETL' ? 0.6 : 0);
    for (const d of st.drops) {
      d.visible = active;
      if (active) { d.position.y -= dt * 6; if (d.position.y < 0.2) d.position.y = rnd(2.4, 3.1); }
    }
  } else if (st.id === 'toll') {
    const target = active && st.busy && st.busy.stT < 0.25 ? -1.3 : 0;
    st.arm.rotation.x += (target - st.arm.rotation.x) * Math.min(1, dt * 10 || 0.2);
  } else if (st.id === 'dedup') {
    st.scan.visible = active;
    if (active) st.scan.position.x = st.x + Math.sin(state.sim * 14) * 0.8;
    st.lampMat.color.set(skips(st) ? 0x666b75 : active ? 0xff3c3c : 0x4cff8a);
  } else if (st.id === 'load') {
    const target = active ? 2.6 : 0;
    st.gate.position.y += (target - st.gate.position.y) * Math.min(1, dt * 8 || 0.2);
  } else if (st.id === 'fuel') {
    st.flash = Math.max(0, st.flash - dt);
  }
}

function updateTransforms() {
  for (const rec of transformQueue) {
    if (state.sim < rec.transformAt) continue;
    transformQueue.delete(rec);
    const L = rec.L;
    if (!L.dest.includes(rec)) continue;
    if (rec.defect) {
      paintCar(rec, RED);
      rec.phase = 'rejeitado';
      rec.rejectedAt = 'na transformação dentro do banco';
      popup(L, 'rejeitado no banco: ' + rec.reason, V(rec.mesh.position.x, 2.5, rec.mesh.position.z), 'err');
      L.stats.rejected++;
      L.dest[L.dest.indexOf(rec)] = null;
      setTimeout(() => { rec.phase = 'gone'; fadeOut(rec.mesh); }, 600);
    } else {
      paintCar(rec, L.color);
      rec.mesh.userData.rack.visible = true;
      rec.phase = 'destino';
      L.stats.washed++;
    }
  }
}

// ---------- troca de coleta (uma por vez) ----------
let camTween = null;
function selectLane(id, instant = false) {
  const L = LANE[id];
  state.active = L;
  for (const x of LANES) x.root.visible = x === L;
  clearPops();
  closeInfo();
  setFollow(false);
  aimSun(L.z);
  document.querySelectorAll('[data-lane]').forEach((b) => b.classList.toggle('on', b.dataset.lane === id));
  $('#stat').style.setProperty('--c', L.css);
  $('#st-title').textContent = L.name.toUpperCase();
  updateScenarioButton();
  const target = V(CAM_CENTER_X, 0, L.z);
  if (instant) {
    controls.target.copy(target);
    camera.position.copy(target).add(CAM_OFFSET);
    controls.update();
  } else {
    // mantém o ângulo atual da câmera e só desliza até a nova coleta
    moveCameraTo(target);
  }
  renderStats();
}
function moveCameraTo(target) {
  const delta = target.clone().sub(controls.target);
  delta.y = 0;
  camTween = { t: 0, fromT: controls.target.clone(), fromP: camera.position.clone(), delta };
}
function updateCamTween(realDt) {
  if (!camTween) return;
  camTween.t = Math.min(1, camTween.t + realDt * 2);
  const k = 1 - Math.pow(1 - camTween.t, 3);
  controls.target.copy(camTween.fromT).addScaledVector(camTween.delta, k);
  camera.position.copy(camTween.fromP).addScaledVector(camTween.delta, k);
  if (camTween.t >= 1) camTween = null;
}
// a câmera não pode fugir para longe da coleta visível
function clampCamera() {
  const L = state.active, t = controls.target;
  const cx = THREE.MathUtils.clamp(t.x, -48, 62), cz = THREE.MathUtils.clamp(t.z, L.z - 16, L.z + 16);
  if (cx !== t.x || cz !== t.z) {
    const dx = cx - t.x, dz = cz - t.z;
    t.x = cx; t.z = cz; camera.position.x += dx; camera.position.z += dz;
  }
}

// ---------- seguir um carro ----------
function setFollow(on) {
  state.follow = on ? { rec: null } : null;
  const b = $('#btn-follow');
  b.classList.toggle('on', !!on);
  b.textContent = on ? 'Parar de seguir' : 'Seguir um carro';
}
function updateFollow(realDt) {
  const f = state.follow;
  if (!f) return;
  const L = state.active;
  const done = (r) => !r || ['parked', 'rejected'].includes(r.state) || r.phase === 'gone' || r.phase === 'destino';
  if (done(f.rec)) {
    // pega o carro mais novo que já está na estrada
    f.rec = L.road[L.road.length - 1] || [...moving].find((r) => r.L === L && r.phase === 'extraindo') || null;
    if (f.rec) f.rec.followed = true;
  }
  if (!f.rec || !f.rec.mesh) return;
  const p = f.rec.mesh.position;
  const k = 1 - Math.exp(-realDt * 4);
  const dx = (p.x - controls.target.x) * k, dz = (p.z - controls.target.z) * k;
  controls.target.x += dx; controls.target.z += dz;
  camera.position.x += dx; camera.position.z += dz;
}

// ---------- clique nos objetos: o que cada coisa significa ----------
const fmtS = (n) => (Number.isFinite(n) ? n.toFixed(1) + 's' : '—');
const OBJ_INFO = {
  car(o) {
    const r = o.userData.rec, L = r.L;
    const age = `Surgiu na fonte há ${fmtS(state.sim - r.born)}`;
    const took = r.lat !== undefined ? `Levou ${fmtS(r.lat)} da fonte até o banco` : age;
    const P = {
      fonte: ['Registro novo (dado bruto)', 'Um dado que acabou de surgir no sistema de origem, por exemplo um pedido. A cor marrom com lama indica dado <b>bruto</b>. Ele ainda não foi extraído.', age],
      extraindo: ['Sendo extraído', `${L.extracting} Ainda está sujo: nada foi tratado.`, age],
      estrada: ['Dado bruto no seu pipeline', 'Já foi extraído, mas ainda está cru: números como texto, datas em formatos diferentes e possíveis duplicados.', age],
      landing: ['Salvando a cópia bruta', 'Antes de mexer em qualquer coisa, uma cópia do jeito que chegou é guardada na área de pouso.', age],
      toll: ['Na validação de schema', 'O pedágio confere se o registro tem os campos e o formato esperados.', age],
      validado: ['Dado validado', 'Passou na validação de schema, mas ainda está sujo: falta limpar e padronizar.', age],
      wash: ['Passando pela transformação', 'O lava-rápido está convertendo tipos, padronizando datas e limpando os campos.', age],
      tratado: ['Dado tratado', 'Limpo e padronizado (cor da coleta). Ainda vai checar duplicidade e ganhar informação extra.', age],
      dedup: ['Checando duplicidade', 'O scanner compara a chave do registro (ex.: id do pedido) com o que já passou.', age],
      fuel: ['Sendo enriquecido', 'O posto está adicionando informação que não veio da fonte.', age],
      enriquecido: ['Dado tratado e enriquecido', 'A caixa amarela no teto é a informação extra (ex.: cidade a partir do CEP, categoria do produto). Pronto para ir ao banco.', age],
      load: ['Sendo gravado no banco', 'O portão de carga está fazendo o INSERT/UPSERT do registro.', age],
      carregando: ['Gravado, estacionando', 'Já está no banco de dados.', took],
      destino: ['Dado pronto no banco', 'Validado, tratado, sem duplicidade e enriquecido. Pronto para relatórios e dashboards.', took],
      lake: ['Dado bruto no banco (ELT)', 'Chegou rápido, mas ainda sujo. A transformação vai rodar aqui dentro do banco (SQL/dbt).', took],
      rejeitado: ['Dado rejeitado', `Motivo: <b>${r.reason}</b>. Foi barrado ${r.rejectedAt || ''} e foi para a quarentena para alguém analisar.`, ''],
    }[r.phase] || ['Registro', '', ''];
    const clean = ['tratado', 'enriquecido', 'load', 'carregando', 'destino', 'dedup', 'fuel'].includes(r.phase);
    return { title: P[0], body: P[1], meta: P[2], color: r.phase === 'rejeitado' ? '#ff5a5a' : clean ? L.css : '#c99a62' };
  },
  fence: () => ({ title: 'Fronteira', body: 'À esquerda fica o sistema de <b>outra empresa</b> (a origem), que você não controla. À direita fica o <b>seu pipeline</b>.' }),
  'lot-src': (o) => ({ title: 'Estacionamento da origem', body: 'Onde os registros novos aparecem. Eles ficam esperando aqui até a extração vir buscar.', meta: `${o.userData.lane.pending.length} esperando agora` }),
  'api-bld': () => ({ title: 'Servidor da API', body: 'O sistema de origem entrega os dados por <b>endpoints HTTP</b>: respostas em JSON, paginadas e com limite de requisições (rate limit).', more: 'api' }),
  van: () => ({ title: 'Requisição HTTP', body: 'Cada viagem é um <code>GET</code>. O envelope amarelo é o pedido; a van volta com uma <b>página</b> de até 4 registros. Ir e voltar mesmo sem novidade é o custo do <b>polling</b>.', more: 'api' }),
  'site-bld': () => ({ title: 'Site (HTML)', body: 'Uma página feita para pessoas, não para máquinas. Não existe API: o dado está misturado com o layout.', more: 'scrap' }),
  glass: () => ({ title: 'Vitrine = a página renderizada', body: state.siteBroken ? 'O layout <b>mudou</b> (vidro rosa): o seletor antigo não encontra mais os carros e o robô falha.' : 'O robô só enxerga o que está atrás do vidro, ou seja, o HTML. Se o layout mudar, o seletor quebra.', more: 'scrap' }),
  robot: () => ({ title: 'Scraper', body: 'O seu código (requests + BeautifulSoup). O laser é o <b>seletor CSS</b> lendo um item por vez e criando uma cópia.', more: 'scrap' }),
  'erp-bld': () => ({ title: 'ERP / sistema legado', body: 'Um sistema sem API que junta os dados e <b>exporta um arquivo</b> (CSV, Excel, TXT) em horário agendado.', more: 'batch' }),
  truck: (o) => ({ title: 'Arquivo em lote', body: 'Cada viagem é <b>um arquivo</b>: leva de uma vez todos os registros acumulados. É eficiente, mas quem chega logo depois do lote espera o próximo.', meta: o.userData.lane.batchState.phase === 'parked' ? `Próximo lote em ${Math.ceil(Math.max(0, o.userData.lane.nextBatch - state.sim))}s` : 'Lote a caminho', more: 'batch' }),
  road: () => ({ title: 'Seu pipeline', body: 'O caminho do dado depois de extraído até o banco. Cada construção na estrada é uma etapa por onde todo registro passa.', more: 'wash' }),
  landing: (o) => ({ title: 'Área de pouso (raw)', body: 'Antes de qualquer tratamento, o dado bruto é <b>salvo do jeito que chegou</b> (ex.: pasta <code>raw/</code> num data lake ou S3). Se algo der errado depois, dá para reprocessar sem buscar na fonte de novo. Cada caixa é uma cópia guardada.', meta: `${stn(o, 'landing').count} cópias salvas`, more: 'wash' }),
  toll: () => ({ title: 'Pedágio = validação de schema', body: state.mode === 'ETL' ? 'Confere se o registro tem o <b>formato esperado</b>: campos obrigatórios presentes, número certo de colunas, tipos básicos. Quem não passa vai para a quarentena ao lado.' : 'No <b>ELT</b> o pedágio fica aberto: a validação acontece depois, dentro do banco.', more: 'wash' }),
  wash: () => ({
    title: 'Lava-rápido = transformação',
    body: state.mode === 'ETL'
      ? 'Converte tipos (<code>"R$ 1.299,90"</code> → <code>1299.90</code>), padroniza datas e limpa os campos. O carro sai com a cor da coleta. Quem não dá para converter vai para a quarentena.'
      : 'No <b>ELT</b> o lava-rápido está desligado. Os carros passam direto e são lavados <b>dentro do banco</b>, depois.',
    more: 'wash', color: '#3fd0ff',
  }),
  dedup: () => ({ title: 'Detector de duplicados', body: state.mode === 'ETL' ? 'Compara a <b>chave</b> do registro (ex.: id do pedido) com o que já passou. Se já existe, é duplicado e vai para a quarentena. Comum quando a API repete itens entre páginas ou o scraping lê a mesma página duas vezes.' : 'No <b>ELT</b> o scanner fica desligado: a remoção de duplicados roda dentro do banco.', more: 'wash' }),
  fuel: () => ({ title: 'Posto = enriquecimento', body: state.mode === 'ETL' ? 'Adiciona informação que <b>não veio da fonte</b>, cruzando com outras tabelas: CEP → cidade/estado, código do produto → categoria, cotação do dólar do dia. A caixa amarela no teto do carro é esse dado extra.' : 'No <b>ELT</b> o enriquecimento é um <code>JOIN</code> feito dentro do banco.', more: 'wash' }),
  load: () => ({ title: 'Portão de carga (load)', body: 'É a <b>escrita no banco</b>: <code>INSERT</code>/<code>UPSERT</code> em lote, dentro de uma transação. Se a carga falhar no meio, nada fica pela metade.', more: 'wash' }),
  reject: (o) => ({ title: 'Quarentena (rejeitados)', body: `Registros barrados ${WHERE[o.userData.station.rejects]}. Na vida real é uma tabela de erros ou uma pasta de rejeitados para alguém analisar depois.`, meta: `${o.userData.lane.stats.rejected} rejeitados no total` }),
  tower: (o) => {
    const L = o.userData.lane, s = L.stats;
    return { title: 'Torre de monitoramento', body: 'Logs e alertas. Registra quantos dados chegaram, quantos foram rejeitados e quanto tempo levou. Quando algo quebra (429, seletor, arquivo que não chegou), a luz fica <b>vermelha</b> e alguém é avisado.', meta: `${s.extracted} no banco · ${s.rejected} rejeitados · ${s.fails} falhas na extração` };
  },
  clock: (o) => {
    const L = o.userData.lane;
    const agenda = L.id === 'api' ? `chama a API a cada ${state.pollEvery}s` : L.id === 'scrap' ? 'manda o robô ler o site a cada ~2s' : `próximo lote em ${Math.ceil(Math.max(0, L.nextBatch - state.sim))}s`;
    return { title: 'Orquestrador (ex.: Airflow)', body: 'O relógio da cidade: decide <b>quando</b> cada etapa roda e em que ordem, e tenta de novo quando algo falha.', meta: 'Agenda: ' + agenda };
  },
  dest: () => ({ title: 'Estacionamento do banco', body: state.mode === 'ETL' ? 'Onde o dado chega <b>pronto para uso</b>: validado, limpo, sem duplicados e enriquecido.' : 'No ELT os carros entram sujos e são tratados aqui dentro, alguns segundos depois.' }),
  dw: () => ({ title: 'Banco de dados', body: state.mode === 'ETL' ? 'Banco analítico (data warehouse) que guarda os dados tratados: SQL Server, PostgreSQL, BigQuery…' : 'No ELT ele guarda o dado <b>bruto</b> como chegou e a transformação roda aqui dentro (SQL, dbt).' }),
};
const stn = (o, id) => o.userData.lane.stations.find((s) => s.id === id);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function hitInfo(ev) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(state.active.root, true);
  for (const h of hits) {
    let o = h.object;
    if (!o.visible) continue;
    while (o && !o.userData.info) o = o.parent;
    if (o && o.visible && OBJ_INFO[o.userData.info]) return o;
  }
  return null;
}
const tip = $('#tip');
const SHORT = {
  car: 'carro (registro)', fence: 'fronteira', 'lot-src': 'origem', 'api-bld': 'servidor da API', van: 'requisição',
  'site-bld': 'site', glass: 'vitrine', robot: 'scraper', 'erp-bld': 'ERP', truck: 'lote (arquivo)', road: 'pipeline',
  landing: 'área de pouso (raw)', toll: 'validação de schema', wash: 'lava-rápido', dedup: 'detector de duplicados',
  fuel: 'enriquecimento', load: 'carga no banco', reject: 'quarentena', tower: 'monitoramento', clock: 'orquestrador',
  dest: 'estacionamento do banco', dw: 'banco de dados',
};
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointermove', (e) => {
  if (e.buttons) { tip.style.display = 'none'; return; }
  const o = hitInfo(e);
  renderer.domElement.classList.toggle('hover', !!o);
  if (o) {
    tip.textContent = SHORT[o.userData.info];
    tip.style.display = 'block';
    tip.style.left = e.clientX + 14 + 'px';
    tip.style.top = e.clientY + 12 + 'px';
  } else tip.style.display = 'none';
});
renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!downAt) return;
  const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]);
  downAt = null;
  if (moved > 6) { if (state.follow) setFollow(false); return; }   // arrastou: era movimento de câmera
  const o = hitInfo(e);
  if (o) openInfo(o); else closeInfo();
});
// duplo clique: centraliza a câmera no ponto clicado
renderer.domElement.addEventListener('dblclick', (e) => {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  if (raycaster.ray.intersectPlane(new THREE.Plane(V(0, 1, 0), 0), p)) moveCameraTo(p);
});

const infoEl = $('#info');
function openInfo(o) {
  const I = OBJ_INFO[o.userData.info](o);
  infoEl.style.setProperty('--c', I.color || state.active.css);
  $('#info-title').innerHTML = I.title;
  $('#info-body').innerHTML = I.body;
  $('#info-meta').textContent = I.meta || '';
  const more = $('#info-more');
  more.textContent = I.more ? 'Ver explicação e código ›' : '';
  more.onclick = () => { closeInfo(); openModal(I.more); };
  infoEl.classList.add('open');
}
function closeInfo() { infoEl.classList.remove('open'); }
$('#info-close').addEventListener('click', closeInfo);

// ---------- loop ----------
let last = performance.now();
let statsT = 0;
function frame(now) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = state.paused ? 0 : realDt * state.speed;

  if (dt > 0) {
    state.sim += dt;
    if (state.sim >= state.nextGen) {
      state.nextGen = state.sim + state.genEvery * rnd(0.6, 1.4);
      for (const L of LANES) spawnRecord(L);
    }
    for (const L of LANES) {
      if (L.id === 'api') updateAPI(L, dt);
      else if (L.id === 'scrap') updateScrap(L, dt);
      else updateBatch(L, dt);
      updateRoad(L, dt);
    }
    for (const rec of [...moving]) {
      if (rec.delay > 0) { rec.delay -= dt; continue; }
      if (stepMover(rec.mesh, rec.mv, dt)) { moving.delete(rec); rec.onDone && rec.onDone(); }
    }
    updateTransforms();
  }

  // animações visuais (pop-in, fade, robô, relógio, alarme)
  const L = state.active;
  for (const r of [...L.pending, ...L.road, ...moving]) {
    if (r.mesh && r.pop !== undefined && r.pop < 1) {
      r.pop = Math.min(1, r.pop + realDt * 4);
      const k = r.pop;
      r.mesh.scale.setScalar(k >= 1 ? 1 : k < 0.8 ? 0.01 + (k / 0.8) * 1.14 : 1.15 - ((k - 0.8) / 0.2) * 0.15);
    }
  }
  for (const X of LANES) {
    if (X.robot) X.robot.userData.head.rotation.y = Math.sin(now / 300) * 0.25;
    X.hand.rotation.z = -state.sim * 0.8;
    const alarm = (X.id === 'api' && state.rateLimit) || (X.id === 'scrap' && state.siteBroken);
    X.alarmMat.color.set(alarm ? (Math.floor(now / 300) % 2 ? 0xff3c3c : 0x5a1010) : 0x4cff8a);
  }
  for (let i = fading.length - 1; i >= 0; i--) {
    const f = fading[i];
    f.t += realDt * 3;
    f.mesh.scale.setScalar(Math.max(0.01, 1 - f.t));
    if (f.t >= 1) { disposeCar(f.mesh); fading.splice(i, 1); }
  }

  updateCamTween(realDt);
  updateFollow(realDt);
  controls.update();
  clampCamera();
  renderer.render(scene, camera);
  updatePops(realDt);

  statsT -= realDt;
  if (statsT <= 0) { statsT = 0.25; renderStats(); }
  requestAnimationFrame(frame);
}

// ---------- painel e controles ----------
const avgLat = (L) => (L.stats.latN ? L.stats.latSum / L.stats.latN : NaN);
function renderStats() {
  const L = state.active, s = L.stats;
  const card = $('#stat');
  card.querySelector('[data-k="dest"]').textContent = s.extracted;
  card.querySelector('[data-k="lat"]').textContent = fmtS(avgLat(L));
  card.querySelector('[data-k="req"]').textContent = s.requests;
  card.querySelector('[data-k="rej"]').textContent = s.rejected;
  let st;
  if (L.id === 'api') st = state.rateLimit ? '<span class="bad">●</span> rate limit ativo (429)' : `<span class="good">●</span> pergunta a cada ${state.pollEvery}s`;
  else if (L.id === 'scrap') st = state.siteBroken ? '<span class="bad">●</span> layout mudou: seletor quebrado' : '<span class="good">●</span> seletor OK · 1 item por vez';
  else st = L.batchState.phase === 'parked' ? `<span class="warn">●</span> próximo lote em ${Math.ceil(Math.max(0, L.nextBatch - state.sim))}s` : '<span class="good">●</span> lote a caminho…';
  $('#st-status').innerHTML = st + ` · ${L.pending.length} esperando`;
  if ($('#cmp').classList.contains('open')) renderCompare();
}

function renderCompare() {
  const rows = [
    ['No banco', (L) => L.stats.extracted, 'max'],
    ['Latência média', (L) => avgLat(L), 'min', fmtS],
    ['Acessos à fonte', (L) => L.stats.requests, 'min'],
    ['Falhas na extração', (L) => L.stats.fails, 'min'],
    ['% rejeitados', (L) => (L.stats.seen ? (100 * L.stats.rejected) / L.stats.seen : NaN), 'min', (v) => (Number.isFinite(v) ? v.toFixed(0) + '%' : '—')],
  ];
  let html = '<tr><th></th>' + LANES.map((L) => `<th style="color:${L.css}">${L.id === 'scrap' ? 'SCRAPING' : L.id === 'api' ? 'API' : 'LOTE'}</th>`).join('') + '</tr>';
  for (const [name, get, best, f = (v) => v] of rows) {
    const vals = LANES.map(get);
    const ok = vals.filter(Number.isFinite);
    const target = ok.length ? (best === 'max' ? Math.max(...ok) : Math.min(...ok)) : null;
    html += `<tr><td>${name}</td>` + vals.map((v) => `<td class="${v === target && ok.length > 1 ? 'best' : ''}">${f(v)}</td>`).join('') + '</tr>';
  }
  $('#c-table').innerHTML = html;
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  for (const L of LANES) {
    const w = L.stations.find((s) => s.id === 'wash');
    w.roofMat.color.set(mode === 'ETL' ? 0x2f9ae0 : 0x7d8590);
    w.brushMat.color.set(mode === 'ETL' ? 0x3fd0ff : 0x9aa0a8);
    L.dwMat.color.set(mode === 'ETL' ? 0x6b4fa0 : 0x2f7fb5);
  }
}
function setRateLimit(on) { state.rateLimit = on; updateScenarioButton(); }
function setBroken(on) {
  state.siteBroken = on;
  const L = LANE.scrap;
  L.glassMat.color.set(on ? 0xff4fd8 : 0x8fe6ff);
  L.chrome.position.y = on ? 2.9 : 2.2 + 0.175;
  L.chrome.material = M(on ? 0xb03fa0 : 0x50545f);
  if (!on) popup(L, 'seletor atualizado', V(-32, 3.4, L.z), 'ok');
  updateScenarioButton();
}
function forceBatch() {
  const L = LANE.batch;
  if (L.batchState.phase === 'parked') L.nextBatch = state.sim;
}
function updateScenarioButton() {
  const b = $('#btn-scenario');
  const id = state.active.id;
  b.classList.remove('danger');
  if (id === 'api') {
    b.textContent = state.rateLimit ? 'Desligar rate limit' : 'Simular rate limit (429)';
    b.classList.toggle('danger', state.rateLimit);
  } else if (id === 'scrap') {
    b.textContent = state.siteBroken ? 'Corrigir seletor' : 'Mudar layout do site';
    b.classList.toggle('danger', state.siteBroken);
  } else b.textContent = 'Gerar lote agora';
}
$('#btn-scenario').addEventListener('click', () => {
  const id = state.active.id;
  if (id === 'api') setRateLimit(!state.rateLimit);
  else if (id === 'scrap') setBroken(!state.siteBroken);
  else forceBatch();
});

$('#btn-play').addEventListener('click', () => {
  state.paused = !state.paused;
  $('#btn-play').textContent = state.paused ? 'Continuar' : 'Pausar';
});
document.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => {
  state.speed = +b.dataset.speed;
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
}));
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.querySelectorAll('[data-lane]').forEach((b) => b.addEventListener('click', () => selectLane(b.dataset.lane)));
$('#btn-follow').addEventListener('click', () => setFollow(!state.follow));
$('#btn-cam').addEventListener('click', () => { camera.zoom = 1; camera.updateProjectionMatrix(); selectLane(state.active.id, true); });
$('#st-code').addEventListener('click', () => openModal(state.active.id));
$('#btn-compare').addEventListener('click', () => { renderCompare(); $('#cmp').classList.add('open'); });
$('#c-close').addEventListener('click', () => $('#cmp').classList.remove('open'));
$('#cmp').addEventListener('click', (e) => { if (e.target.id === 'cmp') $('#cmp').classList.remove('open'); });

// ---------- modal com explicação + código ----------
const INFO = {
  api: {
    title: 'Coleta via API', color: '#4c8dff',
    city: 'Uma van vai até o guichê da API, pede <b>uma página</b> de dados e volta com no máximo 4 carros. A cada 3s ela pergunta de novo, mesmo quando não tem nada novo (isso é <b>polling</b>).',
    real: 'Você chama endpoints HTTP (REST/JSON) com autenticação. O dado já vem <b>estruturado e paginado</b>, e o provedor controla o ritmo com <b>rate limit</b> (HTTP 429).',
    pros: ['Dado estruturado (JSON), com tipos e documentação', 'Contrato estável e versionado', 'Dá para pedir só o que mudou (<code>?updated_since=</code>)'],
    cons: ['Rate limit e cotas', 'Paginação, tokens que expiram', 'Polling gasta requisição quando nada mudou'],
  },
  scrap: {
    title: 'Web Scraping', color: '#ff8a3d',
    city: 'Um robô vai até a <b>vitrine</b> do site e lê cada carro com um feixe de luz, criando uma <b>cópia</b>. Ele só enxerga o que está na tela e lê um por vez.',
    real: 'Você baixa o HTML de páginas feitas para <b>humanos</b> e recorta os dados com seletores CSS. Os valores chegam como texto (<code>"R$ 1.299,90"</code>).',
    pros: ['Funciona quando não existe API', 'Pega qualquer dado visível na página'],
    cons: ['Frágil: se o layout muda, o seletor quebra', 'Dado sujo → mais rejeitados no caminho', 'Lento e pode ser bloqueado (captcha, IP)', 'Respeite termos de uso e robots.txt'],
  },
  batch: {
    title: 'Arquivo em lote', color: '#3ecf7a',
    city: 'O ERP vai juntando os carros o dia todo. No <b>horário marcado</b>, uma cegonha leva todos de uma vez, num único arquivo.',
    real: 'Um sistema exporta CSV/Excel/TXT para uma pasta, SFTP ou bucket em horário agendado, e você processa o <b>arquivo inteiro</b>.',
    pros: ['Muito eficiente para grande volume', 'Um acesso por lote: não sobrecarrega a fonte', 'Fácil reprocessar (o arquivo fica guardado)'],
    cons: ['Latência alta: o dado espera o próximo lote', 'Encoding, separador e linhas quebradas', 'Se o arquivo não chega, o dia todo atrasa'],
  },
  wash: {
    title: 'O caminho até o banco', color: '#3fd0ff',
    city: 'Depois de extraído, todo carro passa por: <b>área de pouso</b> (guarda a cópia bruta) → <b>pedágio</b> (validação de schema) → <b>lava-rápido</b> (transformação) → <b>detector de duplicados</b> → <b>posto</b> (enriquecimento) → <b>portão de carga</b> (grava no banco). A <b>torre</b> monitora tudo e o <b>relógio</b> (orquestrador) decide quando cada coisa roda.',
    real: '<b>ETL</b>: valida, limpa, deduplica e enriquece <b>antes</b> de gravar, e só entra dado pronto no banco. <b>ELT</b>: grava o bruto primeiro e faz essas etapas <b>dentro do banco</b> (SQL, dbt). Teste os dois modos na barra de baixo.',
    pros: ['ETL: o banco só recebe dado limpo e confiável', 'ELT: o dado chega mais rápido e o bruto fica guardado para reprocessar', 'A área de pouso permite reprocessar sem voltar à fonte'],
    cons: ['ETL: cada etapa pode virar gargalo (veja a fila)', 'ELT: o banco guarda lixo até a transformação rodar', 'Sem quarentena, um dado ruim pode derrubar a carga inteira'],
  },
};
const KW = 'import|from|def|return|for|in|if|not|and|or|while|True|False|None|continue|break|with|as|tuple|raise|is';
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function hl(code) {
  const re = new RegExp(`(#[^\\n]*)|("(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*')|\\b(${KW})\\b|\\b(\\d+(?:\\.\\d+)?)\\b`, 'g');
  let out = '', lastI = 0, m;
  while ((m = re.exec(code))) {
    out += esc(code.slice(lastI, m.index));
    const cls = m[1] ? 'c' : m[2] ? 's' : m[3] ? 'k' : 'n';
    out += `<span class="${cls}">${esc(m[0])}</span>`;
    lastI = re.lastIndex;
  }
  return out + esc(code.slice(lastI));
}
function openModal(id) {
  const I = INFO[id];
  $('#m-title').textContent = I.title;
  $('#m-title').style.color = I.color;
  $('#m-city').innerHTML = I.city;
  $('#m-real').innerHTML = I.real;
  $('#m-pros').innerHTML = I.pros.map((p) => `<li>${p}</li>`).join('');
  $('#m-cons').innerHTML = I.cons.map((p) => `<li>${p}</li>`).join('');
  const el = document.getElementById(`code-${id}-py`);
  $('#m-code').innerHTML = el ? hl(el.textContent.replace(/^\n+|\s+$/g, '')) : '';
  $('#modal').classList.add('open');
  $('#mbox').scrollTop = 0;
}
function closeModal() { $('#modal').classList.remove('open'); }
$('#m-close').addEventListener('click', closeModal);
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeInfo(); $('#cmp').classList.remove('open'); }
});
$('#m-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#m-code').textContent); $('#m-copy').textContent = 'Copiado!'; }
  catch { $('#m-copy').textContent = 'Selecione e copie'; }
  setTimeout(() => ($('#m-copy').textContent = 'Copiar'), 1400);
});

resize();
setMode('ETL');
selectLane('api', true);
requestAnimationFrame(frame);
if (import.meta.env && import.meta.env.DEV) window.__debug = { state, LANES, camera, controls };
