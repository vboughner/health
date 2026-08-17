/**
 * The plan, turned into blocks a component can draw.
 *
 * A deliberately tiny subset: `## headings`, `- bullets`, and blank-line-separated
 * paragraphs. No bold, no links, no images. With nothing inline to parse this is a
 * line classifier and a grouping pass, and a block holds a string rather than a tree —
 * emphasis in a document one person reads to themselves is not worth doubling this
 * file and its tests to buy.
 *
 * Anything outside the subset comes out as the text it is, which is also why the
 * renderer can hand these to React as plain children: with no links or images in the
 * grammar there is nothing a plan could inject, and no reason to reach for
 * dangerouslySetInnerHTML.
 *
 * Never parsed for meaning. The budget you are measured against is the one in
 * Settings; writing a number in here does nothing.
 */

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'paragraph'; text: string };

const HEADING = /^##\s+(.+)$/;
const BULLET = /^-\s+(.+)$/;

export function renderPlan(md: string): Block[] {
  const blocks: Block[] = [];

  // Held open across lines so consecutive bullets become one list and wrapped prose
  // becomes one paragraph. A blank line, a heading, or a change of kind closes it.
  let bullets: string[] | null = null;
  let paragraph: string[] | null = null;

  const closeParagraph = () => {
    if (paragraph) blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
    paragraph = null;
  };

  const closeBullets = () => {
    if (bullets) blocks.push({ kind: 'bullets', items: bullets });
    bullets = null;
  };

  for (const raw of md.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();

    if (line === '') {
      closeBullets();
      closeParagraph();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      closeBullets();
      closeParagraph();
      blocks.push({ kind: 'heading', text: heading[1].trim() });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      closeParagraph();
      bullets = bullets ?? [];
      bullets.push(bullet[1].trim());
      continue;
    }

    closeBullets();
    paragraph = paragraph ?? [];
    paragraph.push(line);
  }

  closeBullets();
  closeParagraph();

  return blocks;
}
