const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../js/awt-brand.js');

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ascii = text => [...text].map(c => c.charCodeAt(0));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
const WEBP = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP'), 1];
const GIF = [...ascii('GIF89a'), 1, 2];
const PDF = ascii('%PDF-1.4 conteudo');
const HTML = '<!DOCTYPE html><html><body>site</body></html>';
const SVG = '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>';

const blob = (data, type = '') => new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
const bytesOf = async b => new Uint8Array(await b.arrayBuffer());
const toPng = async () => blob(PNG, 'image/png');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, options = {}) => {
    const call = { url, method: options.method, headers: options.headers, body: options.body };
    calls.push(call);
    return respond(call);
  };
  fn.calls = calls;
  return fn;
}

/** Servidor que aceita tudo, como o awt-onboarding-services em dia bom. */
function happyServer(overrides = {}) {
  let n = 0;
  return fakeFetch(call => {
    if (call.method === 'PUT') return overrides.put ? overrides.put(call) : { ok: true, status: 200 };
    if (call.url.endsWith('/upload-url')) {
      if (overrides.uploadUrl) return overrides.uploadUrl(call);
      n += 1;
      return reply(201, { file_id: B.uuidV4(), upload_url: `https://storage.test/up/${n}`, expires_in: 900, headers: { 'Content-Type': JSON.parse(call.body).content_type } });
    }
    if (call.url.endsWith('/events')) return overrides.events ? overrides.events(call) : reply(200, { ok: true });
    if (call.url.endsWith('/queue')) return reply(200, { partners: [{ partnerId: 'p-1' }] });
    throw new Error(`rota inesperada: ${call.url}`);
  });
}

const NOW = new Date('2026-11-24T12:00:00.000Z');
const makeClient = fetchImpl => B.createClient({
  baseUrl: 'https://api.test/', key: 'chave-do-thiago', operatorEmail: 'thiago@awtgroup.com.br', fetchImpl, now: () => NOW,
});
const partner = (extra = {}) => ({ partnerId: 'p-1', slug: 'torres-wealth', servicos: ['site', 'papelaria'], versaoAtual: 0, ...extra });
const baseSources = () => ({
  logo_png: async () => blob(PNG, 'image/png'),
  logo_branco_png: async () => blob(PNG, 'image/png'),
  cartao_pdf: async () => blob(PDF, 'application/pdf'),
  timbrado_pdf: async () => blob(PDF, 'application/pdf'),
  site_html: async () => blob(HTML, 'text/html'),
});
const site = { slug: 'torres-wealth', pubUrl: 'https://torres-wealth.vercel.app', githubUrl: 'https://github.com/awt-mkt-hub/AWT-Onboarding/tree/main/Torres%20Wealth' };
const deliverWith = (fetchImpl, extra = {}) => B.deliver({
  client: makeClient(fetchImpl), partner: partner(), sources: baseSources(), site, toPng, ...extra,
});
const rejects = async (promise, Type) => {
  try { await promise; } catch (error) { assert.ok(error instanceof Type, `esperava ${Type.name}, veio ${error && error.name}: ${error && error.message}`); return error; }
  assert.fail('deveria ter falhado');
};

// ── Contrato de arquivos (espelha domain/brand_files.py) ────────────────────────────────────────────────────────────
test('obrigatórios: os 5 de sempre, e a foto só com o serviço fotos-ai', () => {
  assert.deepEqual(B.requiredKinds(['site', 'papelaria']), ['logo_png', 'logo_branco_png', 'cartao_pdf', 'timbrado_pdf', 'site_html']);
  assert.ok(B.requiredKinds(['site', 'papelaria', 'fotos-ai']).includes('foto_png'));
  assert.ok(!B.requiredKinds(['site', 'papelaria']).includes('logo_svg'), 'logo_svg é opcional');
});

test('missingKinds lista o que falta, na ordem do contrato', () => {
  assert.deepEqual(B.missingKinds({ servicos: ['fotos-ai'] }, ['logo_png', 'site_html']),['logo_branco_png', 'cartao_pdf', 'timbrado_pdf', 'foto_png']);
});

test('assertComplete barra de forma síncrona e informa o que falta', () => {
  assert.doesNotThrow(() => B.assertComplete({ servicos: ['site'] }, B.requiredKinds(['site'])));
  assert.throws(() => B.assertComplete({ servicos: ['fotos-ai'] }, ['logo_png']), error => {
    assert.ok(error instanceof B.BrandFileError);
    assert.ok(error.missing.includes('foto_png'));
    assert.match(error.userMessage, /Foto corporativa PNG/);
    return true;
  });
});

test('detectKind reconhece pelo conteúdo, nunca pelo nome', () => {
  const kind = data => B.detectKind(typeof data === 'string' ? new Uint8Array(ascii(data)) : new Uint8Array(data));
  assert.equal(kind(PNG), 'png');
  assert.equal(kind(JPEG), 'jpeg');
  assert.equal(kind(WEBP), 'webp');
  assert.equal(kind(GIF), 'gif');
  assert.equal(kind(PDF), 'pdf');
  assert.equal(kind(HTML), 'html');
  assert.equal(kind(`  \n<html lang="pt">`), 'html');
  assert.equal(kind(SVG), 'svg');
  assert.equal(kind('<svg viewBox="0 0 1 1"></svg>'), 'svg');
  assert.equal(kind([0, 1, 2, 3]), 'unknown');
  assert.equal(kind('{"erro": "isto não é HTML"}'), 'unknown');
});

// ── prepareForKind: o bug de produção (JPEG enviado como foto_png) ──────────────────────────────────────────────────
test('PNG de verdade passa direto, sem reencodar', async () => {
  const original = blob(PNG, 'image/png');
  assert.equal(await B.prepareForKind('foto_png', original, { toPng: async () => assert.fail('não deveria converter') }), original);
});

test('JPEG, WebP e GIF no campo PNG são CONVERTIDOS (não só rotulados como PNG)', async () => {
  for (const raster of [JPEG, WEBP, GIF]) {
    let converted = 0;
    const result = await B.prepareForKind('foto_png', blob(raster, 'image/png'), { toPng: async () => { converted += 1; return blob(PNG, 'image/png'); } });
    assert.equal(converted, 1);
    assert.equal(B.detectKind(await bytesOf(result)), 'png');
  }
});

test('a foto continua sendo recusada se a conversão não produzir PNG', async () => {
  const error = await rejects(B.prepareForKind('foto_png', blob(JPEG), { toPng: async () => blob(JPEG) }), B.BrandFileError);
  assert.match(error.userMessage, /^Foto corporativa PNG: esperado PNG, mas o arquivo parece ser JPEG/);
});

test('sem conversor, JPEG no campo PNG vira erro explicando o formato', async () => {
  const error = await rejects(B.prepareForKind('logo_png', blob(JPEG, 'image/png')), B.BrandFileError);
  assert.match(error.userMessage, /Logo PNG: o arquivo é JPEG e precisa ser PNG/);
});

test('falha ao converter vira erro do arquivo, com a causa preservada', async () => {
  const cause = new Error('decode falhou');
  const error = await rejects(B.prepareForKind('foto_png', blob(JPEG), { toPng: async () => { throw cause; } }), B.BrandFileError);
  assert.equal(error.cause, cause);
  assert.match(error.userMessage, /não foi possível converter JPEG para PNG/);
});

test('tipo trocado, vazio, lixo e grande demais são recusados com o que o arquivo parece ser', async () => {
  assert.match((await rejects(B.prepareForKind('cartao_pdf', blob(PNG)), B.BrandFileError)).userMessage, /esperado PDF, mas o arquivo parece ser PNG/);
  assert.match((await rejects(B.prepareForKind('site_html', blob('{"x":1}')), B.BrandFileError)).userMessage, /esperado HTML, mas o arquivo parece ser formato desconhecido/);
  assert.match((await rejects(B.prepareForKind('logo_png', blob([])), B.BrandFileError)).userMessage, /arquivo vazio/);
  const huge = { size: B.MAX_FILE_BYTES + 1, type: 'application/pdf', slice: () => blob(PDF), arrayBuffer: async () => new Uint8Array(PDF).buffer };
  assert.match((await rejects(B.prepareForKind('cartao_pdf', huge), B.BrandFileError)).userMessage, /maior que 10 MB/);
});

test('BOM UTF-8 no HTML e no SVG é removido (o servidor não o aceita antes do doctype)', async () => {
  const withBom = text => blob([0xef, 0xbb, 0xbf, ...ascii(text)], 'text/html');
  const html = await B.prepareForKind('site_html', withBom(HTML));
  assert.equal(await html.text(), HTML);
  assert.equal(await (await B.prepareForKind('logo_svg', withBom(SVG))).text(), SVG);
});

// ── Cliente ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('o cliente exige chave e e-mail do operador: o servidor só aceita eventos do dono da chave', () => {
  assert.throws(() => B.createClient({ operatorEmail: 'a@b.com' }), B.BrandConfigError);
  assert.throws(() => B.createClient({ key: 'k' }), B.BrandConfigError);
});

test('evento: forma exata esperada pelo servidor, com chave no header e operador = e-mail configurado', async () => {
  const fetchImpl = happyServer();
  await makeClient(fetchImpl).started('p-1');
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.test/internal/brand/events');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['X-Brand-Key'], 'chave-do-thiago');
  const body = JSON.parse(call.body);
  assert.deepEqual(Object.keys(body).sort(), ['event_id', 'occurred_at', 'operator', 'partnerId', 'type']);
  assert.match(body.event_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(body.operator, 'thiago@awtgroup.com.br');
  assert.equal(body.occurred_at, '2026-11-24T12:00:00.000Z');
  assert.equal(body.type, 'brand.started');
});

test('a chave nunca vira o operador do evento', async () => {
  const fetchImpl = happyServer();
  await makeClient(fetchImpl).started('p-1');
  assert.ok(!fetchImpl.calls[0].body.includes('chave-do-thiago'));
});

test('brand.failed corta step (40) e error (300) no limite do servidor', async () => {
  const fetchImpl = happyServer();
  await makeClient(fetchImpl).failed('p-1', 'x'.repeat(100), 'e'.repeat(1000));
  const body = JSON.parse(fetchImpl.calls[0].body);
  assert.equal(body.step.length, 40);
  assert.equal(body.error.length, 300);
  assert.ok(body.error.endsWith('…'));
});

test('brand.delivered recusa site sem https antes de chamar o servidor', async () => {
  const fetchImpl = happyServer();
  await rejects(makeClient(fetchImpl).delivered('p-1', { version: 1, site: { slug: 's', pubUrl: 'http://x.com' }, files: [] }), B.BrandConfigError);
  assert.equal(fetchImpl.calls.length, 0);
});

test('upload-url usa o content_type da regra do kind, ignorando o type do arquivo', async () => {
  const fetchImpl = happyServer();
  await makeClient(fetchImpl).requestUpload({ partnerId: 'p-1', kind: 'foto_png', filename: 'x', blob: blob(JPEG, 'image/jpeg') });
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].body), { partnerId: 'p-1', kind: 'foto_png', filename: 'x', content_type: 'image/png', size_bytes: JPEG.length });
});

test('o PUT usa a URL e os headers que o servidor devolveu, sem a chave de integração', async () => {
  const fetchImpl = happyServer();
  const file = blob(PNG, 'image/png');
  const result = await makeClient(fetchImpl).uploadFile({ partnerId: 'p-1', kind: 'logo_png', filename: 'x', blob: file });
  const put = fetchImpl.calls[1];
  assert.equal(put.method, 'PUT');
  assert.match(put.url, /^https:\/\/storage\.test\/up\//);
  assert.deepEqual(put.headers, { 'Content-Type': 'image/png' });
  assert.equal(put.body, file);
  assert.deepEqual(result, { kind: 'logo_png', file_id: result.file_id });
});

test('erro do servidor vira BrandApiError com código, mensagem e detalhes', async () => {
  const fetchImpl = happyServer({ events: () => reply(422, { error: 'incomplete_delivery', message: 'Faltam arquivos na entrega', details: ['foto_png'] }) });
  const error = await rejects(makeClient(fetchImpl).started('p-1'), B.BrandApiError);
  assert.deepEqual([error.status, error.code, error.details], [422, 'incomplete_delivery', ['foto_png']]);
  assert.equal(error.userMessage, 'faltam arquivos obrigatórios (Foto corporativa PNG)');
});

test('validation_error mostra campo e motivo; corpo não-JSON e queda de rede não escondem a causa', async () => {
  const validation = happyServer({ events: () => reply(422, { error: 'validation_error', message: 'Dados inválidos', details: [{ field: 'files', message: 'List should have at least 1 item' }] }) });
  assert.equal((await rejects(makeClient(validation).started('p-1'), B.BrandApiError)).userMessage, 'files: List should have at least 1 item');

  const html502 = fakeFetch(() => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('not json'); } }));
  const bad = await rejects(makeClient(html502).started('p-1'), B.BrandApiError);
  assert.deepEqual([bad.status, bad.code, bad.userMessage], [502, 'http_502', 'HTTP 502']);

  const cause = new TypeError('Failed to fetch');
  const down = await rejects(makeClient(async () => { throw cause; }).started('p-1'), B.BrandApiError);
  assert.deepEqual([down.status, down.code, down.cause], [0, 'network_error', cause]);
});

test('queue devolve a lista de parceiros', async () => {
  assert.deepEqual(await makeClient(happyServer()).queue(), [{ partnerId: 'p-1' }]);
});

test('deliveries consulta a janela pedida e devolve a lista', async () => {
  const fetchImpl = fakeFetch(() => reply(200, { deliveries: [{ slug: 'torres-wealth' }] }));
  assert.deepEqual(await makeClient(fetchImpl).deliveries(30), [{ slug: 'torres-wealth' }]);
  assert.equal(fetchImpl.calls[0].url, 'https://api.test/internal/brand/deliveries?dias=30');
  assert.deepEqual(await makeClient(fakeFetch(() => reply(200, {}))).deliveries(), []);
});

test('filename é cortado em 120, o máximo do servidor (nome de arquivo longo dava 422)', async () => {
  const fetchImpl = happyServer();
  await makeClient(fetchImpl).requestUpload({ partnerId: 'p-1', kind: 'logo_png', filename: `${'a'.repeat(300)}.png`, blob: blob(PNG) });
  assert.equal(JSON.parse(fetchImpl.calls[0].body).filename.length, 120);
});

// ── Entrega ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('versão: a próxima é a última entregue + 1; fila sem o campo conta como primeira entrega', () => {
  assert.equal(B.nextVersion({ versaoAtual: 0 }), 1);
  assert.equal(B.nextVersion({ versaoAtual: 2 }), 3);
  assert.equal(B.nextVersion({}), 1);
});

test('entrega completa: sobe cada arquivo, depois registra UM evento com versão, site e todos os file_id', async () => {
  const fetchImpl = happyServer();
  const progress = [];
  const result = await deliverWith(fetchImpl, { partner: partner({ versaoAtual: 1 }), checklist: { nome_marca: true }, onProgress: p => progress.push(p) });

  const expected = [1, 2, 3, 4, 5].flatMap(n => ['POST /internal/brand/upload-url', `PUT /up/${n}`]);
  expected.push('POST /internal/brand/events');
  assert.deepEqual(fetchImpl.calls.map(c => `${c.method} ${new URL(c.url).pathname}`), expected);

  const event = JSON.parse(fetchImpl.calls.at(-1).body);
  assert.equal(event.type, 'brand.delivered');
  assert.equal(event.version, 2);
  assert.deepEqual(event.site, site);
  assert.deepEqual(event.files.map(f => f.kind), ['logo_png', 'logo_branco_png', 'cartao_pdf', 'timbrado_pdf', 'site_html']);
  assert.ok(event.files.every(f => /^[0-9a-f-]{36}$/.test(f.file_id)));
  assert.deepEqual(event.checklist, { nome_marca: true });
  assert.equal(result.version, 2);
  assert.deepEqual(progress.map(p => p.phase), [...Array(5).fill('prepare'), ...Array(5).fill(['upload', 'done']).flat(), 'register']);
});

test('entrega incompleta falha ANTES de qualquer chamada (não deixa upload pendente no servidor)', async () => {
  const fetchImpl = happyServer();
  const sources = baseSources();
  delete sources.timbrado_pdf;
  const error = await rejects(deliverWith(fetchImpl, { sources }), B.BrandFileError);
  assert.deepEqual(error.missing, ['timbrado_pdf']);
  assert.match(error.message, /Papel timbrado PDF/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('com o serviço fotos-ai a foto passa a ser obrigatória', async () => {
  const fetchImpl = happyServer();
  const error = await rejects(deliverWith(fetchImpl, { partner: partner({ servicos: ['site', 'papelaria', 'fotos-ai'] }) }), B.BrandFileError);
  assert.deepEqual(error.missing, ['foto_png']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('REGRESSÃO produção: foto JPEG é convertida e o servidor recebe um PNG de verdade', async () => {
  const fetchImpl = happyServer();
  const uploaded = [];
  const spyFetch = async (url, options) => { if (options && options.method === 'PUT') uploaded.push(options.body); return fetchImpl(url, options); };
  const sources = { ...baseSources(), foto_png: async () => blob(JPEG, 'image/png') };
  const result = await deliverWith(spyFetch, { partner: partner({ servicos: ['site', 'papelaria', 'fotos-ai'] }), sources });
  assert.ok(result.files.some(f => f.kind === 'foto_png'));
  for (const body of uploaded) assert.notEqual(B.detectKind(await bytesOf(body)), 'jpeg');
  assert.equal(B.detectKind(await bytesOf(uploaded.at(-1))), 'png');
});

test('REGRESSÃO produção: 409 no upload-url interrompe com a mensagem do servidor e NÃO registra entrega com files vazio', async () => {
  const fetchImpl = happyServer({ uploadUrl: () => reply(409, { error: 'too_many_pending', message: 'Há uploads demais aguardando entrega' }) });
  const error = await rejects(deliverWith(fetchImpl), B.BrandApiError);
  assert.equal(error.code, 'too_many_pending');
  assert.equal(error.kind, 'logo_png');
  assert.equal(error.userMessage, 'Logo PNG: Há uploads demais aguardando entrega');
  assert.ok(!fetchImpl.calls.some(c => c.url.endsWith('/events')), 'nenhum evento pode sair');
  assert.equal(fetchImpl.calls.length, 1, 'para no primeiro erro');
});

test('upload recusado pelo armazenamento interrompe a entrega (antes contava como enviado)', async () => {
  const fetchImpl = happyServer({ put: () => ({ ok: false, status: 403 }) });
  const error = await rejects(deliverWith(fetchImpl), B.BrandApiError);
  assert.deepEqual([error.code, error.status, error.kind], ['upload_failed', 403, 'logo_png']);
  assert.ok(!fetchImpl.calls.some(c => c.url.endsWith('/events')));
});

test('falha ao gerar um arquivo (ex.: PDF) interrompe e diz qual', async () => {
  const fetchImpl = happyServer();
  const cause = new Error('html2canvas travou');
  const sources = { ...baseSources(), cartao_pdf: async () => { throw cause; } };
  const error = await rejects(B.deliver({ client: makeClient(fetchImpl), partner: partner(), sources, site, toPng }), Error);
  assert.equal(error, cause);
  assert.equal(fetchImpl.calls.length, 0, 'nada foi enviado: tudo é validado antes do primeiro upload');
});

test('arquivo gerado com conteúdo errado é barrado antes do upload', async () => {
  const fetchImpl = happyServer();
  const sources = { ...baseSources(), cartao_pdf: async () => blob('<html>não virou PDF</html>', 'application/pdf') };
  const error = await rejects(deliverWith(fetchImpl, { sources }), B.BrandFileError);
  assert.equal(error.userMessage, 'Cartão de visita PDF: esperado PDF, mas o arquivo parece ser HTML');
  assert.ok(!fetchImpl.calls.some(c => c.url.endsWith('/events')));
});

test('erro no registro (ex.: version_mismatch) chega ao operador com a mensagem do servidor', async () => {
  const fetchImpl = happyServer({ events: () => reply(409, { error: 'version_mismatch', message: 'Esperava a versão 3' }) });
  const error = await rejects(deliverWith(fetchImpl), B.BrandApiError);
  assert.equal(error.userMessage, 'Esperava a versão 3');
});

// ── prepareFiles / sendFiles (o Publicar usa os mesmos arquivos no GitHub, no Vercel e no onboarding) ────────────────
test('prepareFiles valida TODOS os arquivos antes de devolver, e devolve Blobs no formato exigido', async () => {
  const files = await B.prepareFiles({ ...baseSources(), foto_png: async () => blob(JPEG, 'image/png') }, { toPng });
  assert.deepEqual(Object.keys(files), ['logo_png', 'logo_branco_png', 'cartao_pdf', 'timbrado_pdf', 'site_html', 'foto_png']);
  assert.equal(B.detectKind(await bytesOf(files.foto_png)), 'png');
});

test('prepareFiles para no primeiro arquivo inválido e diz qual', async () => {
  const sources = { logo_png: async () => blob(PNG), cartao_pdf: async () => blob('nao e pdf'), site_html: async () => assert.fail('não deveria chegar aqui') };
  const error = await rejects(B.prepareFiles(sources, { toPng }), B.BrandFileError);
  assert.equal(error.kind, 'cartao_pdf');
});

test('sendFiles envia o que já foi preparado e registra uma única entrega', async () => {
  const fetchImpl = happyServer();
  const files = await B.prepareFiles(baseSources(), { toPng });
  const result = await B.sendFiles({ client: makeClient(fetchImpl), partner: partner({ versaoAtual: 3 }), files, site });
  assert.equal(result.version, 4);
  assert.equal(fetchImpl.calls.filter(c => c.url.endsWith('/events')).length, 1);
  assert.deepEqual(result.files.map(f => f.kind), Object.keys(files));
});

// ── Materiais que o parceiro manteve (o servidor informa o que o branding precisa entregar) ─────────────────────────────
test('requiredFor: quem decide é o servidor; sem a lista vale a regra por serviço', () => {
  const all = ['site', 'papelaria', 'fotos-ai'];
  assert.deepEqual(B.requiredFor({ arquivosObrigatorios: ['cartao_pdf'], servicos: all }), ['cartao_pdf']);
  assert.deepEqual(B.requiredFor({ arquivosObrigatorios: [], servicos: all }), [], 'lista vazia vale: o parceiro manteve tudo');
  assert.deepEqual(B.requiredFor({ servicos: ['site'] }), B.requiredKinds(['site']));
});

test('parceiro manteve o logo: o painel entrega só o que falta e o evento leva só esses arquivos', async () => {
  const fetchImpl = happyServer();
  const { cartao_pdf, timbrado_pdf, site_html } = baseSources();
  const partnerKept = partner({ arquivosObrigatorios: ['cartao_pdf', 'timbrado_pdf', 'site_html'] });
  await B.deliver({ client: makeClient(fetchImpl), partner: partnerKept, sources: { cartao_pdf, timbrado_pdf, site_html }, site, toPng });
  assert.deepEqual(JSON.parse(fetchImpl.calls.at(-1).body).files.map(f => f.kind), ['cartao_pdf', 'timbrado_pdf', 'site_html']);
});

test('parceiro manteve o logo: o que ainda é obrigatório continua barrado', async () => {
  const fetchImpl = happyServer();
  const error = await rejects(B.deliver({
    client: makeClient(fetchImpl), partner: partner({ arquivosObrigatorios: ['cartao_pdf', 'site_html'] }), sources: { site_html: baseSources().site_html }, site, toPng,
  }), B.BrandFileError);
  assert.deepEqual(error.missing, ['cartao_pdf']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('entregar o que o parceiro manteve não é proibido: o painel pode mandar o logo mesmo assim', async () => {
  const fetchImpl = happyServer();
  const result = await B.deliver({ client: makeClient(fetchImpl), partner: partner({ arquivosObrigatorios: ['cartao_pdf'] }), sources: baseSources(), site, toPng });
  assert.equal(result.files.length, 5);
});

test('parceiro manteve tudo: a entrega vai sem arquivos e sem pedir nenhuma URL de upload', async () => {
  const fetchImpl = happyServer();
  const result = await B.deliver({ client: makeClient(fetchImpl), partner: partner({ arquivosObrigatorios: [] }), sources: {}, site, toPng });
  assert.deepEqual(fetchImpl.calls.map(c => new URL(c.url).pathname), ['/internal/brand/events']);
  assert.deepEqual(JSON.parse(fetchImpl.calls[0].body).files, []);
  assert.deepEqual(result.files, []);
});

// ── Texto do parceiro nunca vira HTML no painel ─────────────────────────────────────────────────────────────────────────
test('neutralize troca "<" em qualquer profundidade e deixa o resto como está', () => {
  const input = { nome: '<img src=x onerror=alert(1)>', lista: ['ok', '<b>x</b>'], aninhado: { visao: 'a < b' }, n: 3, ok: true, nada: null };
  assert.deepEqual(B.neutralize(input), { nome: '＜img src=x onerror=alert(1)>', lista: ['ok', '＜b>x＜/b>'], aninhado: { visao: 'a ＜ b' }, n: 3, ok: true, nada: null });
  assert.equal(B.neutralize('Torres & Filhos > 5'), 'Torres & Filhos > 5', 'só "<" abre tag');
});

test('a fila já chega neutralizada: nenhuma tela recebe HTML do parceiro', async () => {
  const evil = { partnerId: 'p-1', nomeMarca: '<img src=x onerror=alert(1)>', especialidades: ['<script>x</script>'], materiais: { site: { obs: '<a href=x>' } } };
  const fetchImpl = fakeFetch(() => reply(200, { partners: [evil] }));
  const [partnerInQueue] = await makeClient(fetchImpl).queue();
  assert.ok(!JSON.stringify(partnerInQueue).includes('<'));
  assert.equal(partnerInQueue.partnerId, 'p-1');
});
