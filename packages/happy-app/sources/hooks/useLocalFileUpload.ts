/**
 * Pick arbitrary files and upload them to the self-host local-upload API.
 * Successful uploads expose host-absolute paths for chat text markers.
 */
import { useCallback, useRef, useState } from "react";
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { Modal } from "@/modal";
import { sync } from "@/sync/sync";
import { uploadLocalFile } from "@/sync/apiLocalUpload";

export const MAX_LOCAL_FILES_PER_MESSAGE = 10;
export const MAX_LOCAL_FILE_SIZE = 10 * 1024 * 1024;

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
    pickFiles: () => Promise<void>;
    removeFile: (id: string) => void;
    clearFiles: () => void;
    /** Upload any still-pending files; returns the final list (may include errors). */
    ensureUploaded: (sessionId: string) => Promise<LocalFilePreview[]>;
};

function newId(): string {
    return `local_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function readUriBytes(uri: string): Promise<Uint8Array> {
    const res = await fetch(uri);
    if (!res.ok) {
        throw new Error(`Failed to read file (${res.status})`);
    }
    return new Uint8Array(await res.arrayBuffer());
}

export function useLocalFileUpload(): UseLocalFileUploadResult {
    const [selectedFiles, setSelectedFiles] = useState<LocalFilePreview[]>([]);
    const filesRef = useRef(selectedFiles);
    filesRef.current = selectedFiles;
    const stashRef = useRef(new Map<string, Stash>());

    const removeFile = useCallback((id: string) => {
        stashRef.current.delete(id);
        setSelectedFiles((prev) => prev.filter((f) => f.id !== id));
    }, []);

    const clearFiles = useCallback(() => {
        stashRef.current.clear();
        setSelectedFiles([]);
    }, []);

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
                    const next: LocalFilePreview[] = [];
                    for (const file of list) {
                        if (file.size > MAX_LOCAL_FILE_SIZE) {
                            Modal.alert("Error", `${file.name}: max 10MB`);
                            continue;
                        }
                        const id = newId();
                        stashRef.current.set(id, { blob: file });
                        next.push({
                            id,
                            name: file.name,
                            size: file.size,
                            status: "pending",
                        });
                    }
                    if (next.length) {
                        setSelectedFiles((prev) => [...prev, ...next]);
                    }
                    cleanup();
                };
                // Some browsers fire cancel; also fall back if focus returns with no change.
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

        const next: LocalFilePreview[] = [];
        for (const asset of result.assets.slice(0, remaining)) {
            const size = asset.size ?? 0;
            if (size > MAX_LOCAL_FILE_SIZE) {
                Modal.alert("Error", `${asset.name}: max 10MB`);
                continue;
            }
            const id = newId();
            stashRef.current.set(id, { uri: asset.uri });
            next.push({
                id,
                name: asset.name,
                size,
                status: "pending",
            });
        }
        if (next.length) {
            setSelectedFiles((prev) => [...prev, ...next]);
        }
    }, []);

    const ensureUploaded = useCallback(async (sessionId: string) => {
        const credentials = sync.getCredentials();
        if (!credentials) {
            throw new Error("Not authenticated");
        }

        const current = filesRef.current;
        const updated = [...current];

        for (let i = 0; i < updated.length; i++) {
            const item = updated[i];
            if (item.status === "ready" && item.path) continue;

            updated[i] = { ...item, status: "uploading", error: undefined };
            setSelectedFiles([...updated]);

            try {
                const stash = stashRef.current.get(item.id);
                let data: Uint8Array | Blob;
                if (stash?.blob) {
                    data = stash.blob;
                } else if (stash?.uri) {
                    data = await readUriBytes(stash.uri);
                } else if (item.path) {
                    // already uploaded in a previous pass
                    continue;
                } else {
                    throw new Error("Missing file data");
                }

                const result = await uploadLocalFile(credentials, sessionId, {
                    name: item.name,
                    data,
                });
                updated[i] = {
                    id: item.id,
                    name: result.name || item.name,
                    size: result.size,
                    status: "ready",
                    path: result.path,
                };
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                updated[i] = {
                    id: item.id,
                    name: item.name,
                    size: item.size,
                    status: "error",
                    error: message,
                };
            }
            setSelectedFiles([...updated]);
        }

        return updated;
    }, []);

    return { selectedFiles, pickFiles, removeFile, clearFiles, ensureUploaded };
}
