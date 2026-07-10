import { trimIdent } from "@/utils/trimIdent";

/**
 * Formerly injected Options / Plan-mode XML chip instructions into Codex/Claude
 * via message meta.appendSystemPrompt. Disabled: polluted agent context and
 * competed with the model's own UX. change_title is a separate CLI injection
 * (CHANGE_TITLE_INSTRUCTION) and is unaffected.
 *
 * Keep the export so sync.ts wiring stays stable; empty string is treated as
 * "no append" by the CLI (Boolean("") === false).
 */
export const systemPrompt = trimIdent(`
`);
