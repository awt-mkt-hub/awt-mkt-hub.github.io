/* Publicação do escritório: pasta no GitHub, deploy no Vercel e entrega ao onboarding, tudo a partir dos MESMOS arquivos.
 *
 * Um clique em "Publicar" faz, nesta ordem, e interrompe no primeiro erro:
 *   1. prepara e confere todos os arquivos (nada é publicado se um estiver inválido);
 *   2. grava a pasta com o nome do escritório no GitHub, em UM commit;
 *   3. publica o site no Vercel e espera ficar no ar;
 *   4. entrega os arquivos ao onboarding (por último, para o onboarding receber a URL do site que realmente existe).
 * Sem DOM: roda no browser e no Node (tests/). Depende de awt-brand.js. */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./awt-brand.js') : root.AwtBrand);
  if (isNode) module.exports = api;
  else root.AwtPublish = api;
})(typeof self !== 'undefined' ? self : globalThis, function (Brand) {
  'use strict';

  const GITHUB = Object.freeze({ api: 'https://api.github.com', owner: 'awt-mkt-hub', repo: 'AWT-Onboarding', branch: 'main' });
  const VERCEL_API = 'https://api.vercel.com';
  const MARKER_FILE = 'publicacao.json'; // diz de qual escritório é a pasta, para dois nomes iguais não se sobrescreverem
  const MAX_FOLDER_LENGTH = 100;
  const MAX_GITHUB_URL_LENGTH = 300; // site.githubUrl no servidor

  // Nome de cada arquivo dentro da pasta do escritório. O site fica em index.html (mesma convenção das pastas já existentes).
  const REPO_FILES = Object.freeze({
    logo_svg: 'logo.svg', logo_png: 'logo.png', logo_branco_png: 'logo-branco.png',
    cartao_pdf: 'cartao-de-visita.pdf', timbrado_pdf: 'papel-timbrado.pdf', site_html: 'index.html', foto_png: 'foto.png',
  });
  const VERCEL_KINDS = ['site_html', 'logo_svg']; // o que o site precisa para abrir

  const STEP_LABEL = { github: 'GitHub', vercel: 'Vercel' };

  /** Falha de uma etapa da publicação. `step` diz qual (github | vercel) e `status` guarda o HTTP, quando houve. */
  class PublishError extends Brand.BrandError {
    constructor(message, { step, status, cause } = {}) {
      super(message, { cause });
      this.step = step;
      this.status = status;
    }
    describe() { return `${STEP_LABEL[this.step] || 'Publicação'}: ${this.message}`; }
  }

  // ── Nomes ───────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Nome da pasta no GitHub: o nome do escritório como o time escreveu ("Teste Wealth"), sem o que quebra caminho ou URL. O link da
   * pasta vai no evento de entrega, e o servidor limita esse link a 300 caracteres (acento vira 6 na URL): nome comprido é cortado até caber.
   */
  function folderName(nomeMarca, slug) {
    let name = String(nomeMarca || '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+|\.+$/g, '')
      .slice(0, MAX_FOLDER_LENGTH)
      .trim();
    while (name && githubFolderUrl(name).length > MAX_GITHUB_URL_LENGTH) name = name.slice(0, -1).trim();
    return name || slug;
  }

  function githubFolderUrl(folder, { owner, repo, branch } = GITHUB) {
    return `https://github.com/${owner}/${repo}/tree/${branch}/${encodeURIComponent(folder)}`;
  }

  async function toBase64(blob) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  async function messageOf(res) {
    try { return (await res.json()).message || ''; } catch (_) { return ''; }
  }

  // ── GitHub ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const GITHUB_HINTS = {
    401: 'token inválido ou expirado',
    403: 'o token não tem permissão de escrita neste repositório (ou o limite de uso foi atingido)',
    404: 'repositório ou branch não encontrado para este token',
    422: 'o GitHub recusou a gravação (alguém publicou ao mesmo tempo? tente de novo)',
  };

  function createGithubPublisher({ token, owner = GITHUB.owner, repo = GITHUB.repo, branch = GITHUB.branch, baseUrl = GITHUB.api, fetchImpl } = {}) {
    if (!token) throw new PublishError('token não configurado (barra lateral)', { step: 'github' });
    const doFetch = fetchImpl || ((url, options) => fetch(url, options));
    const repoUrl = `${baseUrl}/repos/${owner}/${repo}`;

    async function call(method, path, body, { allowMissing = false } = {}) {
      let res;
      try {
        res = await doFetch(repoUrl + path, {
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: body && JSON.stringify(body),
        });
      } catch (cause) { throw new PublishError('sem conexão com o GitHub', { step: 'github', cause }); }
      if (allowMissing && res.status === 404) return null;
      if (!res.ok) {
        const detail = await messageOf(res);
        throw new PublishError(`${GITHUB_HINTS[res.status] || `HTTP ${res.status}`}${detail ? ` (${detail})` : ''}`, { step: 'github', status: res.status });
      }
      return res.json();
    }

    /** A pasta já existe de OUTRO escritório (mesmo nome, slug diferente)? Então publicar aqui sobrescreveria o trabalho dele. */
    async function assertFolderFree(folder, slug) {
      const found = await call('GET', `/contents/${encodeURIComponent(folder)}/${MARKER_FILE}?ref=${encodeURIComponent(branch)}`, undefined, { allowMissing: true });
      if (!found) return;
      let existingSlug;
      try { existingSlug = JSON.parse(atob(found.content.replace(/\s/g, ''))).slug; } catch (_) { return; }
      if (existingSlug && existingSlug !== slug) {
        throw new PublishError(`já existe uma pasta "${folder}" de outro escritório (${existingSlug}). Mude o nome do escritório ou remova a pasta`, { step: 'github' });
      }
    }

    /**
     * Grava `files` ({ nome: Blob }) em `<folder>/` num único commit. Idempotente: se nada mudou, não cria commit.
     * Arquivos que já estavam na pasta e não vieram agora ficam como estão.
     */
    async function publishFolder({ folder, files, slug, message }) {
      const head = (await call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
      const baseTree = (await call('GET', `/git/commits/${head}`)).tree.sha;
      await assertFolderFree(folder, slug);

      const marker = new Blob([JSON.stringify({ slug }, null, 2)], { type: 'application/json' });
      const entries = [];
      for (const [name, blob] of Object.entries({ ...files, [MARKER_FILE]: marker })) {
        const { sha } = await call('POST', '/git/blobs', { content: await toBase64(blob), encoding: 'base64' });
        entries.push({ path: `${folder}/${name}`, mode: '100644', type: 'blob', sha });
      }
      const tree = await call('POST', '/git/trees', { base_tree: baseTree, tree: entries });
      const folderUrl = githubFolderUrl(folder, { owner, repo, branch });
      if (tree.sha === baseTree) return { changed: false, commitSha: head, folderUrl };

      const commit = await call('POST', '/git/commits', { message, tree: tree.sha, parents: [head] });
      await call('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha });
      return { changed: true, commitSha: commit.sha, folderUrl };
    }

    return { publishFolder };
  }

  // ── Vercel ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const VERCEL_FAILED = ['ERROR', 'CANCELED'];

  function createVercelPublisher({
    token, baseUrl = VERCEL_API, fetchImpl, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), pollMs = 2000, timeoutMs = 120000,
  } = {}) {
    if (!token) throw new PublishError('token não configurado (barra lateral)', { step: 'vercel' });
    const doFetch = fetchImpl || ((url, options) => fetch(url, options));

    async function call(method, path, body) {
      let res;
      try {
        res = await doFetch(baseUrl + path, {
          method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
        });
      } catch (cause) { throw new PublishError('sem conexão com o Vercel', { step: 'vercel', cause }); }
      if (!res.ok) {
        let detail = '';
        try { detail = (await res.json()).error?.message || ''; } catch (_) { /* corpo não-JSON */ }
        throw new PublishError(detail || `HTTP ${res.status}`, { step: 'vercel', status: res.status });
      }
      return res.json();
    }

    /** Publica `files` ({ caminho: Blob }) em produção, abre o acesso público e espera o deploy ficar pronto. Devolve a URL pública. */
    async function deploy({ name, files }) {
      const payload = [];
      for (const [file, blob] of Object.entries(files)) payload.push({ file, data: await toBase64(blob), encoding: 'base64' });
      const created = await call('POST', '/v13/deployments', { name, target: 'production', files: payload, projectSettings: { framework: null } });
      // O projeto nasce com o "Deployment Protection" do Vercel (login obrigatório): o site do parceiro é público, então a proteção sai a cada deploy
      await call('PATCH', `/v9/projects/${encodeURIComponent(created.projectId || name)}`, { ssoProtection: null });

      let deployment = created;
      for (let waited = 0; deployment.readyState !== 'READY'; waited += pollMs) {
        if (VERCEL_FAILED.includes(deployment.readyState)) throw new PublishError(`o deploy terminou em ${deployment.readyState}`, { step: 'vercel' });
        if (waited >= timeoutMs) throw new PublishError('o deploy não ficou pronto a tempo', { step: 'vercel' });
        await sleep(pollMs);
        deployment = await call('GET', `/v13/deployments/${created.id}`);
      }
      const wanted = `${name}.vercel.app`;
      const aliases = deployment.alias || [];
      return { url: `https://${aliases.includes(wanted) ? wanted : (aliases[0] || wanted)}`, deploymentId: created.id };
    }

    return { deploy };
  }

  // ── Publicar ────────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * `sources`: { kind: () => Promise<Blob> } só do que o branding produziu (o que o parceiro manteve não entra). `archive`: o registro do
   * que veio do parceiro ({ caminho: () => Promise<Blob> }: originais e manifesto), gravado na pasta do GitHub junto com o resto, para
   * ficar documentado tudo de cada cliente (o onboarding já tem esses arquivos). `client` (opcional):
   * sem ele o escritório é publicado mas não entregue ao onboarding (parceira sem vínculo). `partner.keptSiteUrl`: o parceiro mantém o
   * site que já tem; ele é o site público, então não há deploy no Vercel. Sem arquivo nenhum (parceiro manteve tudo) também não há pasta
   * no GitHub, e a entrega ao onboarding segue com a lista vazia. `onProgress({ stage, kind?, phase? })`: prepare | github | vercel | onboarding.
   */
  /**
   * Obtém os arquivos de registro da pasta ({ caminho: () => Promise<Blob> }). O caminho sem extensão ganha a certa, pelo conteúdo.
   * Falha aqui interrompe tudo antes de publicar: pasta incompleta não serve como documentação.
   */
  async function collectArchive(archive) {
    const collected = {};
    for (const [path, produce] of Object.entries(archive)) {
      let blob;
      try { blob = await produce(); }
      catch (cause) { throw new Brand.BrandFileError(`não foi possível obter ${path} (${cause.message})`, { cause }); }
      collected[/\.[a-z0-9]+$/i.test(path) ? path : `${path}.${await Brand.extensionOf(blob)}`] = blob;
    }
    return collected;
  }

  /**
   * `partner.ajusteItens` (ajuste pedido item a item): `sources` traz só o que foi refeito e o servidor mantém o resto da versão anterior.
   * O site, porém, é um deploy inteiro: se a logo ou o site mudou, o Vercel recebe os dois, e o que não mudou vem de `unchanged`
   * ({ kind: () => Promise<Blob> }, do que o painel já tem). Sem mudar nenhum dos dois, não há deploy: o site no ar segue o mesmo.
   */
  async function publishOffice({ partner, sources, unchanged = {}, archive = {}, checklist, notes, client, github, vercel, toPng, onProgress = () => {} }) {
    Brand.assertComplete(partner, Object.keys(sources));
    const partial = Object.keys(partner.ajusteItens || {}).length > 0;
    const redeploy = !partner.keptSiteUrl && (!partial || VERCEL_KINDS.some(kind => kind in sources));
    const siteKinds = Object.fromEntries(VERCEL_KINDS.filter(kind => kind in sources || kind in unchanged).map(kind => [kind, sources[kind] || unchanged[kind]]));
    if (redeploy && !siteKinds.site_html) {
      throw new PublishError('o código do site não está neste navegador: refaça a etapa Site para republicar', { step: 'vercel' });
    }
    const folder = folderName(partner.nomeMarca, partner.slug);
    const stage = name => step => onProgress({ stage: name, ...step });

    const files = await Brand.prepareFiles(sources, { toPng, onProgress: stage('prepare') });
    const records = await collectArchive(archive);

    let git = null;
    const repoFiles = { ...Object.fromEntries(Object.entries(files).map(([kind, blob]) => [REPO_FILES[kind], blob])), ...records };
    if (Object.keys(repoFiles).length) {
      onProgress({ stage: 'github', folder });
      git = await github.publishFolder({
        folder, files: repoFiles, slug: partner.slug, message: `chore: publica ${folder} (v${Brand.nextVersion(partner)})`,
      });
    }

    let site = { url: partner.keptSiteUrl, deploymentId: null };
    if (redeploy) {
      onProgress({ stage: 'vercel' });
      const vercelFiles = {};
      for (const kind of VERCEL_KINDS) {
        const blob = files[kind] || (unchanged[kind] && await unchanged[kind]());
        if (blob) vercelFiles[REPO_FILES[kind]] = blob;
      }
      site = await vercel.deploy({ name: partner.slug, files: vercelFiles });
    } else if (!partner.keptSiteUrl) {
      site = null; // ajuste que não mexe no site: o servidor segue com o endereço da versão anterior
    }

    let delivered = null;
    if (client) {
      onProgress({ stage: 'onboarding' });
      delivered = await Brand.sendFiles({
        client, partner, files, checklist, notes, onProgress: stage('onboarding'),
        site: site ? { slug: partner.slug, pubUrl: site.url, ...(git && { githubUrl: git.folderUrl }) } : undefined,
      });
    }
    return { folder, git, site, delivered };
  }

  return {
    GITHUB, REPO_FILES, PublishError,
    folderName, githubFolderUrl, createGithubPublisher, createVercelPublisher, publishOffice,
  };
});
