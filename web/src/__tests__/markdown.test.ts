import { describe, it, expect } from 'vitest';
import { renderPlan } from '../markdown';

describe('renderPlan', () => {
  it('is empty for an empty plan', () => {
    expect(renderPlan('')).toEqual([]);
    expect(renderPlan('   \n\n  ')).toEqual([]);
  });

  it('reads a heading', () => {
    expect(renderPlan('## Calories')).toEqual([{ kind: 'heading', text: 'Calories' }]);
  });

  it('groups consecutive bullets into one list', () => {
    expect(renderPlan('- one\n- two\n- three')).toEqual([
      { kind: 'bullets', items: ['one', 'two', 'three'] },
    ]);
  });

  it('starts a new list after a heading', () => {
    expect(renderPlan('- a\n\n## Next\n\n- b')).toEqual([
      { kind: 'bullets', items: ['a'] },
      { kind: 'heading', text: 'Next' },
      { kind: 'bullets', items: ['b'] },
    ]);
  });

  it('joins wrapped lines into one paragraph', () => {
    expect(renderPlan('one line\nand its continuation')).toEqual([
      { kind: 'paragraph', text: 'one line and its continuation' },
    ]);
  });

  it('splits paragraphs on a blank line', () => {
    expect(renderPlan('first\n\nsecond')).toEqual([
      { kind: 'paragraph', text: 'first' },
      { kind: 'paragraph', text: 'second' },
    ]);
  });

  it('leaves unsupported syntax as the text it is', () => {
    // The subset is deliberately three things. Anything else is a plan someone wrote,
    // not a directive, and showing it verbatim is more honest than half-honouring it.
    expect(renderPlan('**bold** and [a link](http://x)')).toEqual([
      { kind: 'paragraph', text: '**bold** and [a link](http://x)' },
    ]);
    expect(renderPlan('# One hash')).toEqual([{ kind: 'paragraph', text: '# One hash' }]);
    expect(renderPlan('* star bullet')).toEqual([{ kind: 'paragraph', text: '* star bullet' }]);
  });

  it('does not treat a bare dash or hashes as an empty item', () => {
    expect(renderPlan('-')).toEqual([{ kind: 'paragraph', text: '-' }]);
    expect(renderPlan('##')).toEqual([{ kind: 'paragraph', text: '##' }]);
  });

  it('tolerates carriage returns and trailing space', () => {
    expect(renderPlan('## Calories  \r\n- one  \r\n')).toEqual([
      { kind: 'heading', text: 'Calories' },
      { kind: 'bullets', items: ['one'] },
    ]);
  });

  it('handles the whole shape of a real plan', () => {
    const md = ['## Calories', '', '- About 2400 a day.', '- Burn about 960.', '', 'Roughly.'].join(
      '\n',
    );

    expect(renderPlan(md)).toEqual([
      { kind: 'heading', text: 'Calories' },
      { kind: 'bullets', items: ['About 2400 a day.', 'Burn about 960.'] },
      { kind: 'paragraph', text: 'Roughly.' },
    ]);
  });
});
