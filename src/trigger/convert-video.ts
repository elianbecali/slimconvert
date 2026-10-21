// src/trigger/convert-video.ts
import { task, metadata, logger } from "@trigger.dev/sdk/v3";
import {
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2, R2_BUCKET } from "../lib/r2";
import { spawn } from "child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

interface ConvertPayload {
  fileKey: string;
  originalName: string;
  crf: number;
  muteAudio: boolean;
  scale1080p: boolean;
}

export const convertVideoTask = task({
  id: "convert-video",
  run: async (payload: ConvertPayload) => {
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `in-${Date.now()}.mov`);
    const outputPath = path.join(tmpDir, `out-${Date.now()}.mp4`);
    const outputKey = payload.fileKey.replace(/\.[^/.]+\$/, "") + "-slim.mp4";

    logger.info("Iniciando task de conversão de vídeo", {
      originalName: payload.originalName,
      fileKey: payload.fileKey,
    });

    try {
      metadata.set("status", "Baixando do R2 para o worker...");
      metadata.set("progress", 5);
      logger.info("Baixando arquivo do Cloudflare R2...", {
        bucket: R2_BUCKET,
        key: payload.fileKey,
      });

      // 1. Baixar arquivo .MOV do R2 via stream
      const getObj = await r2.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: payload.fileKey }),
      );
      if (!getObj.Body) throw new Error("Arquivo não encontrado no R2");
      await pipeline(getObj.Body as Readable, fs.createWriteStream(inputPath));

      const originalSize = fs.statSync(inputPath).size;
      metadata.set("originalSize", originalSize);
      logger.info("Download concluído com sucesso", {
        sizeMB: (originalSize / (1024 * 1024)).toFixed(2),
      });

      metadata.set("status", "Comprimindo vídeo (FFmpeg)...");
      metadata.set("progress", 10);
      logger.info("Preparando argumentos do FFmpeg", { crf: payload.crf });

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
        "ultrafast", // Máxima velocidade de processamento
        "-threads",
        "0", // Usa todos os núcleos da CPU disponíveis
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
      ];

      args.push(outputPath);
      logger.info("Executando processo FFmpeg (Resolução original mantida)", {
        args: args.join(" "),
      });

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
              logger.info("Duração total do vídeo detectada", {
                totalDurationSec,
              });
            }
          }

          // Captura tempo atual processado
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
          if (code === 0) {
            logger.info("FFmpeg finalizado com sucesso");
            resolve();
          } else {
            logger.error("FFmpeg falhou", { code });
            reject(new Error(`FFmpeg falhou com código ${code}`));
          }
        });
      });

      // 4. Subir o .MP4 convertido de volta para o R2
      metadata.set("status", "Salvando MP4 otimizado...");
      metadata.set("progress", 95);

      const finalSize = fs.statSync(outputPath).size;
      logger.info("Fazendo upload do arquivo otimizado para o R2", {
        sizeMB: (finalSize / (1024 * 1024)).toFixed(2),
        economizouPct: Math.round((1 - finalSize / originalSize) * 100),
      });

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

      const downloadUrl = await getSignedUrl(
        r2,
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: outputKey }),
        { expiresIn: 3600 },
      );

      logger.info(
        "Removendo arquivo original .MOV do R2 para economizar espaço",
      );
      await r2.send(
        new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: payload.fileKey }),
      );

      metadata.set("status", "Concluído!");
      metadata.set("progress", 100);
      metadata.set("finalSize", finalSize);
      metadata.set("downloadUrl", downloadUrl);

      logger.info("Task de conversão finalizada com sucesso!", { outputKey });

      return {
        downloadUrl,
        originalSize,
        finalSize,
        savedPercentage: Math.round((1 - finalSize / originalSize) * 100),
      };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error("Erro crítico na task convert-video", {
        error: errorMessage,
      });
      metadata.set("status", "Erro na conversão");
      throw err;
    } finally {
      // Limpa disco temporário do worker
      if (fs.existsSync(inputPath)) {
        fs.unlinkSync(inputPath);
        logger.info("Arquivo temporário de entrada limpo do disco");
      }
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
        logger.info("Arquivo temporário de saída limpo do disco");
      }
    }
  },
});
