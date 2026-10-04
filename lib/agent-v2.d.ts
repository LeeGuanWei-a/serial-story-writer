/** Proposal-based agent entry: its Workspace registry is a required Host dependency. */
import type { Context } from '@deepseek-ai/cordis';
import { ShortStoryConfig } from './agent.js';
import type { ShortStoryConfig as ShortStoryConfigType } from './agent.js';
/** Stable Cordis plugin name for the isolated proposal-based tool surface. */
export declare const name = "dsh-serial-story-agent-v2";
/** The proposal entry needs the Host-owned Workspace registry. */
export declare const inject: string[];
/** Runtime config schema for the proposal inbox bounds. */
export declare const Config: import("@deepseek-ai/schemastery").default<ShortStoryConfig>;
/** Register the proposal-based tools with the separately injected Workspace registry. */
export declare function apply(ctx: Context, config?: ShortStoryConfigType): void;
