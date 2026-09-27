// The [field …] directive filter — streaming edge cases (spatial/app/field-directives.js).
// One grammar module shared by the door (presenceLane SSE pump) and the browser
// organs; these pins guarantee tags are applied exactly once and NEVER spoken,
// while her actual words are never swallowed by a malformed tag.
import { describe, expect, it } from 'vitest';
import { makeDirectiveFilter, FIELD_HUES, FIELD_FORMS } from '../../spatial/app/field-directives.js';

function run(chunks: string[]) {
  const tags: string[] = [];
  const f = makeDirectiveFilter((t: string) => tags.push(t));
  let out = '';
  for (const c of chunks) out += f.push(c);
  out += f.flush();
  return { out, tags };
}

describe('field directive filter — streaming tag extraction', () => {
  it('applies a tag split across many tiny tokens (the real SSE shape)', () => {
    const { out, tags } = run(['I', "'m", ' unfolding', ' [', 'field', ' hue', '=', 'te', 'al', ' energy', '=', '0', '.', '4', ' form', '=', 'aur', 'ora', '],', ' nice']);
    expect(out).toBe("I'm unfolding , nice");
    expect(tags).toEqual(['[field hue=teal energy=0.4 form=aurora]']);
  });

  it('applies an inline tag and passes ordinary brackets through', () => {
    expect(run(['before [field burst] after'])).toEqual({ out: 'before  after', tags: ['[field burst]'] });
    expect(run(['see [the map] here']).out).toBe('see [the map] here');
  });

  it('never swallows prose that merely starts like a tag', () => {
    expect(run(['walking through [fields of gold] tonight']).out).toBe('walking through [fields of gold] tonight');
    expect(run(['the [fielder] caught it']).out).toBe('the [fielder] caught it');
    expect(run(['[a[field burst] x'])).toEqual({ out: '[a x', tags: ['[field burst]'] });
  });

  it('drops a short truncated tag at end-of-turn silently (never read aloud)', () => {
    expect(run(['so calm [field hue=violet ener'])).toEqual({ out: 'so calm ', tags: [] });
    expect(run(['left hanging ['])).toEqual({ out: 'left hanging ', tags: [] });
  });

  it('degrades a malformed overlong tag to text — her words are never lost', () => {
    const { out, tags } = run([
      'so [field hue=violet energy',
      ' I love that idea, we should absolutely build the whole thing tonight and tomorrow too',
    ]);
    expect(tags).toEqual([]);
    expect(out).toContain('build the whole thing tonight');
  });

  it('holds a whitespace-padded tag split mid-word (captured verbatim)', () => {
    expect(run(['ok [ fi', 'eld burst] done'])).toEqual({ out: 'ok  done', tags: ['[ field burst]'] });
  });

  it('handles multiple tags, uppercase, and double flush inertness', () => {
    expect(run(['a [field calm] b [field hue=rose] c'])).toEqual({ out: 'a  b  c', tags: ['[field calm]', '[field hue=rose]'] });
    expect(run(['x [FIELD BURST] y']).tags).toEqual(['[FIELD BURST]']);
    const f = makeDirectiveFilter(() => {});
    expect(f.push('hello [field ca')).toBe('hello ');
    expect(f.flush()).toBe('');
    expect(f.flush()).toBe('');
  });

  it('exports the vocabulary both prompt and parser derive from', () => {
    expect(FIELD_HUES.violet).toBe(280);
    expect(FIELD_FORMS.aurora).toBe(0);
    expect(Object.keys(FIELD_FORMS)).toContain('vortex');
  });
});
