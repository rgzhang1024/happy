/**
 * Self-host local plaintext file upload.
 * Returns a host-absolute path for the client to append into chat text as
 * [附件N:path]. Does NOT use the encrypted .enc attachment / file-event pipeline.
 */
import { AuthCredentials } from "@/auth/tokenStorage";
import { getServerUrl } from "./serverConfig";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export type LocalUploadResult = {
    path: string;
    name: string;
    size: number;
};

export async function uploadLocalFile(
    credentials: AuthCredentials,
    sessionId: string,
    file: { name: string; data: Uint8Array | ArrayBuffer | Blob },
): Promise<LocalUploadResult> {
    const API_ENDPOINT = getServerUrl();
    const filename = encodeURIComponent(file.name || "file.bin");
    const url = `${API_ENDPOINT}/v1/sessions/${sessionId}/local-uploads?filename=${filename}`;

    let body: BodyInit;
    let sizeHint = 0;
    if (file.data instanceof Blob) {
        body = file.data;
        sizeHint = file.data.size;
    } else if (file.data instanceof ArrayBuffer) {
        body = file.data;
        sizeHint = file.data.byteLength;
    } else {
        // Ensure a standalone ArrayBuffer of exact length (RN-safe).
        const standalone = new Uint8Array(file.data);
        body = standalone.buffer;
        sizeHint = standalone.byteLength;
    }

    if (sizeHint > MAX_FILE_SIZE) {
        throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${credentials.token}`,
                "Content-Type": "application/octet-stream",
            },
            body,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(message ? `Local upload network error: ${message}` : "Local upload network error");
    }

    if (!response.ok) {
        if (response.status === 413) {
            throw new Error(`File too large (max ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
        }
        if (response.status === 404) {
            throw new Error("Session not found");
        }
        if (response.status === 429) {
            throw new Error("Too many uploads. Try again in a minute.");
        }
        let detail = "";
        try {
            const json = await response.json() as { error?: string };
            detail = json.error ? `: ${json.error}` : "";
        } catch {
            // ignore
        }
        throw new Error(`Local upload failed: ${response.status}${detail}`);
    }

    return await response.json() as LocalUploadResult;
}
