// Infinite OS Bridge — connection config.
//
// config.js is generated for you: the installer copies this file's shape with a
// random local token, and the app re-syncs it on every start, so only Infinite
// OS on this machine can drive this browser.
//
// You only need this file if config.js is missing (fresh clone). Copy it to
// config.js and paste the token from  ~/.infinite-ai/bridge-token  — the popup
// shows "Missing token in config.js" until a token is present.
//
//   const BRIDGE_CONFIG = { port: 8765, token: "<token from ~/.infinite-ai/bridge-token>" };
//
// Never commit config.js: the token is a bearer credential for your browser.
const BRIDGE_CONFIG = { port: 8765, token: "" };