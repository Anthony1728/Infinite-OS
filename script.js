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

I can:
- Write code in any language (JS, Python, TypeScript, Rust, Go, etc.)
- Build websites, apps, games, APIs
- Explain any concept in simple terms
- Debug errors and fix code
- Help plan and architect projects
- Research topics deeply
- And I learn from every conversation we have

Essential Git commands: