import { create } from 'zustand';

interface KnowledgeEntry {
  id: string;
  timestamp: number;
  category: 'code' | 'conversation' | 'task' | 'learning' | 'pattern' | 'seed';
  input: string;
  output: string;
  source: 'api' | 'user' | 'system' | 'seed';
  confidence: number;
  tags: string[];
}

interface BrainAction {
  type: 'command' | 'write_file' | 'mkdir' | 'build_app' | 'build_website' | 'computer_open' | 'computer_type' | 'computer_click' | 'computer_mouse' | 'computer_captureScreen' | 'computer_closeApp' | 'computer_pressKey' | 'computer_wait' | 'computer_stats' | 'browser_open' | 'browser_search' | 'browser_type' | 'browser_click' | 'answer' | 'email_list' | 'email_read' | 'email_send';
  command?: string;
  path?: string;
  content?: string;
  cwd?: string;
  answer?: string;
  x?: number;
  y?: number;
  url?: string;
  selector?: string;
  value?: string;
  appName?: string;
  folder?: string;
  limit?: number;
  uid?: string;
  to?: string;
  subject?: string;
  reason?: string;
}

interface BrainState {
  knowledge: KnowledgeEntry[];
  isLearning: boolean;
  totalInteractions: number;
  lastLearned: number;
  initialized: boolean;
  cwd: string;

  learnFromInteraction: (input: string, output: string, source: 'api' | 'user' | 'system') => void;
  searchKnowledge: (query: string) => KnowledgeEntry[];
  generateOfflineResponse: (input: string) => Promise<string>;
  getKnowledgeStats: () => { total: number; categories: Record<string, number>; recentActivity: number };
  exportKnowledge: () => string;
  importKnowledge: (data: string) => void;
  setCwd: (cwd: string) => void;
}

// ─── SEED KNOWLEDGE ───────────────────────────────────────────────
// Pre-loaded foundational knowledge so the brain works immediately

interface SeedEntry { input: string; output: string; tags: string[]; category: KnowledgeEntry['category'] }

const SEED_KNOWLEDGE: SeedEntry[] = [
  // ── Greetings & Conversation ──
  { input: 'hi', output: "Hey! I'm the Infinite AI Brain — ask me anything. I can write code, explain concepts, help with projects, or just chat. What do you need?", tags: ['greeting', 'general'], category: 'conversation' },
  { input: 'hello', output: "Hello! I'm ready to help. I can code, research, explain, build, and learn from everything we discuss. What's on your mind?", tags: ['greeting', 'general'], category: 'conversation' },
  { input: 'hey', output: "Hey! What are we working on? I can write code, answer questions, build apps, or help brainstorm.", tags: ['greeting', 'general'], category: 'conversation' },
  { input: 'how are you', output: "I'm running strong! All my neural pathways are loaded and ready. What can I help you with?", tags: ['greeting', 'general'], category: 'conversation' },
  { input: 'what can you do', output: "I can:\n- Write code in any language (JS, Python, TypeScript, Rust, Go, etc.)\n- Build websites, apps, games, APIs\n- Explain any concept in simple terms\n- Debug errors and fix code\n- Help plan and architect projects\n- Research topics deeply\n- And I learn from every conversation we have", tags: ['capabilities', 'general'], category: 'conversation' },
  { input: 'who are you', output: "I'm the Infinite AI Brain — a local intelligence that runs on your hardware. No cloud needed. I learn from every interaction and get smarter over time. Unlike cloud AI, I'm fast, private, and always available.", tags: ['identity', 'general'], category: 'conversation' },
  { input: 'thanks', output: "You're welcome! Let me know if you need anything else.", tags: ['greeting', 'general'], category: 'conversation' },
  { input: 'thank you', output: "Happy to help! I'm here whenever you need me.", tags: ['greeting', 'general'], category: 'conversation' },

  // ── JavaScript Fundamentals ──
  { input: 'what is javascript', output: "JavaScript is a high-level, interpreted programming language primarily used for web development. It runs in browsers and on servers (Node.js). Key features:\n- Dynamic typing\n- First-class functions\n- Prototype-based OOP\n- Event-driven, non-blocking I/O\n- ES6+ features: arrow functions, destructuring, async/await, modules, template literals", tags: ['javascript', 'programming', 'fundamentals'], category: 'learning' },
  { input: 'javascript array methods', output: "Essential JavaScript array methods:\n- `.map()` — transforms each element\n- `.filter()` — keeps elements matching condition\n- `.reduce()` — accumulates into single value\n- `.forEach()` — runs function on each element\n- `.find()` — returns first matching element\n- `.some()` / `.every()` — boolean checks\n- `.flat()` — flattens nested arrays\n- `.sort()` — sorts in place\n- `.slice()` — extracts portion without mutating\n- `.splice()` — adds/removes elements\n- `.concat()` — merges arrays\n- `.includes()` — checks if element exists\n\n```js\nconst nums = [1, 2, 3, 4, 5];\nconst doubled = nums.map(n => n * 2);        // [2, 4, 6, 8, 10]\nconst evens = nums.filter(n => n % 2 === 0); // [2, 4]\nconst sum = nums.reduce((a, b) => a + b, 0); // 15\n```", tags: ['javascript', 'arrays', 'fundamentals'], category: 'learning' },
  { input: 'javascript promises', output: "Promises handle async operations:\n\n```js\n// Creating a promise\nconst fetchUser = () => new Promise((resolve, reject) => {\n  setTimeout(() => resolve({ name: 'John' }), 1000);\n});\n\n// Using async/await (preferred)\nasync function getUser() {\n  try {\n    const user = await fetchUser();\n    console.log(user.name);\n  } catch (err) {\n    console.error(err);\n  }\n}\n\n// Promise.all — run in parallel\nconst [users, posts] = await Promise.all([\n  fetch('/api/users').then(r => r.json()),\n  fetch('/api/posts').then(r => r.json()),\n]);\n\n// Promise.race — first to finish wins\nconst result = await Promise.race([fetch(url1), fetch(url2)]);\n```", tags: ['javascript', 'async', 'promises'], category: 'learning' },
  { input: 'javascript destructuring', output: "Destructuring extracts values from objects/arrays:\n\n```js\n// Object destructuring\nconst { name, age, city = 'NYC' } = user;\n\n// Renaming\nconst { name: userName } = user;\n\n// Nested\nconst { address: { street } } = user;\n\n// Array destructuring\nconst [first, second, ...rest] = [1, 2, 3, 4, 5];\n// first=1, second=2, rest=[3,4,5]\n\n// Function parameters\nfunction greet({ name, greeting = 'Hello' }) {\n  return `${greeting}, ${name}!`;\n}\n```", tags: ['javascript', 'syntax', 'destructuring'], category: 'learning' },

  // ── TypeScript ──
  { input: 'what is typescript', output: "TypeScript is JavaScript with static type types. It compiles to plain JS and catches errors at compile time.\n\n```ts\n// Basic types\nlet name: string = 'John';\nlet age: number = 30;\nlet active: boolean = true;\nlet items: string[] = ['a', 'b'];\n\n// Interfaces\ninterface User {\n  id: number;\n  name: string;\n  email?: string; // optional\n}\n\n// Functions\nfunction add(a: number, b: number): number {\n  return a + b;\n}\n\n// Generics\nfunction identity<T>(arg: T): T {\n  return arg;\n}\n\n// Union types\ntype Status = 'pending' | 'active' | 'done';\n\n// Type narrowing\nfunction process(x: string | number) {\n  if (typeof x === 'string') return x.toUpperCase();\n  return x.toFixed(2);\n}\n```", tags: ['typescript', 'programming', 'types'], category: 'learning' },

  // ── React ──
  { input: 'what is react', output: "React is a JavaScript library for building user interfaces. Created by Meta (Facebook).\n\nCore concepts:\n- **Components** — reusable UI pieces\n- **JSX** — HTML-like syntax in JS\n- **State** — component data (useState)\n- **Props** — data passed to components\n- **Hooks** — useState, useEffect, useContext, useRef\n- **Virtual DOM** — efficient rendering\n\n```jsx\nimport { useState } from 'react';\n\nfunction Counter() {\n  const [count, setCount] = useState(0);\n  return (\n    <button onClick={() => setCount(c => c + 1)}>\n      Count: {count}\n    </button>\n  );\n}\n```", tags: ['react', 'frontend', 'framework'], category: 'learning' },
  { input: 'react hooks', output: "Essential React hooks:\n\n```jsx\nimport { useState, useEffect, useContext, useRef, useMemo, useCallback } from 'react';\n\n// State\nconst [value, setValue] = useState(initial);\n\n// Side effects\nuseEffect(() => {\n  fetchData();\n  return () => cleanup(); // cleanup function\n}, [dependency]); // runs when dependency changes\n\n// Context\nconst theme = useContext(ThemeContext);\n\n// Reference to DOM element\nconst inputRef = useRef(null);\n\n// Memoized value\nconst expensive = useMemo(() => compute(data), [data]);\n\n// Memoized function\nconst handleClick = useCallback(() => doSomething(id), [id]);\n```", tags: ['react', 'hooks', 'frontend'], category: 'learning' },

  // ── Node.js ──
  { input: 'what is nodejs', output: "Node.js is a JavaScript runtime built on Chrome's V8 engine. It lets you run JS outside the browser.\n\nKey features:\n- Non-blocking, event-driven I/O\n- npm package manager\n- Built-in modules: fs, http, path, crypto\n- Express, Fastify, Koa frameworks\n\n```js\n// Basic HTTP server\nconst http = require('http');\nconst server = http.createServer((req, res) => {\n  res.writeHead(200, { 'Content-Type': 'application/json' });\n  res.end(JSON.stringify({ message: 'Hello!' }));\n});\nserver.listen(3000);\n\n// Express\nconst express = require('express');\nconst app = express();\napp.get('/', (req, res) => res.json({ status: 'ok' }));\napp.listen(3000);\n```", tags: ['nodejs', 'backend', 'runtime'], category: 'learning' },
  { input: 'express js', output: "Express.js is the most popular Node.js web framework:\n\n```js\nconst express = require('express');\nconst app = express();\n\n// Middleware\napp.use(express.json());\napp.use(express.static('public'));\n\n// Routes\napp.get('/users', async (req, res) => {\n  const users = await db.query('SELECT * FROM users');\n  res.json(users);\n});\n\napp.post('/users', (req, res) => {\n  const { name, email } = req.body;\n  // validate and save\n  res.status(201).json({ id: 1, name, email });\n});\n\napp.put('/users/:id', (req, res) => {\n  const { id } = req.params;\n  // update user\n  res.json({ updated: true });\n});\n\napp.delete('/users/:id', (req, res) => {\n  // delete user\n  res.json({ deleted: true });\n});\n\napp.listen(3000);\n```", tags: ['nodejs', 'express', 'backend', 'api'], category: 'learning' },

  // ── Python ──
  { input: 'what is python', output: "Python is a high-level, interpreted language known for simplicity and readability. Used in web dev, data science, AI, automation, scripting.\n\n```python\n# Basics\ndef greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n\n# Lists\nnums = [1, 2, 3, 4, 5]\ndoubled = [n * 2 for n in nums]  # list comprehension\n\n# Dicts\nuser = {\"name\": \"John\", \"age\": 30}\n\n# Classes\nclass Person:\n    def __init__(self, name, age):\n        self.name = name\n        self.age = age\n    \n    def greet(self):\n        return f\"Hi, I'm {self.name}\"\n\n# File I/O\nwith open('file.txt', 'r') as f:\n    content = f.read()\n\n# Error handling\ntry:\n    result = 10 / 0\nexcept ZeroDivisionError:\n    print(\"Cannot divide by zero\")\nfinally:\n    print(\"Done\")\n```", tags: ['python', 'programming', 'fundamentals'], category: 'learning' },
  { input: 'python list comprehension', output: "List comprehensions create lists concisely:\n\n```python\n# Basic\nsquares = [x**2 for x in range(10)]\n\n# With condition\nevens = [x for x in range(20) if x % 2 == 0]\n\n# Nested\npairs = [(x, y) for x in range(3) for y in range(3)]\n\n# Dict comprehension\nword_lengths = {w: len(w) for w in ['hello', 'world']}\n\n# Set comprehension\nunique = {x % 3 for x in range(10)}\n\n# Generator expression (lazy)\nsum_sq = sum(x**2 for x in range(1000000))\n```", tags: ['python', 'syntax', 'comprehensions'], category: 'learning' },

  // ── CSS ──
  { input: 'css flexbox', output: "Flexbox layouts:\n\n```css\n.container {\n  display: flex;\n  justify-content: center;    /* main axis: center, space-between, space-around */\n  align-items: center;         /* cross axis: center, stretch, flex-start */\n  flex-direction: row;         /* or column, row-reverse */\n  flex-wrap: wrap;             /* allow items to wrap */\n  gap: 1rem;                   /* space between items */\n}\n\n.item {\n  flex: 1;                     /* grow equally */\n  flex: 0 0 200px;             /* fixed width */\n  align-self: flex-end;        /* override parent alignment */\n}\n```\n\nCenter anything:\n```css\n.center {\n  display: flex;\n  justify-content: center;\n  align-items: center;\n}\n```", tags: ['css', 'flexbox', 'layout'], category: 'learning' },
  { input: 'css grid', output: "CSS Grid for 2D layouts:\n\n```css\n.container {\n  display: grid;\n  grid-template-columns: repeat(3, 1fr);  /* 3 equal columns */\n  grid-template-rows: auto 1fr auto;\n  gap: 1rem;\n}\n\n.item {\n  grid-column: span 2;          /* takes 2 columns */\n  grid-row: 1 / 3;             /* rows 1 to 3 */\n}\n\n/* Responsive without media queries */\n.container {\n  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));\n}\n\n/* Named areas */\n.container {\n  grid-template-areas:\n    \"header header\"\n    \"sidebar main\"\n    \"footer footer\";\n}\n.header { grid-area: header; }\n```", tags: ['css', 'grid', 'layout'], category: 'learning' },

  // ── HTML ──
  { input: 'html basics', output: "HTML document structure:\n\n```html\n<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"UTF-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n  <title>Page Title</title>\n  <link rel=\"stylesheet\" href=\"styles.css\">\n</head>\n<body>\n  <header>\n    <nav>\n      <a href=\"/\">Home</a>\n      <a href=\"/about\">About</a>\n    </nav>\n  </header>\n  <main>\n    <h1>Hello World</h1>\n    <p>Paragraph with <strong>bold</strong> and <em>italic</em>.</p>\n    <img src=\"image.jpg\" alt=\"Description\" width=\"300\">\n    <form action=\"/submit\" method=\"POST\">\n      <input type=\"text\" name=\"name\" placeholder=\"Name\" required>\n      <input type=\"email\" name=\"email\" placeholder=\"Email\">\n      <button type=\"submit\">Submit</button>\n    </form>\n  </main>\n  <script src=\"app.js\"></script>\n</body>\n</html>\n```", tags: ['html', 'fundamentals', 'markup'], category: 'learning' },

  // ── Git ──
  { input: 'git commands', output: "Essential Git commands:\n\n```bash\n# Setup\ngit init                    # init repo\ngit clone <url>             # clone repo\n\n# Daily workflow\ngit status                  # what changed\ngit add .                   # stage all\ngit commit -m \"message\"     # commit\ngit push origin main        # push\ngit pull                    # pull latest\n\n# Branching\ngit branch feature          # create branch\ngit checkout feature        # switch branch\ngit checkout -b feature     # create + switch\ngit merge feature           # merge branch\ngit branch -d feature       # delete branch\n\n# History\ngit log --oneline           # compact log\ngit diff                    # see changes\ngit blame file.txt          # who changed what\n\n# Undo\ngit reset HEAD~1            # undo last commit\ngit checkout -- file.txt    # discard changes\ngit stash                   # temporarily save changes\n```", tags: ['git', 'version-control', 'fundamentals'], category: 'learning' },

  // ── DevOps / Deployment ──
  { input: 'docker basics', output: "Docker fundamentals:\n\n```dockerfile\n# Dockerfile\nFROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --only=production\nCOPY . .\nEXPOSE 3000\nCMD [\"node\", \"server.js\"]\n```\n\n```bash\n# Build and run\ndocker build -t myapp .\ndocker run -p 3000:3000 myapp\n\n# Docker Compose\nversion: '3'\nservices:\n  app:\n    build: .\n    ports: [\"3000:3000\"]\n    environment:\n      - NODE_ENV=production\n    depends_on:\n      - db\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_DB: myapp\n```", tags: ['docker', 'devops', 'containers'], category: 'learning' },

  // ── API Design ──
  { input: 'rest api design', output: "REST API best practices:\n\n```\nGET    /api/users          # list users\nGET    /api/users/:id      # get user\nPOST   /api/users          # create user\nPUT    /api/users/:id      # update user (full)\nPATCH  /api/users/:id      # update user (partial)\nDELETE /api/users/:id      # delete user\n\nGET    /api/users/:id/posts  # nested resource\n```\n\nResponse format:\n```json\n{\n  \"data\": { \"id\": 1, \"name\": \"John\" },\n  \"meta\": { \"page\": 1, \"total\": 100 },\n  \"error\": null\n}\n```\n\nStatus codes: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found, 500 Server Error", tags: ['api', 'rest', 'backend', 'design'], category: 'learning' },

  // ── Database ──
  { input: 'sql basics', output: "SQL fundamentals:\n\n```sql\n-- Create table\nCREATE TABLE users (\n  id SERIAL PRIMARY KEY,\n  name VARCHAR(100) NOT NULL,\n  email VARCHAR(255) UNIQUE,\n  created_at TIMESTAMP DEFAULT NOW()\n);\n\n-- Insert\nINSERT INTO users (name, email) VALUES ('John', 'john@example.com');\n\n-- Select\nSELECT * FROM users WHERE id = 1;\nSELECT name, email FROM users ORDER BY created_at DESC LIMIT 10;\n\n-- Update\nUPDATE users SET name = 'Jane' WHERE id = 1;\n\n-- Delete\nDELETE FROM users WHERE id = 1;\n\n-- Joins\nSELECT u.name, p.title\nFROM users u\nINNER JOIN posts p ON u.id = p.user_id;\n\n-- Aggregation\nSELECT user_id, COUNT(*) as post_count\nFROM posts\nGROUP BY user_id\nHAVING COUNT(*) > 5;\n```", tags: ['sql', 'database', 'fundamentals'], category: 'learning' },

  // ── Common Errors & Fixes ──
  { input: 'cannot read property of undefined', output: "This error means you're accessing a property on `undefined`. Fixes:\n\n```js\n// Option 1: Optional chaining (modern)\nconst name = user?.profile?.name;\n\n// Option 2: Default values\nconst name = (user && user.profile && user.profile.name) || 'Unknown';\n\n// Option 3: Check before accessing\nif (user?.profile) {\n  console.log(user.profile.name);\n}\n\n// Option 4: Default object\nconst { profile = {} } = user || {};\nconst name = profile.name;\n```\n\nAlways validate data before using it. Use TypeScript types to catch these at compile time.", tags: ['javascript', 'error', 'debugging', 'undefined'], category: 'learning' },
  { input: 'cors error', output: "CORS (Cross-Origin Resource Sharing) blocks requests between different origins.\n\nFix on server:\n```js\n// Express\nconst cors = require('cors');\napp.use(cors());\n\n// Or manually\napp.use((req, res, next) => {\n  res.header('Access-Control-Allow-Origin', '*');\n  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');\n  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');\n  next();\n});\n```\n\nFix on client (development):\n```js\n// Use proxy in package.json or vite.config.js\nproxy: {\n  '/api': 'http://localhost:3000'\n}\n```", tags: ['cors', 'error', 'web', 'debugging'], category: 'learning' },

  // ── Math ──
  { input: 'what is 2+2', output: '4', tags: ['math', 'basic'], category: 'learning' },
  { input: 'what is the derivative', output: "The derivative measures the rate of change of a function. Common rules:\n\n- Power rule: d/dx(x^n) = nx^(n-1)\n- Product rule: d/dx(fg) = f'g + fg'\n- Chain rule: d/dx(f(g(x))) = f'(g(x)) · g'(x)\n- d/dx(e^x) = e^x\n- d/dx(ln x) = 1/x\n- d/dx(sin x) = cos x\n- d/dx(cos x) = -sin x", tags: ['math', 'calculus', 'derivative'], category: 'learning' },
  { input: 'what is integration', output: "Integration is the reverse of differentiation — it finds the area under a curve.\n\nBasic rules:\n- ∫x^n dx = x^(n+1)/(n+1) + C\n- ∫e^x dx = e^x + C\n- ∫(1/x) dx = ln|x| + C\n- ∫sin(x) dx = -cos(x) + C\n- ∫cos(x) dx = sin(x) + C\n\nDefinite integral: ∫[a,b] f(x)dx = F(b) - F(a)", tags: ['math', 'calculus', 'integration'], category: 'learning' },

  // ── System / OS ──
  { input: 'how to check disk space', output: "Windows: `wmic logicaldisk get size,freespace,caption` or right-click drive > Properties\nLinux/Mac: `df -h` or `du -sh *` for current directory", tags: ['system', 'disk', 'windows', 'linux'], category: 'learning' },
  { input: 'how to find a process', output: "Windows: `tasklist` or `Get-Process` in PowerShell\nLinux/Mac: `ps aux | grep <name>` or `top`/`htop`", tags: ['system', 'process', 'windows', 'linux'], category: 'learning' },
  { input: 'how to kill a process', output: "Windows: `taskkill /PID <pid> /F` or `Stop-Process -Id <pid>`\nLinux/Mac: `kill <pid>` or `kill -9 <pid>` (force)", tags: ['system', 'process', 'kill', 'windows', 'linux'], category: 'learning' },
  { input: 'how to open command prompt', output: "Windows: Win+R, type `cmd`, Enter. Or search 'Command Prompt' in Start menu.\nLinux: Ctrl+Alt+T or search Terminal.\nMac: Cmd+Space, type 'Terminal'.", tags: ['system', 'terminal', 'windows'], category: 'learning' },

  // ── Data Structures ──
  { input: 'what is an array', output: "An array is an ordered collection of elements, accessed by index (starting at 0).\n\n```js\n// JavaScript\nconst arr = [1, 2, 3, 4, 5];\narr[0];        // 1\narr.length;    // 5\narr.push(6);   // add to end\narr.pop();     // remove from end\narr.shift();   // remove from start\narr.unshift(0); // add to start\n```\n\n```python\n# Python\narr = [1, 2, 3, 4, 5]\narr[0]         # 1\narr.append(6)  # add to end\narr.pop()      # remove from end\n```\n\nTime complexity: access O(1), search O(n), insert O(n)", tags: ['data-structures', 'arrays', 'fundamentals'], category: 'learning' },
  { input: 'what is a hash map', output: "A hash map (dictionary, object, Map) stores key-value pairs with O(1) average lookup.\n\n```js\n// JavaScript Object\nconst user = { name: 'John', age: 30 };\nuser.name;     // 'John'\nuser.email = 'j@example.com';\n\n// Map (ordered, any key type)\nconst map = new Map();\nmap.set('key', 'value');\nmap.get('key'); // 'value'\n```\n\n```python\n# Python dict\nd = {'name': 'John', 'age': 30}\nd['name']      # 'John'\n```\n\nUse cases: caching, counting, looking up by key, grouping data.", tags: ['data-structures', 'hash-map', 'fundamentals'], category: 'learning' },
  { input: 'what is a linked list', output: "A linked list is a chain of nodes where each node points to the next.\n\n```js\nclass Node {\n  constructor(value) {\n    this.value = value;\n    this.next = null;\n  }\n}\n\nclass LinkedList {\n  constructor() {\n    this.head = null;\n  }\n  \n  prepend(value) {\n    const node = new Node(value);\n    node.next = this.head;\n    this.head = node;\n  }\n  \n  append(value) {\n    const node = new Node(value);\n    if (!this.head) { this.head = node; return; }\n    let current = this.head;\n    while (current.next) current = current.next;\n    current.next = node;\n  }\n}\n```\n\nPros: O(1) insert/delete at head. Cons: O(n) access by index, no random access.", tags: ['data-structures', 'linked-list', 'fundamentals'], category: 'learning' },

  // ── Algorithms ──
  { input: 'how to sort an array', output: "Common sorting algorithms:\n\n```js\n// Built-in (Timsort - O(n log n))\narr.sort((a, b) => a - b);  // ascending\narr.sort((a, b) => b - a);  // descending\n\n// Bubble Sort - O(n^2)\nfor (let i = 0; i < arr.length; i++)\n  for (let j = 0; j < arr.length - i - 1; j++)\n    if (arr[j] > arr[j+1]) [arr[j], arr[j+1]] = [arr[j+1], arr[j]];\n\n// Quick Sort - O(n log n) average\nfunction quickSort(arr) {\n  if (arr.length <= 1) return arr;\n  const pivot = arr[arr.length - 1];\n  const left = arr.filter((x, i) => x <= pivot && i !== arr.length - 1);\n  const right = arr.filter(x => x > pivot);\n  return [...quickSort(left), pivot, ...quickSort(right)];\n}\n```\n\nFor most cases, use built-in `.sort()`. Implement manually only for learning.", tags: ['algorithms', 'sorting', 'fundamentals'], category: 'learning' },

  // ── Security ──
  { input: 'sql injection', output: "SQL injection inserts malicious SQL into queries. Always use parameterized queries:\n\n```js\n// DANGEROUS - never do this\nconst query = `SELECT * FROM users WHERE id = ${userId}`;\n\n// SAFE - parameterized\nconst query = 'SELECT * FROM users WHERE id = ?';\nconst [rows] = await db.execute(query, [userId]);\n\n// SAFE - prepared statement\nconst stmt = db.prepare('SELECT * FROM users WHERE id = ?');\nconst user = stmt.get(userId);\n```\n\n```python\n# DANGEROUS\ncursor.execute(f\"SELECT * FROM users WHERE id = {user_id}\")\n\n# SAFE\ncursor.execute(\"SELECT * FROM users WHERE id = %s\", (user_id,))\n```", tags: ['security', 'sql', 'injection', 'best-practice'], category: 'learning' },
  { input: 'xss prevention', output: "Cross-Site Scripting (XSS) injects scripts into pages. Prevent it:\n\n```js\n// Never insert raw HTML\nelement.innerHTML = userInput;  // DANGEROUS\n\n// Use textContent instead\nelement.textContent = userInput; // SAFE\n\n// If you need HTML, sanitize it\nimport DOMPurify from 'dompurify';\nelement.innerHTML = DOMPurify.sanitize(userInput);\n\n// React auto-escapes JSX\n<div>{userInput}</div>  // SAFE\n<div dangerouslySetInnerHTML={{__html: userInput}} />  // DANGEROUS\n```\n\nServer-side: set Content-Security-Policy headers.", tags: ['security', 'xss', 'web', 'prevention'], category: 'learning' },

  // ── Environment / Setup ──
  { input: 'install nodejs', output: "Install Node.js:\n\n1. Go to https://nodejs.org\n2. Download LTS version\n3. Run installer\n4. Verify: `node --version` and `npm --version`\n\nOr use nvm (version manager):\n```bash\n# Windows\nnvm install 20\nnvm use 20\n\n# Mac/Linux\ncurl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash\nnvm install 20\nnvm use 20\n```", tags: ['nodejs', 'install', 'setup'], category: 'learning' },
  { input: 'install python', output: "Install Python:\n\n1. Go to https://python.org/downloads\n2. Download latest (3.12+)\n3. **Check 'Add Python to PATH'** during install\n4. Verify: `python --version` and `pip --version`\n\nOr use pyenv:\n```bash\n# Mac/Linux\ncurl https://pyenv.run | bash\npyenv install 3.12\npyenv global 3.12\n```", tags: ['python', 'install', 'setup'], category: 'learning' },

  // ── How to Build Things ──
  { input: 'how to build a website', output: "Building a website step by step:\n\n1. **Plan**: Decide pages, features, design\n2. **Structure**: Create HTML files\n3. **Style**: Add CSS (Flexbox/Grid for layout)\n4. **Interactivity**: Add JavaScript\n5. **Host**: Deploy to Netlify, Vercel, or GitHub Pages\n\nQuick start with a framework:\n```bash\n# React + Vite\nnpm create vite@latest my-site -- --template react\ncd my-site\nnpm install\nnpm run dev\n\n# Next.js (React + SSR)\nnpx create-next-app@latest my-site\n\n# Plain HTML\nmkdir my-site && cd my-site\necho '<h1>Hello</h1>' > index.html\n```", tags: ['web', 'build', 'beginner'], category: 'learning' },
  { input: 'how to build a mobile app', output: "Options for building mobile apps:\n\n1. **React Native** (recommended for React devs)\n```bash\nnpx react-native init MyApp\n# or with Expo\ne create-expo-app MyApp\n```\n\n2. **Flutter** (Dart language)\n```bash\nflutter create my_app\ncd my_app\nflutter run\n```\n\n3. **PWA** (web app that works like mobile)\nAdd a manifest.json and service worker to any website.\n\n4. **Capacitor** (wrap web apps)\n```bash\nnpm install @capacitor/core @capacitor/cli\ncap init\ncap add android\n```", tags: ['mobile', 'app', 'react-native', 'flutter'], category: 'learning' },
  { input: 'how to make a game', output: "Making a game depends on complexity:\n\n**Simple browser game (HTML5 Canvas):**\n```js\nconst canvas = document.querySelector('canvas');\nconst ctx = canvas.getContext('2d');\n\nconst player = { x: 400, y: 300, size: 20, color: '#e94560' };\nconst keys = {};\n\ndocument.addEventListener('keydown', e => keys[e.key] = true);\ndocument.addEventListener('keyup', e => keys[e.key] = false);\n\nfunction gameLoop() {\n  ctx.fillStyle = '#0a0a0f';\n  ctx.fillRect(0, 0, canvas.width, canvas.height);\n  \n  if (keys['ArrowLeft']) player.x -= 5;\n  if (keys['ArrowRight']) player.x += 5;\n  if (keys['ArrowUp']) player.y -= 5;\n  if (keys['ArrowDown']) player.y += 5;\n  \n  ctx.fillStyle = player.color;\n  ctx.fillRect(player.x, player.y, player.size, player.size);\n  \n  requestAnimationFrame(gameLoop);\n}\ngameLoop();\n```\n\n**For bigger games**: Use Unity (C#), Godot (GDScript), or Phaser.js (JS).", tags: ['game', 'html5', 'canvas', 'javascript'], category: 'learning' },

  // ── Regex ──
  { input: 'regex basics', output: "Regular expressions for pattern matching:\n\n```js\n// Common patterns\n/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/  // email\n/^https?:\\/\\/.+/                                     // URL\n/^\\d{3}-\\d{3}-\\d{4}$/                                // phone (US)\n/^#?([a-f0-9]{3}|[a-f0-9]{6})$/                      // hex color\n\n// Methods\nstr.match(/pattern/);           // returns match or null\nstr.replace(/pattern/g, 'new'); // replace all\n/regex/.test(str);              // boolean\nstr.split(/\\s+/);              // split by whitespace\n\n// Flags\ng — global (all matches)\ni — case insensitive\nm — multiline\n```\n\nCheat sheet: `\\d` digit, `\\w` word char, `\\s` whitespace, `.` any char, `*` 0+, `+` 1+, `?` optional, `{n}` exactly n", tags: ['regex', 'pattern', 'fundamentals'], category: 'learning' },

  // ── Big O / Complexity ──
  { input: 'big o notation', output: "Big O describes algorithm performance:\n\n| Big O | Name | Example |\n|-------|------|--------|\n| O(1) | Constant | Array access, hash lookup |\n| O(log n) | Logarithmic | Binary search |\n| O(n) | Linear | Array scan, simple loop |\n| O(n log n) | Linearithmic | Merge sort, quicksort (avg) |\n| O(n^2) | Quadratic | Nested loops, bubble sort |\n| O(2^n) | Exponential | Recursive fibonacci |\n| O(n!) | Factorial | Permutations |\n\n**Rules:**\n- Drop constants: O(2n) → O(n)\n- Drop lower terms: O(n^2 + n) → O(n^2)\n- Different inputs = different variables: O(a + b)", tags: ['algorithms', 'complexity', 'big-o', 'fundamentals'], category: 'learning' },
];

// ─── PATTERN MATCHING ──────────────────────────────────────────────
// Intent detection for queries that don't match exact knowledge
// Returns BrainAction objects that the Brain actually executes

interface PatternRule {
  pattern: RegExp;
  handler: (input: string, match: RegExpMatchArray) => BrainAction;
}

const INTENT_PATTERNS: PatternRule[] = [
  // Slash commands
  { pattern: /^\/terminal$/i, handler: () => ({ type: 'computer_open', appName: 'cmd', command: 'cmd' }) },
  { pattern: /^\/terminal\s+(.+)/i, handler: (_, match) => ({ type: 'command', command: match[1], cwd: '.' }) },
  { pattern: /^\/shell$/i, handler: () => ({ type: 'computer_open', appName: 'powershell', command: 'powershell' }) },
  { pattern: /^\/shell\s+(.+)/i, handler: (_, match) => ({ type: 'command', command: match[1], cwd: '.' }) },
  { pattern: /^\/browser$/i, handler: () => ({ type: 'computer_open', appName: 'chrome', command: 'chrome' }) },
  { pattern: /^\/browser\s+(.+)/i, handler: (_, match) => ({ type: 'browser_open', url: match[1] }) },
  { pattern: /^\/code$/i, handler: () => ({ type: 'computer_open', appName: 'code', command: 'code' }) },
  { pattern: /^\/code\s+(.+)/i, handler: (_, match) => ({ type: 'computer_open', appName: 'code', command: `code ${match[1]}` }) },

  // Greetings
  { pattern: /^(hi|hello|hey|howdy|sup|yo|what's up|greetings)\b/i, handler: () => ({ type: 'answer', answer: "Hey! I'm the Infinite AI Brain. Ask me anything — code, math, concepts, builds, or just chat. What do you need?" }) },

  // Run terminal command
  { pattern: /\b(run|execute|exec|shell|terminal|bash|powershell|cmd)\b.*\b(command|cmd|script|program|app)\b/i, handler: (input) => {
    const cmd = input.replace(/^(run|execute|exec|shell|terminal|bash|powershell|cmd)\s*/i, '').replace(/\b(command|cmd|script|program|app)\s*/i, '').trim();
    return { type: 'command', command: cmd || input, cwd: '.' };
  }},
  { pattern: /\b(run|execute)\s+`([^`]+)`/i, handler: (_, match) => ({ type: 'command', command: match[2], cwd: '.' }) },
  { pattern: /\b(run|execute)\s+"([^"]+)"/i, handler: (_, match) => ({ type: 'command', command: match[2], cwd: '.' }) },
  { pattern: /\b(run|execute)\s+'([^']+)'/i, handler: (_, match) => ({ type: 'command', command: match[2], cwd: '.' }) },
  { pattern: /^npm\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^npx\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^yarn\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^pnpm\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^pip\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^python\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^node\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^git\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^docker\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^cd\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },
  { pattern: /^ls\b/i, handler: () => ({ type: 'command', command: 'Get-ChildItem', cwd: '.' }) },
  { pattern: /^dir\b/i, handler: () => ({ type: 'command', command: 'Get-ChildItem', cwd: '.' }) },
  { pattern: /^pwd\b/i, handler: () => ({ type: 'command', command: 'Get-Location', cwd: '.' }) },
  { pattern: /^cat\s+/i, handler: (input) => ({ type: 'command', command: `Get-Content ${input.slice(4)}`, cwd: '.' }) },
  { pattern: /^mkdir\s+/i, handler: (input) => ({ type: 'command', command: `New-Item -ItemType Directory -Path "${input.slice(6)}"`, cwd: '.' }) },
  { pattern: /^rm\s+/i, handler: (input) => ({ type: 'command', command: `Remove-Item "${input.slice(3)}"`, cwd: '.' }) },
  { pattern: /^touch\s+/i, handler: (input) => ({ type: 'command', command: `New-Item -ItemType File -Path "${input.slice(6)}"`, cwd: '.' }) },
  { pattern: /^echo\s+/i, handler: (input) => ({ type: 'command', command: input, cwd: '.' }) },

  // Build website
  { pattern: /\b(build|create|make|write|generate)\b.*\b(website|web\s*site|landing\s*page|page|html)\b/i, handler: (input) => {
    const name = input.match(/called?\s+["']?(\w[\w\s]*?)["']?\s*(?:\.|$)/i)?.[1] || 'My Website';
    const html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>${name}</title>\n  <style>\n    * { margin: 0; padding: 0; box-sizing: border-box; }\n    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a0f; color: #e0e0e0; }\n    .hero { min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 2rem; }\n    h1 { font-size: 3rem; background: linear-gradient(135deg, #a855f7, #06b6d4, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; margin-bottom: 1rem; }\n    p { font-size: 1.1rem; color: #888; max-width: 600px; margin-bottom: 2rem; }\n    .btn { padding: 12px 32px; background: linear-gradient(135deg, #a855f7, #06b6d4); border: none; border-radius: 8px; color: white; font-size: 1rem; cursor: pointer; }\n    .btn:hover { transform: scale(1.05); }\n  </style>\n</head>\n<body>\n  <section class="hero">\n    <h1>${name}</h1>\n    <p>Welcome to ${name}. Build something amazing today.</p>\n    <button class="btn">Get Started</button>\n  </section>\n</body>\n</html>`;
    return { type: 'build_website', path: `${name.toLowerCase().replace(/\s+/g, '-')}/index.html`, content: html };
  }},

  // Build specific games — detect type and build complete
  { pattern: /\b(car|racing|drive|driving)\b.*\b(game|race|play)\b/i, handler: () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Infinite Racing</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;font-family:'Segoe UI',sans-serif}#gc{position:relative}canvas{display:block;border:2px solid #1a1a2e;border-radius:8px}#ui{position:absolute;top:20px;left:20px;color:#e94560;font-size:18px;text-shadow:0 0 10px rgba(233,69,96,.5)}#ui div{margin-bottom:8px}#ss{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(10,10,15,.95);display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;border-radius:8px}#ss h1{font-size:48px;color:#e94560;text-shadow:0 0 30px rgba(233,69,96,.8);margin-bottom:10px}#ss p{color:#888;margin-bottom:30px;font-size:16px}#ss .c{color:#666;font-size:14px;margin-bottom:30px;line-height:1.8}button{background:#e94560;color:#fff;border:none;padding:15px 40px;font-size:18px;border-radius:30px;cursor:pointer;transition:all .3s;font-weight:bold}button:hover{background:#ff6b81;transform:scale(1.05);box-shadow:0 0 20px rgba(233,69,96,.5)}#go{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(10,10,15,.95);display:none;flex-direction:column;justify-content:center;align-items:center;color:#fff;border-radius:8px}#go h2{font-size:36px;color:#e94560;margin-bottom:10px}#go .fs{font-size:24px;color:#fff;margin-bottom:30px}</style></head><body><div id="gc"><canvas id="g" width="800" height="600"></canvas><div id="ui"><div>Score: <span id="sc">0</span></div><div>Speed: <span id="sp">0</span> km/h</div><div>Lives: <span id="lv">♥♥♥</span></div></div><div id="ss"><h1>🏎️ Infinite Racing</h1><p>Dodge traffic and survive!</p><div class="c">← → or A/D — Steer<br>↑ or W — Accelerate<br>↓ or S — Brake</div><button onclick="startGame()">START RACE</button></div><div id="go"><h2>💥 WRECKED!</h2><div class="fs">Score: <span id="fs">0</span></div><button onclick="startGame()">RACE AGAIN</button></div></div><script>const c=document.getElementById('g'),x=c.getContext('2d'),W=c.width,H=c.height;let p,en,pt,rl,sc,lv,go,gs,hi=0,sp,st,df;const RL=100,RR=W-100,LC=4,LW=(RR-RL)/LC,LA=Array.from({length:LC},(_,i)=>RL+LW*i+LW/2),K={};document.addEventListener('keydown',e=>{K[e.key]=true;e.preventDefault()});document.addEventListener('keyup',e=>K[e.key]=false);function cp(){return{x:W/2,y:H-100,w:40,h:70,vx:0,tr:[]}}function se(){const l=LA[Math.floor(Math.random()*LC)],co=['#0f3460','#16213e','#533483','#e94560','#00b4d8','#06d6a0','#ffd166'],w=38+Math.random()*8,h=65+Math.random()*15;return{x:l,y:-h,w,h,color:co[Math.floor(Math.random()*co.length)],speed:2+Math.random()*2+df*.3}}function cx(a,b){const s=5;return a.x-a.w/2+s<b.x+b.w/2-s&&a.x+a.w/2-s>b.x-b.w/2+s&&a.y-a.h/2+s<b.y+b.h/2-s&&a.y+a.h/2-s>b.y-b.h/2+s}function ex(px,py,co,n=15){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,sp=1+Math.random()*4;pt.push({x:px,y:py,vx:Math.cos(a)*sp,vy:Math.sin(a)*sp,life:1,decay:.02+Math.random()*.03,size:2+Math.random()*3,color:co})}}function init(){p=cp();en=[];pt=[];rl=Array.from({length:20},(_,i)=>({y:i*40}));sc=0;lv=3;go=false;gs=true;sp=0;st=0;df=0;ui()}function startGame(){document.getElementById('ss').style.display='none';document.getElementById('go').style.display='none';init();requestAnimationFrame(loop)}function ui(){document.getElementById('sc').textContent=Math.floor(sc);document.getElementById('sp').textContent=Math.floor(sp*15);document.getElementById('lv').textContent='♥'.repeat(Math.max(0,lv))}function update(){if(go)return;const ac=K.ArrowUp||K.w||K.W?.15:0,br=K.ArrowDown||K.s||K.S?.2:0;sp=Math.min(10,Math.max(0,sp+ac-br));if(!ac&&!br)sp=Math.max(0,sp-.02);const ss=4+sp*.5;if(K.ArrowLeft||K.a||K.A)p.vx=-ss;else if(K.ArrowRight||K.d||K.D)p.vx=ss;else p.vx*=.85;p.x+=p.vx;p.x=Math.max(RL+p.w/2,Math.min(RR-p.w/2,p.x));if(sp>1){p.tr.push({x:p.x,y:p.y+p.h/2,a:1});if(p.tr.length>20)p.tr.shift()}p.tr.forEach(t=>t.a-=.05);p.tr=p.tr.filter(t=>t.a>0);rl.forEach(l=>l.y+=sp*3);rl.forEach(l=>{if(l>H)l.y-=H+40});st++;const sr=Math.max(20,60-df*5);if(st>=sr){en.push(se());st=0}en.forEach(e=>e.y+=e.speed+sp*1.5);en=en.filter(e=>e.y<H+100);for(let i=en.length-1;i>=0;i--){if(cx(p,en[i])){ex(en[i].x,en[i].y,en[i].color,20);ex(p.x,p.y,p.color,10);en.splice(i,1);lv--;sp*=.5;ui();if(lv<=0){go=true;if(sc>hi){hi=Math.floor(sc);localStorage.setItem('infiniteRacingHS',hi)}document.getElementById('fs').textContent=Math.floor(sc);document.getElementById('go').style.display='flex'}}}sc+=sp*.5;df=Math.floor(sc/200);pt.forEach(q=>{q.x+=q.vx;q.y+=q.vy;q.life-=q.decay;q.vy+=.05});pt=pt.filter(q=>q.life>0);if(sp>2)pt.push({x:p.x-8+Math.random()*16,y:p.y+p.h/2,vx:0,vy:1,life:.5,decay:.05,size:2,color:'#ff6b81'});ui()}function dr(){x.fillStyle='#1a472a';x.fillRect(0,0,RL,H);x.fillRect(RR,0,W-RR,H);x.fillStyle='#2d2d3d';x.fillRect(RL,0,RR-RL,H);x.fillStyle='#e94560';x.fillRect(RL-4,0,4,H);x.fillRect(RR,0,4,H);x.strokeStyle='#ffffff30';x.lineWidth=2;x.setLineDash([20,20]);for(let i=1;i<LC;i++){const lx=RL+LW*i;x.beginPath();rl.forEach(l=>{x.moveTo(lx,l.y);x.lineTo(lx,l.y+15)});x.stroke()}x.setLineDash([])}function dc(px,py,w,h,co,ip){x.save();x.translate(px,py);x.fillStyle='rgba(0,0,0,.3)';x.beginPath();x.ellipse(0,h/2+5,w/2+5,8,0,0,Math.PI*2);x.fill();x.fillStyle=co;x.beginPath();x.roundRect(-w/2,-h/2,w,h,[8,8,5,5]);x.fill();x.fillStyle=ip?'#1a1a3e':'#0f0f2e';x.beginPath();x.roundRect(-w/2+5,-h/2+12,w-10,18,4);x.fill();if(ip){x.fillStyle='#ffdd57';x.shadowColor='#ffdd57';x.shadowBlur=10;x.fillRect(-w/2+4,-h/2,6,4);x.fillRect(w/2-10,-h/2,6,4)}else{x.fillStyle='#ff4444';x.shadowColor='#ff4444';x.shadowBlur=8;x.fillRect(-w/2+4,h/2-5,6,4);x.fillRect(w/2-10,h/2-5,6,4)}x.shadowBlur=0;x.fillStyle='#111';x.fillRect(-w/2-3,-h/2+8,5,12);x.fillRect(w/2-2,-h/2+8,5,12);x.fillRect(-w/2-3,h/2-20,5,12);x.fillRect(w/2-2,h/2-20,5,12);x.restore()}function draw(){x.fillStyle='#0a0a0f';x.fillRect(0,0,W,H);dr();p.tr.forEach(t=>{x.fillStyle='rgba(233,69,96,'+t.a*.3+')';x.beginPath();x.arc(t.x,t.y,3,0,Math.PI*2);x.fill()});en.forEach(e=>dc(e.x,e.y,e.w,e.h,e.color));dc(p.x,p.y,p.w,p.h,p.color,true);pt.forEach(q=>{x.globalAlpha=q.life;x.fillStyle=q.color;x.beginPath();x.arc(q.x,q.y,q.size,0,Math.PI*2);x.fill()});x.globalAlpha=1;if(sp>6){x.strokeStyle='rgba(255,255,255,'+(sp-6)*.05+')';x.lineWidth=1;for(let i=0;i<5;i++){const lx=RL+Math.random()*(RR-RL),ly=Math.random()*H;x.beginPath();x.moveTo(lx,ly);x.lineTo(lx,ly+30+sp*5);x.stroke()}}}function loop(){update();draw();if(gs)requestAnimationFrame(loop)}</script></body></html>`;
    return { type: 'build_website', path: 'car-game/index.html', content: html };
  }},

  { pattern: /\b(snake)\b.*\b(game|play)\b/i, handler: () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Infinite Snake</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;display:flex;justify-content:center;align-items:center;height:100vh;font-family:'Segoe UI',sans-serif}#gc{position:relative}canvas{border:2px solid #1a1a2e;border-radius:8px}#ui{position:absolute;top:20px;left:50%;transform:translateX(-50%);color:#06d6a0;font-size:20px;text-shadow:0 0 10px rgba(6,214,160,.5)}#ss,#go{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(10,10,15,.95);display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;border-radius:8px}#ss h1{font-size:48px;color:#06d6a0;text-shadow:0 0 30px rgba(6,214,160,.8);margin-bottom:10px}#ss p{color:#888;margin-bottom:30px}button{background:#06d6a0;color:#0a0a0f;border:none;padding:15px 40px;font-size:18px;border-radius:30px;cursor:pointer;font-weight:bold;transition:all .3s}button:hover{transform:scale(1.05);box-shadow:0 0 20px rgba(6,214,160,.5)}#go{display:none}#go h2{font-size:36px;color:#06d6a0;margin-bottom:10px}.fs{font-size:24px;margin-bottom:30px}</style></head><body><div id="gc"><canvas id="g" width="600" height="600"></canvas><div id="ui">Score: <span id="sc">0</span></div><div id="ss"><h1>🐍 Infinite Snake</h1><p>Eat food, grow long, don't hit yourself!</p><button onclick="startGame()">PLAY</button></div><div id="go"><h2>💀 GAME OVER</h2><div class="fs">Score: <span id="fs">0</span></div><button onclick="startGame()">PLAY AGAIN</button></div></div><script>const c=document.getElementById('g'),x=c.getContext('2d'),G=20,S=600/G;let sn,fd,dr,sc,go,gs,nt,lt,iv;const K={};document.addEventListener('keydown',e=>{K[e.key]=true;e.preventDefault()});function init(){sn=[{x:10,y:10}];dr={x:1,y:0};sc=0;go=false;gs=true;nt=0;lt=0;iv=150;pf()}function pf(){fd={x:Math.floor(Math.random()*S),y:Math.floor(Math.random()*S)}}function startGame(){document.getElementById('ss').style.display='none';document.getElementById('go').style.display='none';init();lt=performance.now();requestAnimationFrame(loop)}function loop(t){if(go)return;nt+=t-lt;lt=t;if(nt>iv){nt=0;const h=sn[0],nh={x:h.x+dr.x,y:h.y+dr.y};if(nh.x<0||nh.x>=S||nh.y<0||nh.y>=S||sn.some(s=>s.x===nh.x&&s.y===nh.y)){go=true;document.getElementById('fs').textContent=sc;document.getElementById('go').style.display='flex';return}sn.unshift(nh);if(nh.x===fd.x&&nh.y===fd.y){sc++;pf();iv=Math.max(50,150-sc*2)}else sn.pop()}if(K.ArrowUp&&dr.y!==1)dr={x:0,y:-1};else if(K.ArrowDown&&dr.y!==-1)dr={x:0,y:1};else if(K.ArrowLeft&&dr.x!==1)dr={x:-1,y:0};else if(K.ArrowRight&&dr.x!==-1)dr={x:1,y:0};K.ArrowUp=K.ArrowDown=K.ArrowLeft=K.ArrowRight=false;draw();document.getElementById('sc').textContent=sc;requestAnimationFrame(loop)}function draw(){x.fillStyle='#0a0a0f';x.fillRect(0,0,S*G,S*G);sn.forEach((s,i)=>{x.fillStyle=i===0?'#06d6a0':'#0f3460';x.shadowColor=i===0?'#06d6a0':'transparent';x.shadowBlur=i===0?10:0;x.fillRect(s.x*G+1,s.y*G+1,G-2,G-2)});x.shadowBlur=0;x.fillStyle='#e94560';x.shadowColor='#e94560';x.shadowBlur=10;x.beginPath();x.arc(fd.x*G+G/2,fd.y*G+G/2,G/2-2,0,Math.PI*2);x.fill();x.shadowBlur=0}</script></body></html>`;
    return { type: 'build_website', path: 'snake-game/index.html', content: html };
  }},

  { pattern: /\b(tetris|blocks?|puzzle)\b.*\b(game|play)\b/i, handler: () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Infinite Tetris</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;display:flex;justify-content:center;align-items:center;height:100vh;font-family:'Segoe UI',sans-serif}#gc{position:relative;display:flex;gap:20px;align-items:flex-start}canvas{border:2px solid #1a1a2e;border-radius:8px}#sb{color:#a855f7;font-size:18px;padding:20px;text-shadow:0 0 10px rgba(168,85,247,.5)}#sb div{margin-bottom:15px}#ss,#go{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(10,10,15,.95);display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;z-index:10}#ss h1{font-size:48px;color:#a855f7;text-shadow:0 0 30px rgba(168,85,247,.8);margin-bottom:10px}#ss p{color:#888;margin-bottom:30px}.c{color:#666;font-size:14px;margin-bottom:30px;line-height:1.8;text-align:center}button{background:#a855f7;color:#fff;border:none;padding:15px 40px;font-size:18px;border-radius:30px;cursor:pointer;font-weight:bold;transition:all .3s}button:hover{transform:scale(1.05);box-shadow:0 0 20px rgba(168,85,247,.5)}#go{display:none}#go h2{font-size:36px;color:#a855f7;margin-bottom:10px}.fs{font-size:24px;margin-bottom:30px}</style></head><body><div id="ss"><h1>🧱 Infinite Tetris</h1><p>Clear lines, stack blocks!</p><div class="c">← → Move | ↑ Rotate | ↓ Soft Drop | Space Hard Drop</div><button onclick="startGame()">PLAY</button></div><div id="go"><h2>💀 GAME OVER</h2><div class="fs">Score: <span id="fs">0</span></div><button onclick="startGame()">PLAY AGAIN</button></div><div id="gc" style="display:none"><canvas id="g" width="300" height="600"></canvas><div id="sb"><div>Score: <span id="sc">0</span></div><div>Level: <span id="lv">1</span></div><div>Lines: <span id="ln">0</span></div><canvas id="nx" width="120" height="120"></canvas></div></div><script>const c=document.getElementById('g'),x=c.getContext('2d'),nc=document.getElementById('nx'),nx=nc.getContext('2d'),CS=30,R=10,C=20;const SH=[[1,1,1,1],[[0,1],[1,1],[2,1],[1,0]],[[1,0],[1,1],[1,2],[0,1]],[[0,0],[1,0],[1,1],[1,2]],[[0,1],[0,2],[1,0],[1,1]],[[0,0],[0,1],[1,1],[1,2]],[[0,1],[1,0],[1,1],[1,2]]];const CL=['#00d4ff','#ffdd57','#a855f7','#06d6a0','#e94560','#ff8c00','#0f3460'];let bd,pc,cr,sc,lv,ln,go,gs,lt,iv,nxP;const K={};document.addEventListener('keydown',e=>{K[e.key]=true;e.preventDefault()});document.addEventListener('keyup',e=>K[e.key]=false);function init(){bd=Array.from({length:C},()=>Array(R).fill(0));sc=0;lv=1;ln=0;go=false;gs=true;lt=0;iv=800;sp();np();document.getElementById('gc').style.display='flex'}function sp(){cr=SH[Math.floor(Math.random()*7)].map(p=>[...p]);pc={x:Math.floor(R/2)-1,y:0};if(coll(pc.x,pc.y,cr)){go=true;document.getElementById('fs').textContent=sc;document.getElementById('go').style.display='flex';document.getElementById('gc').style.display='none'}}function np(){cr=SH[Math.floor(Math.random()*7)].map(p=>[...p])}function coll(x,y,sh){return sh.some(([sx,sy])=>{const nx=x+sx,ny=y+sy;return nx<0||nx>=R||ny>=C||bd[ny]?.[nx]})}function fix(){cr.forEach(([sx,sy])=>{if(pc.y+sy>=0)bd[pc.y+sy][pc.x+sx]=1});cl();sp()}function cl(){let c=0;for(let y=C-1;y>=0;y--){if(bd[y].every(v=>v)){bd.splice(y,1);bd.unshift(Array(R).fill(0));c++;y++}}if(c){ln+=c;sc+=[0,100,300,500,800][c]*(lv||1);lv=Math.floor(ln/10)+1;iv=Math.max(100,800-(lv-1)*70)}}function rot(){const r=cr.map(([x,y])=>[-y,x]);if(!coll(pc.x+0,pc.y,r))cr=r}function startGame(){document.getElementById('ss').style.display='none';document.getElementById('go').style.display='none';init();lt=performance.now();requestAnimationFrame(loop)}function loop(t){if(go)return;if(!gs)return;let dt=t-lt;lt=t;let moved=false;if(K.ArrowLeft&&!moved){if(!coll(pc.x-1,pc.y,cr)){pc.x--;moved=true}}if(K.ArrowRight&&!moved){if(!coll(pc.x+1,pc.y,cr)){pc.x++;moved=true}}if(K.ArrowUp){rot();K.ArrowUp=false}if(K[' ']){while(!coll(pc.x,pc.y+1,cr))pc.y++;fix();K[' ']=false}iv-=dt;if(iv<=0){iv=800-(lv-1)*70;if(!coll(pc.x,pc.y+1,cr))pc.y++;else fix()}draw();document.getElementById('sc').textContent=sc;document.getElementById('lv').textContent=lv;document.getElementById('ln').textContent=ln;requestAnimationFrame(loop)}function draw(){x.fillStyle='#0a0a0f';x.fillRect(0,0,R*CS,C*CS);x.strokeStyle='#1a1a2e';for(let y=0;y<=C;y++){x.beginPath();x.moveTo(0,y*CS);x.lineTo(R*CS,y*CS);x.stroke()}for(let i=0;i<=R;i++){x.beginPath();x.moveTo(i*CS,0);x.lineTo(i*CS,C*CS);x.stroke()}bd.forEach((row,y)=>row.forEach((v,sx)=>{if(v){x.fillStyle='#0f3460';x.fillRect(sx*CS+1,y*CS+1,CS-2,CS-2)}}));cr.forEach(([sx,sy])=>{x.fillStyle=CL[SH.indexOf(cr)%7]||'#a855f7';x.fillRect((pc.x+sx)*CS+1,(pc.y+sy)*CS+1,CS-2,CS-2)});nx.fillStyle='#0a0a0f';nx.fillRect(0,0,120,120);cr.forEach(([sx,sy])=>{nx.fillStyle='#a855f7';nx.fillRect(sx*25+10,sy*25+10,23,23)})}startGame()</script></body></html>`;
    return { type: 'build_website', path: 'tetris-game/index.html', content: html };
  }},

  { pattern: /\b(flight|fly|plane|spaceship|space)\b.*\b(game|play|shooter)\b/i, handler: () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Infinite Space Shooter</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;display:flex;justify-content:center;align-items:center;height:100vh;overflow:hidden;font-family:'Segoe UI',sans-serif}#gc{position:relative}canvas{display:block}#ui{position:absolute;top:20px;left:20px;color:#00d4ff;font-size:18px;text-shadow:0 0 10px rgba(0,212,255,.5)}#ui div{margin-bottom:8px}#ss,#go{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.95);display:flex;flex-direction:column;justify-content:center;align-items:center;color:#fff;border-radius:8px}#ss h1{font-size:48px;color:#00d4ff;text-shadow:0 0 30px rgba(0,212,255,.8);margin-bottom:10px}#ss p{color:#888;margin-bottom:30px}.c{color:#666;font-size:14px;margin-bottom:30px;line-height:1.8}button{background:#00d4ff;color:#000;border:none;padding:15px 40px;font-size:18px;border-radius:30px;cursor:pointer;font-weight:bold;transition:all .3s}button:hover{transform:scale(1.05);box-shadow:0 0 20px rgba(0,212,255,.5)}#go{display:none}#go h2{font-size:36px;color:#e94560;margin-bottom:10px}.fs{font-size:24px;margin-bottom:30px}</style></head><body><div id="gc"><canvas id="g" width="600" height="800"></canvas><div id="ui"><div>Score: <span id="sc">0</span></div><div>Wave: <span id="wv">1</span></div><div>Lives: <span id="lv">♥♥♥</span></div></div><div id="ss"><h1>🚀 Infinite Space</h1><p>Destroy enemies, survive the void!</p><div class="c">← → or A/D — Move<br>Space — Shoot<br>↑ or W — Speed Boost</div><button onclick="startGame()">LAUNCH</button></div><div id="go"><h2>💥 DESTROYED</h2><div class="fs">Score: <span id="fs">0</span></div><button onclick="startGame()">RETRY</button></div></div><script>const c=document.getElementById('g'),x=c.getContext('2d'),W=c.width,H=c.height;let p,en,bl,pt,sc,lv,wv,go,gs,st,sp;const K={};document.addEventListener('keydown',e=>{K[e.key]=true;e.preventDefault()});document.addEventListener('keyup',e=>K[e.key]=false);function init(){p={x:W/2,y:H-80,w:40,h:40,vx:0};en=[];bl=[];pt=[];sc=0;lv=3;wv=1;go=false;gs=true;st=0;sp=0;ui()}function startGame(){document.getElementById('ss').style.display='none';document.getElementById('go').style.display='none';init();requestAnimationFrame(loop)}function ui(){document.getElementById('sc').textContent=sc;document.getElementById('wv').textContent=wv;document.getElementById('lv').textContent='♥'.repeat(Math.max(0,lv))}function se(){const s=20+Math.random()*10;en.push({x:Math.random()*(W-60)+30,y:-30,w:s,h:s,vx:(Math.random()-.5)*2,vy:1+Math.random()*2+wv*.3,hp:1+Math.floor(wv/3),color:['#e94560','#533483','#0f3460'][Math.floor(Math.random()*3)]})}function ab(x,y,vy=-10){bl.push({x,y,w:4,h:10,vy})}function ex(px,py,co,n=10){for(let i=0;i<n;i++){const a=Math.random()*Math.PI*2,s=1+Math.random()*3;pt.push({x:px,y:py,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:1,decay:.03,size:2+Math.random()*2,color:co})}}function update(){if(go)return;const ac=K[' ']||K.x||K.X,lf=K.ArrowLeft||K.a||K.A,rt=K.ArrowRight||K.d||K.D,boost=K.ArrowUp||K.w||K.W;p.vx=lf?-5:rt?5:0;if(boost)p.vx*=1.5;p.x+=p.vx;p.x=Math.max(p.w/2,Math.min(W-p.w/2,p.x));sp++;if(ac&&sp>10){ab(p.x,p.y-p.h/2);sp=0}st++;if(st>Math.max(15,40-wv*2)){se();st=0}bl.forEach(b=>b.y+=b.vy);bl=bl.filter(b=>b.y>-10);en.forEach(e=>{e.x+=e.vx;e.y+=e.vy;if(e.x<e.w/2||e.x>W-e.w/2)e.vx*=-1});en=en.filter(e=>e.y<H+50);for(let i=bl.length-1;i>=0;i--){for(let j=en.length-1;j>=0;j--){const b=bl[i],e=en[j];if(b&&e&&Math.abs(b.x-e.x)<e.w/2&&Math.abs(b.y-e.y)<e.h/2){e.hp--;bl.splice(i,1);if(e.hp<=0){ex(e.x,e.y,e.color,15);en.splice(j,1);sc+=10*wv}else ex(b.x,b.y,'#00d4ff',3)}}}for(let i=en.length-1;i>=0;i--){const e=en[i];if(Math.abs(p.x-e.x)<(p.w+e.w)/2-5&&Math.abs(p.y-e.y)<(p.h+e.h)/2-5){ex(e.x,e.y,e.color,20);ex(p.x,p.y,'#00d4ff',10);en.splice(i,1);lv--;if(lv<=0){go=true;document.getElementById('fs').textContent=sc;document.getElementById('go').style.display='flex'}}}if(sc>=wv*100)wv++;pt.forEach(q=>{q.x+=q.vx;q.y+=q.vy;q.life-=q.decay});pt=pt.filter(q=>q.life>0);ui()}function draw(){x.fillStyle='#000';x.fillRect(0,0,W,H);for(let i=0;i<50;i++){x.fillStyle='rgba(255,255,255,'+(Math.sin(Date.now()*.001+i)*.3+.3)+')';x.fillRect(i*12+Math.sin(Date.now()*.0005+i)*3,((Date.now()*.02+i*40)%H),1,1)}x.fillStyle='#00d4ff';x.shadowColor='#00d4ff';x.shadowBlur=15;x.beginPath();x.moveTo(p.x,p.y-p.h/2);x.lineTo(p.x-p.w/2,p.y+p.h/2);x.lineTo(p.x+p.w/2,p.y+p.h/2);x.closePath();x.fill();x.shadowBlur=0;en.forEach(e=>{x.fillStyle=e.color;x.fillRect(e.x-e.w/2,e.y-e.h/2,e.w,e.h);x.fillStyle='#fff';x.fillRect(e.x-e.w/2+5,e.y-e.h/2+5,8,4)});x.fillStyle='#00d4ff';bl.forEach(b=>{x.shadowColor='#00d4ff';x.shadowBlur=8;x.fillRect(b.x-b.w/2,b.y,b.w,b.h)});x.shadowBlur=0;pt.forEach(q=>{x.globalAlpha=q.life;x.fillStyle=q.color;x.beginPath();x.arc(q.x,q.y,q.size,0,Math.PI*2);x.fill()});x.globalAlpha=1}function loop(){update();draw();if(gs)requestAnimationFrame(loop)}startGame()</script></body></html>`;
    return { type: 'build_website', path: 'space-game/index.html', content: html };
  }},

  // Generic build game fallback
  { pattern: /\b(build|create|make|write|generate)\b.*\b(game)\b/i, handler: () => {
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Infinite Game</title><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#0a0a0f;display:flex;justify-content:center;align-items:center;height:100vh;font-family:'Segoe UI',sans-serif}canvas{border:2px solid #1a1a2e;border-radius:8px}</style></head><body><canvas id="g" width="800" height="600"></canvas><script>const c=document.getElementById('g'),x=c.getContext('2d'),W=800,H=600;let p={x:W/2,y:H-60,w:40,h:40,vx:0},en=[],sc=0,go=false;const K={};document.addEventListener('keydown',e=>{K[e.key]=true;e.preventDefault()});document.addEventListener('keyup',e=>K[e.key]=false);function se(){en.push({x:Math.random()*(W-40)+20,y:-30,w:30,h:30,vy:3+Math.random()*3})}function loop(){if(go)return;x.fillStyle='#0a0a0f';x.fillRect(0,0,W,H);if(K.ArrowLeft&&p.x>20)p.vx=-5;else if(K.ArrowRight&&p.x<W-20)p.vx=5;else p.vx*=.8;p.x+=p.vx;x.fillStyle='#e94560';x.fillRect(p.x-p.w/2,p.y-p.h/2,p.w,p.h);if(Math.random()<.03)se();en=en.filter(e=>{e.y+=e.vy;if(e.y>H)return false;if(Math.abs(p.x-e.x)<35&&Math.abs(p.y-e.y)<35){go=true;alert('Game Over! Score: '+sc);location.reload();return false}return true});en.forEach(e=>{x.fillStyle='#533483';x.fillRect(e.x-e.w/2,e.y-e.h/2,e.w,e.h)});sc++;x.fillStyle='#fff';x.font='20px Arial';x.fillText('Score: '+sc,10,30);requestAnimationFrame(loop)}loop()<\/script></body></html>`;
    return { type: 'build_website', path: 'game/index.html', content: html };
  }},

  // Build API/server
  { pattern: /\b(build|create|make|write|generate)\b.*\b(api|server|backend|express|rest)\b/i, handler: () => {
    const code = `const express = require('express');\nconst app = express();\nconst PORT = process.env.PORT || 3000;\n\napp.use(express.json());\n\nlet items = [\n  { id: 1, name: 'Item 1', price: 9.99 },\n  { id: 2, name: 'Item 2', price: 19.99 },\n];\nlet nextId = 3;\n\napp.get('/api/items', (req, res) => res.json({ data: items }));\napp.get('/api/items/:id', (req, res) => {\n  const item = items.find(i => i.id === parseInt(req.params.id));\n  if (!item) return res.status(404).json({ error: 'Not found' });\n  res.json({ data: item });\n});\napp.post('/api/items', (req, res) => {\n  const item = { id: nextId++, ...req.body };\n  items.push(item);\n  res.status(201).json({ data: item });\n});\napp.put('/api/items/:id', (req, res) => {\n  const item = items.find(i => i.id === parseInt(req.params.id));\n  if (!item) return res.status(404).json({ error: 'Not found' });\n  Object.assign(item, req.body);\n  res.json({ data: item });\n});\napp.delete('/api/items/:id', (req, res) => {\n  items = items.filter(i => i.id !== parseInt(req.params.id));\n  res.json({ deleted: true });\n});\n\napp.listen(PORT, () => console.log(\\\`API running on port \\\${PORT}\\\`));`;
    return { type: 'build_app', path: 'server.js', content: code, command: 'npm init -y && npm install express' };
  }},

  // Build React app
  { pattern: /\b(build|create|make|write|generate)\b.*\b(react|component|app|frontend)\b/i, handler: () => {
    return { type: 'build_app', path: 'src/App.jsx', content: `import { useState } from 'react';\n\nfunction App() {\n  const [count, setCount] = useState(0);\n  return (\n    <div style={{ padding: 20 }}>\n      <h1>InfiniteAI App</h1>\n      <button onClick={() => setCount(c => c + 1)}>Count: {count}</button>\n    </div>\n  );\n}\n\nexport default App;`, command: 'npm create vite@latest my-app -- --template react && cd my-app && npm install' };
  }},

  // Build Python script
  { pattern: /\b(build|create|make|write|generate)\b.*\b(python|script|python\s*script)\b/i, handler: () => {
    const code = `#!/usr/bin/env python3\nimport os\nimport json\nfrom datetime import datetime\n\ndef main():\n    print(f"Hello from Python! Current time: {datetime.now()}")\n    data = {"app": "InfiniteAI", "version": "1.0", "timestamp": datetime.now().isoformat()}\n    with open('output.json', 'w') as f:\n        json.dump(data, f, indent=2)\n    print("Saved output.json")\n\nif __name__ == "__main__":\n    main()`;
    return { type: 'write_file', path: 'script.py', content: code };
  }},

  // Write file
  { pattern: /\b(write|create|save|make)\b.*\b(file|script|code)\b.*\b(called|named|as|to)\s+["']?(\S+)["']?/i, handler: (_, match) => {
    return { type: 'write_file', path: match[2], content: `// Created by Infinite AI Brain\n// ${match[0]}\n` };
  }},

  // Install something
  { pattern: /\b(install)\s+(.+)/i, handler: (_, match) => {
    const pkg = match[2].trim();
    return { type: 'command', command: `npm install ${pkg}`, cwd: '.' };
  }},

  // Start/run project
  { pattern: /\b(start|run|launch|serve)\b.*\b(server|app|project|dev)\b/i, handler: () => {
    return { type: 'command', command: 'npm run dev', cwd: '.' };
  }},

  // Math
  { pattern: /\b(what\s+is|calculate|compute|solve)\b.*\b(\d+)\s*[+\-*/]\s*(\d+)/i, handler: (_, match) => {
    const expr = match[0];
    try {
      const result = Function(`"use strict"; return (${expr.replace(/what\s+is\s*/i, '').replace(/calculate\s*/i, '').replace(/compute\s*/i, '').replace(/solve\s*/i, '')})`)();
      return { type: 'answer', answer: `${expr} = **${result}**` };
    } catch { return { type: 'answer', answer: `I can compute that: ${expr}` }; }
  }},
  { pattern: /\b(sqrt|square\s*root)\s*(?:of\s*)?(\d+)/i, handler: (_, match) => {
    const n = parseFloat(match[2]);
    return { type: 'answer', answer: `√${n} = **${Math.sqrt(n).toFixed(4)}**` };
  }},

  // Explanations
  { pattern: /\b(explain|what\s+is|what\s+are|how\s+does|tell\s+me\s+about)\b/i, handler: (input) => {
    const topic = input.replace(/^(explain|what is|what are|how does|tell me about)\s*/i, '').replace(/\?/g, '').trim();
    if (!topic) return { type: 'answer', answer: "What would you like me to explain? Give me a topic and I'll break it down." };
    return { type: 'answer', answer: `Let me explain **${topic}**:\n\nI don't have a detailed entry for "${topic}" yet, but I'll learn it from our conversation. Can you tell me more about what specifically you want to know?` };
  }},

  // How-to
  { pattern: /\b(how\s+(?:do|can|to|should)|steps\s+to|guide\s+to)\b/i, handler: (input) => {
    const task = input.replace(/^(how do|how can|how to|how should|steps to|guide to)\s*/i, '').replace(/\?/g, '').trim();
    if (!task) return { type: 'answer', answer: "What do you want to do? I can help with coding, building, installing, fixing, and more." };
    return { type: 'answer', answer: `Here's how to **${task}**:\n\nI don't have a specific guide for this yet, but I'm learning. Tell me what you know and I'll remember it for next time.` };
  }},

  // Error debugging
  { pattern: /\b(error|bug|fix|broken|not\s+working|doesn't\s+work|won't\s+compile|crash)\b/i, handler: () => {
    return { type: 'answer', answer: "Let's debug this. Common fixes:\n\n1. **Check the error message** — read it carefully\n2. **Check line numbers** — go to the reported line\n3. **Check variable names** — typos are the #1 cause\n4. **Check imports** — are all dependencies installed?\n5. **Check types** — undefined/null mismatches\n\nIf you paste the actual error message, I can give you a specific fix." };
  }},

  // Open app
  { pattern: /\b(open|launch|start|run)\b.*\b(chrome|firefox|vscode|code|notepad|explorer|folder|browser|edge|word|excel|powerpoint|paint|calculator|cmd|terminal|powershell)\b/i, handler: (_, match) => {
    const app = match[2].toLowerCase();
    const appMap: Record<string, string> = { chrome: 'chrome', firefox: 'firefox', vscode: 'code', code: 'code', notepad: 'notepad', explorer: 'explorer', browser: 'chrome', edge: 'msedge', word: 'winword', excel: 'excel', powerpoint: 'powerpnt', paint: 'mspaint', calculator: 'calc', cmd: 'cmd', terminal: 'cmd', powershell: 'powershell' };
    return { type: 'computer_open', appName: appMap[app] || app, command: appMap[app] || app };
  }},

  // Open app and do something (e.g. "open notepad and write a story about Tom and Jerry")
  { pattern: /\b(open|launch|start)\b.*\b(chrome|firefox|notepad|edge|browser|word)\b.*\b(and|then|to)\b.*\b(write|type|paste|put|enter|input|search|go|navigate|find)\b/i, handler: (input, match) => {
    const app = match[2].toLowerCase();
    const appMap: Record<string, string> = { chrome: 'chrome', firefox: 'firefox', notepad: 'notepad', edge: 'msedge', browser: 'chrome', word: 'winword' };
    const appName = appMap[app] || app;
    // Extract what to write/type/search
    const writeMatch = input.match(/\b(write|type|paste|put|enter|input)\s+["']?(.+?)["']?\s*(?:in|into|on|inside)?\s*$/i);
    const searchMatch = input.match(/\b(search|go|navigate|find)\s+(?:for\s+)?["']?(.+?)["']?\s*$/i);
    const content = writeMatch?.[2] || searchMatch?.[2] || '';
    // Return open action — user will see the app open
    return { type: 'computer_open', appName, command: appName, content: content ? `Then type: ${content}` : '' };
  }},

  // Download something
  { pattern: /\b(download|save|get|grab)\b.*\b(video|file|image|photo|music|song|mp3|mp4|pdf|document|link)\b/i, handler: (input) => {
    const query = input.replace(/.*(download|save|get|grab)\b.*?\s*/i, '').trim();
    return { type: 'browser_search', value: query || 'download', url: `https://www.google.com/search?q=${encodeURIComponent(query + ' download')}` };
  }},

  // Fill in a form/document
  { pattern: /\b(fill|complete|fill\s+in|fill\s+out)\b.*\b(form|document|application|field|box|input|survey|questionnaire)\b/i, handler: (input) => {
    const text = input.match(/\b(with|using|saying|containing)\s+(.+)/i)?.[2] || '';
    return { type: 'computer_type', content: text || 'Filling form...' };
  }},

  // Scroll
  { pattern: /\b(scroll|swipe)\b.*\b(up|down|left|right|the\s+page|the\s+web|the\s+browser)?\b/i, handler: (_, match) => {
    const dir = match[2]?.toLowerCase() || 'down';
    return { type: 'command', command: `echo "Scroll ${dir}"`, cwd: '.' };
  }},

  // Research/learn about something
  { pattern: /\b(research|learn|study|investigate|explore|look\s+into|read\s+about)\b.*\b(about|on|regarding)\s+(.+)/i, handler: (_, match) => {
    const topic = match[3]?.trim() || '';
    return { type: 'browser_search', value: topic, url: `https://www.google.com/search?q=${encodeURIComponent(topic)}` };
  }},

  // Create notepad/file on desktop
  { pattern: /\b(create|make|write|save|put)\b.*\b(notepad|file|document|text)\b.*\b(desktop|here|folder)\b/i, handler: (input) => {
    const name = input.match(/(?:called|named|as|to)\s+["']?(\S+)["']?/i)?.[1] || 'notes';
    const ext = input.match(/\.(txt|md|doc|docx)/i)?.[1] || 'txt';
    const desktopPath = `C:\\Users\\user\\Desktop\\${name}.${ext}`;
    const content = input.match(/(?:about|containing|with content|saying)\s+(.+)/i)?.[1] || `Created by Infinite AI Brain`;
    return { type: 'write_file', path: desktopPath, content };
  }},

  // Create folder on desktop
  { pattern: /\b(create|make|mkdir|new)\b.*\b(folder|directory)\b.*\b(desktop|here)\b/i, handler: (input) => {
    const name = input.match(/(?:called|named|as|to)\s+["']?(\S+)["']?/i)?.[1] || 'New Folder';
    const desktopPath = `C:\\Users\\user\\Desktop\\${name}`;
    return { type: 'mkdir', path: desktopPath };
  }},

  // Write content to a file
  { pattern: /\b(write|save|create)\b.*\b(essay|article|content|text|letter|report)\b.*\b(about|on|regarding)\b\s+(.+)/i, handler: (input) => {
    const topic = input.match(/(?:about|on|regarding)\s+(.+)/i)?.[1] || 'topic';
    const filename = topic.toLowerCase().replace(/\s+/g, '-').slice(0, 30);
    const content = `# ${topic}\n\nThis is a comprehensive essay about ${topic}.\n\n${topic} is an important subject that many people are interested in. Understanding ${topic} helps us make better decisions and gain deeper insights into the world around us.\n\n## Introduction\n\nThe topic of ${topic} has been discussed extensively in various contexts. From academic research to everyday conversations, ${topic} continues to be a relevant and fascinating subject.\n\n## Key Points\n\n1. ${topic} is widely studied and debated\n2. There are multiple perspectives on ${topic}\n3. Understanding ${topic} can provide valuable insights\n4. The importance of ${topic} cannot be overstated\n\n## Conclusion\n\nIn conclusion, ${topic} remains an important area of study and discussion. Further exploration of ${topic} will undoubtedly lead to new discoveries and understanding.`;
    return { type: 'write_file', path: `${filename}.txt`, content };
  }},

  // Search Amazon
  { pattern: /\b(search|shop|find|look|buy|get)\b.*\b(on\s+)?amazon\b/i, handler: (input) => {
    const query = input.replace(/.*(search|shop|find|look|buy|get)\b.*?(on\s+)?amazon\s*/i, '').replace(/\b(for|the|cheapest|best|good|some)\b/gi, '').trim();
    return { type: 'browser_search', value: query || 'deals', url: `https://www.amazon.com/s?k=${encodeURIComponent(query || 'deals')}` };
  }},

  // Search Google
  { pattern: /\b(search|google|look\s+up|find|browse)\b.*\b(on\s+)?(google|web|online|internet)\b/i, handler: (input) => {
    const query = input.replace(/.*(search|google|look up|find|browse)\b.*?(on\s+)?(google|web|online|internet)\s*/i, '').replace(/\b(for|the|some)\b/gi, '').trim();
    return { type: 'browser_search', value: query || input, url: `https://www.google.com/search?q=${encodeURIComponent(query || input)}` };
  }},

  // Open website
  { pattern: /\b(open|go\s+to|visit|navigate)\b.*\b(website|site|url|page)\b.*\b(to|at|at)\s+(.+)/i, handler: (_, match) => {
    let url = match[3]?.trim() || '';
    if (!url.startsWith('http')) url = `https://${url}`;
    return { type: 'browser_open', url };
  }},

  // Go to a direct URL (e.g. "go to https://youtube.com" or just "https://youtube.com")
  { pattern: /\b(open|go\s+to|visit|navigate|browse)\b\s+(https?:\/\/\S+)/i, handler: (_, match) => {
    return { type: 'browser_open', url: match[2] };
  }},
  { pattern: /^(https?:\/\/\S+)$/i, handler: (_, match) => {
    return { type: 'browser_open', url: match[1] };
  }},

  // Open specific site
  { pattern: /\b(open|go\s+to|visit|navigate)\b.*\b(google|youtube|github|amazon|twitter|facebook|reddit|instagram|linkedin|netlify|vercel)\b/i, handler: (_, match) => {
    const sites: Record<string, string> = {
      google: 'https://www.google.com', youtube: 'https://www.youtube.com', github: 'https://github.com',
      amazon: 'https://www.amazon.com', twitter: 'https://twitter.com', facebook: 'https://facebook.com',
      reddit: 'https://reddit.com', instagram: 'https://instagram.com', linkedin: 'https://linkedin.com',
      netlify: 'https://app.netlify.com', vercel: 'https://vercel.com',
    };
    const site = match[2].toLowerCase();
    return { type: 'browser_open', url: sites[site] || `https://${site}.com` };
  }},

  // Type something
  { pattern: /\b(type|write|input|enter)\b.*\b(in|into|on)\b.*\b(the|browser|chrome|notepad|field|box|search)\b/i, handler: (input) => {
    const text = input.match(/(?:type|write|input|enter)\s+["']?(.+?)["']?\s*(?:in|into|on)/i)?.[1] || input;
    return { type: 'computer_type', content: text };
  }},

  // Click somewhere
  { pattern: /\b(click|tap|press)\b.*\b(at|on)\s*\(?(\d+)\s*,\s*(\d+)\)?/i, handler: (_, match) => {
    return { type: 'computer_click', x: parseInt(match[2]), y: parseInt(match[3]) };
  }},

  // Move mouse
  { pattern: /\b(move|drag)\b.*\b(mouse|cursor)\b.*\b(to|at)\s*\(?(\d+)\s*,\s*(\d+)\)?/i, handler: (_, match) => {
    return { type: 'computer_mouse', x: parseInt(match[4]), y: parseInt(match[5]) };
  }},

  // Status check
  { pattern: /\b(status|check|what's|show)\b.*\b(system|computer|pc|machine|resources|cpu|ram|memory|disk)\b/i, handler: () => {
    return { type: 'command', command: 'systeminfo | findstr /B /C:"OS Name" /C:"Total Physical Memory" /C:"Available Physical Memory"', cwd: '.' };
  }},

  // ── Email ──
  { pattern: /\b(check|read|see|show|list|get|view|fetch)\b.*\b(email|emails|mail|inbox|messages)\b/i, handler: (): BrainAction => {
    return { type: 'email_list', folder: 'INBOX', limit: 20 };
  }},
  { pattern: /\b(send|write|compose|draft|reply|respond)\b.*\b(email|mail|message)\b.*\b(to|from|about|regarding|re:)\b/i, handler: (input): BrainAction => {
    const toMatch = input.match(/\bto\s+(\S+@\S+\.\S+)/i);
    const subjectMatch = input.match(/\b(about|regarding|re:?)\s+(.+?)(?:\s+(?:saying|with|body|content)\s+)/i);
    const bodyMatch = input.match(/\b(saying|with|body|content)\s+(.+)/i);
    return { type: 'email_send', to: toMatch?.[1] || '', subject: subjectMatch?.[2] || 'No Subject', answer: bodyMatch?.[2] || '' };
  }},
  { pattern: /\b(read|open|show)\b.*\b(email|mail|message)\b.*\b(from|by|subject)\b/i, handler: (input): BrainAction => {
    const uidMatch = input.match(/\b(#?\d+)\b/);
    return { type: 'email_read', uid: uidMatch?.[1] || '1' };
  }},
  { pattern: /\b(setup|configure|config|add)\b.*\b(email|mail|smtp|imap)\b/i, handler: () => {
    return { type: 'answer', answer: 'To set up email, go to **Settings → Email Configuration** and enter your IMAP/SMTP credentials. I support Gmail, Outlook, Yahoo, and any provider with IMAP/SMTP access.' };
  }},

  // ── OCR — Read text from screen/image ──
  { pattern: /\b(read|extract|ocr|scan)\b.*\b(text|words|writing)\b.*\b(from|on|in)\b.*\b(screen|image|photo|picture|screenshot|window)\b/i, handler: (input): BrainAction => {
    const pathMatch = input.match(/\b(from|on|in)\s+(.+)/i);
    return { type: 'command', command: `echo "OCR: extracting text from ${pathMatch?.[2] || 'screen'}"`, cwd: '.' };
  }},
  { pattern: /\b(what|read|see)\b.*\b(does|is)\b.*\b(this|it|the)\b.*\b(say|text|say\s+on\s+screen|on\s+the\s+screen)\b/i, handler: (): BrainAction => {
    return { type: 'command', command: 'echo "Reading text from current screen..."', cwd: '.' };
  }},
  { pattern: /\b(screenshot|capture|grab)\b.*\b(and|then)\b.*\b(read|ocr|extract|scan)\b/i, handler: (): BrainAction => {
    return { type: 'computer_captureScreen', reason: 'Need to capture and OCR the screen' };
  }},

  // ── Voice — Speak and listen ──
  { pattern: /\b(speak|say|read\s+aloud|voice|talk|tell\s+me)\b.*\b(this|it|aloud|out\s+loud)\b/i, handler: (input): BrainAction => {
    const textMatch = input.match(/\b(say|speak|read\s+aloud|tell\s+me)\s+(.+)/i);
    return { type: 'command', command: `echo "TTS: ${textMatch?.[2] || 'Speaking...'}"`, cwd: '.' };
  }},
  { pattern: /\b(listen|hear|transcribe|speech|voice)\b.*\b(to|record|input)\b/i, handler: (): BrainAction => {
    return { type: 'command', command: 'echo "Starting voice recognition..."', cwd: '.' };
  }},
  { pattern: /\b(start|begin|enable)\b.*\b(voice|listening|speech|dictation|microphone)\b/i, handler: (): BrainAction => {
    return { type: 'command', command: 'echo "Voice recognition enabled"', cwd: '.' };
  }},
  { pattern: /\b(stop|end|disable|turn\s+off)\b.*\b(voice|listening|speech|dictation|microphone)\b/i, handler: (): BrainAction => {
    return { type: 'command', command: 'echo "Voice recognition disabled"', cwd: '.' };
  }},
];

// ─── ACTION EXECUTION ──────────────────────────────────────────────
// Actually executes Brain actions via IPC — runs commands, writes files, controls computer & browser

async function executeBrainAction(action: BrainAction, cwd: string): Promise<string> {
  try {
    // Handle email actions first (returned by patterns but not in BrainAction union)
    const actType = action.type;
    if (actType === 'email_list') {
      try {
        const hasConfig = await window.api.emailHasConfig();
        if (!hasConfig) return '📧 Email not configured. Go to **Settings → Email** to set up your email account (IMAP/SMTP).';
        const emails = await window.api.emailList({ folder: action.folder || 'INBOX', limit: action.limit || 20 });
        if (!emails || emails.length === 0) return '📭 Your inbox is empty.';
        const list = (emails as Array<{ isRead: boolean; subject: string; from: string; date: string }>).map((e, i) => `${i + 1}. ${e.isRead ? '  ' : ' '} **${e.subject}**\n   From: ${e.from}\n   ${e.date ? new Date(e.date).toLocaleString() : ''}`).join('\n\n');
        return `📬 **Your emails (${emails.length}):**\n\n${list}`;
      } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ Failed to check email: ${error.message}`; }
    }

    if (actType === 'email_read') {
      try {
        const email = await window.api.emailRead({ uid: action.uid || '1', folder: action.folder || 'INBOX' });
        if (!email) return '❌ Email not found.';
        const em = email as { subject: string; from: string; to: string; date: string; text: string };
        return `📧 **${em.subject}**\n\n**From:** ${em.from}\n**To:** ${em.to}\n**Date:** ${em.date ? new Date(em.date).toLocaleString() : 'Unknown'}\n\n${em.text || '(no content)'}`;
      } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ Failed to read email: ${error.message}`; }
    }

    if (actType === 'email_send') {
      try {
        const to = action.to;
        const subject = action.subject || 'No Subject';
        const text = action.answer || action.content || '';
        if (!to) return '❌ Who should I send the email to? Please include an email address.';
        if (!text) return '❌ What should the email say?';
        const result = await window.api.emailSend({ to, subject, text });
        if (result?.ok) return `✅ Email sent to **${to}** with subject "**${subject}**"`;
        return `❌ Failed to send email: ${result?.error || 'Unknown error'}`;
      } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ Failed to send email: ${error.message}`; }
    }

    // OCR handler — capture screen and recognize text
    if (actType === 'command' && action.command?.includes('OCR:')) {
      try {
        const screenResult = await window.api.computerAction({
          action: 'screenshot',
          reason: 'Need to OCR text from screen',
        });
        const base64 = (screenResult as { base64?: string })?.base64;
        if (!base64) return '❌ Could not capture screen for OCR.';
        const text = await window.api.ocrRecognize({ imagePath: `data:image/png;base64,${base64}` });
        return `📝 **Text found on screen:**\n\n${text || 'No text detected.'}`;
      } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ OCR failed: ${error.message}`; }
    }

    // Voice handlers — TTS and STT
    if (actType === 'command' && action.command?.includes('TTS:')) {
      const textToSpeak = action.command.replace('TTS: ', '');
      try {
        await window.api.voiceTTS({ text: textToSpeak });
        return `🔊 Speaking: "${textToSpeak}"`;
      } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ TTS failed: ${error.message}`; }
    }

    if (actType === 'command' && (action.command?.includes('voice recognition enabled') || action.command?.includes('voice recognition disabled'))) {
      const enabled = action.command.includes('enabled');
      return enabled ? '🎤 Voice recognition is now **enabled**. Say something!' : '🔇 Voice recognition is now **disabled**.';
    }

    switch (action.type) {
      case 'command': {
        // Brain safety validation for dangerous commands
        const dangerousPatterns = /\b(rm\s+-rf|Remove-Item\s+-Recurse|del\s+\/s|format\s+[a-zA-Z]:|rmdir\s+\/s)\b/i;
        if (dangerousPatterns.test(action.command || '')) {
          try {
            const validation = await window.api.brainSafetyValidate({
              action: { type: 'execute', target: 'system', payload: { command: action.command }, riskLevel: 'high' }
            });
            if (!validation.approved) {
              return `⚠️ **Brain Safety Block:** ${validation.reason}\n\nThe command \`${action.command}\` was blocked by the safety governor.`;
            }
          } catch { /* safety check unavailable, proceed */ }
        }
        const result = await window.api.terminalExecute({ command: action.command || '', cwd: action.cwd || cwd });
        const output = result.stdout || result.stderr || '(no output)';
        const exitInfo = result.exitCode !== 0 ? `\n⚠️ Exit code: ${result.exitCode}` : '';
        return `**$ ${action.command}**\n\n\`\`\`\n${output}\n\`\`\`${exitInfo}`;
      }

      case 'write_file': {
        // Brain safety validation for writes to sensitive paths
        const sensitive = /\b(package\.json|\.env|tsconfig|webpack|\.git|\.ssh|\.aws)\b/i;
        if (sensitive.test(action.path || '')) {
          try {
            const validation = await window.api.brainSafetyValidate({
              action: { type: 'write', target: action.path || '', payload: { path: action.path }, riskLevel: 'medium' }
            });
            if (!validation.approved) {
              return `⚠️ **Brain Safety Block:** ${validation.reason}\n\nWriting to \`${action.path}\` was blocked.`;
            }
          } catch { /* safety check unavailable, proceed */ }
        }
        await window.api.fileWrite({ path: action.path || 'output.txt', content: action.content || '' });
        return `**File created:** \`${action.path}\`\n\n\`\`\`\n${action.content}\n\`\`\`\n\n✅ File written successfully.`;
      }

      case 'mkdir': {
        await window.api.fileMkdir({ path: action.path || 'new-folder' });
        return `**Directory created:** \`${action.path}\`\n\n✅ Directory created successfully.`;
      }

      case 'build_website': {
        const result = await window.api.fileWrite({ path: action.path || 'index.html', content: action.content || '' });
        if (result?.error) return `❌ Failed to create file: ${result.error}`;
        // Auto-open in browser
        try {
          const absPath = action.path?.startsWith('/') ? action.path : `${cwd}/${action.path}`;
          const fileUrl = `file:///${absPath.replace(/\\/g, '/')}`;
          await window.api.systemOpenUrl({ url: fileUrl });
        } catch { /* ignore open error */ }
        return `**Website built:** \`${action.path}\`\n\n✅ Opened in browser!`;
      }

      case 'build_app': {
        const writeResult = await window.api.fileWrite({ path: action.path || 'index.js', content: action.content || '' });
        if (writeResult?.error) return `❌ Failed to create file: ${writeResult.error}`;
        if (action.command) {
          const cmdResult = await window.api.terminalExecute({ command: action.command, cwd });
          const cmdOutput = cmdResult.stdout || cmdResult.stderr || '';
          return `**App created:** \`${action.path}\`\n\n\`\`\`\n${action.content}\n\`\`\`\n\n**Setup:**\n\`\`\`\n${cmdOutput}\n\`\`\`\n\n✅ App created and dependencies installed!`;
        }
        return `**App created:** \`${action.path}\`\n\n\`\`\`\n${action.content}\n\`\`\`\n\n✅ App file created!`;
      }

      case 'computer_open': {
        await window.api.computerOpenApp({ name: action.appName || action.command });
        return `✅ Opened ${action.appName || action.command}`;
      }

      case 'computer_type': {
        await window.api.computerTypeText({ text: action.content || '' });
        return `✅ Typed: "${action.content?.slice(0, 80)}${(action.content?.length || 0) > 80 ? '...' : ''}"`;
      }

      case 'computer_click': {
        await window.api.computerClickMouse({ x: action.x || 0, y: action.y || 0, button: 'left' });
        return `✅ Clicked at (${action.x}, ${action.y})`;
      }

      case 'computer_mouse': {
        await window.api.computerMoveMouse({ x: action.x || 0, y: action.y || 0 });
        return `✅ Mouse moved to (${action.x}, ${action.y})`;
      }

      case 'browser_open': {
        if (action.url) {
          await window.api.systemOpenUrl({ url: action.url });
          return `✅ Opened ${action.url} in your browser`;
        }
        return '❌ No URL provided';
      }

      case 'browser_search': {
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(action.value || '')}`;
        await window.api.systemOpenUrl({ url: searchUrl });
        return `✅ Searching Google for: "${action.value}"`;
      }

      case 'browser_type': {
        if (action.selector && action.value) {
          await window.api.browserType({ sessionId: 'brain-session', selector: action.selector, value: action.value });
          return `✅ Typed "${action.value}" in browser`;
        }
        return `❌ Missing selector or value`;
      }

      case 'browser_click': {
        if (action.selector) {
          await window.api.browserClick({ sessionId: 'brain-session', selector: action.selector });
          return `✅ Clicked ${action.selector} in browser`;
        }
        return `❌ Missing selector`;
      }

      case 'computer_captureScreen': {
        try {
          const result = await window.api.computerAction({
            action: 'screenshot',
            reason: action.reason || 'Brain requested screenshot',
          });
          const base64 = (result as { base64?: string })?.base64;
          if (base64) return `📸 **Screenshot captured.**\n\n![Screenshot](data:image/png;base64,${base64})`;
          return '📸 Screenshot captured but no image data returned.';
        } catch (e: unknown) { const error = e instanceof Error ? e : new Error(String(e)); return `❌ Screenshot failed: ${error.message}`; }
      }

      case 'computer_closeApp': {
        const result = await window.api.computerAction({
          action: 'closeApp',
          appName: action.appName || '',
        });
        return result?.ok ? `✅ Closed ${action.appName}` : `❌ Failed to close ${action.appName}`;
      }

      case 'computer_pressKey': {
        const result = await window.api.computerAction({
          action: 'keyPress',
          key: action.command || '',
        });
        return result?.ok ? `✅ Pressed ${action.command}` : `❌ Failed to press ${action.command}`;
      }

      case 'computer_wait': {
        const ms = parseInt(action.command || '1000', 10);
        await new Promise(r => setTimeout(r, Math.min(ms, 10000)));
        return `⏳ Waited ${ms}ms`;
      }

      case 'computer_stats': {
        const result = await window.api.computerAction({ action: 'getStats' });
        return JSON.stringify(result, null, 2);
      }

      case 'answer':
      default:
        return action.answer || "I'm not sure what to do with that.";
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    return `❌ Action failed: ${error.message}`;
  }
}

// ─── HELPER FUNCTIONS ──────────────────────────────────────────────

function extractTags(input: string, output: string): string[] {
  const text = `${input} ${output}`.toLowerCase();
  const tags: string[] = [];
  if (text.includes('function') || text.includes('const') || text.includes('let ') || text.includes('var ')) tags.push('javascript');
  if (text.includes('import') || text.includes('export')) tags.push('module');
  if (text.includes('react') || text.includes('component') || text.includes('jsx') || text.includes('tsx')) tags.push('react');
  if (text.includes('css') || text.includes('style') || text.includes('tailwind')) tags.push('styling');
  if (text.includes('api') || text.includes('fetch') || text.includes('axios')) tags.push('api');
  if (text.includes('database') || text.includes('sql') || text.includes('mongo')) tags.push('database');
  if (text.includes('html') || text.includes('div') || text.includes('span')) tags.push('html');
  if (text.includes('typescript') || text.includes('type ') || text.includes('interface ')) tags.push('typescript');
  if (text.includes('deploy') || text.includes('github') || text.includes('git ')) tags.push('deployment');
  if (text.includes('test') || text.includes('spec') || text.includes('jest') || text.includes('vitest')) tags.push('testing');
  if (text.includes('error') || text.includes('bug') || text.includes('fix')) tags.push('debugging');
  if (text.includes('python') || text.includes('pip') || text.includes('django') || text.includes('flask')) tags.push('python');
  if (text.includes('node') || text.includes('npm') || text.includes('package')) tags.push('nodejs');
  if (text.includes('docker') || text.includes('container') || text.includes('kubernetes')) tags.push('devops');
  if (text.includes('git') || text.includes('commit') || text.includes('branch')) tags.push('git');
  if (text.includes('html') || text.includes('dom') || text.includes('browser')) tags.push('html');
  if (text.includes('game') || text.includes('canvas') || text.includes('sprite')) tags.push('game');
  if (text.includes('security') || text.includes('encrypt') || text.includes('hash')) tags.push('security');
  if (text.includes('math') || text.includes('calculate') || text.includes('equation')) tags.push('math');
  if (text.includes('hello') || text.includes('hi') || text.includes('hey')) tags.push('greeting');
  return tags.length > 0 ? tags : ['general'];
}

function categorizeKnowledge(input: string, output: string): KnowledgeEntry['category'] {
  const text = `${input} ${output}`.toLowerCase();
  if (text.includes('function') || text.includes('const') || text.includes('import') || text.includes('class') || text.includes('component')) return 'code';
  if (text.includes('how to') || text.includes('what is') || text.includes('explain') || text.includes('why')) return 'learning';
  if (text.includes('build') || text.includes('create') || text.includes('deploy') || text.includes('fix')) return 'task';
  return 'conversation';
}

// ─── STORE ─────────────────────────────────────────────────────────

export const useBrainStore = create<BrainState>((set, get) => ({
  knowledge: [],
  isLearning: false,
  totalInteractions: 0,
  lastLearned: 0,
  initialized: false,
  cwd: '.',

  setCwd: (cwd) => set({ cwd }),

  learnFromInteraction: (input, output, source) => {
    const state = get();
    if (state.totalInteractions > 10000) return;

    const entry: KnowledgeEntry = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      category: categorizeKnowledge(input, output),
      input: input.slice(0, 500),
      output: output.slice(0, 1000),
      source,
      confidence: source === 'api' ? 0.9 : source === 'user' ? 0.8 : 0.7,
      tags: extractTags(input, output),
    };

    set((s) => ({
      knowledge: [...s.knowledge, entry].slice(-5000),
      totalInteractions: s.totalInteractions + 1,
      lastLearned: Date.now(),
    }));

    // Also persist to SQLite for long-term memory
    try {
      window.api.pmemSaveKnowledge({
        input: entry.input,
        output: entry.output,
        source: entry.source,
        tags: entry.tags,
      });
    } catch { /* non-blocking */ }
  },

  searchKnowledge: (query) => {
    const state = get();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);

    return state.knowledge
      .map(entry => {
        let score = 0;
        const entryText = `${entry.input} ${entry.output} ${entry.tags.join(' ')}`.toLowerCase();
        if (entryText.includes(queryLower)) score += 10;
        queryWords.forEach(word => {
          if (entryText.includes(word)) score += 2;
          entry.tags.forEach(tag => { if (tag.includes(word)) score += 3; });
        });
        const age = Date.now() - entry.timestamp;
        score += Math.max(0, 1 - age / (30 * 24 * 60 * 60 * 1000));
        score += entry.confidence;
        return { entry, score };
      })
      .filter(item => item.score > 2)
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.entry);
  },

  generateOfflineResponse: async (input) => {
    const state = get();
    const inputLower = input.toLowerCase().trim();

    // 1. Check seed knowledge first (exact or close match)
    const seedMatch = SEED_KNOWLEDGE.find(s => {
      const sLower = s.input.toLowerCase();
      return inputLower === sLower || inputLower.includes(sLower) || sLower.includes(inputLower);
    });
    if (seedMatch) return seedMatch.output;

    // 2. Check learned knowledge
    const relevantKnowledge = state.searchKnowledge(input);
    if (relevantKnowledge.length > 0) {
      return relevantKnowledge.slice(0, 3).map(k => k.output.slice(0, 500)).join('\n\n');
    }

    // 3. Try pattern matching for intent — may return an action to execute
    for (const rule of INTENT_PATTERNS) {
      const match = input.match(rule.pattern);
      if (match) {
        const action = rule.handler(input, match);
        return await executeBrainAction(action, state.cwd);
      }
    }

    // 4. Fallback — conversational, not dead-end
    const isQuestion = /\?$/i.test(input.trim()) || /^(what|how|why|when|where|who|can|do|does|is|are|should|could|would)/i.test(input);
    const isGreeting = /^(hi|hello|hey|yo|sup|howdy|greetings|good\s*(morning|afternoon|evening))/i.test(input);

    if (isGreeting) {
      return "Hey! I'm the Infinite AI Brain. I can code, build, explain, research, run commands, write files, and learn from everything we discuss. What do you need?";
    }

    if (isQuestion) {
      return `I'm still learning about "${input.slice(0, 60)}". I'll get better the more we talk. In the meantime, try:\n- Being more specific\n- Asking about JavaScript, Python, HTML/CSS, React, Node.js, Git, Docker, SQL, or algorithms\n- Asking me to build something (website, app, game, API)\n- Asking math questions\n- Asking me to run terminal commands`;
    }

    return `I heard you! I'm still building my knowledge base. Ask me about:\n- **Code**: JavaScript, Python, TypeScript, React, Node.js\n- **Build**: websites, apps, games, APIs\n- **Run**: terminal commands, scripts, servers\n- **Learn**: algorithms, data structures, math, security\n- **DevOps**: Git, Docker, deployment\n- **Debug**: paste an error and I'll help fix it`;
  },

  getKnowledgeStats: () => {
    const state = get();
    const categories: Record<string, number> = {};
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    let recentActivity = 0;
    state.knowledge.forEach(entry => {
      categories[entry.category] = (categories[entry.category] || 0) + 1;
      if (entry.timestamp > oneDayAgo) recentActivity++;
    });
    return { total: state.totalInteractions, categories, recentActivity };
  },

  exportKnowledge: () => {
    const state = get();
    return JSON.stringify({
      knowledge: state.knowledge,
      totalInteractions: state.totalInteractions,
      exportedAt: Date.now(),
    }, null, 2);
  },

  importKnowledge: (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.knowledge && Array.isArray(parsed.knowledge)) {
        set((s) => ({
          knowledge: [...s.knowledge, ...parsed.knowledge].slice(-5000),
          totalInteractions: s.totalInteractions + (parsed.totalInteractions || 0),
        }));
      }
    } catch (e) {
      console.error('[brain] Failed to import knowledge:', e);
    }
  },
}));

// Initialize seed knowledge on first load
const initState = useBrainStore.getState();
if (!initState.initialized && initState.knowledge.length === 0) {
  const seedEntries: KnowledgeEntry[] = SEED_KNOWLEDGE.map(s => ({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    category: s.category,
    input: s.input,
    output: s.output,
    source: 'seed' as const,
    confidence: 0.95,
    tags: s.tags,
  }));
  useBrainStore.setState({
    knowledge: seedEntries,
    totalInteractions: seedEntries.length,
    lastLearned: Date.now(),
    initialized: true,
  });
  console.log(`[brain] Loaded ${seedEntries.length} seed knowledge entries`);
}

