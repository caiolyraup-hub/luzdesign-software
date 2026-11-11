import { describe, expect, it } from "vitest";
import {
  calcularKit,
  comprimentoM,
  escolherFonte,
  lerMetros,
  potenciaW,
  tensaoV,
  type ProdutoKit,
} from "./kit-fita";

const p = (codigo: string, descricao: string, extra: Partial<ProdutoKit> = {}): ProdutoKit => ({
  codigo,
  descricao,
  categoria: null,
  unidade: "un",
  preco: 10,
  atributos: {},
  ...extra,
});

const fita = (w: number | null, extra: Partial<ProdutoKit> = {}) =>
  p("11208", "MT FITA MB 7,2W 4.0K", {
    categoria: "FITA LED",
    unidade: "m",
    preco: 30,
    atributos: w === null ? {} : { w },
    ...extra,
  });
const perfil = (extra: Partial<ProdutoKit> = {}) =>
  p("12086", "NIT. PS201B 3M", {
    categoria: "PERFIL",
    preco: 95,
    atributos: { comprimento: 3 },
    ...extra,
  });
// Fontes do catálogo provisório (sem tensão na descrição).
const FONTES = [24, 36, 48, 60, 72, 100, 120, 150].map((w, i) =>
  p(String(10338 + i), `MB ${w}W`, { categoria: "FONTE", preco: w, atributos: { w } }),
);

describe("parser dos dados do produto", () => {
  it("potência: atributos primeiro, depois a descrição", () => {
    expect(potenciaW({ atributos: { w: 22 }, descricao: "x" })).toBe(22);
    expect(potenciaW({ atributos: {}, descricao: "MT FITA MB 7,2W 4.0K" })).toBe(7.2);
    expect(potenciaW({ atributos: {}, descricao: "MTS FITA 22W/M NT" })).toBe(22);
    expect(potenciaW({ atributos: {}, descricao: "60W MB" })).toBe(60);
    expect(potenciaW({ atributos: {}, descricao: "30660/250BR" })).toBeNull();
    expect(potenciaW({ atributos: {}, descricao: "WIFI SPOT" })).toBeNull();
  });

  it("tensão: 12, 24 e 220 V na descrição; sem tensão = nulo", () => {
    expect(tensaoV({ atributos: {}, descricao: "FITA 12V 4.0K" })).toBe(12);
    expect(tensaoV({ atributos: {}, descricao: "FONTE 24 VDC 60W" })).toBe(24);
    expect(tensaoV({ atributos: {}, descricao: "MTS FITA 10W/M 220V BR AVANT" })).toBe(220);
    expect(tensaoV({ atributos: { v: 12 }, descricao: "x" })).toBe(12);
    expect(tensaoV({ atributos: {}, descricao: "MB 24W" })).toBeNull(); // 24W não é 24 V
    expect(tensaoV({ atributos: {}, descricao: "FITA 7,2W 4.0K IP66" })).toBeNull();
  });

  it("comprimento: atributos, depois '2MTS', '3M', '5 METROS'", () => {
    expect(comprimentoM({ atributos: { comprimento: 2 }, descricao: "x" })).toBe(2);
    expect(comprimentoM({ atributos: {}, descricao: "4321 AXIS S. 2MTS BR MB" })).toBe(2);
    expect(comprimentoM({ atributos: {}, descricao: "NIT. PS201B 3M" })).toBe(3);
    expect(comprimentoM({ atributos: {}, descricao: "ROLO 5 METROS" })).toBe(5);
    expect(comprimentoM({ atributos: {}, descricao: "30850/200BR" })).toBeNull();
    expect(comprimentoM({ atributos: {}, descricao: "MB 120W" })).toBeNull();
  });
});

describe("lerMetros", () => {
  it.each([
    ["5", 5],
    ["5,5", 5.5],
    ["5.25", 5.25],
    ["12 m", 12],
    [" 3,05 mts", 3.05],
  ])("aceita %s", (t, m) => expect(lerMetros(t)).toEqual({ ok: true, metros: m }));

  it.each(["", "abc", "0", "0,00", "-3", "5,555", "501", "1,2,3"])("recusa %j", (t) =>
    expect(lerMetros(t).ok).toBe(false),
  );
});

describe("fonte", () => {
  it("fita de 22 W/m, 5 m: 110 W x 1,2 = 132 W -> a menor fonte que aguenta é a de 150 W", () => {
    const f = escolherFonte(fita(22), 5, FONTES);
    expect(f).toMatchObject({ tipo: "sugerida", cargaW: 110, necessariaW: 132 });
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.linha.produto.descricao).toBe("MB 150W");
    expect(f.linha.quantidade).toBe(1);
    expect(f.confirmarTensao).toBe(true); // o catálogo não informa a tensão
  });

  it("fita de 7,2 W/m, 5 m: 36 W x 1,2 = 43,2 W -> 48 W", () => {
    const f = escolherFonte(fita(7.2), 5, FONTES);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.cargaW).toBe(36);
    expect(f.necessariaW).toBe(43.2);
    expect(f.linha.produto.descricao).toBe("MB 48W");
  });

  it("carga exatamente no limite da fonte usa essa fonte (sem arredondamento torto)", () => {
    // 5 W/m x 20 m = 100 W; x 1,2 = 120 W -> fonte de 120 W
    const f = escolherFonte(fita(5), 20, FONTES);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.linha.produto.descricao).toBe("MB 120W");
    expect(f.linha.quantidade).toBe(1);
  });

  it("12 V e 24 V: só entram as fontes da mesma tensão; as sem tensão pedem confirmação", () => {
    const f12 = fita(7.2, { descricao: "FITA 7,2W 12V" });
    const fontes = [
      p("1", "FONTE 12V 60W", { atributos: { w: 60 }, preco: 60 }),
      p("2", "FONTE 24V 36W", { atributos: { w: 36 }, preco: 36 }),
      p("3", "FONTE 12V 100W", { atributos: { w: 100 }, preco: 100 }),
    ];
    // 5 m x 7,2 = 36 W x 1,2 = 43,2 W. A de 24 V (36 W) não serve: tensão errada e potência curta.
    const f = escolherFonte(f12, 5, fontes);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.linha.produto.codigo).toBe("1");
    expect(f.confirmarTensao).toBe(false);

    const f24 = fita(7.2, { descricao: "FITA 7,2W 24V" });
    const g = escolherFonte(f24, 3, fontes); // 21,6 x 1,2 = 25,92 W -> 24 V de 36 W
    if (g.tipo !== "sugerida") throw new Error();
    expect(g.linha.produto.codigo).toBe("2");
  });

  it("carga que passa da maior fonte divide em fontes iguais", () => {
    // 22 W/m x 20 m = 440 W; x 1,2 = 528 W; maior fonte 150 W -> 4 fontes, cada uma com 132 W -> 150 W
    const f = escolherFonte(fita(22), 20, FONTES);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.necessariaW).toBe(528);
    expect(f.linha.quantidade).toBe(4);
    expect(f.linha.produto.descricao).toBe("MB 150W");
    expect(f.linha.conta).toContain("4 fontes");
  });

  it("carga que pede 2 fontes: 10 m de 22 W/m = 264 W -> 2 x 150 W", () => {
    const f = escolherFonte(fita(22), 10, FONTES);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.linha.quantidade).toBe(2);
    expect(f.linha.produto.descricao).toBe("MB 150W");
  });

  it("2 fontes: cada uma pode ser menor que a maior (parte = 130 W/2 = 65 W -> 72 W)", () => {
    const f = escolherFonte(fita(22), 10, [p("a", "FONTE 100W", { atributos: { w: 100 } })]);
    if (f.tipo !== "sugerida") throw new Error();
    expect(f.linha.quantidade).toBe(3); // 264 / 100 -> 3 fontes de 88 W cada -> a de 100 W
    const g = escolherFonte(fita(22), 10, FONTES.slice(0, 7)); // maior é 120 W: 264/120 -> 3
    if (g.tipo !== "sugerida") throw new Error();
    expect(g.linha.quantidade).toBe(3);
    expect(g.linha.produto.descricao).toBe("MB 100W"); // 88 W cada
  });

  it("produto sem dado de potência: não chuta, pede para escolher e diz o que faltou", () => {
    const f = escolherFonte(fita(null, { descricao: "FITA SEM DADOS" }), 5, FONTES);
    expect(f.tipo).toBe("escolher");
    if (f.tipo !== "escolher") throw new Error();
    expect(f.motivo).toContain("potência");
    expect(f.motivo).toContain("11208");
    expect(f.cargaW).toBeNull();
  });

  it("fontes sem potência conhecida não são sugeridas", () => {
    const f = escolherFonte(fita(22), 5, [p("x", "FONTE ESPECIAL")]);
    expect(f.tipo).toBe("escolher");
  });

  it("fita de 220 V não leva fonte", () => {
    const f = escolherFonte(fita(10, { descricao: "MTS FITA 10W/M 220V BR AVANT" }), 5, FONTES);
    expect(f.tipo).toBe("nao_precisa");
  });
});

describe("calcularKit", () => {
  it("kit de 5 m: fita em metros, perfil de 3 m em 2 barras, fonte de 150 W", () => {
    const k = calcularKit({ metros: 5, fita: fita(22), perfil: perfil(), fontes: FONTES });
    expect(k.fita.quantidade).toBe(5);
    expect(k.perfil?.quantidade).toBe(2); // 5 / 3 = 1,67 -> 2
    expect(k.perfil?.conta).toBe("5 m ÷ 3 m = 2 barras");
    expect(k.fonte.tipo).toBe("sugerida");
  });

  it("metragem quebrada: 4,3 m de fita; perfil de 2 m = 3 barras (2,15 arredonda para cima)", () => {
    const k = calcularKit({
      metros: 4.3,
      fita: fita(10),
      perfil: perfil({ atributos: { comprimento: 2 } }),
      fontes: FONTES,
    });
    expect(k.fita.quantidade).toBe(4.3);
    expect(k.perfil?.quantidade).toBe(3);
    if (k.fonte.tipo !== "sugerida") throw new Error();
    expect(k.fonte.cargaW).toBe(43); // 4,3 x 10
    expect(k.fonte.necessariaW).toBe(51.6);
    expect(k.fonte.linha.produto.descricao).toBe("MB 60W");
  });

  it("barra exata não sobra: 6 m com barras de 3 m = 2 barras", () => {
    const k = calcularKit({ metros: 6, fita: fita(5), perfil: perfil(), fontes: FONTES });
    expect(k.perfil?.quantidade).toBe(2);
  });

  it("perfil vendido por metro leva os metros", () => {
    const k = calcularKit({
      metros: 5.5,
      fita: fita(5),
      perfil: perfil({ unidade: "m" }),
      fontes: FONTES,
    });
    expect(k.perfil?.quantidade).toBe(5.5);
  });

  it("perfil sem o comprimento da barra: não chuta a quantidade e avisa", () => {
    const k = calcularKit({
      metros: 5,
      fita: fita(5),
      perfil: perfil({ descricao: "30850/200BR", atributos: {} }),
      fontes: FONTES,
    });
    expect(k.perfil?.quantidade).toBeNull();
    expect(k.avisos.join(" ")).toContain("comprimento da barra");
  });

  it("fita vendida em rolo: rolos = metros / comprimento do rolo, para cima", () => {
    const rolo = fita(10, { unidade: "un", atributos: { w: 10, comprimento_rolo: 5 } });
    const k = calcularKit({ metros: 12, fita: rolo, perfil: null, fontes: FONTES });
    expect(k.fita.quantidade).toBe(3);
    expect(k.perfil).toBeNull();
    const semRolo = fita(10, { unidade: "un", descricao: "FITA ROLO" });
    expect(
      calcularKit({ metros: 12, fita: semRolo, perfil: null, fontes: FONTES }).fita.quantidade,
    ).toBeNull();
  });

  it("os avisos dizem o que confirmar", () => {
    const k = calcularKit({ metros: 5, fita: fita(22), perfil: null, fontes: FONTES });
    expect(k.avisos.join(" ")).toContain("Confirmar a tensão");
    const sem = calcularKit({
      metros: 5,
      fita: fita(null, { descricao: "FITA SEM DADOS" }),
      perfil: null,
      fontes: FONTES,
    });
    expect(sem.avisos.join(" ")).toContain("potência");
  });
});
