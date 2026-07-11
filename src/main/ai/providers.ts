// Pluggable vision providers (main process only — the renderer CSP blocks network
// calls). Hand-rolled over global fetch so we ship no heavy SDK; endpoint is
// override-able per the locked AI design. Both providers force a tool/function
// call against DNA_SCHEMA so the model returns structured DNA, not prose.

import { DNA_SCHEMA, SYSTEM_PROMPT, USER_PROMPT, TOOL_NAME } from './prompt'
import type { AiProviderId } from '../../shared/types'

export type ProviderId = AiProviderId
export interface VisionImage { data: string; mediaType: string } // data = raw base64 (no data: prefix)
export interface VisionConfig { provider: ProviderId; apiKey: string; model: string; endpoint?: string }

export const DEFAULT_ENDPOINT: Record<ProviderId, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1'
}
export const DEFAULT_MODEL: Record<ProviderId, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-5'
}
export const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic'
}

const TOOL_DESC = 'Describe the photographed cat as pixel-pet DNA.'
const base = (cfg: VisionConfig): string => (cfg.endpoint?.trim() || DEFAULT_ENDPOINT[cfg.provider]).replace(/\/$/, '')

/** Pull a human-readable message out of a provider error body. */
function errText(status: number, body: string): string {
  try {
    const j = JSON.parse(body)
    const m = j?.error?.message ?? j?.message ?? j?.error
    if (typeof m === 'string') return m
  } catch { /* not JSON */ }
  return body.slice(0, 300) || `HTTP ${status}`
}

// ---- OpenAI (Chat Completions + function calling) ---------------------------
async function openaiDescribe(images: VisionImage[], cfg: VisionConfig): Promise<unknown> {
  const res = await fetch(`${base(cfg)}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 700,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            { type: 'text', text: USER_PROMPT },
            ...images.map((im) => ({ type: 'image_url', image_url: { url: `data:${im.mediaType};base64,${im.data}` } }))
          ]
        }
      ],
      tools: [{ type: 'function', function: { name: TOOL_NAME, description: TOOL_DESC, parameters: DNA_SCHEMA } }],
      tool_choice: { type: 'function', function: { name: TOOL_NAME } }
    })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(errText(res.status, text))
  const j = JSON.parse(text)
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments
  if (typeof args !== 'string') throw new Error('OpenAI returned no structured description.')
  return JSON.parse(args)
}

async function openaiPing(cfg: VisionConfig): Promise<void> {
  const res = await fetch(`${base(cfg)}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
  })
  if (!res.ok) throw new Error(errText(res.status, await res.text()))
}

// ---- Anthropic (Messages + tool use) ----------------------------------------
async function anthropicDescribe(images: VisionImage[], cfg: VisionConfig): Promise<unknown> {
  const res = await fetch(`${base(cfg)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      tools: [{ name: TOOL_NAME, description: TOOL_DESC, input_schema: DNA_SCHEMA }],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.mediaType, data: im.data } })),
            { type: 'text', text: USER_PROMPT }
          ]
        }
      ]
    })
  })
  const text = await res.text()
  if (!res.ok) throw new Error(errText(res.status, text))
  const j = JSON.parse(text)
  const block = Array.isArray(j?.content) ? j.content.find((b: { type?: string }) => b?.type === 'tool_use') : null
  if (!block?.input) throw new Error('Anthropic returned no structured description.')
  return block.input
}

async function anthropicPing(cfg: VisionConfig): Promise<void> {
  const res = await fetch(`${base(cfg)}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: cfg.model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
  })
  if (!res.ok) throw new Error(errText(res.status, await res.text()))
}

// ---- dispatch ---------------------------------------------------------------
/** Call the configured provider's vision model; returns raw (unsanitized) DNA JSON. */
export function describeCat(images: VisionImage[], cfg: VisionConfig): Promise<unknown> {
  return cfg.provider === 'anthropic' ? anthropicDescribe(images, cfg) : openaiDescribe(images, cfg)
}

/** Cheap credentials/model check. Returns a friendly ok/failure result (never throws). */
export async function testConnection(cfg: VisionConfig): Promise<{ ok: boolean; message: string }> {
  try {
    if (cfg.provider === 'anthropic') await anthropicPing(cfg)
    else await openaiPing(cfg)
    return { ok: true, message: `Connected to ${PROVIDER_LABEL[cfg.provider]} (${cfg.model}).` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}
