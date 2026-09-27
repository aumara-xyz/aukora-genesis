import { describe, expect, it } from 'vitest';
import { shouldDisablePresenceReasoning } from '../../spatial/presenceLane';

describe('presence lane model-specific reasoning controls', () => {
  it('disables hidden reasoning only for DeepSeek V4 Flash live voice', () => {
    expect(shouldDisablePresenceReasoning('deepseek/deepseek-v4-flash')).toBe(true);
    expect(shouldDisablePresenceReasoning('anthropic/claude-fable-5')).toBe(false);
    expect(shouldDisablePresenceReasoning('meta-llama/llama-3.3-70b-instruct')).toBe(false);
  });
});
