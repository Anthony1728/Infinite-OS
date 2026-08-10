const canvas = document.querySelector('canvas');
const ctx = canvas.getContext('2d');

const player = { x: 400, y: 300, size: 20, color: '#e94560' };
const keys = {};

document.addEventListener('keydown', e => keys[e.key] = true);
document.addEventListener('keyup', e => keys[e.key] = false);

function gameLoop() {
  ctx.fillStyle = '#0a0a0f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  
  if (keys['Arrow

Flexbox layouts: