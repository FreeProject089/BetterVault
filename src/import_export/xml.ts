/**
 * Parseur XML minimal et sans dépendance (fonctionne dans le navigateur, Tauri et Node/Vitest).
 * Suffisant pour les documents KeePass et les fichiers clé : éléments, attributs,
 * texte, entités, CDATA ; les commentaires, PI et DOCTYPE sont ignorés.
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity[0] === '#') {
      const codePoint = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[entity] ?? match;
  });
}

export function encodeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null;
  for (let i = from; i < xml.length; i++) {
    const ch = xml[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
  }
  return -1;
}

function skipPast(xml: string, from: number, terminator: string): number {
  const end = xml.indexOf(terminator, from);
  if (end === -1) throw new Error('XML malformé : section non terminée');
  return end + terminator.length;
}

export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;

  while (i < xml.length) {
    const top = stack[stack.length - 1];
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      top.text += decodeXmlEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeXmlEntities(xml.slice(i, lt));

    if (xml.startsWith('<!--', lt)) { i = skipPast(xml, lt + 4, '-->'); continue; }
    if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end === -1) throw new Error('XML malformé : CDATA non terminé');
      top.text += xml.slice(lt + 9, end);
      i = end + 3;
      continue;
    }
    if (xml.startsWith('<?', lt)) { i = skipPast(xml, lt + 2, '?>'); continue; }
    if (xml.startsWith('<!', lt)) { i = skipPast(xml, lt + 2, '>'); continue; }

    const gt = findTagEnd(xml, lt + 1);
    if (gt === -1) throw new Error('XML malformé : balise non terminée');
    const raw = xml.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      if (stack.length > 1 && top.name === name) {
        stack.pop();
        continue;
      }
      throw new Error(`XML malformé : balise fermante inattendue </${name}>`);
    }

    const selfClosing = raw.endsWith('/');
    const body = selfClosing ? raw.slice(0, -1) : raw;
    const nameMatch = /^([^\s/>]+)/.exec(body);
    if (!nameMatch) throw new Error('XML malformé : nom de balise manquant');

    const node: XmlNode = { name: nameMatch[1], attrs: {}, children: [], text: '' };
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attr: RegExpExecArray | null;
    const attrSource = body.slice(nameMatch[1].length);
    while ((attr = attrRe.exec(attrSource)) !== null) {
      node.attrs[attr[1]] = decodeXmlEntities(attr[2] ?? attr[3] ?? '');
    }

    top.children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length !== 1) throw new Error(`XML incomplet : <${stack[stack.length - 1].name}> non fermée`);
  return root;
}

export function child(node: XmlNode | undefined, name: string): XmlNode | undefined {
  return node?.children.find(c => c.name === name);
}

export function children(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter(c => c.name === name) : [];
}

export function nodeText(node: XmlNode | undefined): string {
  return node ? node.text.trim() : '';
}
