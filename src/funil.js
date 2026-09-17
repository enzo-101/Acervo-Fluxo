/**
 * Metricas do funil comercial. Logica pura: recebe cards e fases ja carregados
 * e devolve numeros. Nao fala com rede nem com banco — por isso e testavel.
 *
 * A conversao aqui e por COORTE, nao razao de estoque: para cada fase, olhamos
 * quem *entrou* nela na semana e perguntamos quantos desses chegaram a alguma
 * fase seguinte. A razao entre cards parados em duas etapas pode marcar 50%
 * num periodo em que ninguem converteu nada — ela mede acumulo, nao avanco.
 */

/** Ordem das fases no pipe, para saber o que e "avancar". */
function indicePorFase(phases) {
  const mapa = new Map();
  phases.forEach((fase, indice) => mapa.set(fase.id, indice));
  return mapa;
}

/**
 * Entrou na fase dentro da janela? Usa `firstTimeIn`: a primeira vez que o
 * card pisou naquela etapa. Reentradas nao criam uma nova coorte.
 */
function entrouNaJanela(entrada, inicio, fim) {
  return entrada.firstTimeIn != null && entrada.firstTimeIn >= inicio && entrada.firstTimeIn < fim;
}

/**
 * Foto do funil: quantos cards estao em cada fase agora.
 */
export function snapshot(cards, phases) {
  const porFase = new Map(phases.map((f) => [f.id, 0]));
  let semFase = 0;

  for (const card of cards) {
    if (card.phaseId && porFase.has(card.phaseId)) {
      porFase.set(card.phaseId, porFase.get(card.phaseId) + 1);
    } else {
      semFase += 1;
    }
  }

  return {
    total: cards.length,
    semFase,
    fases: phases.map((fase) => ({ ...fase, total: porFase.get(fase.id) ?? 0 })),
  };
}

/**
 * Conversao por etapa, para os cards que entraram na etapa dentro da janela.
 *
 * @returns lista por fase com `entraram`, `avancaram` e `taxa` (0..1, ou null
 *          quando ninguem entrou — taxa de coorte vazia nao e zero).
 */
export function conversaoPorEtapa(cards, phases, inicio, fim) {
  const ordem = indicePorFase(phases);

  const ultimaPosicao = phases.length - 1;

  return phases.map((fase, posicao) => {
    // Da ultima fase (e de qualquer fase final) nao se "avanca": medir
    // conversao ali daria sempre 0%, que leria como fracasso quando na
    // verdade e o fim feliz do funil.
    const ehFinal = posicao === ultimaPosicao || fase.done;
    let entraram = 0;
    let avancaram = 0;

    for (const card of cards) {
      const entrada = card.history.find((h) => h.phaseId === fase.id);
      if (!entrada || !entrouNaJanela(entrada, inicio, fim)) continue;

      entraram += 1;
      const posicaoDaFase = ordem.get(fase.id) ?? -1;
      const chegouAdiante = card.history.some((h) => {
        const posicao = ordem.get(h.phaseId);
        return posicao !== undefined && posicao > posicaoDaFase && h.firstTimeIn != null;
      });
      if (chegouAdiante) avancaram += 1;
    }

    return {
      ...fase,
      ehFinal,
      entraram,
      avancaram,
      taxa: ehFinal || entraram === 0 ? null : avancaram / entraram,
    };
  });
}

/**
 * Conversao agregada por label (as coordenacoes: PRO, MNP, ACE, QAB...).
 *
 * Um card com duas labels conta para as duas — e o comportamento certo aqui,
 * porque o negocio realmente envolve as duas coordenacoes.
 */
export function conversaoPorCoordenacao(cards, phases, inicio, fim) {
  const ordem = indicePorFase(phases);
  const primeiraFase = phases[0];
  if (!primeiraFase) return [];

  const porLabel = new Map();
  const registrar = (label, campo) => {
    const atual = porLabel.get(label) ?? { label, entraram: 0, avancaram: 0, ganhos: 0 };
    atual[campo] += 1;
    porLabel.set(label, atual);
  };

  const fasesFinais = new Set(phases.filter((f) => f.done).map((f) => f.id));

  for (const card of cards) {
    // A coorte da coordenacao e a entrada no funil, nao numa etapa especifica.
    const entradaNoFunil = card.history
      .filter((h) => h.firstTimeIn != null)
      .sort((a, b) => a.firstTimeIn - b.firstTimeIn)[0];
    if (!entradaNoFunil || !entrouNaJanela(entradaNoFunil, inicio, fim)) continue;

    const labels = card.labels.length > 0 ? card.labels : ['(sem tag)'];
    const posicaoInicial = ordem.get(entradaNoFunil.phaseId) ?? -1;
    const avancou = card.history.some((h) => {
      const posicao = ordem.get(h.phaseId);
      return posicao !== undefined && posicao > posicaoInicial && h.firstTimeIn != null;
    });
    const ganhou = card.done || (card.phaseId && fasesFinais.has(card.phaseId));

    for (const label of labels) {
      registrar(label, 'entraram');
      if (avancou) registrar(label, 'avancaram');
      if (ganhou) registrar(label, 'ganhos');
    }
  }

  return [...porLabel.values()]
    .map((linha) => ({ ...linha, taxa: linha.entraram > 0 ? linha.avancaram / linha.entraram : null }))
    .sort((a, b) => b.entraram - a.entraram || a.label.localeCompare(b.label));
}

/** Cards que entraram no funil dentro da janela. */
export function novosNaJanela(cards, inicio, fim) {
  return cards.filter((card) => card.createdAt != null && card.createdAt >= inicio && card.createdAt < fim);
}
