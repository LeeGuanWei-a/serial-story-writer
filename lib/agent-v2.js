import { applyV2, ShortStoryConfig } from './agent.js';
/** Stable Cordis plugin name for the isolated proposal-based tool surface. */
export const name = 'dsh-serial-story-agent-v2';
/** The proposal entry needs the Host-owned Workspace registry. */
export const inject = ['agents', 'systemPrompt', 'tools', 'workspaceRegistry'];
/** Runtime config schema for the proposal inbox bounds. */
export const Config = ShortStoryConfig;
/** Register the proposal-based tools with the separately injected Workspace registry. */
export function apply(ctx, config = {}) {
    applyV2(ctx, config);
}
