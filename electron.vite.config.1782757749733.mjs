// electron.vite.config.ts
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@main": resolve("src/main")
      }
    },
    build: {
      outDir: "out/main",
      rollupOptions: {
        input: { index: resolve("src/main/index.ts") },
        external: ["playwright", "playwright-core"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: { "@shared": resolve("src/shared") }
    },
    build: {
      outDir: "out/preload",
      rollupOptions: {
        input: { index: resolve("src/preload/index.ts") }
      }
    }
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    resolve: {
      alias: {
        "@shared": resolve("src/shared"),
        "@renderer": resolve("src/renderer")
      }
    },
    build: {
      outDir: "out/renderer",
      rollupOptions: {
        input: resolve("src/renderer/index.html")
      }
    },
    server: { port: 5173 }
  }
});
export {
  electron_vite_config_default as default
};
