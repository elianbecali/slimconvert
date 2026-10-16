// trigger.config.ts
import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg } from "@trigger.dev/build/extensions/core";

export default defineConfig({
  project: "proj_nazakpcnpkfwynoyarlx", // Coloque o ID do seu projeto do Trigger.dev
  runtime: "node",
  logLevel: "log",
  maxDuration: 3600, // 1 hora máxima por vídeo
  dirs: ["./src/trigger"],
  build: {
    extensions: [ffmpeg()], // Instala o FFmpeg automaticamente no container do worker
  },
});
