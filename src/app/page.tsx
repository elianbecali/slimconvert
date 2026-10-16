// src/app/page.tsx
"use client";

import { useRealtimeRun } from "@trigger.dev/react-hooks";
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileVideo,
  Loader2,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getUploadPresignedUrl, startConversionAction } from "./actions";

type JobItem = {
  id: string;
  fileName: string;
  fileSize: number;
  status: "uploading" | "processing" | "done" | "error";
  uploadProgress: number;
  runId?: string;
  publicToken?: string;
  downloadUrl?: string;
  finalSize?: number;
  createdAt: number;
  expiresAt: number;
};

function formatBytes(bytes: number) {
  if (!bytes) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Componente que gerencia cada item da lista (ativo ou recuperado do localStorage)
function ConversionRow({
  item,
  onUpdate,
  onRemove,
}: {
  item: JobItem;
  onUpdate: (updated: JobItem) => void;
  onRemove: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);

  // Se tiver runId e publicToken, o Trigger.dev Realtime reconecta mesmo após F5 ou fechar aba!
  const { run, error } = useRealtimeRun(item.runId || "", {
    accessToken: item.publicToken || "",
    enabled: Boolean(
      item.runId && item.publicToken && item.status === "processing",
    ),
  });

  const meta = (run?.metadata || {}) as {
    status?: string;
    progress?: number;
    finalSize?: number;
    downloadUrl?: string;
  };

  const isCompleted = run?.status === "COMPLETED" && meta.downloadUrl;
  const isFailed =
    run?.status === "FAILED" || item.status === "error" || Boolean(error);

  const ffmpegProgress = meta.progress ?? 0;
  const finalSize = meta.finalSize ?? 0;
  const savedPct = finalSize
    ? Math.max(0, Math.round((1 - finalSize / item.fileSize) * 100))
    : 0;

  // Atualiza o estado pai assim que o Trigger.dev sinalizar conclusão
  useEffect(() => {
    if (isCompleted && meta.downloadUrl && item.status !== "done") {
      onUpdate({
        ...item,
        status: "done",
        downloadUrl: meta.downloadUrl,
        finalSize,
      });
    } else if (isFailed && item.status !== "error") {
      onUpdate({
        ...item,
        status: "error",
      });
    }
  }, [isCompleted, isFailed, meta, finalSize, item, onUpdate]);

  const copyLink = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl bg-zinc-900/90 border border-zinc-800 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div
          className={`p-2.5 rounded-lg shrink-0 ${
            item.status === "done"
              ? "bg-emerald-500/10 text-emerald-400"
              : "bg-zinc-800 text-zinc-300"
          }`}
        >
          {item.status === "done" ? (
            <CheckCircle2 className="w-5 h-5" />
          ) : (
            <FileVideo className="w-5 h-5" />
          )}
        </div>
        <div className="min-w-0">
          <p className="font-medium text-zinc-100 truncate text-sm">
            {item.fileName}
          </p>
          <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
            <span>{formatBytes(item.fileSize)}</span>
            {item.status === "done" && finalSize > 0 ? (
              <>
                <span>➔</span>
                <span className="text-emerald-400 font-semibold">
                  {formatBytes(finalSize)} (-{savedPct}%)
                </span>
              </>
            ) : (
              <span className="text-zinc-500">MP4 Otimizado</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0 w-full sm:w-auto justify-end">
        {item.status === "uploading" && (
          <div className="w-full sm:w-56">
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5 text-sky-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Enviando...
              </span>
              <span>{item.uploadProgress}%</span>
            </div>
            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-sky-500 transition-all duration-200"
                style={{ width: `${item.uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {item.status === "processing" && !isCompleted && !isFailed && (
          <div className="w-full sm:w-56">
            <div className="flex justify-between text-xs text-zinc-400 mb-1">
              <span className="flex items-center gap-1.5 text-amber-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                {meta.status || "Processando na nuvem..."}
              </span>
              <span>{ffmpegProgress}%</span>
            </div>
            <div className="h-2 w-full bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all duration-300"
                style={{ width: `${ffmpegProgress}%` }}
              />
            </div>
          </div>
        )}

        {item.status === "done" && item.downloadUrl && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => copyLink(item.downloadUrl!)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium transition"
            >
              {copied ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
              {copied ? "Copiado" : "Link"}
            </button>
            <a
              href={item.downloadUrl}
              download
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-semibold transition shadow-sm"
            >
              <Download className="w-4 h-4" />
              Baixar
            </a>
          </div>
        )}

        {isFailed && (
          <div className="flex items-center gap-3">
            <span className="text-xs text-red-400 font-medium">Falha</span>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="text-xs text-zinc-500 hover:text-zinc-300"
            >
              Remover
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function SlimConvertPage() {
  const [items, setItems] = useState<JobItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Carrega e limpa itens expirados (+7 dias) do localStorage na inicialização
  useEffect(() => {
    const saved = localStorage.getItem("slimconvert_items");
    if (saved) {
      try {
        const parsed: JobItem[] = JSON.parse(saved);
        const now = Date.now();
        // Filtra itens com menos de 7 dias
        const validItems = parsed.filter((item) => item.expiresAt > now);
        setItems(validItems);
        localStorage.setItem("slimconvert_items", JSON.stringify(validItems));
      } catch {
        localStorage.removeItem("slimconvert_items");
      }
    }
  }, []);

  // Sincroniza alterações de estado diretamente no localStorage
  const updateItem = useCallback((updated: JobItem) => {
    setItems((prev) => {
      const newItems = prev.map((i) => (i.id === updated.id ? updated : i));
      localStorage.setItem("slimconvert_items", JSON.stringify(newItems));
      return newItems;
    });
  }, []);

  const removeItem = useCallback((id: string) => {
    setItems((prev) => {
      const newItems = prev.filter((i) => i.id !== id);
      localStorage.setItem("slimconvert_items", JSON.stringify(newItems));
      return newItems;
    });
  }, []);

  const clearAll = () => {
    setItems([]);
    localStorage.removeItem("slimconvert_items");
  };

  const processFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);

    for (const file of fileArray) {
      const id = Math.random().toString(36).substring(2, 9);
      const now = Date.now();

      // Cria o item inicial já salvando no localStorage como "uploading"
      const newItem: JobItem = {
        id,
        fileName: file.name,
        fileSize: file.size,
        status: "uploading",
        uploadProgress: 0,
        createdAt: now,
        expiresAt: now + 7 * 24 * 60 * 60 * 1000, // 7 dias
      };

      setItems((prev) => {
        const updated = [newItem, ...prev];
        localStorage.setItem("slimconvert_items", JSON.stringify(updated));
        return updated;
      });

      try {
        const { uploadUrl, fileKey } = await getUploadPresignedUrl(
          file.name,
          file.type,
        );

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", uploadUrl);
          xhr.setRequestHeader("Content-Type", file.type || "video/quicktime");

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const pct = Math.round((event.loaded / event.total) * 100);
              setItems((prev) => {
                const updated = prev.map((j) =>
                  j.id === id ? { ...j, uploadProgress: pct } : j,
                );
                localStorage.setItem(
                  "slimconvert_items",
                  JSON.stringify(updated),
                );
                return updated;
              });
            }
          };

          xhr.onload = () =>
            xhr.status >= 200 && xhr.status < 300 ? resolve() : reject();
          xhr.onerror = () => reject();
          xhr.send(file);
        });

        // Dispara a task no Trigger.dev
        const { runId, publicToken } = await startConversionAction({
          fileKey,
          originalName: file.name,
          crf: 23,
          fileSize: file.size,
          muteAudio: false,
          scale1080p: true,
        });

        // Assim que o upload acaba e o Trigger assume, mudamos para "processing" e salvamos os tokens
        setItems((prev) => {
          const updated = prev.map((j) =>
            j.id === id
              ? { ...j, status: "processing" as const, runId, publicToken }
              : j,
          );
          localStorage.setItem("slimconvert_items", JSON.stringify(updated));
          return updated;
        });
      } catch {
        setItems((prev) => {
          const updated = prev.map((j) =>
            j.id === id ? { ...j, status: "error" as const } : j,
          );
          localStorage.setItem("slimconvert_items", JSON.stringify(updated));
          return updated;
        });
      }
    }
  }, []);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (e.clipboardData?.files?.length) {
        processFiles(e.clipboardData.files);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [processFiles]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 px-4 py-16">
      <div className="max-w-3xl mx-auto space-y-10">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold text-xl mb-2 shadow-sm">
            S
          </div>
          <h1 className="text-3xl font-bold tracking-tight">
            Slim<span className="text-emerald-400">Convert</span>
          </h1>
          <p className="text-sm text-zinc-400">
            Arraste seu vídeo .MOV ou use{" "}
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
              Cmd + V
            </kbd>
            . Pode fechar a aba se quiser; o histórico e o progresso ficam
            salvos.
          </p>
        </div>

        <label
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              processFiles(e.dataTransfer.files);
            }
          }}
          className={`flex flex-col items-center justify-center border-2 border-dashed rounded-3xl p-14 cursor-pointer transition-all ${
            isDragging
              ? "border-emerald-400 bg-emerald-500/10"
              : "border-zinc-800 bg-zinc-900/30 hover:border-zinc-700 hover:bg-zinc-900/60"
          }`}
        >
          <input
            type="file"
            accept="video/quicktime,video/mp4,.mov,.mp4"
            multiple
            className="hidden"
            onChange={(e) =>
              e.target.files?.length && processFiles(e.target.files)
            }
          />
          <UploadCloud className="w-10 h-10 text-emerald-400 mb-4" />
          <p className="text-base font-medium text-zinc-200 text-center">
            Arraste seu vídeo <span className="text-emerald-400">.MOV</span>{" "}
            aqui ou clique para selecionar
          </p>
        </label>

        {items.length > 0 && (
          <div className="space-y-3 pt-4 border-t border-zinc-900">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                Seus Vídeos ({items.length})
              </h2>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-zinc-500 hover:text-red-400 flex items-center gap-1 transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Limpar tudo
              </button>
            </div>

            <div className="space-y-2.5">
              {items.map((item) => (
                <ConversionRow
                  key={item.id}
                  item={item}
                  onUpdate={updateItem}
                  onRemove={removeItem}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
