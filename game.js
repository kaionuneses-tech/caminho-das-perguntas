// Caminho das Perguntas — lógica base
// Regras: acerto avança 1 casa (+2 pontos); erro recua 1 casa (-1 ponto, pode ficar negativo).
// As perguntas saem embaralhadas de um "baralho": ao voltar numa casa, vem pergunta nova.
// Casas especiais (sorteadas a cada partida): BÔNUS (acerto vale 2 pontos) e DICA
// (elimina alternativas erradas da pergunta daquela casa).
// Chega ao fim quando responde corretamente na última casa.
// Rank: o jogador digita o nome na tela inicial (teclado em VR); o resultado vai
// pro rank salvo no aparelho (localStorage) e aparece no fim do jogo.

const ESPACO_ENTRE_CASAS = 3;   // metros
const LETRAS = ['A', 'B', 'C', 'D', 'E'];
const CORES_CASAS = ['#ef476f', '#f8961e', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'];
const COR_CASA_FEITA = '#b7e4c7';
const COR_CASA_BONUS = '#ffd700';
const COR_CASA_DICA = '#00b4d8';
const QTD_CASAS_BONUS = 4;
const QTD_CASAS_DICA = 4;
const PONTOS_ACERTO = 2;
const PONTOS_ACERTO_BONUS = 4;  // casa bônus: acerto vale o dobro
const PONTOS_ERRO = 1;          // quanto se perde ao errar
const DURACAO_PULO = 650;       // ms
const ALTURA_PULO = 0.5;        // metros

let perguntas = [];
let perguntaAtual = null;
let fila = [];                  // baralho embaralhado de índices de perguntas
let especiais = {};             // índice da casa -> 'bonus' | 'dica'
let casaAtual = 0;
let acertos = 0;
let erros = 0;
let pontos = 0;
let travado = false;
let nomeJogador = '';

const RANK_KEY = 'cdp-rank';
const NOME_KEY = 'cdp-nome';
const TAM_MAX_NOME = 10;
const TAM_MAX_RANK = 20;
const CODIGO_MESTRE = 'MESTRE';   // digite como nome + JOGAR pra abrir o modo mestre

const $ = (id) => document.getElementById(id);

function embaralhar(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function init() {
  perguntas = await (await fetch('perguntas.json')).json();
  sortearCasasEspeciais();
  precarregarImagens();
  gerarCaminho();
  gerarCidade();
  telaInicial();
}

// ---------- Rank (salvo no aparelho via localStorage) ----------

function carregarRank() {
  try {
    return JSON.parse(localStorage.getItem(RANK_KEY)) || [];
  } catch (e) {
    return [];
  }
}

// Insere uma entrada no rank e devolve a posição dela (0 = primeiro lugar)
function salvarEntradaRank(entrada) {
  const rank = carregarRank();
  rank.push(entrada);
  rank.sort((a, b) => b.pontos - a.pontos || b.acertos - a.acertos || a.quando - b.quando);
  const posicao = rank.indexOf(entrada);
  try {
    localStorage.setItem(RANK_KEY, JSON.stringify(rank.slice(0, TAM_MAX_RANK)));
  } catch (e) { /* modo privado etc. */ }
  return posicao;
}

// Insere o resultado da partida atual no rank
function salvarNoRank() {
  return salvarEntradaRank({ nome: nomeJogador, pontos, acertos, erros, quando: Date.now() });
}

// ---------- Rank online (Firestore via REST, compartilhado entre aparelhos) ----------
// O rank local (localStorage) continua como reserva pra quando estiver sem internet.

const FIRESTORE_URL = 'https://firestore.googleapis.com/v1/projects/caminho-das-perguntas/databases/(default)/documents';

let rankOnline = null;   // cache da última leitura do servidor (null = ainda não carregou)

function obterRank() {
  return rankOnline || carregarRank();
}

async function atualizarRankOnline() {
  try {
    const resp = await fetch(`${FIRESTORE_URL}:runQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: 'rank' }],
          orderBy: [{ field: { fieldPath: 'pontos' }, direction: 'DESCENDING' }],
          limit: 50,
        },
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const dados = await resp.json();
    const lista = dados.filter((d) => d.document).map((d) => {
      const f = d.document.fields || {};
      return {
        docId: d.document.name,
        nome: f.nome?.stringValue || '?',
        pontos: parseInt(f.pontos?.integerValue ?? 0, 10),
        acertos: parseInt(f.acertos?.integerValue ?? 0, 10),
        erros: parseInt(f.erros?.integerValue ?? 0, 10),
        quando: parseInt(f.quando?.integerValue ?? 0, 10),
      };
    });
    lista.sort((a, b) => b.pontos - a.pontos || b.acertos - a.acertos || a.quando - b.quando);
    rankOnline = lista.slice(0, TAM_MAX_RANK);
  } catch (e) {
    rankOnline = null;   // sem internet ou bloqueado: as telas usam o rank local
  }
  return rankOnline;
}

// Grava uma entrada no servidor; devolve o id do documento (ou null se falhou)
async function salvarRankOnline(entrada) {
  try {
    const resp = await fetch(`${FIRESTORE_URL}/rank`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fields: {
          nome: { stringValue: entrada.nome },
          pontos: { integerValue: String(entrada.pontos) },
          acertos: { integerValue: String(entrada.acertos) },
          erros: { integerValue: String(entrada.erros) },
          quando: { integerValue: String(entrada.quando) },
        },
      }),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return (await resp.json()).name;
  } catch (e) {
    return null;
  }
}

async function limparRankOnline() {
  try {
    for (let volta = 0; volta < 10; volta++) {
      const resp = await fetch(`${FIRESTORE_URL}:runQuery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'rank' }], limit: 100 } }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const docs = (await resp.json()).filter((d) => d.document);
      if (docs.length === 0) break;
      await Promise.all(docs.map((d) =>
        fetch(`https://firestore.googleapis.com/v1/${d.document.name}`, { method: 'DELETE' })));
    }
    rankOnline = [];
  } catch (e) { /* fica só a limpeza local */ }
}

// ---------- Tela inicial: nome + teclado em VR + rank ----------

// Controla o aviso do painel: texto simples ou faixa colorida com texto branco
function definirAviso(texto, cor, comFundo) {
  const aviso = $('aviso');
  const fundo = $('avisoFundo');
  aviso.setAttribute('value', texto);
  if (comFundo) {
    aviso.setAttribute('color', '#ffffff');
    fundo.setAttribute('color', cor);
    fundo.setAttribute('visible', true);
  } else {
    aviso.setAttribute('color', cor);
    fundo.setAttribute('visible', false);
  }
}

function telaInicial() {
  $('imgPergunta').setAttribute('visible', false);
  $('status').setAttribute('value', 'CAMINHO DAS PERGUNTAS');
  mostrarRecordeNoAviso();
  try { nomeJogador = localStorage.getItem(NOME_KEY) || ''; } catch (e) { nomeJogador = ''; }

  const tela = document.createElement('a-entity');
  tela.setAttribute('id', 'telaInicio');
  tela.setAttribute('position', '0 0 0.02');
  $('painel').appendChild(tela);
  mostrarVistaNome();

  // busca o rank online e atualiza a linha do recorde quando chegar
  atualizarRankOnline().then(() => {
    if ($('telaInicio') && !$('pontosMestreDisplay')) mostrarRecordeNoAviso();
  });

  // teclado físico do PC também funciona
  window.addEventListener('keydown', aoTeclarNome);
}

// Vista 1 da tela inicial: digitar o nome
function mostrarVistaNome() {
  const tela = $('telaInicio');
  tela.innerHTML = '';

  const rotulo = document.createElement('a-text');
  rotulo.setAttribute('value', 'Digite seu nome:');
  rotulo.setAttribute('align', 'center');
  rotulo.setAttribute('color', '#073b4c');
  rotulo.setAttribute('width', 2);
  rotulo.setAttribute('position', '0 0.62 0');
  tela.appendChild(rotulo);

  const nome = document.createElement('a-text');
  nome.setAttribute('id', 'nomeDisplay');
  nome.setAttribute('align', 'center');
  nome.setAttribute('color', '#118ab2');
  nome.setAttribute('width', 3.2);
  nome.setAttribute('position', '0 0.42 0');
  tela.appendChild(nome);
  atualizarNomeDisplay();

  criarTeclado(tela, 0.18);
  botaoTecla(tela, -0.35, -0.78, 'JOGAR', 0.85, '#06d6a0', iniciarJogo);
  botaoTecla(tela, 0.55, -0.78, 'VER RANK', 0.7, '#f8961e', mostrarVistaRank);
}

// Teclado A-Z + APAGAR, com a primeira linha em yTopo
function criarTeclado(tela, yTopo) {
  const linhas = ['ABCDEFG', 'HIJKLMN', 'OPQRSTU', 'VWXYZ'];
  linhas.forEach((linha, li) => {
    const y = yTopo - li * 0.24;
    const x0 = -((linha.length - 1) * 0.24) / 2;
    [...linha].forEach((letra, ci) => {
      botaoTecla(tela, x0 + ci * 0.24, y, letra, 0.2, '#118ab2', () => {
        if (nomeJogador.length < TAM_MAX_NOME) {
          nomeJogador += letra;
          atualizarNomeDisplay();
        }
      });
    });
  });
  botaoTecla(tela, 0.82, yTopo - 0.72, 'APAGAR', 0.5, '#ef476f', () => {
    nomeJogador = nomeJogador.slice(0, -1);
    atualizarNomeDisplay();
  });
}

// ---------- Modo mestre (escondido: digite MESTRE como nome e clique JOGAR) ----------
// Permite colocar qualquer nome e pontuação no rank — e limpar o rank da turma.

let pontosMestre = 500;

function mostrarVistaMestre() {
  const tela = $('telaInicio');
  tela.innerHTML = '';
  $('status').setAttribute('value', 'MODO MESTRE');
  definirAviso('Monte uma entrada do rank do seu jeito', '#9b5de5', true);

  const nome = document.createElement('a-text');
  nome.setAttribute('id', 'nomeDisplay');
  nome.setAttribute('align', 'center');
  nome.setAttribute('color', '#9b5de5');
  nome.setAttribute('width', 3.2);
  nome.setAttribute('position', '0 0.58 0');
  tela.appendChild(nome);
  atualizarNomeDisplay();

  criarTeclado(tela, 0.34);

  // ajuste de pontos: -50 -10 [valor] +10 +50
  const valor = document.createElement('a-text');
  valor.setAttribute('id', 'pontosMestreDisplay');
  valor.setAttribute('align', 'center');
  valor.setAttribute('color', '#073b4c');
  valor.setAttribute('width', 2.6);
  valor.setAttribute('position', '0 -0.62 0');
  tela.appendChild(valor);
  const atualizarValor = () => valor.setAttribute('value', `${pontosMestre} pts`);
  atualizarValor();
  const ajustar = (delta) => () => { pontosMestre += delta; atualizarValor(); };
  botaoTecla(tela, -0.95, -0.62, '-50', 0.34, '#ef476f', ajustar(-50));
  botaoTecla(tela, -0.55, -0.62, '-10', 0.34, '#ef476f', ajustar(-10));
  botaoTecla(tela, 0.55, -0.62, '+10', 0.34, '#06d6a0', ajustar(10));
  botaoTecla(tela, 0.95, -0.62, '+50', 0.34, '#06d6a0', ajustar(50));

  botaoTecla(tela, -0.8, -0.85, 'SALVAR', 0.62, '#06d6a0', async () => {
    const entrada = {
      nome: nomeJogador || 'MESTRE',
      pontos: pontosMestre,
      acertos: 0,
      erros: 0,
      quando: Date.now(),
    };
    salvarEntradaRank(entrada);          // reserva local
    nomeJogador = '';
    $('status').setAttribute('value', 'CAMINHO DAS PERGUNTAS');
    await salvarRankOnline(entrada);     // rank compartilhado
    mostrarVistaRank().then(mostrarRecordeNoAviso);
  });
  botaoTecla(tela, 0.05, -0.85, 'LIMPAR RANK', 0.86, '#f8961e', async function aoLimpar() {
    const botao = this;
    const texto = botao.querySelector('a-text');
    if (texto.getAttribute('value') === 'LIMPAR RANK') {
      // primeiro clique só pede confirmação
      texto.setAttribute('value', 'CONFIRMA?');
      botao.setAttribute('color', '#ef476f');
    } else {
      try { localStorage.removeItem(RANK_KEY); } catch (e) { /* ok */ }
      texto.setAttribute('value', 'LIMPANDO...');
      await limparRankOnline();
      mostrarRecordeNoAviso();
      texto.setAttribute('value', 'LIMPAR RANK');
      botao.setAttribute('color', '#f8961e');
    }
  });
  botaoTecla(tela, 0.85, -0.85, 'VOLTAR', 0.55, '#118ab2', () => {
    $('status').setAttribute('value', 'CAMINHO DAS PERGUNTAS');
    mostrarRecordeNoAviso();
    mostrarVistaNome();
  });
}

function mostrarRecordeNoAviso() {
  const rank = obterRank();
  definirAviso(rank.length
    ? `RECORDE: ${rank[0].nome} com ${rank[0].pontos} pts`
    : 'Seja o primeiro no rank!', '#f8961e', false);
}

// Vista 2 da tela inicial: quadro do rank (busca a versão online antes de mostrar)
async function mostrarVistaRank() {
  const tela = $('telaInicio');
  tela.innerHTML = '';
  botaoTecla(tela, 0, -0.78, 'VOLTAR', 0.85, '#118ab2', mostrarVistaNome);

  const carregando = document.createElement('a-text');
  carregando.setAttribute('id', 'rankCarregando');
  carregando.setAttribute('value', 'Carregando rank online...');
  carregando.setAttribute('align', 'center');
  carregando.setAttribute('color', '#073b4c');
  carregando.setAttribute('width', 2);
  carregando.setAttribute('position', '0 0.05 0');
  tela.appendChild(carregando);

  await atualizarRankOnline();
  if (!$('rankCarregando')) return;   // jogador já saiu desta vista
  tela.removeChild(carregando);
  const quadro = montarPainelRank(-1, obterRank());
  quadro.setAttribute('position', '0 0.02 0');
  tela.appendChild(quadro);
  if (!rankOnline) {
    const avisoOffline = document.createElement('a-text');
    avisoOffline.setAttribute('value', 'Sem internet: mostrando o rank deste aparelho');
    avisoOffline.setAttribute('align', 'center');
    avisoOffline.setAttribute('color', '#ef476f');
    avisoOffline.setAttribute('width', 1.6);
    avisoOffline.setAttribute('position', '0 -0.6 0');
    tela.appendChild(avisoOffline);
  }
}

// Quadro decorado do rank: título dourado, medalhas ouro/prata/bronze e
// a linha do jogador destacada em verde. destaque = posição a marcar (-1: nenhuma).
function montarPainelRank(destaque, rank) {
  const cont = document.createElement('a-entity');
  cont.setAttribute('id', 'painelRank');

  const titulo = document.createElement('a-plane');
  titulo.setAttribute('width', 1.6);
  titulo.setAttribute('height', 0.26);
  titulo.setAttribute('color', '#ffd700');
  titulo.setAttribute('position', '0 0.45 0');
  const tituloTexto = document.createElement('a-text');
  tituloTexto.setAttribute('value', 'RANKING');
  tituloTexto.setAttribute('align', 'center');
  tituloTexto.setAttribute('color', '#073b4c');
  tituloTexto.setAttribute('width', 3.4);
  tituloTexto.setAttribute('position', '0 0 0.01');
  titulo.appendChild(tituloTexto);
  cont.appendChild(titulo);

  if (rank.length === 0) {
    const vazio = document.createElement('a-text');
    vazio.setAttribute('value', 'Ainda nao tem ninguem aqui.\nJogue e seja o primeiro!');
    vazio.setAttribute('align', 'center');
    vazio.setAttribute('color', '#073b4c');
    vazio.setAttribute('width', 2);
    vazio.setAttribute('position', '0 0.05 0');
    cont.appendChild(vazio);
    return cont;
  }

  const MEDALHAS = ['#ffd700', '#c0c0c0', '#cd7f32'];
  const linha = (posicao, r, y, ehVoce) => {
    const placa = document.createElement('a-plane');
    placa.setAttribute('width', 2.2);
    placa.setAttribute('height', 0.17);
    placa.setAttribute('color', ehVoce ? '#b7f7d8' : '#e9edf2');
    placa.setAttribute('position', `0 ${y} 0`);
    cont.appendChild(placa);

    const medalha = document.createElement('a-circle');
    medalha.setAttribute('radius', 0.08);
    medalha.setAttribute('segments', 20);
    medalha.setAttribute('color', MEDALHAS[posicao] || '#118ab2');
    medalha.setAttribute('position', `-0.95 ${y} 0.005`);
    cont.appendChild(medalha);

    const num = document.createElement('a-text');
    num.setAttribute('value', String(posicao + 1));
    num.setAttribute('align', 'center');
    num.setAttribute('color', posicao < 3 ? '#073b4c' : '#ffffff');
    num.setAttribute('width', 2.4);
    num.setAttribute('position', `-0.95 ${y} 0.01`);
    cont.appendChild(num);

    const nome = document.createElement('a-text');
    nome.setAttribute('value', ehVoce ? `${r.nome} (voce)` : r.nome);
    nome.setAttribute('align', 'left');
    nome.setAttribute('color', '#073b4c');
    nome.setAttribute('width', 2.2);
    nome.setAttribute('position', `-0.78 ${y} 0.01`);
    cont.appendChild(nome);

    const pts = document.createElement('a-text');
    pts.setAttribute('value', `${r.pontos} pts`);
    pts.setAttribute('align', 'right');
    pts.setAttribute('color', '#118ab2');
    pts.setAttribute('width', 2.2);
    pts.setAttribute('position', `1.02 ${y} 0.01`);
    cont.appendChild(pts);
  };

  if (destaque >= 5) {
    // top 4, reticências e a linha do jogador
    rank.slice(0, 4).forEach((r, i) => linha(i, r, 0.2 - i * 0.19, false));
    const retic = document.createElement('a-text');
    retic.setAttribute('value', '...');
    retic.setAttribute('align', 'center');
    retic.setAttribute('color', '#073b4c');
    retic.setAttribute('width', 2.4);
    retic.setAttribute('position', '0 -0.55 0.01');
    cont.appendChild(retic);
    const eu = rank[destaque] || { nome: nomeJogador, pontos };
    linha(destaque, eu, -0.68, true);
  } else {
    rank.slice(0, 5).forEach((r, i) => linha(i, r, 0.2 - i * 0.19, i === destaque));
  }
  return cont;
}

function botaoTecla(pai, x, y, rotulo, largura, cor, aoClicar) {
  const b = document.createElement('a-plane');
  b.classList.add('clicavel');
  b.setAttribute('width', largura);
  b.setAttribute('height', 0.2);
  b.setAttribute('color', cor);
  b.setAttribute('position', `${x} ${y} 0`);
  const t = document.createElement('a-text');
  t.setAttribute('value', rotulo);
  t.setAttribute('align', 'center');
  t.setAttribute('color', '#ffffff');
  t.setAttribute('width', 2.2);
  t.setAttribute('position', '0 0 0.01');
  b.appendChild(t);
  b.addEventListener('mouseenter', () => b.setAttribute('scale', '1.12 1.12 1'));
  b.addEventListener('mouseleave', () => b.setAttribute('scale', '1 1 1'));
  b.addEventListener('click', aoClicar);
  pai.appendChild(b);
}

function atualizarNomeDisplay() {
  const el = $('nomeDisplay');
  if (el) el.setAttribute('value', (nomeJogador || '') + '_');
}

function aoTeclarNome(e) {
  if (!$('nomeDisplay')) return; // só na vista de digitar o nome
  if (/^[a-zA-Z]$/.test(e.key) && nomeJogador.length < TAM_MAX_NOME) {
    nomeJogador += e.key.toUpperCase();
    atualizarNomeDisplay();
  } else if (e.key === 'Backspace') {
    nomeJogador = nomeJogador.slice(0, -1);
    atualizarNomeDisplay();
  } else if (e.key === 'Enter' && !$('pontosMestreDisplay')) {
    iniciarJogo();
  }
}

function iniciarJogo() {
  if (nomeJogador === CODIGO_MESTRE) {
    nomeJogador = '';
    mostrarVistaMestre();
    return;
  }
  if (!nomeJogador) nomeJogador = 'JOGADOR';
  try { localStorage.setItem(NOME_KEY, nomeJogador); } catch (e) { /* ok */ }
  window.removeEventListener('keydown', aoTeclarNome);
  const tela = $('telaInicio');
  if (tela) tela.parentNode.removeChild(tela);
  mostrarPergunta();
}

// Tira a próxima pergunta do baralho; quando acaba, reembaralha todas.
function proximaPergunta() {
  if (fila.length === 0) {
    fila = embaralhar([...perguntas.keys()]);
    // evita repetir imediatamente a pergunta que acabou de aparecer
    if (perguntaAtual && perguntas[fila[fila.length - 1]] === perguntaAtual && fila.length > 1) {
      fila.unshift(fila.pop());
    }
  }
  return perguntas[fila.pop()];
}

function sortearCasasEspeciais() {
  especiais = {};
  const indices = embaralhar([...perguntas.keys()].slice(1)); // casa 1 (índice 0) fica normal
  indices.slice(0, QTD_CASAS_BONUS).forEach((i) => { especiais[i] = 'bonus'; });
  indices.slice(QTD_CASAS_BONUS, QTD_CASAS_BONUS + QTD_CASAS_DICA).forEach((i) => { especiais[i] = 'dica'; });
}

function precarregarImagens() {
  const assets = $('assets');
  perguntas.forEach((p) => {
    const img = document.createElement('img');
    img.id = `img-${p.id}`;
    img.src = p.img;
    assets.appendChild(img);
  });
}

function corDaCasa(i) {
  if (i < casaAtual) return COR_CASA_FEITA;
  if (especiais[i] === 'bonus') return COR_CASA_BONUS;
  if (especiais[i] === 'dica') return COR_CASA_DICA;
  return CORES_CASAS[i % CORES_CASAS.length];
}

function gerarCaminho() {
  const caminho = $('caminho');
  perguntas.forEach((_, i) => {
    const casa = document.createElement('a-box');
    casa.setAttribute('id', `casa-${i}`);
    casa.setAttribute('width', 1.6);
    casa.setAttribute('depth', 1.6);
    casa.setAttribute('height', 0.12);
    casa.setAttribute('position', `0 0.06 ${-i * ESPACO_ENTRE_CASAS}`);
    casa.setAttribute('color', corDaCasa(i));
    const num = document.createElement('a-text');
    num.setAttribute('value', String(i + 1));
    num.setAttribute('align', 'center');
    num.setAttribute('color', '#073b4c');
    num.setAttribute('rotation', '-90 0 0');
    num.setAttribute('position', '0 0.07 0');
    num.setAttribute('width', 4);
    casa.appendChild(num);
    caminho.appendChild(casa);

    // Ícone flutuante das casas especiais
    if (especiais[i]) {
      const icone = document.createElement('a-text');
      icone.setAttribute('value', especiais[i] === 'bonus' ? '2x' : '?');
      icone.setAttribute('color', especiais[i] === 'bonus' ? '#ffd700' : '#00b4d8');
      icone.setAttribute('align', 'center');
      icone.setAttribute('width', 8);
      icone.setAttribute('side', 'double');
      const z = -i * ESPACO_ENTRE_CASAS;
      icone.setAttribute('position', `0.95 0.7 ${z}`);
      icone.setAttribute('animation', `property: position; from: 0.95 0.7 ${z}; to: 0.95 1 ${z}; dir: alternate; dur: 800; loop: true; easing: easeInOutSine`);
      caminho.appendChild(icone);
    }

    // Faixa central da rua ligando as casas
    if (i > 0) {
      for (let d = 1; d <= 2; d++) {
        const traco = document.createElement('a-box');
        traco.setAttribute('width', 0.25);
        traco.setAttribute('depth', 0.45);
        traco.setAttribute('height', 0.04);
        traco.setAttribute('color', '#fffdf7');
        traco.setAttribute('position', `0 0.02 ${-(i - 1) * ESPACO_ENTRE_CASAS - d * (ESPACO_ENTRE_CASAS / 3)}`);
        caminho.appendChild(traco);
      }
    }
  });

  // Marcador flutuante da casa atual (anel que sobe e desce)
  const marcador = document.createElement('a-entity');
  marcador.setAttribute('id', 'marcador');
  const anel = document.createElement('a-torus');
  anel.setAttribute('radius', 0.55);
  anel.setAttribute('radius-tubular', 0.03);
  anel.setAttribute('segments-radial', 10);
  anel.setAttribute('segments-tubular', 24);
  anel.setAttribute('rotation', '-90 0 0');
  anel.setAttribute('color', '#ffd166');
  anel.setAttribute('position', '0 0.18 0');
  anel.setAttribute('animation', 'property: position; from: 0 0.18 0; to: 0 0.4 0; dir: alternate; dur: 700; loop: true; easing: easeInOutSine');
  marcador.appendChild(anel);
  caminho.appendChild(marcador);

  // Chegada: base, mastro e bandeira
  const fimZ = -perguntas.length * ESPACO_ENTRE_CASAS;
  const chegada = document.createElement('a-entity');
  chegada.setAttribute('position', `0 0 ${fimZ}`);
  chegada.innerHTML = `
    <a-cylinder radius="0.6" height="0.15" color="#ffd166" position="0 0.07 0" segments-radial="16"></a-cylinder>
    <a-cylinder radius="0.05" height="2.4" color="#6c584c" position="0 1.2 0" segments-radial="8"></a-cylinder>
    <a-triangle vertex-a="0 0.4 0" vertex-b="0 0 0" vertex-c="0.7 0.2 0" color="#ef476f"
                material="side: double" position="0.02 1.95 0"></a-triangle>
    <a-text value="CHEGADA" align="center" color="#073b4c" width="6" position="0 0.55 0.7"
            animation="property: position; from: 0 0.55 0.7; to: 0 0.75 0.7; dir: alternate; dur: 900; loop: true; easing: easeInOutSine"></a-text>
  `;
  caminho.appendChild(chegada);
}

// Fachada de prédio desenhada em canvas (janelas acesas/apagadas)
function texturaPredio(corFachada) {
  const c = document.createElement('canvas');
  c.width = 96;
  c.height = 192;
  const x = c.getContext('2d');
  x.fillStyle = corFachada;
  x.fillRect(0, 0, 96, 192);
  for (let ly = 0; ly < 8; ly++) {
    for (let lx = 0; lx < 4; lx++) {
      x.fillStyle = Math.random() < 0.35 ? '#ffe9a0' : '#2b3a4a';
      x.fillRect(8 + lx * 22, 10 + ly * 22, 14, 14);
    }
  }
  return c.toDataURL();
}

function gerarCidade() {
  const cenario = $('cenario');
  const fimZ = -perguntas.length * ESPACO_ENTRE_CASAS;
  const fachadas = ['#e29578', '#f2cc8f', '#81b29a', '#a5a58d', '#adb5bd', '#e07a5f']
    .map((cor) => texturaPredio(cor));

  // Prédios dos dois lados da rua
  for (let z = -4; z > fimZ - 4; z -= 6.5) {
    [-1, 1].forEach((lado) => {
      const largura = 2.6 + Math.random() * 1.2;
      const altura = 2.5 + Math.random() * 4.5;
      const profundidade = 2.6 + Math.random() * 1.2;
      const x = lado * (5.4 + Math.random() * 1.8);
      const zz = z - Math.random() * 2;

      const predio = document.createElement('a-box');
      predio.setAttribute('width', largura);
      predio.setAttribute('depth', profundidade);
      predio.setAttribute('height', altura);
      predio.setAttribute('position', `${x} ${altura / 2} ${zz}`);
      predio.setAttribute('material', `src: url(${fachadas[Math.floor(Math.random() * fachadas.length)]}); repeat: 1 ${Math.max(1, Math.round(altura / 2.5))}`);
      cenario.appendChild(predio);

      // Tampa do telhado (esconde a textura esticada no topo)
      const telhado = document.createElement('a-box');
      telhado.setAttribute('width', largura + 0.2);
      telhado.setAttribute('depth', profundidade + 0.2);
      telhado.setAttribute('height', 0.12);
      telhado.setAttribute('color', '#3d405b');
      telhado.setAttribute('position', `${x} ${altura + 0.06} ${zz}`);
      cenario.appendChild(telhado);
    });
  }

  // Postes de luz alternando os lados da rua
  for (let i = 0; i < 10; i++) {
    const z = -6 - i * 8;
    const lado = i % 2 === 0 ? -1 : 1;
    const poste = document.createElement('a-entity');
    poste.setAttribute('position', `${lado * 2.9} 0 ${z}`);
    poste.innerHTML = `
      <a-cylinder radius="0.04" height="2.6" color="#40484f" position="0 1.3 0" segments-radial="6"></a-cylinder>
      <a-sphere radius="0.13" position="0 2.7 0" segments-width="8" segments-height="6"
                material="shader: flat; color: #fff3b0"></a-sphere>
    `;
    cenario.appendChild(poste);
  }

  // Algumas árvores de calçada entre os prédios
  for (let i = 0; i < 8; i++) {
    const z = -9 - i * 9;
    const lado = i % 2 === 0 ? 1 : -1;
    const arvore = document.createElement('a-entity');
    arvore.setAttribute('position', `${lado * 3.1} 0 ${z}`);
    const copaCor = ['#588157', '#6a994e', '#7cb518'][i % 3];
    arvore.innerHTML = `
      <a-cylinder radius="0.1" height="0.6" color="#8d5a2b" position="0 0.3 0" segments-radial="6"></a-cylinder>
      <a-sphere radius="0.5" color="${copaCor}" position="0 0.95 0" segments-width="8" segments-height="6"></a-sphere>
    `;
    cenario.appendChild(arvore);
  }

  // Símbolos de matemática flutuando sobre a cidade, como letreiros
  const simbolos = ['+', '-', 'x', '=', '%', '2', '3', '7', '9'];
  const coresSimbolos = ['#ef476f', '#f8961e', '#06d6a0', '#118ab2', '#9b5de5'];
  for (let i = 0; i < 10; i++) {
    const t = document.createElement('a-text');
    t.setAttribute('value', simbolos[i % simbolos.length]);
    t.setAttribute('color', coresSimbolos[i % coresSimbolos.length]);
    t.setAttribute('align', 'center');
    t.setAttribute('width', 7 + Math.random() * 4);
    t.setAttribute('side', 'double');
    const x = (i % 2 === 0 ? -1 : 1) * (4.6 + Math.random() * 1.4);
    const y = 3.4 + Math.random() * 3;
    const z = -6 - (i / 10) * (-fimZ - 10);
    t.setAttribute('position', `${x} ${y} ${z}`);
    t.setAttribute('animation', `property: position; from: ${x} ${y} ${z}; to: ${x} ${y + 0.35} ${z}; dir: alternate; dur: ${1400 + Math.random() * 800}; loop: true; easing: easeInOutSine`);
    cenario.appendChild(t);
  }

  // Nuvens
  for (let i = 0; i < 7; i++) {
    const nuvem = document.createElement('a-sphere');
    nuvem.setAttribute('radius', 1.6 + Math.random() * 1.2);
    nuvem.setAttribute('scale', '1 0.45 1');
    nuvem.setAttribute('segments-width', 10);
    nuvem.setAttribute('segments-height', 8);
    nuvem.setAttribute('material', 'shader: flat; color: #ffffff; fog: false');
    const x = (Math.random() < 0.5 ? -1 : 1) * (9 + Math.random() * 16);
    nuvem.setAttribute('position', `${x} ${11 + Math.random() * 5} ${-8 - Math.random() * (-fimZ)}`);
    cenario.appendChild(nuvem);
  }
}

// Troca a imagem do painel aplicando a textura direto no material (via canvas).
// O caminho normal (setAttribute('src', '#img-N')) falhava em trocar a textura
// exibida; este caminho é determinístico e libera a textura anterior da memória.
let texturaAtual = null;
function aplicarImagemPergunta(p) {
  const img = $(`img-${p.id}`);
  const mesh = $('imgPergunta').getObject3D('mesh');
  if (!mesh) {           // cena ainda montando
    setTimeout(() => aplicarImagemPergunta(p), 100);
    return;
  }
  if (!img.complete || !img.naturalWidth) {   // imagem ainda baixando
    img.addEventListener('load', () => aplicarImagemPergunta(p), { once: true });
    return;
  }
  if (p !== perguntaAtual) return;            // jogador já mudou de pergunta
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  c.getContext('2d').drawImage(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (texturaAtual) texturaAtual.dispose();
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
  texturaAtual = tex;
}

function atualizarPlacar() {
  $('placarTexto').setAttribute('value', String(pontos));
}

function mostrarPergunta() {
  perguntaAtual = proximaPergunta();
  const p = perguntaAtual;
  const tipo = especiais[casaAtual];
  pintarCasas();
  atualizarPlacar();

  aplicarImagemPergunta(p);
  $('imgPergunta').setAttribute('visible', true);
  $('status').setAttribute('value', `Casa ${casaAtual + 1} de ${perguntas.length}`);

  if (tipo === 'bonus') {
    definirAviso(`CASA BÔNUS: acerto vale ${PONTOS_ACERTO_BONUS} pontos!`, '#f8961e', true);
  } else if (tipo === 'dica') {
    definirAviso('CASA DICA: eliminei alternativas erradas!', '#0096c7', true);
  } else {
    definirAviso('', '#f8961e', false);
  }

  // "pop" do painel ao trocar de pergunta
  const painel = $('painel');
  painel.removeAttribute('animation__pop');
  painel.setAttribute('animation__pop', 'property: scale; from: 0.92 0.92 0.92; to: 1 1 1; dur: 220; easing: easeOutBack');

  const botoes = $('botoes');
  botoes.innerHTML = '';
  const n = p.alternativas;

  // Casa DICA: sorteia alternativas erradas pra eliminar (deixa ao menos 2 opções)
  let eliminadas = [];
  if (tipo === 'dica') {
    const erradas = embaralhar(LETRAS.slice(0, n).filter((l) => l !== p.correta));
    eliminadas = erradas.slice(0, Math.min(2, n - 2));
  }

  const raio = 0.17, gap = 0.12;
  const passo = raio * 2 + gap;
  const inicio = -((n - 1) * passo) / 2;

  for (let i = 0; i < n; i++) {
    const letra = LETRAS[i];
    const b = document.createElement('a-circle');
    b.setAttribute('radius', raio);
    b.setAttribute('segments', 24);
    b.setAttribute('position', `${inicio + i * passo} 0 0.01`);
    const t = document.createElement('a-text');
    t.setAttribute('value', letra);
    t.setAttribute('align', 'center');
    t.setAttribute('width', 3);
    t.setAttribute('position', '0 0 0.01');
    b.appendChild(t);

    if (eliminadas.includes(letra)) {
      // alternativa eliminada pela dica: apagada e sem clique
      b.setAttribute('material', 'color: #8d99ae; opacity: 0.35');
      t.setAttribute('color', '#dee2e6');
    } else {
      b.classList.add('clicavel');
      b.setAttribute('color', '#118ab2');
      t.setAttribute('color', '#ffffff');
      b.addEventListener('mouseenter', () => { if (!travado) b.setAttribute('scale', '1.18 1.18 1'); });
      b.addEventListener('mouseleave', () => b.setAttribute('scale', '1 1 1'));
      b.addEventListener('click', () => responder(letra, b));
    }
    botoes.appendChild(b);
  }
  travado = false;
}

function responder(letra, botao) {
  if (travado) return;
  travado = true;
  const p = perguntaAtual;
  const certo = letra === p.correta;
  const tipo = especiais[casaAtual];

  botao.setAttribute('color', certo ? '#06d6a0' : '#ef476f');
  if (certo) {
    const ganho = tipo === 'bonus' ? PONTOS_ACERTO_BONUS : PONTOS_ACERTO;
    pontos += ganho;
    acertos++;
    $('status').setAttribute('value', `Correto! +${ganho} ponto${ganho > 1 ? 's' : ''}`);
  } else {
    pontos -= PONTOS_ERRO;
    erros++;
    $('status').setAttribute('value', `Errou! -${PONTOS_ERRO} ponto. Voltando...`);
  }
  atualizarPlacar();

  setTimeout(() => {
    const chegouAoFim = certo && casaAtual + 1 >= perguntas.length;
    if (certo) {
      casaAtual++;
    } else {
      casaAtual = Math.max(0, casaAtual - 1);
    }
    animarPulo(-casaAtual * ESPACO_ENTRE_CASAS, () => {
      if (chegouAoFim) fimDeJogo();
      else mostrarPergunta();
    });
  }, 900);
}

function pintarCasas() {
  perguntas.forEach((_, i) => {
    $(`casa-${i}`).setAttribute('color', corDaCasa(i));
  });
  const marcador = $('marcador');
  if (casaAtual < perguntas.length) {
    marcador.setAttribute('visible', true);
    marcador.setAttribute('position', `0 0 ${-casaAtual * ESPACO_ENTRE_CASAS}`);
  } else {
    marcador.setAttribute('visible', false);
  }
}

// Pulo de peça de tabuleiro: arco parabólico do rig até a casa alvo.
// O painel desliza junto, sem pular, pra não enjoar.
function animarPulo(zAlvo, aoTerminar) {
  const rig = $('rig').object3D;
  const painel = $('painel').object3D;
  const z0 = rig.position.z;
  const painelZ0 = painel.position.z;
  const painelZAlvo = zAlvo - 2.2;
  const t0 = performance.now();

  function quadro(agora) {
    let p = (agora - t0) / DURACAO_PULO;
    if (p > 1) p = 1;
    const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2; // easeInOutQuad
    rig.position.z = z0 + (zAlvo - z0) * e;
    rig.position.y = Math.sin(Math.PI * p) * ALTURA_PULO;
    painel.position.z = painelZ0 + (painelZAlvo - painelZ0) * e;
    if (p < 1) {
      requestAnimationFrame(quadro);
    } else {
      rig.position.y = 0;
      $('rig').setAttribute('position', `0 0 ${zAlvo}`);
      $('painel').setAttribute('position', `0 1.6 ${painelZAlvo}`);
      if (aoTerminar) aoTerminar();
    }
  }
  requestAnimationFrame(quadro);
}

function fimDeJogo() {
  pintarCasas();
  atualizarPlacar();
  $('imgPergunta').setAttribute('visible', false);
  $('statusBar').setAttribute('visible', false);
  definirAviso('', '#f8961e', false);

  $('status').setAttribute('value', `Fim de jogo, ${nomeJogador}!\nPontos: ${pontos}   Acertos: ${acertos}   Erros: ${erros}`);
  $('status').setAttribute('position', '0 0.68 0.02');
  $('status').setAttribute('color', '#073b4c');
  $('status').setAttribute('width', 2.2);

  // salva local (reserva) e online, depois mostra o quadro com a posição real
  const entrada = { nome: nomeJogador, pontos, acertos, erros, quando: Date.now() };
  const posicaoLocal = salvarEntradaRank(entrada);
  const salvando = document.createElement('a-text');
  salvando.setAttribute('value', 'Salvando no rank online...');
  salvando.setAttribute('align', 'center');
  salvando.setAttribute('color', '#073b4c');
  salvando.setAttribute('width', 2);
  salvando.setAttribute('position', '0 -0.1 0.02');
  $('painel').appendChild(salvando);

  (async () => {
    const docId = await salvarRankOnline(entrada);
    await atualizarRankOnline();
    $('painel').removeChild(salvando);
    let rank, destaque;
    if (docId && rankOnline) {
      rank = rankOnline;
      destaque = rank.findIndex((r) => r.docId === docId);
    } else {
      rank = carregarRank();
      destaque = posicaoLocal;
    }
    const quadro = montarPainelRank(destaque, rank);
    quadro.setAttribute('position', '0 -0.14 0.02');
    $('painel').appendChild(quadro);
  })();

  const botoes = $('botoes');
  botoes.innerHTML = '';
  const b = document.createElement('a-plane');
  b.classList.add('clicavel');
  b.setAttribute('width', 1.3);
  b.setAttribute('height', 0.3);
  b.setAttribute('color', '#06d6a0');
  b.setAttribute('position', '0 0 0.01');
  const t = document.createElement('a-text');
  t.setAttribute('value', 'JOGAR DE NOVO');
  t.setAttribute('align', 'center');
  t.setAttribute('color', '#073b4c');
  t.setAttribute('width', 2.6);
  t.setAttribute('position', '0 0 0.01');
  b.appendChild(t);
  b.addEventListener('mouseenter', () => b.setAttribute('scale', '1.1 1.1 1'));
  b.addEventListener('mouseleave', () => b.setAttribute('scale', '1 1 1'));
  b.addEventListener('click', () => window.location.reload());
  botoes.appendChild(b);
}

window.addEventListener('DOMContentLoaded', init);
