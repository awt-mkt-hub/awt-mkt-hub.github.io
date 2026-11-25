const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const B = require('../js/awt-brand.js');
const P = require('../js/awt-publish.js');

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────────────────────────
const ascii = text => [...text].map(c => c.charCodeAt(0));
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
const blob = (data, type = '') => new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
const toPng = async () => blob(PNG, 'image/png');
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const b64 = text => Buffer.from(text).toString('base64');

function fakeFetch(respond) {
  const calls = [];
  const fn = async (url, options = {}) => {
    const call = { url, method: options.method, headers: options.headers, body: typeof options.body === 'string' ? JSON.parse(options.body) : options.body };
    calls.push(call);
    return respond(call);
  };
  fn.calls = calls;
  return fn;
}

/** GitHub em memória com a semântica real da API de Git Data: blobs, árvores sobre base_tree, commits e a ref da branch. */
function fakeGithub({ existingMarker, failOn } = {}) {
  const repo = { head: 'c0', commits: { c0: { tree: 't0' } }, trees: { t0: {} }, blobs: {}, files: {}, log: [] };
  let n = 0;
  const treeSha = files => `t:${Object.entries(files).sort().map(([p, s]) => `${p}=${s}`).join('|')}`;
  const fetchImpl = fakeFetch(call => {
    const url = new URL(call.url);
    const path = decodeURIComponent(url.pathname.replace('/repos/awt-mkt-hub/AWT-Onboarding', ''));
    repo.log.push(`${call.method} ${path}`);
    if (failOn && failOn(call, path)) return failOn(call, path);
    if (call.method === 'GET' && path === '/git/ref/heads/main') return reply(200, { object: { sha: repo.head } });
    if (call.method === 'GET' && path === `/git/commits/${repo.head}`) return reply(200, { tree: { sha: repo.commits[repo.head].tree } });
    if (call.method === 'GET' && path.endsWith('/publicacao.json')) {
      return existingMarker ? reply(200, { content: b64(JSON.stringify(existingMarker)) + '\n' }) : reply(404, { message: 'Not Found' });
    }
    if (call.method === 'POST' && path === '/git/blobs') { const data = Buffer.from(call.body.content, 'base64'); const sha = crypto.createHash('sha1').update(data).digest('hex'); repo.blobs[sha] = data; return reply(201, { sha }); }
    if (call.method === 'POST' && path === '/git/trees') {
      const files = { ...repo.trees[call.body.base_tree] };
      for (const e of call.body.tree) files[e.path] = e.sha;
      const sha = treeSha(files);
      repo.trees[sha] = files;
      return reply(201, { sha });
    }
    if (call.method === 'POST' && path === '/git/commits') {
      const sha = `c${(n += 1)}`;
      repo.commits[sha] = { tree: call.body.tree, message: call.body.message, parents: call.body.parents };
      return reply(201, { sha });
    }
    if (call.method === 'PATCH' && path === '/git/refs/heads/main') { repo.head = call.body.sha; return reply(200, {}); }
    throw new Error(`rota inesperada: ${call.method} ${path}`);
  });
  repo.fetchImpl = fetchImpl;
  repo.read = filePath => { const sha = repo.trees[repo.commits[repo.head].tree][filePath]; return sha && repo.blobs[sha]; };
  repo.paths = () => Object.keys(repo.trees[repo.commits[repo.head].tree]).sort();
  return repo;
}

const githubFor = repo => P.createGithubPublisher({ token: 'ghp_teste', fetchImpl: repo.fetchImpl });

function fakeVercel({ states = ['READY'], alias = ['torres-wealth.vercel.app'], createError } = {}) {
  let polls = 0;
  const fetchImpl = fakeFetch(call => {
    if (call.method === 'POST') return createError ? reply(createError.status, { error: { message: createError.message } }) : reply(200, { id: 'dpl_1', readyState: 'QUEUED' });
    polls += 1;
    return reply(200, { id: 'dpl_1', readyState: states[Math.min(polls - 1, states.length - 1)], alias });
  });
  const waits = [];
  return { fetchImpl, waits, publisher: P.createVercelPublisher({ token: 'vc_teste', fetchImpl, sleep: async ms => waits.push(ms), pollMs: 10, timeoutMs: 40 }) };
}

// ── Nomes ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a pasta leva o nome do escritório como o time escreveu', () => {
  assert.equal(P.folderName('Teste Wealth', 'teste-wealth'), 'Teste Wealth');
  assert.equal(P.folderName('  Gestão   Patrimonial  Ltda ', 'x'), 'Gestão Patrimonial Ltda');
});

test('o nome da pasta perde só o que quebra caminho ou URL', () => {
  assert.equal(P.folderName('Torres/Wealth: "A|B"?', 'x'), 'Torres Wealth A B');
  assert.equal(P.folderName('..Wealth..', 'x'), 'Wealth');
  assert.equal(P.folderName('100% #1', 'x'), '100 1');
  assert.equal(P.folderName('   ', 'sem-nome'), 'sem-nome');
  assert.equal(P.folderName('a'.repeat(300), 'x').length, 100);
});

test('o link da pasta no GitHub é codificado e aceito pelo servidor (https, sem espaços)', () => {
  const url = P.githubFolderUrl('Teste Wealth');
  assert.equal(url, 'https://github.com/awt-mkt-hub/AWT-Onboarding/tree/main/Teste%20Wealth');
  assert.match(url, /^https:\/\/\S+$/);
  assert.ok(P.githubFolderUrl('Gestão Ltda').includes('Gest%C3%A3o'));
});

test('todo tipo de arquivo do contrato tem um nome de arquivo na pasta', () => {
  assert.deepEqual(Object.keys(P.REPO_FILES).sort(), Object.keys(B.KINDS).sort());
  assert.equal(new Set(Object.values(P.REPO_FILES)).size, Object.keys(B.KINDS).length, 'sem nomes repetidos');
  assert.equal(P.REPO_FILES.site_html, 'index.html');
});

// ── GitHub ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const siteFiles = () => ({ 'index.html': blob('<!doctype html><html></html>', 'text/html'), 'logo.svg': blob('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'logo.png': blob(PNG) });

test('GitHub: grava a pasta do escritório com todos os arquivos em UM commit', async () => {
  const repo = fakeGithub();
  const result = await githubFor(repo).publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'chore: publica Teste Wealth (v1)' });

  assert.deepEqual(repo.paths(), ['Teste Wealth/index.html', 'Teste Wealth/logo.png', 'Teste Wealth/logo.svg', 'Teste Wealth/publicacao.json']);
  assert.equal(repo.commits[repo.head].message, 'chore: publica Teste Wealth (v1)');
  assert.deepEqual(repo.commits[repo.head].parents, ['c0']);
  assert.equal(Object.keys(repo.commits).length, 2, 'um único commit novo, não um por arquivo');
  assert.deepEqual([...repo.read('Teste Wealth/logo.png')], PNG, 'bytes binários preservados (base64)');
  assert.equal(repo.read('Teste Wealth/index.html').toString(), '<!doctype html><html></html>');
  assert.deepEqual(JSON.parse(repo.read('Teste Wealth/publicacao.json')), { slug: 'teste-wealth' });
  assert.deepEqual([result.changed, result.folderUrl], [true, 'https://github.com/awt-mkt-hub/AWT-Onboarding/tree/main/Teste%20Wealth']);
});

test('GitHub: publicar de novo o mesmo conteúdo não cria commit vazio', async () => {
  const repo = fakeGithub();
  const github = githubFor(repo);
  await github.publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'm' });
  const commits = Object.keys(repo.commits).length;
  const again = await github.publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'm' });
  assert.equal(again.changed, false);
  assert.equal(Object.keys(repo.commits).length, commits);
});

test('GitHub: republicar com um arquivo alterado cria um novo commit só com a diferença', async () => {
  const repo = fakeGithub();
  const github = githubFor(repo);
  await github.publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'v1' });
  const changed = { ...siteFiles(), 'index.html': blob('<!doctype html><html>v2</html>') };
  assert.equal((await github.publishFolder({ folder: 'Teste Wealth', files: changed, slug: 'teste-wealth', message: 'v2' })).changed, true);
  assert.equal(repo.read('Teste Wealth/index.html').toString(), '<!doctype html><html>v2</html>');
});

test('GitHub: não sobrescreve a pasta de OUTRO escritório com o mesmo nome (e não grava nada)', async () => {
  const repo = fakeGithub({ existingMarker: { slug: 'outro-escritorio' } });
  await assert.rejects(githubFor(repo).publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'm' }), error => {
    assert.ok(error instanceof P.PublishError);
    assert.match(error.userMessage, /^GitHub: já existe uma pasta "Teste Wealth" de outro escritório \(outro-escritorio\)/);
    return true;
  });
  assert.ok(!repo.log.some(line => line.startsWith('POST')), 'nenhum blob, árvore ou commit foi criado');
});

test('GitHub: a mesma pasta do mesmo escritório é aceita (republicação)', async () => {
  const repo = fakeGithub({ existingMarker: { slug: 'teste-wealth' } });
  assert.equal((await githubFor(repo).publishFolder({ folder: 'Teste Wealth', files: siteFiles(), slug: 'teste-wealth', message: 'm' })).changed, true);
});

test('GitHub: erros viram mensagem que o operador entende', async () => {
  const run = (status, message) => githubFor(fakeGithub({ failOn: call => call.method === 'GET' && call.url.includes('/git/ref/') && reply(status, { message }) }))
    .publishFolder({ folder: 'F', files: siteFiles(), slug: 's', message: 'm' });
  await assert.rejects(run(401, 'Bad credentials'), e => e.userMessage === 'GitHub: token inválido ou expirado (Bad credentials)');
  await assert.rejects(run(403, 'Resource not accessible'), e => /não tem permissão de escrita/.test(e.userMessage) && e.status === 403);
  await assert.rejects(run(404, 'Not Found'), e => /repositório ou branch não encontrado/.test(e.userMessage));
});

test('GitHub: ref movida por outra publicação ao mesmo tempo falha em vez de sobrescrever', async () => {
  const repo = fakeGithub({ failOn: call => call.method === 'PATCH' && reply(422, { message: 'Update is not a fast forward' }) });
  await assert.rejects(githubFor(repo).publishFolder({ folder: 'F', files: siteFiles(), slug: 's', message: 'm' }), e => /tente de novo/.test(e.userMessage));
});

test('GitHub: sem token ou sem rede, a causa aparece', async () => {
  assert.throws(() => P.createGithubPublisher({}), e => e instanceof P.PublishError && /token não configurado/.test(e.userMessage));
  const cause = new TypeError('Failed to fetch');
  const offline = P.createGithubPublisher({ token: 't', fetchImpl: async () => { throw cause; } });
  await assert.rejects(offline.publishFolder({ folder: 'F', files: {}, slug: 's', message: 'm' }), e => e.cause === cause && /sem conexão com o GitHub/.test(e.userMessage));
});

// ── Vercel ──────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Vercel: cria o deploy de produção com os arquivos em base64 e devolve a URL do alias', async () => {
  const { fetchImpl, publisher } = fakeVercel();
  const result = await publisher.deploy({ name: 'torres-wealth', files: { 'index.html': blob('<html>oi</html>'), 'logo.svg': blob('<svg/>') } });
  const create = fetchImpl.calls[0];
  assert.equal(create.url, 'https://api.vercel.com/v13/deployments');
  assert.equal(create.headers.Authorization, 'Bearer vc_teste');
  assert.deepEqual([create.body.name, create.body.target], ['torres-wealth', 'production']);
  assert.deepEqual(create.body.files, [
    { file: 'index.html', data: b64('<html>oi</html>'), encoding: 'base64' },
    { file: 'logo.svg', data: b64('<svg/>'), encoding: 'base64' },
  ]);
  assert.deepEqual(result, { url: 'https://torres-wealth.vercel.app', deploymentId: 'dpl_1' });
});

test('Vercel: espera o deploy ficar READY em vez de dormir um tempo fixo', async () => {
  const { fetchImpl, waits, publisher } = fakeVercel({ states: ['BUILDING', 'BUILDING', 'READY'] });
  await publisher.deploy({ name: 'x', files: { 'index.html': blob('x') } });
  assert.equal(fetchImpl.calls.filter(c => c.method === 'GET').length, 3);
  assert.equal(waits.length, 3);
});

test('Vercel: usa o alias que o Vercel realmente atribuiu (o nome pode ter sido ocupado)', async () => {
  const { publisher } = fakeVercel({ alias: ['torres-wealth-3.vercel.app'] });
  assert.equal((await publisher.deploy({ name: 'torres-wealth', files: { 'index.html': blob('x') } })).url, 'https://torres-wealth-3.vercel.app');
});

test('Vercel: deploy com ERROR, travado ou recusado vira erro explicando', async () => {
  const files = { 'index.html': blob('x') };
  await assert.rejects(fakeVercel({ states: ['BUILDING', 'ERROR'] }).publisher.deploy({ name: 'x', files }), e => e.userMessage === 'Vercel: o deploy terminou em ERROR');
  await assert.rejects(fakeVercel({ states: ['BUILDING'] }).publisher.deploy({ name: 'x', files }), e => /não ficou pronto a tempo/.test(e.userMessage));
  await assert.rejects(fakeVercel({ createError: { status: 403, message: 'Not authorized' } }).publisher.deploy({ name: 'x', files }), e => e.userMessage === 'Vercel: Not authorized' && e.status === 403);
  assert.throws(() => P.createVercelPublisher({}), e => /token não configurado/.test(e.userMessage));
});

// ── Publicar (GitHub + Vercel + onboarding) ─────────────────────────────────────────────────────────────────────────
const partner = (extra = {}) => ({ partnerId: 'p-1', slug: 'teste-wealth', nomeMarca: 'Teste Wealth', servicos: ['site', 'papelaria'], versaoAtual: 0, ...extra });
const sources = () => ({
  logo_svg: async () => blob('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'),
  logo_png: async () => blob(PNG, 'image/png'),
  logo_branco_png: async () => blob(PNG, 'image/png'),
  cartao_pdf: async () => blob(ascii('%PDF-1.4 cartao'), 'application/pdf'),
  timbrado_pdf: async () => blob(ascii('%PDF-1.4 timbrado'), 'application/pdf'),
  site_html: async () => blob('<!doctype html><html>site</html>', 'text/html'),
});

/** Onboarding falso que aceita tudo e guarda os eventos. */
function fakeOnboarding({ events } = {}) {
  let n = 0;
  const fetchImpl = fakeFetch(call => {
    if (call.method === 'PUT') return { ok: true, status: 200 };
    if (call.url.endsWith('/upload-url')) { n += 1; return reply(201, { file_id: B.uuidV4(), upload_url: `https://storage.test/${n}`, headers: { 'Content-Type': call.body.content_type } }); }
    if (call.url.endsWith('/events')) return events ? events(call) : reply(200, { ok: true });
    throw new Error(`rota inesperada: ${call.url}`);
  });
  return { fetchImpl, client: B.createClient({ baseUrl: 'https://api.test', key: 'k', operatorEmail: 'thiago@awtgroup.com.br', fetchImpl }) };
}

async function publish({ repo = fakeGithub(), vercel = fakeVercel(), onboarding = fakeOnboarding(), ...overrides } = {}) {
  const order = [];
  const track = (name, fetchImpl) => { const inner = fetchImpl; return async (...args) => { if (!order.includes(name)) order.push(name); return inner(...args); }; };
  const github = P.createGithubPublisher({ token: 't', fetchImpl: track('github', repo.fetchImpl) });
  const vercelPublisher = P.createVercelPublisher({ token: 't', fetchImpl: track('vercel', vercel.fetchImpl), sleep: async () => {}, pollMs: 1, timeoutMs: 10 });
  const client = overrides.client === null ? undefined : B.createClient({ baseUrl: 'https://api.test', key: 'k', operatorEmail: 'thiago@awtgroup.com.br', fetchImpl: track('onboarding', onboarding.fetchImpl) });
  const stages = [];
  const run = () => P.publishOffice({
    partner: partner(), sources: sources(), checklist: { nome_marca: true }, client, github, vercel: vercelPublisher, toPng,
    onProgress: p => { if (!stages.includes(p.stage)) stages.push(p.stage); }, ...overrides,
  });
  return { run, order, stages, repo, vercel, onboarding };
}

test('Publicar: pasta no GitHub com todos os arquivos, deploy no Vercel e entrega ao onboarding, nessa ordem', async () => {
  const ctx = await publish();
  const result = await ctx.run();

  assert.deepEqual(ctx.order, ['github', 'vercel', 'onboarding']);
  assert.deepEqual(ctx.stages, ['prepare', 'github', 'vercel', 'onboarding']);
  assert.deepEqual(ctx.repo.paths(), [
    'Teste Wealth/cartao-de-visita.pdf', 'Teste Wealth/index.html', 'Teste Wealth/logo-branco.png', 'Teste Wealth/logo.png',
    'Teste Wealth/logo.svg', 'Teste Wealth/papel-timbrado.pdf', 'Teste Wealth/publicacao.json',
  ]);
  assert.equal(result.folder, 'Teste Wealth');

  const vercelBody = ctx.vercel.fetchImpl.calls[0].body;
  assert.deepEqual(vercelBody.files.map(f => f.file), ['index.html', 'logo.svg'], 'o Vercel só recebe o que o site precisa');

  const events = ctx.onboarding.fetchImpl.calls.filter(c => c.url.endsWith('/events'));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].body.site, {
    slug: 'teste-wealth', pubUrl: 'https://torres-wealth.vercel.app', githubUrl: 'https://github.com/awt-mkt-hub/AWT-Onboarding/tree/main/Teste%20Wealth',
  });
  assert.equal(events[0].body.version, 1);
  assert.deepEqual(events[0].body.checklist, { nome_marca: true });
  assert.equal(events[0].body.files.length, 6);
});

test('Publicar: o onboarding recebe exatamente os mesmos arquivos da pasta do GitHub', async () => {
  const ctx = await publish();
  await ctx.run();
  const uploaded = ctx.onboarding.fetchImpl.calls.filter(c => c.method === 'PUT').length;
  assert.equal(uploaded, 6);
  assert.equal(ctx.repo.paths().length - 1, uploaded, 'seis arquivos + publicacao.json');
});

test('Publicar: foto JPEG vira PNG de verdade em todos os destinos', async () => {
  const ctx = await publish({ partner: partner({ servicos: ['site', 'papelaria', 'fotos-ai'] }), sources: { ...sources(), foto_png: async () => blob(JPEG, 'image/png') } });
  await ctx.run();
  assert.deepEqual([...ctx.repo.read('Teste Wealth/foto.png')], PNG);
});

test('Publicar: arquivo inválido interrompe ANTES de tocar GitHub, Vercel ou onboarding', async () => {
  const ctx = await publish({ sources: { ...sources(), cartao_pdf: async () => blob('isto não é um PDF') } });
  await assert.rejects(ctx.run(), e => e.kind === 'cartao_pdf');
  assert.deepEqual(ctx.order, []);
});

test('Publicar: obrigatório faltando interrompe antes de qualquer chamada', async () => {
  const { logo_png, ...incompleto } = sources();
  const ctx = await publish({ sources: incompleto });
  await assert.rejects(ctx.run(), e => e instanceof B.BrandFileError && e.missing.includes('logo_png'));
  assert.deepEqual(ctx.order, []);
});

test('Publicar: falha no GitHub não publica no Vercel nem entrega ao onboarding', async () => {
  const ctx = await publish({ repo: fakeGithub({ failOn: call => call.method === 'GET' && call.url.includes('/git/ref/') && reply(401, { message: 'Bad credentials' }) }) });
  await assert.rejects(ctx.run(), e => e instanceof P.PublishError && e.step === 'github');
  assert.deepEqual(ctx.order, ['github']);
});

test('Publicar: falha no Vercel não entrega ao onboarding (ele nunca recebe uma URL que não existe)', async () => {
  const ctx = await publish({ vercel: fakeVercel({ createError: { status: 500, message: 'boom' } }) });
  await assert.rejects(ctx.run(), e => e instanceof P.PublishError && e.step === 'vercel');
  assert.deepEqual(ctx.order, ['github', 'vercel']);
});

test('Publicar: falha na entrega ao onboarding mostra o motivo do servidor, depois de GitHub e Vercel', async () => {
  const ctx = await publish({ onboarding: fakeOnboarding({ events: () => reply(409, { error: 'version_mismatch', message: 'Esperava a versão 3' }) }) });
  await assert.rejects(ctx.run(), e => e instanceof B.BrandApiError && e.userMessage === 'Esperava a versão 3');
  assert.deepEqual(ctx.order, ['github', 'vercel', 'onboarding']);
});

test('Publicar: parceira sem vínculo com o onboarding publica GitHub e Vercel e pula a entrega', async () => {
  const ctx = await publish({ client: null });
  const result = await ctx.run();
  assert.deepEqual(ctx.order, ['github', 'vercel']);
  assert.equal(result.delivered, null);
});

test('Publicar de novo (reentrega) usa a próxima versão e não duplica a pasta', async () => {
  const repo = fakeGithub();
  const first = await publish({ repo });
  await first.run();
  const second = await publish({ repo, partner: partner({ versaoAtual: 1 }) });
  const result = await second.run();
  assert.equal(result.delivered.version, 2);
  assert.equal(repo.paths().filter(p => p.startsWith('Teste Wealth/')).length, 7);
  assert.equal(result.git.changed, false, 'mesmo conteúdo: nenhum commit novo');
});

// ── Parceiro que manteve materiais: não se publica o que ele já tem ─────────────────────────────────────────────────────
const KEPT_SITE = 'https://www.teste-wealth.com.br';
const withoutKeys = (source, ...keys) => Object.fromEntries(Object.entries(source).filter(([key]) => !keys.includes(key)));

test('Publicar com o site mantido: não há deploy no Vercel e o onboarding recebe o site do parceiro', async () => {
  const kept = partner({ keptSiteUrl: KEPT_SITE, arquivosObrigatorios: ['logo_png', 'logo_branco_png', 'cartao_pdf', 'timbrado_pdf'] });
  const ctx = await publish({ partner: kept, sources: withoutKeys(sources(), 'site_html') });
  const result = await ctx.run();

  assert.deepEqual(ctx.order, ['github', 'onboarding'], 'o site é do parceiro: nada de Vercel');
  assert.deepEqual(ctx.stages, ['prepare', 'github', 'onboarding']);
  assert.equal(result.site.url, KEPT_SITE);
  assert.ok(!ctx.repo.paths().includes('Teste Wealth/index.html'));
  const event = ctx.onboarding.fetchImpl.calls.find(c => c.url.endsWith('/events')).body;
  assert.deepEqual(event.site, { slug: 'teste-wealth', pubUrl: KEPT_SITE, githubUrl: 'https://github.com/awt-mkt-hub/AWT-Onboarding/tree/main/Teste%20Wealth' });
});

test('Publicar com o logo mantido: o site sai pelo Vercel e a pasta não leva o logo do parceiro', async () => {
  const kept = partner({ arquivosObrigatorios: ['cartao_pdf', 'timbrado_pdf', 'site_html'] });
  const ctx = await publish({ partner: kept, sources: withoutKeys(sources(), 'logo_png', 'logo_branco_png', 'logo_svg') });
  await ctx.run();
  assert.deepEqual(ctx.order, ['github', 'vercel', 'onboarding']);
  assert.deepEqual(ctx.repo.paths(), ['Teste Wealth/cartao-de-visita.pdf', 'Teste Wealth/index.html', 'Teste Wealth/papel-timbrado.pdf', 'Teste Wealth/publicacao.json']);
  assert.deepEqual(ctx.vercel.fetchImpl.calls[0].body.files.map(f => f.file), ['index.html'], 'sem logo.svg: o parceiro manteve o logo dele');
});

test('Publicar com tudo mantido: só confirma ao onboarding, sem pasta no GitHub e sem Vercel', async () => {
  const kept = partner({ keptSiteUrl: KEPT_SITE, arquivosObrigatorios: [] });
  const ctx = await publish({ partner: kept, sources: {} });
  const result = await ctx.run();

  assert.deepEqual(ctx.order, ['onboarding']);
  assert.equal(result.git, null);
  assert.equal(ctx.repo.paths().length, 0);
  const event = ctx.onboarding.fetchImpl.calls.find(c => c.url.endsWith('/events')).body;
  assert.deepEqual([event.files, event.site], [[], { slug: 'teste-wealth', pubUrl: KEPT_SITE }], 'sem githubUrl: não há pasta');
  assert.equal(ctx.onboarding.fetchImpl.calls.filter(c => c.url.endsWith('/upload-url')).length, 0);
});

test('Publicar: o que ainda é obrigatório continua barrado antes de qualquer chamada', async () => {
  const kept = partner({ keptSiteUrl: KEPT_SITE, arquivosObrigatorios: ['cartao_pdf'] });
  const ctx = await publish({ partner: kept, sources: {} });
  await assert.rejects(ctx.run(), e => e instanceof B.BrandFileError && e.missing.includes('cartao_pdf'));
  assert.deepEqual(ctx.order, []);
});

// ── Registro do que veio do parceiro: tudo de cada cliente fica documentado na pasta ─────────────────────────────────────
const manifestOf = () => blob(JSON.stringify({ escritorio: 'Teste Wealth', materiais: { logo: { acao: 'manter' } } }), 'application/json');
const archiveOf = () => ({
  'originais-do-parceiro/logo': async () => blob(PNG, 'image/png'),
  'originais-do-parceiro/foto': async () => blob(JPEG, 'application/octet-stream'),
  'originais-do-parceiro/cartao': async () => blob(ascii('%PDF-1.4 cartao do parceiro')),
  'materiais-do-parceiro.json': async () => manifestOf(),
});

test('Publicar grava na pasta os originais do parceiro e o manifesto, com a extensão certa pelo conteúdo', async () => {
  const ctx = await publish({ archive: archiveOf() });
  await ctx.run();
  const paths = ctx.repo.paths();
  for (const expected of ['originais-do-parceiro/logo.png', 'originais-do-parceiro/foto.jpg', 'originais-do-parceiro/cartao.pdf', 'materiais-do-parceiro.json']) {
    assert.ok(paths.includes(`Teste Wealth/${expected}`), expected);
  }
  assert.deepEqual([...ctx.repo.read('Teste Wealth/originais-do-parceiro/foto.jpg')], JPEG, 'os bytes originais, sem reencodar');
  assert.ok(paths.includes('Teste Wealth/index.html'), 'o que o marketing produziu continua na mesma pasta');
  assert.equal(Object.keys(ctx.repo.commits).length, 2, 'um único commit para tudo');
});

test('Publicar com tudo mantido ainda grava os originais e o manifesto (a pasta documenta o cliente)', async () => {
  const kept = partner({ keptSiteUrl: KEPT_SITE, arquivosObrigatorios: [] });
  const ctx = await publish({ partner: kept, sources: {}, archive: archiveOf() });
  const result = await ctx.run();
  assert.deepEqual(ctx.order, ['github', 'onboarding'], 'sem Vercel (site do parceiro), mas com GitHub');
  assert.ok(result.git && result.git.changed);
  assert.deepEqual(ctx.repo.paths().filter(p => !p.endsWith('publicacao.json')).length, 4);
  const event = ctx.onboarding.fetchImpl.calls.find(c => c.url.endsWith('/events')).body;
  assert.deepEqual(event.files, [], 'o onboarding já tem esses arquivos: nada a reenviar');
  assert.ok(event.site.githubUrl);
});

test('Publicar: se um arquivo do parceiro não puder ser obtido, nada é publicado', async () => {
  const archive = { ...archiveOf(), 'originais-do-parceiro/logo': async () => { throw new Error('link expirado'); } };
  const ctx = await publish({ archive });
  await assert.rejects(ctx.run(), error => {
    assert.ok(error instanceof B.BrandFileError);
    assert.match(error.userMessage, /não foi possível obter originais-do-parceiro\/logo \(link expirado\)/);
    return true;
  });
  assert.deepEqual(ctx.order, [], 'pasta incompleta não serve como documentação');
});

test('extensionOf escolhe a extensão pelo conteúdo, não pelo nome', async () => {
  assert.equal(await B.extensionOf(blob(PNG)), 'png');
  assert.equal(await B.extensionOf(blob(JPEG)), 'jpg');
  assert.equal(await B.extensionOf(blob(ascii('%PDF-1.7 x'))), 'pdf');
  assert.equal(await B.extensionOf(blob('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg');
  assert.equal(await B.extensionOf(blob([1, 2, 3])), 'bin');
});
