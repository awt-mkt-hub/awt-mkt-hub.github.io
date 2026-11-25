/* Conversões de arquivo que só existem no navegador (canvas, html2pdf). Entram em awt-brand.js por injeção (`toPng`, `sources`),
 * para a lógica da entrega continuar testável no Node. Depende de awt-brand.js. */
(function (root) {
  'use strict';

  const PHOTO_MAX_SIDES = [2048, 1280, 800]; // um PNG de foto grande passa fácil dos 10 MB que o servidor aceita: reduz até caber
  const HTML2PDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js';
  const A4_WIDTH_PX = 794;
  const A4_HEIGHT_PX = 1123;

  const canvasToPng = canvas => new Promise((resolve, reject) => {
    canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('o navegador não gerou o PNG'))), 'image/png');
  });

  function drawContained(ctx, image, width, height) {
    const iw = image.naturalWidth || image.width || width;
    const ih = image.naturalHeight || image.height || height;
    const scale = Math.min(width / iw, height / ih);
    const dw = iw * scale, dh = ih * scale;
    ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  /** Decodifica qualquer imagem que o navegador entenda (JPEG, WebP, GIF…) e a reencoda como PNG de verdade. */
  async function imageBlobToPng(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      let png;
      for (const maxSide of PHOTO_MAX_SIDES) {
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(bitmap.width * scale);
        canvas.height = Math.round(bitmap.height * scale);
        canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        png = await canvasToPng(canvas);
        if (png.size <= root.AwtBrand.MAX_FILE_BYTES) return png;
      }
      return png; // prepareForKind recusa com a mensagem de tamanho
    } finally { bitmap.close(); }
  }

  const hasTransparency = pixels => { for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) return true; return false; };

  /**
   * Versão para fundos escuros: tudo o que a logo desenhou vira branco e a transparência é preservada (nada de fundo embutido).
   * Logo 100% opaca não tem o que separar do fundo, então não dá para gerar a versão branca: falha em vez de entregar um bloco branco.
   */
  function whiten(ctx, width, height) {
    if (!hasTransparency(ctx.getImageData(0, 0, width, height).data)) {
      throw new root.AwtBrand.BrandFileError('a logo não tem transparência (o fundo é opaco), então não dá para gerar a versão branca. Use uma logo com fundo transparente');
    }
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }

  /** Rasteriza o SVG da logo mantendo a proporção, com fundo transparente. `white` gera a versão branca (ver whiten). */
  function svgToPngBlob(svg, { width = 600, height = 300, white = false } = {}) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          drawContained(ctx, image, width, height);
          if (white) whiten(ctx, width, height);
          canvasToPng(canvas).then(resolve, reject);
        } catch (error) { reject(error); }
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('o navegador não conseguiu abrir o SVG')); };
      image.src = url;
    });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src; script.onload = resolve; script.onerror = () => reject(new Error(`falha ao carregar ${src}`));
      document.head.appendChild(script);
    });
  }

  /** O HTML vem de geração por IA e o html2canvas o reinstancia fora do sandbox: sem scripts e sem handlers inline. */
  function neutralize(doc) {
    doc.querySelectorAll('script').forEach(script => script.remove());
    doc.querySelectorAll('*').forEach(el => {
      [...el.attributes].filter(attr => attr.name.startsWith('on')).forEach(attr => el.removeAttribute(attr.name));
    });
  }

  /**
   * Renderiza o documento COMPLETO num iframe isolado (fundo do <body>, CSS do <head> e fontes valem) e o captura.
   * Não pode ficar dentro de um elemento com `left:-9999px`: o html2pdf clona o elemento com esse estilo e o PDF sai em branco
   * (era o que acontecia: todo PDF tinha exatamente 3058 bytes, qualquer que fosse o conteúdo).
   */
  async function htmlToPdfBlob(html) {
    if (!root.html2pdf) await loadScript(HTML2PDF_URL);
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-same-origin');
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;height:${A4_HEIGHT_PX}px;border:0;`;
    document.body.appendChild(frame);
    try {
      await new Promise(resolve => { frame.onload = resolve; frame.srcdoc = html; });
      await frame.contentDocument.fonts.ready;
      neutralize(frame.contentDocument);
      const options = { margin: 0, filename: 'doc.pdf', html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };
      const pdf = await root.html2pdf().set(options).from(frame.contentDocument.documentElement).toPdf().get('pdf');
      return new Blob([pdf.output('arraybuffer')], { type: 'application/pdf' });
    } finally { frame.remove(); }
  }

  async function dataUrlToBlob(dataUrl) {
    return (await fetch(dataUrl)).blob();
  }

  const RASTER_MIME = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  /** Lê um PNG/JPG/WebP/GIF como data URL com o tipo REAL (o que o storage devolve no Content-Type não vale). Devolve null se não é imagem raster. */
  async function rasterBlobToDataUrl(blob) {
    const format = root.AwtBrand.detectKind(new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
    const mime = RASTER_MIME[format];
    if (!mime) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(new Blob([blob], { type: mime }));
    });
    return { dataUrl, mime };
  }

  /** Embrulha um PNG/JPG/WebP/GIF num SVG (o painel trabalha a logo como SVG). Devolve null se o arquivo não é uma imagem raster. */
  async function rasterBlobToSvg(blob, { width = 400, height = 200 } = {}) {
    const raster = await rasterBlobToDataUrl(blob);
    if (!raster) return null;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><image href="${raster.dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/></svg>`;
  }

  root.AwtBrandBrowser = { imageBlobToPng, svgToPngBlob, htmlToPdfBlob, dataUrlToBlob, rasterBlobToDataUrl, rasterBlobToSvg };
})(window);
