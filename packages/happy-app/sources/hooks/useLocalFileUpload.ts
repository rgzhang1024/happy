/**
 * Pick arbitrary files and upload them immediately to the self-host local-upload API.
 * Successful uploads expose host-absolute paths for chat text markers.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { uploadLocalFile } from "@/sync/apiLocalUpload";

export const MAX_LOCAL_FILES_PER_MESSAGE = 10;
export const MAX_LOCAL_FILE_SIZE = 50 * 1024 * 1024;

export type LocalFilePreview = {
    id: string;
    name: string;
    size: number;
    status: "pending" | "uploading" | "ready" | "error";
    path?: string;
    error?: string;
};

type Stash = { blob?: File; uri?: string };

type UseLocalFileUploadResult = {
    selectedFiles: LocalFilePreview[];
    isUploading: boolean;
    pickFiles: () => Promise<void>;
    removeFile: (id: string) => void;
    clearFiles: () => void;
};

function newId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function isAbortError(err: unknown): boolean {
    if (!err || typeof err !== "object") return false;
    const name = (err as { name?: string }).name;
    return name === "AbortError";
}

async function readUriBytes(uri: string, signal?: AbortSignal): Promise<Uint8Array> {
    const res = await fetch(uri, { signal });
    if (!res.ok) {
        throw new Error(`Failed to read file (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
}

export function useLocalFileUpload(sessionId: string): UseLocalFileUploadResult {
    const [selectedFiles, setSelectedFiles] = useState<LocalFilePreview[]>([]);
    const filesRef = useRef(selectedFiles);
    filesRef.current = selectedFiles;
    const stashRef = useRef(new Map<string, Stash>());
    const abortRef = useRef(new Map<string, AbortController>());
    const sessionIdRef = useRef(sessionId);
    sessionIdRef.current = sessionId;

    const patchFile = useCallback((id: string, patch: Partial<LocalFilePreview>) => {
        setSelectedFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    }, []);

    const startUpload = useCallback(async (id: string, name: string) => {
        const credentials = sync.getCredentials();
        if (!credentials) {
            patchFile(id, { status: "error", error: "Not authenticated" });
            return;
        }

        const existing = abortRef.current.get(id);
        existing?.abort();
        const controller = new AbortController();
        abortRef.current.set(id, controller);
        patchFile(id, { status: "uploading", error: undefined });

        try {
            const stash = stashRef.current.get(id);
            let data: Uint8Array | Blob;
            if (stash?.blob) {
                data = stash.blob;
            } else if (stash?.uri) {
                data = await readUriBytes(stash.uri, controller.signal);
            } else {
                throw new Error("Missing file data");
            }

            const result = await uploadLocalFile(
                credentials,
                sessionIdRef.current,
                { name, data },
                { signal: controller.signal },
            );

            if (controller.signal.aborted) return;
            // File may have been removed while uploading.
            if (!filesRef.current.some((f) => f.id === id)) return;

            patchFile(id, {
                status: "ready",
                path: result.path,
                name: result.name || name,
                size: result.size,
                error: undefined,
            });
        } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
                return;
            }
            if (!filesRef.current.some((f) => f.id === id)) return;
            const message = err instanceof Error ? err.message : String(err);
            patchFile(id, { status: "error", error: message });
        } finally {
            if (abortRef.current.get(id) === controller) {
                abortRef.current.delete(id);
            }
        }
    }, [patchFile]);

    const removeFile = useCallback((id: string) => {
        abortRef.current.get(id)?.abort();
        abortRef.current.delete(id);
        stashRef.current.delete(id);
        setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const clearFiles = useCallback(() => {
        for (const c of abortRef.current.values()) {
            c.abort();
        }
        abortRef.current.clear();
        stashRef.current.clear();
        setSelectedFiles([]);
    }, []);

    const enqueueFiles = useCallback((items: Array<{ id: string; name: string; size: number; stash: Stash }>) => {
        if (!items.length) return;
        const next: LocalFilePreview[] = items.map((item) => {
            stashRef.current.set(item.id, item.stash);
            return {
                id: item.id,
                name: item.name,
                size: item.size,
                status: "pending" as const,
            };
        });
        setSelectedFiles((prev) => [...prev, ...next]);
        for (const item of items) {
            void startUpload(item.id, item.name);
        }
    }, [startUpload]);

    const pickFiles = useCallback(async () => {
        const remaining = MAX_LOCAL_FILES_PER_MESSAGE - filesRef.current.length;
        if (remaining <= 0) {
            Modal.alert("Error", `Max ${MAX_LOCAL_FILES_PER_MESSAGE} files per message`);
            return;
        }

        if (Platform.OS === "web") {
            await new Promise<void>((resolve) => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.style.display = "none";
                document.body.appendChild(input);
                let settled = false;
                const cleanup = () => {
                    if (settled) return;
                    settled = true;
                    input.remove();
                    resolve();
                };
                input.onchange = () => {
                    const list = Array.from(input.files ?? []).slice(0, remaining);
                    const items: Array<{ id: string; name: string; size: number; stash: Stash }> = [];
                    for (const file of list) {
                        if (file.size > MAX_LOCAL_FILE_SIZE) {
                            Modal.alert("Error", `${file.name}: max 50MB`);
                            continue;
                        }
                        items.push({
                            id: newId(),
                            name: file.name,
                            size: file.size,
                            stash: { blob: file },
                        });
                    }
                    enqueueFiles(items);
                    cleanup();
                };
                input.addEventListener("cancel", cleanup);
                window.addEventListener("focus", () => setTimeout(cleanup, 500), { once: true });
                input.click();
            });
            return;
        }

        const result = await DocumentPicker.getDocumentAsync({
            multiple: true,
            copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.length) return;

        const items: Array<{ id: string; name: string; size: number; stash: Stash }> = [];
        for (const asset of result.assets.slice(0, remaining)) {
            const size = asset.size ?? 0;
            if (size > MAX_LOCAL_FILE_SIZE) {
                Modal.alert("Error", `${asset.name}: max 50MB`);
                continue;
            }
            items.push({
                id: newId(),
                name: asset.name,
                size,
                stash: { uri: asset.uri },
            });
        }
        enqueueFiles(items);
    }, [enqueueFiles]);

    const isUploading = useMemo(
        () => selectedFiles.some((f) => f.status === "uploading" || f.status === "pending"),
        [selectedFiles],
    );

    return { selectedFiles, isUploading, pickFiles, removeFile, clearFiles };
}
