// src/app/actions.ts
"use server";

import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { tasks, auth } from "@trigger.dev/sdk/v3";
import { r2, R2_BUCKET } from "@/lib/r2";
import type { convertVideoTask } from "@/trigger/convert-video";

export async function getUploadPresignedUrl(
  fileName: string,
  contentType: string,
) {
  const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const fileKey = `uploads/${Date.now()}-${safeName}`;

  const uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileKey,
      ContentType: contentType || "video/quicktime",
    }),
    { expiresIn: 3600 },
  );

  return { uploadUrl, fileKey };
}

// Define faixas de tamanho (em Megabytes) e suas respectivas máquinas
const MACHINE_TIERS = [
  { threshold: 1500, machine: "large-1x" }, // Acima de 1500MB -> 8GB RAM
  { threshold: 0, machine: "medium-1x" }, // Padrão até 1500MB -> 1GB RAM
] as const;

export async function startConversionAction(params: {
  fileKey: string;
  originalName: string;
  fileSize: number;
  crf: number;
  muteAudio: boolean;
  scale1080p: boolean;
}) {
  // A escolha vira uma busca limpa no array/objeto
  const fileSizeMB = params.fileSize / (1024 * 1024);
  const matchedTier = MACHINE_TIERS.find(
    (tier) => fileSizeMB >= tier.threshold,
  );
  const chosenMachine = matchedTier ? matchedTier.machine : "small-2x";

  const handle = await tasks.trigger<typeof convertVideoTask>(
    "convert-video",
    {
      fileKey: params.fileKey,
      originalName: params.originalName,
      crf: params.crf,
      muteAudio: params.muteAudio,
      scale1080p: params.scale1080p,
    },
    {
      machine: chosenMachine, // 👈 Aqui você injeta a máquina de forma dinâmica!
    },
  );

  const publicToken = await auth.createPublicToken({
    scopes: {
      read: { runs: [handle.id] },
    },
  });

  return { runId: handle.id, publicToken };
}
