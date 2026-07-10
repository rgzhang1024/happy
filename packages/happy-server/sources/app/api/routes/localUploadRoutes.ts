/**
 * Local plaintext file uploads for self-host: drop files under a host-visible
 * directory and return the absolute path so Codex/Claude can Read/Shell it.
 *
 * Intentionally separate from attachmentRoutes (.enc / vision pipeline).
 */
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { Fastify } from "../types";
import { db } from "@/storage/db";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const UPLOAD_RATE_WINDOW_MS = 60_000;
const UPLOAD_RATE_MAX = 60;
const MAX_SAFE_NAME_LEN = 128;

const uploadRateState = new Map<string, { count: number; windowStart: number }>();

function checkUploadRate(userId: string): boolean {
    const now = Date.now();
    const entry = uploadRateState.get(userId);
    if (!entry || now - entry.windowStart >= UPLOAD_RATE_WINDOW_MS) {
        uploadRateState.set(userId, { count: 1, windowStart: now });
        if (uploadRateState.size > 10_000) {
            for (const [k, v] of uploadRateState) {
                if (now - v.windowStart >= UPLOAD_RATE_WINDOW_MS) {
                    uploadRateState.delete(k);
                }
            }
        }
        return true;
    }
    if (entry.count >= UPLOAD_RATE_MAX) return false;
    entry.count++;
    return true;
}

function getUploadRoot(): string {
    const root = process.env.LOCAL_UPLOAD_DIR?.trim();
    if (!root) {
        throw new Error("LOCAL_UPLOAD_DIR is not configured");
    }
    return path.resolve(root);
}

function sanitizeFilename(raw: string | undefined): string {
    const base = path.basename((raw ?? "").trim() || "file.bin");
    // Strip path separators / control chars / leading dots.
    let cleaned = base
        .replace(/[\/\\]/g, "_")
        .replace(/[\x00-\x1f\x7f]/g, "")
        .replace(/^\.+/, "");
    if (!cleaned || cleaned === "." || cleaned === "..") {
        cleaned = "file.bin";
    }
    if (cleaned.length > MAX_SAFE_NAME_LEN) {
        const ext = path.extname(cleaned).slice(0, 32);
        const stem = path.basename(cleaned, path.extname(cleaned)).slice(0, MAX_SAFE_NAME_LEN - ext.length);
        cleaned = `${stem}${ext}` || "file.bin";
    }
    return cleaned;
}

function timestampPrefix(d = new Date()): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
        `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}

export function localUploadRoutes(app: Fastify) {
    /**
     * Upload a plaintext file into LOCAL_UPLOAD_DIR/<sessionId>/...
     * Body: application/octet-stream
     * Query: filename=<urlencoded original name>
     */
    app.post("/v1/sessions/:sessionId/local-uploads", {
        schema: {
            params: z.object({
                sessionId: z.string(),
            }),
            querystring: z.object({
                filename: z.string().optional(),
            }),
            response: {
                200: z.object({
                    path: z.string(),
                    name: z.string(),
                    size: z.number(),
                }),
                400: z.object({ error: z.string() }),
                404: z.object({ error: z.string() }),
                413: z.object({ error: z.string() }),
                429: z.object({ error: z.string() }),
                500: z.object({ error: z.string() }),
            },
        },
        preHandler: app.authenticate,
    }, async (request, reply) => {
        const { sessionId } = request.params;
        const userId = request.userId;

        if (!checkUploadRate(userId)) {
            return reply.code(429).send({ error: "Too many upload requests. Try again in a minute." });
        }

        const session = await db.session.findFirst({
            where: { id: sessionId, accountId: userId },
        });
        if (!session) {
            return reply.code(404).send({ error: "Session not found" });
        }

        // sessionId itself must be a single path segment (UUID-like).
        if (!sessionId || sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
            return reply.code(400).send({ error: "Invalid session id" });
        }

        let uploadRoot: string;
        try {
            uploadRoot = getUploadRoot();
        } catch {
            return reply.code(500).send({ error: "Local upload is not configured" });
        }

        const body = request.body as Buffer | undefined;
        if (!body || !Buffer.isBuffer(body)) {
            return reply.code(400).send({ error: "Expected application/octet-stream body" });
        }
        if (body.length === 0) {
            return reply.code(400).send({ error: "Empty file" });
        }
        if (body.length > MAX_FILE_SIZE) {
            return reply.code(413).send({ error: "File too large (max 50MB)" });
        }

        const safeName = sanitizeFilename(request.query.filename);
        const rand = crypto.randomBytes(2).toString("hex");
        const storedName = `${timestampPrefix()}-${rand}-${safeName}`;
        const sessionDir = path.join(uploadRoot, sessionId);
        const fullPath = path.resolve(sessionDir, storedName);

        // Whitelist: must stay under upload root.
        const rootWithSep = uploadRoot.endsWith(path.sep) ? uploadRoot : uploadRoot + path.sep;
        if (!fullPath.startsWith(rootWithSep) || fullPath === uploadRoot) {
            return reply.code(400).send({ error: "Invalid upload path" });
        }

        fs.mkdirSync(sessionDir, { recursive: true, mode: 0o755 });
        // Ensure directory is traversable/readable by host ubuntu even if umask interfered.
        try {
            fs.chmodSync(sessionDir, 0o755);
            if (fs.existsSync(uploadRoot)) fs.chmodSync(uploadRoot, 0o755);
        } catch {
            // best-effort
        }

        fs.writeFileSync(fullPath, body);
        fs.chmodSync(fullPath, 0o644);

        return reply.send({
            path: fullPath,
            name: safeName,
            size: body.length,
        });
    });
}
