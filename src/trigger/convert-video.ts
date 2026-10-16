// src/trigger/convert-video.ts
import { task, metadata } from "@trigger.dev/sdk/v3";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "../lib/r2";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

interface ConvertPayload {
  fileKey: string;
  originalName: string;
  crf: number; // 18 (Alta), 23 (Equilibrado), 28 (Ultra Leve)
  muteAudio: boolean;
  scale1080p: boolean;
}

export const convertVideoTask = task({
  id: "convert-video",
  machine: { preset: "medium-1x" }, // 2 vCPU / 4GB RAM para o FFmpeg voar
  run: async (payload: ConvertPayload) => {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `in-${Date.now()}.mov`);
    const outputPath = path.join(tmpDir, `out-${Date.now()}.mp4`);
    const outputKey = payload.fileKey.replace(/\.[^/.]+\$/, "") + "-slim.mp4";

    try {
      metadata.set("status", "Baixando do R2 para o worker...");
      metadata.set("progress", 5);

      // 1. Baixar arquivo .MOV do R2 via stream
      const getObj = await r2.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: payload.fileKey }),
      );
      if (!getObj.Body) throw new Error("Arquivo não encontrado no R2");
      await pipeline(getObj.Body as Readable, fs.createWriteStream(inputPath));

      const originalSize = fs.statSync(inputPath).size;
      metadata.set("originalSize", originalSize);
      metadata.set("status", "Comprimindo vídeo (FFmpeg)...");
      metadata.set("progress", 10);

      // 2. Montar argumentos otimizados do FFmpeg
      const args = [
        "-y",
        "-i",
        inputPath,
        "-c:v",
        "libx264",
        "-crf",
        String(payload.crf),
        "-preset",
        "faster", // Ótimo equilíbrio velocidade vs compressão
        "-pix_fmt",
        "yuv420p", // Garante compatibilidade em todos navegadores/players
        "-movflags",
        "+faststart", // Começa a tocar na web instantaneamente
      ];

      if (payload.scale1080p) {
        // Reduz para no máximo 1080p de altura sem distorcer (mantém menor se já for menor)
        args.push("-vf", "scale=-2:'min(1080,ih)'");
      }

      if (payload.muteAudio) {
        args.push("-an");
      } else {
        args.push("-c:a", "aac", "-b:a", "128k");
      }

      args.push(outputPath);

      // 3. Executar FFmpeg e extrair porcentagem em tempo real
      await new Promise<void>((resolve, reject) => {
        const ffmpegProc = spawn("ffmpeg", args);
        let totalDurationSec = 0;

        ffmpegProc.stderr.on("data", (chunk: Buffer) => {
          const text = chunk.toString();

          // Captura duração total do vídeo
          if (!totalDurationSec) {
            const durMatch = text.match(
              /Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d{2})/,
            );
            if (durMatch) {
              totalDurationSec =
                parseInt(durMatch[1]) * 3600 +
                parseInt(durMatch[2]) * 60 +
                parseFloat(durMatch[3]);
            }
          }

          // Captura tempo atual processado e atualiza metadata pro frontend
          const timeMatch = text.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d{2})/);
          if (timeMatch && totalDurationSec > 0) {
            const currentSec =
              parseInt(timeMatch[1]) * 3600 +
              parseInt(timeMatch[2]) * 60 +
              parseFloat(timeMatch[3]);
            const pct = Math.min(
              90,
              Math.round(10 + (currentSec / totalDurationSec) * 80),
            );
            metadata.set("progress", pct);
          }
        });

        ffmpegProc.on("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(`FFmpeg falhou com código ${code}`));
        });
      });

      // 4. Subir o .MP4 convertido de volta para o R2
      metadata.set("status", "Salvando MP4 otimizado...");
      metadata.set("progress", 95);

      const finalSize = fs.statSync(outputPath).size;
      const fileStream = fs.createReadStream(outputPath);
      const cleanDownloadName =
        payload.originalName.replace(/\.[^/.]+\$/, "") + ".mp4";

      await r2.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: outputKey,
          Body: fileStream,
          ContentType: "video/mp4",
          ContentDisposition: `attachment; filename="${cleanDownloadName}"`,
        }),
      );

      // 5. Gerar link de download válido por 24h e deletar o .MOV pesado original
      const downloadUrl = await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: outputKey }),
        { expiresIn: 604800 }, // 7 dias (acompanhando a regra do R2)
      );

      await r2.send(
        new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: payload.fileKey }),
      );

      metadata.set("status", "Concluído!");
      metadata.set("progress", 100);
      metadata.set("finalSize", finalSize);
      metadata.set("downloadUrl", downloadUrl);

      return {
        downloadUrl,
        originalSize,
        finalSize,
        savedPercentage: Math.round((1 - finalSize / originalSize) * 100),
      };
    } finally {
      // Limpa disco temporário do worker
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }
  },
});
