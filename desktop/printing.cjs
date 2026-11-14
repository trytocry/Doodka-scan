function printHTML(data) {
  const { size, bits, moduleDots, offset, copies, labelWidth = data.labelSize ?? 20, labelHeight = data.labelSize ?? 20, offsetY = offset } = data;
  if (![labelWidth, labelHeight].every(v => Number.isInteger(v) && v >= 20 && v <= 100) || !Number.isInteger(size) || size < 10 || size > 177 || !Array.isArray(bits) || bits.length !== size * size || bits.some(x => x !== 0 && x !== 1) || !Number.isInteger(moduleDots) || moduleDots < 2 || !Number.isInteger(copies) || copies < 1 || copies > 500 || offset !== Math.floor((labelWidth * 8 - (size + 8) * moduleDots) / 2) || offset < 0 || offsetY !== Math.floor((labelHeight * 8 - (size + 8) * moduleDots) / 2) || offsetY < 0) throw Error('Некорректные параметры печати.');
  let rects = '';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (bits[y * size + x]) rects += `<rect x="${offset + (x + 4) * moduleDots}" y="${offsetY + (y + 4) * moduleDots}" width="${moduleDots}" height="${moduleDots}"/>`;
  const label = `<section><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${labelWidth * 8} ${labelHeight * 8}">${rects}</svg></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>QR Duplicator</title><style>@page{size:${labelWidth}mm ${labelHeight}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0}section{width:${labelWidth}mm;height:${labelHeight}mm;overflow:hidden;break-after:page}section:last-child{break-after:auto}svg{display:block;width:${labelWidth}mm;height:${labelHeight}mm;fill:#000}</style></head><body>${label.repeat(copies)}</body></html>`;
}
module.exports = { printHTML };

