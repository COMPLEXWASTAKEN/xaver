import fs from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const root = __dirname;

function copyEngine() {
  return {
    name: "copy-engine",
    closeBundle() {
      const copy = (from: string, to: string) => {
        fs.mkdirSync(to, { recursive: true });
        for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
          const src = resolve(from, ent.name);
          if (ent.isDirectory()) copy(src, resolve(to, ent.name));
          else if (ent.name.endsWith(".js") && ent.name !== "cli.js") fs.copyFileSync(src, resolve(to, ent.name));
        }
      };
      fs.rmSync(resolve(root, "out", "src"), { recursive: true, force: true });
      copy(resolve(root, "src"), resolve(root, "out", "src"));
    }
  };
}

const pkg = JSON.parse(fs.readFileSync(resolve(root, "package.json"), "utf8"));
const appVersion = JSON.stringify(pkg.version || "0.0.0");

const minify = {
  minify: "esbuild" as const,
  sourcemap: false,
  reportCompressedSize: false
};

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyEngine()],
    build: {
      ...minify,
      rollupOptions: {
        input: {
          index: resolve(root, "electron/main/index.ts")
        }
      }
    },
    esbuild: {
      legalComments: "none"
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      ...minify,
      rollupOptions: {
        input: {
          index: resolve(root, "electron/preload/index.ts")
        }
      }
    },
    esbuild: {
      legalComments: "none"
    }
  },
  renderer: {
    root: resolve(root, "ui"),
    define: {
      __APP_VERSION__: appVersion
    },
    build: {
      ...minify,
      cssMinify: true,
      assetsInlineLimit: 4096,
      chunkSizeWarningLimit: 800,
      target: "es2022",
      rollupOptions: {
        input: {
          index: resolve(root, "ui/index.html")
        }
      }
    },
    esbuild: {
      legalComments: "none"
    },
    resolve: {
      alias: {
        "@": resolve(root, "ui")
      }
    },
    plugins: [react(), copyEngine()]
  }
});
