/* Contrato do Painel de Branding com o awt-onboarding-services (v1).
 *
 * Fonte única do que o painel (index.html) e o dashboard (thiago-dashboard.html) sabem sobre o serviço: tipos de arquivo,
 * cliente HTTP, erros e a entrega. Sem dependências e sem DOM, então roda igual no browser e no Node (tests/).
 * O que depende do browser (canvas, html2pdf) fica em awt-brand-browser.js e entra aqui por injeção. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AwtBrand = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const API_BASE_URL = 'https://awt-onboarding-services-365707580016.us-central1.run.app';
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // limite do servidor por arquivo
  const MAX_ERROR_LENGTH = 300; // Failed.error no servidor
  const MAX_STEP_LENGTH = 40; // Failed.step no servidor
  const MAX_FILENAME_LENGTH = 120; // UploadUrlRequest.filename no servidor
  const HEAD_BYTES = 2048;
  const UTF8_BOM = [0xef, 0xbb, 0xbf];

  // Espelha domain/brand_files.py do servidor. `required`: 'always' | 'fotos-ai' (só com esse serviço) | 'never'.
  const KINDS = Object.freeze({
    logo_png:        { format: 'png',  contentType: 'image/png',       label: 'Logo PNG',            required: 'always' },
    logo_branco_png: { format: 'png',  contentType: 'image/png',       label: 'Logo branco PNG',     required: 'always' },
    logo_svg:        { format: 'svg',  contentType: 'image/svg+xml',   label: 'Logo SVG',            required: 'never' },
    cartao_pdf:      { format: 'pdf',  contentType: 'application/pdf', label: 'Cartão de visita PDF', required: 'always' },
    timbrado_pdf:    { format: 'pdf',  contentType: 'application/pdf', label: 'Papel timbrado PDF',  required: 'always' },
    site_html:       { format: 'html', contentType: 'text/html',       label: 'Site HTML',           required: 'always' },
    foto_png:        { format: 'png',  contentType: 'image/png',       label: 'Foto corporativa PNG', required: 'fotos-ai' },
  });
  const FORMAT_NAMES = Object.freeze({
    png: 'PNG', jpeg: 'JPEG', webp: 'WebP', gif: 'GIF', pdf: 'PDF', html: 'HTML', svg: 'SVG', unknown: 'formato desconhecido',
  });
  const RASTER_FORMATS = ['jpeg', 'webp', 'gif']; // imagens que o navegador converte para PNG de verdade
  const TEXT_FORMATS = ['html', 'svg'];

  // ── Erros ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Base: `userMessage` é o que o operador lê (prefixado com o arquivo, quando o erro é de um arquivo). */
  class BrandError extends Error {
    constructor(message, { cause, kind } = {}) {
      super(message, { cause });
      this.name = this.constructor.name;
      this.kind = kind;
    }
    get userMessage() {
      const rule = KINDS[this.kind];
      return (rule ? `${rule.label}: ` : '') + this.describe();
    }
    describe() { return this.message; }
  }

  class BrandConfigError extends BrandError {}

  /** Arquivo inválido ou entrega incompleta, detectados no painel antes de gastar uma chamada ao servidor. */
  class BrandFileError extends BrandError {
    constructor(message, { missing, ...rest } = {}) {
      super(message, rest);
      this.missing = missing || [];
    }
  }

  /** Resposta de erro do servidor (corpo `{error, message, details}`), falha de rede (status 0) ou upload recusado. */
  class BrandApiError extends BrandError {
    constructor({ status, code, message, details, cause, kind }) {
      super(message, { cause, kind });
      this.status = status;
      this.code = code;
      this.details = details;
    }
    describe() {
      if (this.code === 'incomplete_delivery' && Array.isArray(this.details)) {
        return `faltam arquivos obrigatórios (${this.details.map(k => (KINDS[k] || { label: k }).label).join(', ')})`;
      }
      if (this.code === 'validation_error' && Array.isArray(this.details)) {
        return this.details.map(d => `${d.field}: ${d.message}`).join('; ');
      }
      return this.message;
    }
  }

  async function errorFromResponse(res) {
    let body = {};
    try { body = await res.json(); } catch (_) { /* corpo vazio ou não-JSON */ }
    return new BrandApiError({
      status: res.status, code: body.error || `http_${res.status}`, message: body.message || `HTTP ${res.status}`, details: body.details,
    });
  }

  // ── Detecção do conteúdo real (o servidor ignora extensão e header; o painel confere do mesmo jeito) ─────────────────
  function startsWith(bytes, signature, offset = 0) {
    return signature.every((byte, i) => bytes[offset + i] === byte);
  }
  const ascii = text => [...text].map(c => c.charCodeAt(0));

  /** Mesmas regras de _detect em domain/brand_files.py. Devolve a chave de FORMAT_NAMES. */
  function detectKind(bytes) {
    if (startsWith(bytes, ascii('%PDF-'))) return 'pdf';
    const head = String.fromCharCode(...bytes.slice(0, 256)).trimStart().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
    if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
    if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
    const svgHead = String.fromCharCode(...bytes.slice(0, 512)).trimStart().toLowerCase();
    const svgScan = String.fromCharCode(...bytes.slice(0, HEAD_BYTES)).toLowerCase();
    if ((svgHead.startsWith('<svg') || svgHead.startsWith('<?xml')) && svgScan.includes('<svg')) return 'svg';
    return 'unknown';
  }

  async function readHead(blob) {
    return new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  }

  /**
   * Deixa o arquivo exatamente como o servidor exige para `kind`, ou explica por que não dá:
   *  - imagem raster (JPEG/WebP/GIF) num campo PNG é convertida de verdade por `toPng`, nunca só renomeada;
   *  - BOM UTF-8 em HTML/SVG é removido (o servidor não o aceita antes do `<!doctype`);
   *  - qualquer outro desencontro (PNG num campo PDF etc.) vira erro com o que o arquivo realmente parece ser.
   */
  async function prepareForKind(kind, blob, { toPng } = {}) {
    const rule = KINDS[kind];
    if (!rule) throw new BrandFileError(`tipo de arquivo desconhecido (${kind})`, { kind });
    if (!blob || blob.size === 0) throw new BrandFileError('arquivo vazio', { kind });

    let prepared = blob;
    let detected = detectKind(await readHead(prepared));

    if (rule.format === 'png' && RASTER_FORMATS.includes(detected)) {
      if (!toPng) throw new BrandFileError(`o arquivo é ${FORMAT_NAMES[detected]} e precisa ser PNG`, { kind });
      try { prepared = await toPng(prepared); }
      catch (cause) { throw new BrandFileError(`não foi possível converter ${FORMAT_NAMES[detected]} para PNG`, { kind, cause }); }
      detected = detectKind(await readHead(prepared));
    }
    if (TEXT_FORMATS.includes(rule.format) && startsWith(await readHead(prepared), UTF8_BOM)) {
      prepared = prepared.slice(UTF8_BOM.length, prepared.size, prepared.type);
      detected = detectKind(await readHead(prepared));
    }
    if (detected !== rule.format) {
      throw new BrandFileError(`esperado ${FORMAT_NAMES[rule.format]}, mas o arquivo parece ser ${FORMAT_NAMES[detected]}`, { kind });
    }
    if (prepared.size > MAX_FILE_BYTES) throw new BrandFileError(`maior que ${MAX_FILE_BYTES / 1024 / 1024} MB`, { kind });
    return prepared;
  }

  // ── Regras da entrega ───────────────────────────────────────────────────────────────────────────────────────────
  function requiredKinds(servicos = []) {
    return Object.keys(KINDS).filter(k => KINDS[k].required === 'always' || servicos.includes(KINDS[k].required));
  }

  /**
   * O que o branding PRECISA entregar para esta parceira. Quem decide é o servidor, que informa em : o parceiro
   * pode ter mantido o logo, o site, o cartão ou o papel timbrado, e o que ele manteve não se refaz. Sem essa informação (servidor
   * antigo) vale a regra padrão por serviço.
   */
  function requiredFor(partner) {
    return Array.isArray(partner.arquivosObrigatorios) ? partner.arquivosObrigatorios : requiredKinds(partner.servicos);
  }

  function missingKinds(partner, presentKinds) {
    return requiredFor(partner).filter(kind => !presentKinds.includes(kind));
  }

  /** Entrega incompleta é barrada no painel, antes de qualquer chamada ao servidor. */
  function assertComplete(partner, presentKinds) {
    const missing = missingKinds(partner, presentKinds);
    if (missing.length) {
      throw new BrandFileError(`faltam arquivos obrigatórios (${missing.map(kind => KINDS[kind].label).join(', ')})`, { missing });
    }
  }

  /** A fila informa a última versão entregue; a próxima é sempre essa + 1 (senão o servidor responde 409 version_mismatch). */
  function nextVersion(partner) {
    return (Number.isInteger(partner.versaoAtual) ? partner.versaoAtual : 0) + 1;
  }

  // ── Cliente HTTP ────────────────────────────────────────────────────────────────────────────────────────────────
  function uuidV4(random = globalThis.crypto) {
    const b = random.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

  /**
   * `operatorEmail` e `key` andam juntos: o servidor só aceita eventos cujo operador é o dono da chave (422 operator_mismatch).
   * `fetchImpl`, `newId` e `now` existem para os testes.
   */
  function createClient({ baseUrl = API_BASE_URL, key, operatorEmail, fetchImpl, newId = uuidV4, now = () => new Date() } = {}) {
    if (!key) throw new BrandConfigError('chave de integração não configurada');
    if (!operatorEmail) throw new BrandConfigError('e-mail do operador não configurado');
    const base = baseUrl.replace(/\/+$/, '');
    const doFetch = fetchImpl || ((url, options) => fetch(url, options));

    async function send(url, options) {
      try { return await doFetch(url, options); }
      catch (cause) { throw new BrandApiError({ status: 0, code: 'network_error', message: 'sem conexão com o servidor', cause }); }
    }

    async function call(method, path, body) {
      const res = await send(base + path, {
        method, headers: { 'X-Brand-Key': key, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
      });
      if (!res.ok) throw await errorFromResponse(res);
      return res.json();
    }

    async function queue() {
      const data = await call('GET', '/internal/brand/queue');
      return Array.isArray(data.partners) ? data.partners : [];
    }

    /** Entregas dos últimos `dias` (o servidor limita a 90). */
    async function deliveries(dias = 14) {
      const data = await call('GET', `/internal/brand/deliveries?dias=${dias}`);
      return Array.isArray(data.deliveries) ? data.deliveries : [];
    }

    /** O tipo vem da regra do `kind`, nunca do `blob.type` (que reflete a extensão do arquivo, não o conteúdo). */
    function requestUpload({ partnerId, kind, filename, blob }) {
      return call('POST', '/internal/brand/upload-url', {
        partnerId, kind, filename: filename.slice(0, MAX_FILENAME_LENGTH), content_type: KINDS[kind].contentType, size_bytes: blob.size,
      });
    }

    async function putFile(slot, blob) {
      const res = await send(slot.upload_url, { method: 'PUT', headers: slot.headers, body: blob });
      if (!res.ok) {
        throw new BrandApiError({ status: res.status, code: 'upload_failed', message: `envio ao armazenamento recusado (HTTP ${res.status})` });
      }
    }

    /** Pede a URL, envia os bytes e devolve a referência que o evento de entrega usa. */
    async function uploadFile({ partnerId, kind, filename, blob }) {
      const slot = await requestUpload({ partnerId, kind, filename, blob });
      await putFile(slot, blob);
      return { kind, file_id: slot.file_id };
    }

    function sendEvent(type, partnerId, fields = {}) {
      return call('POST', '/internal/brand/events', {
        event_id: newId(), type, partnerId, operator: operatorEmail, occurred_at: now().toISOString(), ...fields,
      });
    }

    const started = partnerId => sendEvent('brand.started', partnerId);

    const failed = (partnerId, step, error) => sendEvent('brand.failed', partnerId, {
      step: truncate(step, MAX_STEP_LENGTH), error: truncate(error, MAX_ERROR_LENGTH),
    });

    const delivered = async (partnerId, { version, site, files, checklist = {}, notes = '' }) => {
      if (!/^https:\/\/\S+$/.test(site.pubUrl || '')) throw new BrandConfigError('a URL do site precisa começar com https://');
      return sendEvent('brand.delivered', partnerId, { version, site, files, checklist, notes });
    };

    return { operatorEmail, queue, deliveries, requestUpload, putFile, uploadFile, sendEvent, started, failed, delivered };
  }

  // ── Entrega ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Roda uma etapa de um arquivo e, se falhar, marca o erro com o arquivo (para a mensagem dizer qual foi). */
  async function forKind(kind, step) {
    try { return await step(); }
    catch (error) {
      if (error instanceof BrandError && !error.kind) error.kind = kind;
      throw error;
    }
  }

  /**
   * Gera e confere TODOS os arquivos antes de qualquer envio: um arquivo inválido interrompe tudo sem ter publicado nada.
   * `sources`: { kind: () => Promise<Blob> }, na ordem desejada. Devolve { kind: Blob } já no formato que o servidor exige.
   */
  async function prepareFiles(sources, { toPng, onProgress = () => {} } = {}) {
    const files = {};
    for (const [kind, produce] of Object.entries(sources)) {
      onProgress({ kind, phase: 'prepare' });
      files[kind] = await forKind(kind, async () => prepareForKind(kind, await produce(), { toPng }));
    }
    return files;
  }

  /**
   * Envia os arquivos já preparados e registra a entrega. O evento só sai com todos os arquivos no armazenamento:
   * qualquer falha interrompe com o motivo real (nada de "pular" um arquivo e registrar com menos).
   */
  async function sendFiles({ client, partner, files, site, checklist, notes, onProgress = () => {} }) {
    const sent = [];
    for (const [kind, blob] of Object.entries(files)) {
      onProgress({ kind, phase: 'upload', size: blob.size });
      sent.push(await forKind(kind, () => client.uploadFile({ partnerId: partner.partnerId, kind, filename: `${partner.slug}-${kind}`, blob })));
      onProgress({ kind, phase: 'done' });
    }
    onProgress({ phase: 'register' });
    const version = nextVersion(partner);
    await client.delivered(partner.partnerId, { version, site, files: sent, checklist, notes });
    return { version, files: sent };
  }

  /**
   * Prepara, envia e registra a entrega. Tudo ou nada:
   *  - confere os obrigatórios ANTES de qualquer chamada (entrega incompleta não gera upload pendente no servidor);
   *  - valida todos os arquivos antes do primeiro upload.
   */
  async function deliver({ client, partner, sources, site, checklist, notes, onProgress, toPng }) {
    assertComplete(partner, Object.keys(sources));
    const files = await prepareFiles(sources, { toPng, onProgress });
    return sendFiles({ client, partner, files, site, checklist, notes, onProgress });
  }

  return {
    API_BASE_URL, MAX_FILE_BYTES, KINDS, FORMAT_NAMES,
    BrandError, BrandConfigError, BrandFileError, BrandApiError,
    detectKind, prepareForKind, requiredKinds, requiredFor, missingKinds, assertComplete, nextVersion, uuidV4,
    createClient, prepareFiles, sendFiles, deliver,
  };
});
