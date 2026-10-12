import JSZip from 'jszip';

function escapeXml(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function cssColor(value) {
  const raw = String(value || '').trim();
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let body = hex[1];
    if (body.length === 3) body = body.split('').map(ch => ch + ch).join('');
    return body.toUpperCase();
  }
  const rgb = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (!rgb) return '';
  return [rgb[1], rgb[2], rgb[3]].map(part => {
    const n = Math.max(0, Math.min(255, parseInt(part, 10)));
    return n.toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

function halfPoints(size) {
  const match = String(size || '').trim().match(/^(\d+(?:\.\d+)?)(pt|px)$/i);
  if (!match) return '';
  const n = parseFloat(match[1]);
  const pt = match[2].toLowerCase() === 'px' ? n * 0.75 : n;
  return String(Math.round(pt * 2));
}

function lineTwips(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  return String(Math.round(n * 240));
}

function readStyle(element) {
  const style = element.style || {};
  return {
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    subscript: false,
    superscript: false,
    color: cssColor(style.color),
    highlight: cssColor(style.backgroundColor),
    fontFamily: (style.fontFamily || '').replace(/["']/g, '').split(',')[0].trim(),
    fontSize: halfPoints(style.fontSize),
  };
}

function marksFromElement(element, marks) {
  const next = { ...marks };
  const tag = element.tagName;
  if (tag === 'STRONG' || tag === 'B') next.bold = true;
  if (tag === 'EM' || tag === 'I') next.italic = true;
  if (tag === 'U') next.underline = true;
  if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') next.strike = true;
  if (tag === 'SUB') next.subscript = true;
  if (tag === 'SUP') next.superscript = true;
  if (tag === 'MARK') next.highlight = next.highlight || cssColor(element.getAttribute('data-color')) || cssColor(element.style.backgroundColor) || 'FEF08A';
  if (tag === 'A') {
    const href = element.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) next.href = href;
  }
  const style = readStyle(element);
  if (style.color && style.color !== 'INHERIT') next.color = style.color;
  if (style.highlight) next.highlight = style.highlight;
  if (style.fontFamily) next.fontFamily = style.fontFamily;
  if (style.fontSize) next.fontSize = style.fontSize;
  return next;
}

function runProperties(marks) {
  const parts = [];
  if (marks.bold) parts.push('<w:b/>');
  if (marks.italic) parts.push('<w:i/>');
  if (marks.underline) parts.push('<w:u w:val="single"/>');
  if (marks.strike) parts.push('<w:strike/>');
  if (marks.subscript) parts.push('<w:vertAlign w:val="subscript"/>');
  if (marks.superscript) parts.push('<w:vertAlign w:val="superscript"/>');
  if (marks.color) parts.push('<w:color w:val="' + marks.color + '"/>');
  if (marks.highlight) parts.push('<w:shd w:val="clear" w:color="auto" w:fill="' + marks.highlight + '"/>');
  if (marks.fontFamily) {
    const font = escapeXml(marks.fontFamily);
    parts.push('<w:rFonts w:ascii="' + font + '" w:hAnsi="' + font + '"/>');
  }
  if (marks.fontSize) parts.push('<w:sz w:val="' + marks.fontSize + '"/><w:szCs w:val="' + marks.fontSize + '"/>');
  if (!parts.length) return '';
  return '<w:rPr>' + parts.join('') + '</w:rPr>';
}

function paragraphProperties(element, listInfo) {
  const parts = [];
  const tag = element.tagName;
  if (tag === 'H1') parts.push('<w:pStyle w:val="Heading1"/>');
  if (tag === 'H2') parts.push('<w:pStyle w:val="Heading2"/>');
  if (tag === 'H3') parts.push('<w:pStyle w:val="Heading3"/>');
  if (tag === 'H4') parts.push('<w:pStyle w:val="Heading4"/>');
  const align = (element.style.textAlign || '').toLowerCase();
  if (align === 'center' || align === 'right') parts.push('<w:jc w:val="' + align + '"/>');
  if (align === 'justify') parts.push('<w:jc w:val="both"/>');
  const line = lineTwips(element.getAttribute('data-line-height'));
  if (line) parts.push('<w:spacing w:line="' + line + '" w:lineRule="auto"/>');
  const indent = parseInt(element.getAttribute('data-indent') || '0', 10) || 0;
  const left = (listInfo ? 720 + listInfo.level * 360 : 0) + indent * 360;
  if (left) parts.push('<w:ind w:left="' + left + '"' + (listInfo ? ' w:hanging="360"' : '') + '/>');
  if (listInfo && listInfo.numId && !listInfo.checklist) {
    parts.push('<w:numPr><w:ilvl w:val="' + listInfo.level + '"/><w:numId w:val="' + listInfo.numId + '"/></w:numPr>');
  }
  if (!parts.length) return '';
  return '<w:pPr>' + parts.join('') + '</w:pPr>';
}

function collectRuns(node, marks, runs) {
  if (node.nodeType === 3) {
    const text = node.nodeValue || '';
    if (text) runs.push({ text, marks });
    return;
  }
  if (node.nodeType !== 1) return;
  const tag = node.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'INPUT' || tag === 'LABEL') return;
  if (tag === 'BR') {
    runs.push({ break: true, marks });
    return;
  }
  if (tag === 'IMG') {
    runs.push({ image: node.getAttribute('data-path') || '', marks });
    return;
  }
  const next = marksFromElement(node, marks);
  Array.from(node.childNodes).forEach(child => collectRuns(child, next, runs));
}

function imageSize(bytes, type) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let width = 480;
  let height = 320;
  if (type.includes('png') && view.length > 24) {
    width = (view[16] << 24) | (view[17] << 16) | (view[18] << 8) | view[19];
    height = (view[20] << 24) | (view[21] << 16) | (view[22] << 8) | view[23];
  } else if (type.includes('gif') && view.length > 10) {
    width = view[6] | (view[7] << 8);
    height = view[8] | (view[9] << 8);
  }
  width = Math.max(1, Math.min(width, 1200));
  height = Math.max(1, Math.min(height, 1600));
  const max = 540;
  if (width > max) {
    height = Math.round(height * (max / width));
    width = max;
  }
  const emu = px => Math.round(px * 9525);
  return { cx: emu(width), cy: emu(height) };
}

function drawingXml(relId, name, size) {
  return '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="' + size.cx + '" cy="' + size.cy + '"/>' +
    '<wp:effectExtent l="0" t="0" r="0" b="0"/>' +
    '<wp:docPr id="' + relId.replace(/\D/g, '') + '" name="' + escapeXml(name) + '"/>' +
    '<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>' +
    '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<pic:pic><pic:nvPicPr><pic:cNvPr id="' + relId.replace(/\D/g, '') + '" name="' + escapeXml(name) + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="' + relId + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + size.cx + '" cy="' + size.cy + '"/></a:xfrm>' +
    '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
    '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>';
}

async function runsToXml(runs, ctx) {
  let xml = '';
  let linkOpen = '';
  function closeLink() {
    if (!linkOpen) return;
    xml += '</w:hyperlink>';
    linkOpen = '';
  }
  for (const run of runs) {
    const href = run.marks.href || '';
    if (href !== linkOpen) {
      closeLink();
      if (href) {
        const id = ctx.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', href, true);
        xml += '<w:hyperlink r:id="' + id + '">';
        linkOpen = href;
      }
    }
    if (run.break) {
      xml += '<w:r>' + runProperties(run.marks) + '<w:br/></w:r>';
      continue;
    }
    if (run.image) {
      const image = await ctx.image(run.image);
      if (!image) {
        xml += '<w:r>' + runProperties(run.marks) + '<w:t xml:space="preserve">[Image]</w:t></w:r>';
      } else {
        xml += drawingXml(image.id, image.name, image.size);
      }
      continue;
    }
    xml += '<w:r>' + runProperties(run.marks) + '<w:t xml:space="preserve">' + escapeXml(run.text) + '</w:t></w:r>';
  }
  closeLink();
  return xml;
}

function isList(node) {
  return node && node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL');
}

async function renderParagraph(element, ctx, listInfo, prefix) {
  const runs = [];
  if (prefix) runs.push({ text: prefix, marks: {} });
  Array.from(element.childNodes).forEach(child => collectRuns(child, {}, runs));
  const body = await runsToXml(runs, ctx);
  return '<w:p>' + paragraphProperties(element, listInfo) + body + '</w:p>';
}

async function renderList(list, ctx, level) {
  const checklist = list.getAttribute('data-type') === 'taskList';
  const numId = checklist ? null : ctx.numbering(list.tagName === 'OL' ? 'number' : 'bullet');
  let xml = '';
  for (const item of Array.from(list.children)) {
    if (item.tagName !== 'LI') continue;
    const checked = item.getAttribute('data-checked') === 'true';
    const prefix = checklist ? (checked ? '☑ ' : '☐ ') : '';
    let used = false;
    for (const child of Array.from(item.childNodes)) {
      if (isList(child)) {
        xml += await renderList(child, ctx, Math.min(8, level + 1));
        continue;
      }
      if (child.nodeType !== 1) continue;
      if (child.tagName === 'LABEL' || child.tagName === 'INPUT') continue;
      if (child.tagName === 'P' || /^H[1-4]$/.test(child.tagName)) {
        xml += await renderParagraph(child, ctx, { numId, level, checklist }, used ? '' : prefix);
        used = true;
        continue;
      }
      if (child.tagName === 'DIV') {
        xml += await renderBlocks(child, ctx, { numId, level, checklist, prefix: used ? '' : prefix });
        used = true;
      }
    }
    if (!used) xml += '<w:p>' + paragraphProperties(list, { numId, level, checklist }) + '<w:r><w:t>' + escapeXml(prefix || '') + '</w:t></w:r></w:p>';
  }
  return xml;
}

async function renderTable(table, ctx) {
  let rows = '';
  const rowNodes = table.querySelectorAll(':scope > thead > tr, :scope > tbody > tr, :scope > tr');
  for (const row of Array.from(rowNodes)) {
    let cells = '';
    for (const cell of Array.from(row.children)) {
      if (cell.tagName !== 'TD' && cell.tagName !== 'TH') continue;
      const span = parseInt(cell.getAttribute('colspan') || '1', 10) || 1;
      const fill = cell.tagName === 'TH' ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E5E4"/>' : '';
      const grid = span > 1 ? '<w:gridSpan w:val="' + span + '"/>' : '';
      let inner = '';
      const blocks = Array.from(cell.childNodes).filter(node => node.nodeType === 1);
      if (!blocks.length) inner = '<w:p/>';
      else inner = await renderBlocks(cell, ctx, null);
      cells += '<w:tc><w:tcPr>' + grid + fill + '</w:tcPr>' + (inner || '<w:p/>') + '</w:tc>';
    }
    rows += '<w:tr>' + cells + '</w:tr>';
  }
  return '<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>' +
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(edge => '<w:' + edge + ' w:val="single" w:sz="4" w:space="0" w:color="D6D3D1"/>').join('') +
    '</w:tblBorders></w:tblPr>' + rows + '</w:tbl>';
}

async function renderBlocks(parent, ctx, carried) {
  let xml = '';
  let prefix = carried && carried.prefix ? carried.prefix : '';
  for (const child of Array.from(parent.childNodes)) {
    if (child.nodeType !== 1) continue;
    const tag = child.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LABEL' || tag === 'INPUT') continue;
    if (tag === 'UL' || tag === 'OL') {
      xml += await renderList(child, ctx, 0);
      continue;
    }
    if (tag === 'TABLE') {
      xml += await renderTable(child, ctx);
      continue;
    }
    if (tag === 'HR') {
      xml += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A8A29E"/></w:pBdr></w:pPr></w:p>';
      continue;
    }
    if (tag === 'DIV' && child.hasAttribute('data-page-break')) {
      xml += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      continue;
    }
    if (tag === 'P' || /^H[1-4]$/.test(tag)) {
      xml += await renderParagraph(child, ctx, carried && carried.numId ? carried : null, prefix);
      prefix = '';
      continue;
    }
    if (tag === 'IMG') {
      const runs = [{ image: child.getAttribute('data-path') || '', marks: {} }];
      xml += '<w:p>' + await runsToXml(runs, ctx) + '</w:p>';
      continue;
    }
    if (tag === 'DIV' || tag === 'LI') xml += await renderBlocks(child, ctx, carried);
  }
  return xml;
}

function numberingXml(nums) {
  const levels = n => {
    let xml = '';
    for (let i = 0; i < 9; i += 1) {
      const bullet = n === 'bullet';
      xml += '<w:lvl w:ilvl="' + i + '"><w:start w:val="1"/><w:numFmt w:val="' + (bullet ? 'bullet' : 'decimal') + '"/>' +
        '<w:lvlText w:val="' + (bullet ? '•' : '%' + (i + 1) + '.') + '"/><w:lvlJc w:val="left"/>' +
        '<w:pPr><w:ind w:left="' + (720 + i * 360) + '" w:hanging="360"/></w:pPr></w:lvl>';
    }
    return xml;
  };
  let body = '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' + levels('bullet') + '</w:abstractNum>';
  body += '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' + levels('number') + '</w:abstractNum>';
  nums.forEach(item => {
    body += '<w:num w:numId="' + item.id + '"><w:abstractNumId w:val="' + (item.kind === 'number' ? '1' : '0') + '"/></w:num>';
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' + body + '</w:numbering>';
}

function stylesXml() {
  const heading = (id, size) => '<w:style w:type="paragraph" w:styleId="' + id + '"><w:name w:val="' + id + '"/><w:basedOn w:val="Normal"/>' +
    '<w:qFormat/><w:rPr><w:b/><w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/></w:rPr></w:style>';
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>' +
    heading('Heading1', '56') + heading('Heading2', '44') + heading('Heading3', '36') + heading('Heading4', '28') +
    '</w:styles>';
}

export async function htmlToDocxBlob(html, options = {}) {
  const win = options.window || (typeof window !== 'undefined' ? window : null);
  if (!win || !win.DOMParser) throw new Error('A DOM parser is required to build a Word document');
  const title = String(options.title || 'Document').slice(0, 200);
  const doc = new win.DOMParser().parseFromString('<div id="root">' + String(html || '') + '</div>', 'text/html');
  const root = doc.getElementById('root') || doc.body;
  const rels = [];
  const media = [];
  const nums = [];
  let relSeq = 3;
  let numSeq = 1;
  const ctx = {
    rel(type, target, external) {
      relSeq += 1;
      const id = 'rId' + relSeq;
      rels.push({ id, type, target, external: !!external });
      return id;
    },
    numbering(kind) {
      numSeq += 1;
      nums.push({ id: numSeq, kind });
      return numSeq;
    },
    async image(path) {
      if (!options.resolveImage || !path) return null;
      const file = await options.resolveImage(path);
      if (!file || !file.data) return null;
      const type = String(file.type || 'image/png');
      const ext = type.includes('jpeg') || type.includes('jpg') ? 'jpg' : type.includes('gif') ? 'gif' : type.includes('webp') ? 'webp' : 'png';
      const name = 'image' + (media.length + 1) + '.' + ext;
      const id = ctx.rel('http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', 'media/' + name, false);
      media.push({ name, data: file.data, type });
      return { id, name, size: imageSize(file.data, type) };
    },
  };
  const body = await renderBlocks(root, ctx, null);
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
    '<w:body>' + (body || '<w:p/>') +
    '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';
  const contentTypes = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Default Extension="png" ContentType="image/png"/>',
    '<Default Extension="jpg" ContentType="image/jpeg"/>',
    '<Default Extension="jpeg" ContentType="image/jpeg"/>',
    '<Default Extension="gif" ContentType="image/gif"/>',
    '<Default Extension="webp" ContentType="image/webp"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '</Types>'].join('');
  const relXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    rels.map(rel => '<Relationship Id="' + rel.id + '" Type="' + rel.type + '" Target="' + escapeXml(rel.target) + '"' +
      (rel.external ? ' TargetMode="External"' : '') + '/>').join('') +
    '</Relationships>';
  const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    '<dc:title>' + escapeXml(title) + '</dc:title></cp:coreProperties>';
  const zip = new JSZip();
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rootRels);
  zip.folder('docProps').file('core.xml', core);
  const word = zip.folder('word');
  word.file('document.xml', documentXml);
  word.file('styles.xml', stylesXml());
  word.file('numbering.xml', numberingXml(nums));
  word.folder('_rels').file('document.xml.rels', relXml);
  media.forEach(file => word.folder('media').file(file.name, file.data));
  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
