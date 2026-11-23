/** "Meus alimentos": produtos que o usuário usa, com a tabela do rótulo (manual ou por foto). */
import { useRef, useState } from 'react';
import { ask, toast } from '../../components/Dialog';
import { IconEdit, IconPlus, IconTrash } from '../../components/Icons';
import NumberField from '../../components/NumberField';
import Sheet from '../../components/Sheet';
import { useOnline } from '../../lib/hooks';
import { photoToDataURL } from '../../lib/image';
import { chatJSON } from '../../lib/openrouter';
import { labelMessages } from '../../lib/prompts';
import { getData, setData } from '../../lib/storage';
import { errMsg, r0, r1, uid } from '../../lib/utils';
import type { AppData, Food } from '../../types';

type LabelAI = {
  nome?: string;
  marca?: string;
  porcao?: string;
  porcao_qtd?: number | null;
  porcao_unidade?: string;
  calorias?: number | null;
  proteina?: number | null;
  gordura?: number | null;
  carboidratos?: number | null;
  obs?: string;
};

const emptyFood = (): Food => ({
  id: uid(),
  nome: '',
  apelidos: '',
  porcao: '',
  porcaoQtd: 100,
  porcaoUnidade: 'g',
  calorias: 0,
  proteina: 0,
  gordura: 0,
  carboidratos: 0,
  obs: '',
  criadoEm: Date.now(),
});

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? r1(v) : 0);

export default function Alimentos({ data }: { data: AppData }) {
  const online = useOnline();
  const [edit, setEdit] = useState<{ food: Food; foto?: string; aviso?: string } | null>(null);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const lista = Object.values(data.foods).sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  async function lerFoto(f: File | undefined) {
    if (file.current) file.current.value = '';
    if (!f) return;
    setErro('');
    setLendo(true);
    try {
      const foto = await photoToDataURL(f);
      const r = await chatJSON<LabelAI>(getData(), labelMessages(foto, ''), 0.1);
      const un = r.porcao_unidade === 'ml' ? 'ml' : r.porcao_unidade === 'un' ? 'un' : 'g';
      const nome = [r.nome, r.marca].filter((x) => x && String(x).trim()).join(' · ');
      const faltou = [r.calorias, r.proteina, r.gordura, r.carboidratos].some((x) => typeof x !== 'number');
      setEdit({
        foto,
        aviso: [faltou ? 'Alguns valores não ficaram legíveis. Confira antes de salvar.' : 'Confira os valores com o rótulo antes de salvar.', r.obs].filter(Boolean).join(' '),
        food: {
          ...emptyFood(),
          nome,
          porcao: String(r.porcao ?? ''),
          porcaoQtd: num(r.porcao_qtd) || 100,
          porcaoUnidade: un,
          calorias: num(r.calorias),
          proteina: num(r.proteina),
          gordura: num(r.gordura),
          carboidratos: num(r.carboidratos),
        },
      });
    } catch (e) {
      setErro(errMsg(e));
    } finally {
      setLendo(false);
    }
  }

  async function apagar(f: Food) {
    if (!(await ask({ title: `Apagar ${f.nome}?`, message: 'As refeições já salvas não mudam.', confirm: 'Apagar', danger: true }))) return;
    setData((d) => {
      const foods = { ...d.foods };
      delete foods[f.id];
      return { ...d, foods };
    });
  }

  return (
    <>
      <section className="card">
        <div className="row card-head">
          <span className="tile">
            <IconPlus />
          </span>
          <div className="grow">
            <h2 className="m0">Cadastrar alimento</h2>
            <span className="muted small">Seu whey, seu leite, seu iogurte. A IA usa estes valores quando você citar o alimento.</span>
          </div>
        </div>
        <div className="row gap">
          <button className="btn primary grow" disabled={lendo || !online} onClick={() => file.current?.click()}>
            {lendo ? 'Lendo a tabela…' : 'Foto da tabela'}
          </button>
          <button className="btn grow" disabled={lendo} onClick={() => setEdit({ food: emptyFood() })}>
            Digitar
          </button>
        </div>
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void lerFoto(e.target.files?.[0])} />
        {!online && <p className="muted small">Sem internet, a foto não pode ser lida. Dá para digitar os valores.</p>}
        {erro && <p className="error">{erro}</p>}
      </section>

      {lista.length > 0 && <div className="section-title">Meus alimentos</div>}
      {lista.length === 0 && <p className="muted small pad">Nenhum alimento cadastrado ainda.</p>}
      {lista.map((f) => (
        <section key={f.id} className="card food-card">
          <div className="row">
            <div className="grow">
              <div className="strong">{f.nome}</div>
              <div className="muted small">
                Porção: {f.porcao || `${f.porcaoQtd} ${f.porcaoUnidade}`}
                {f.apelidos ? ` · chamo de: ${f.apelidos}` : ''}
              </div>
            </div>
            <button className="icon-btn" aria-label="Editar" onClick={() => setEdit({ food: { ...f } })}>
              <IconEdit />
            </button>
            <button className="icon-btn" aria-label="Apagar" onClick={() => void apagar(f)}>
              <IconTrash />
            </button>
          </div>
          <div className="macro-line">
            <span>{r0(f.calorias)} kcal</span>
            <span>P {r1(f.proteina)} g</span>
            <span>C {r1(f.carboidratos)} g</span>
            <span>G {r1(f.gordura)} g</span>
          </div>
        </section>
      ))}

      <FoodSheet state={edit} onClose={() => setEdit(null)} />
    </>
  );
}

function FoodSheet({ state, onClose }: { state: { food: Food; foto?: string; aviso?: string } | null; onClose: () => void }) {
  const [f, setF] = useState<Food | null>(null);
  const [lastId, setLastId] = useState<string | null>(null);
  if (state && state.food.id !== lastId) {
    setLastId(state.food.id);
    setF(state.food);
  }
  if (!state || !f) return null;
  const set = (p: Partial<Food>) => setF({ ...f, ...p });
  const valido = f.nome.trim() && f.porcaoQtd > 0;
  const novo = !getData().foods[f.id];

  function salvar() {
    if (!f || !valido) return;
    const food: Food = { ...f, nome: f.nome.trim(), apelidos: f.apelidos.trim(), porcao: f.porcao.trim() || `${f.porcaoQtd} ${f.porcaoUnidade}` };
    setData((d) => ({ ...d, foods: { ...d.foods, [food.id]: food } }));
    toast(novo ? 'Alimento cadastrado' : 'Alimento atualizado');
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={novo ? 'Novo alimento' : 'Editar alimento'}>
      {state.foto && <img className="label-photo" src={state.foto} alt="Foto da tabela nutricional" />}
      {state.aviso && <p className="notice">{state.aviso}</p>}
      <label className="field">
        <span>Nome e marca</span>
        <input value={f.nome} placeholder="Ex.: Leite proteico Piracanjuba" onChange={(e) => set({ nome: e.target.value })} />
      </label>
      <label className="field">
        <span>Como você chama (separe por vírgula)</span>
        <input value={f.apelidos} placeholder="Ex.: leite, meu leite" onChange={(e) => set({ apelidos: e.target.value })} />
      </label>
      <label className="field">
        <span>Porção do rótulo</span>
        <input value={f.porcao} placeholder="Ex.: 1 scoop (30 g) ou 1 copo (200 ml)" onChange={(e) => set({ porcao: e.target.value })} />
      </label>
      <div className="row gap">
        <div className="grow">
          <NumberField label="Quantidade da porção" value={f.porcaoQtd} onChange={(n) => set({ porcaoQtd: n })} />
        </div>
        <div className="segmented small unit-pick">
          {(['g', 'ml', 'un'] as const).map((u) => (
            <button key={u} className={f.porcaoUnidade === u ? 'on' : ''} onClick={() => set({ porcaoUnidade: u })}>
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="label mt8">Por porção</div>
      <div className="grid4">
        <NumberField label="kcal" value={f.calorias} onChange={(n) => set({ calorias: n })} />
        <NumberField label="Prot (g)" value={f.proteina} onChange={(n) => set({ proteina: n })} />
        <NumberField label="Carb (g)" value={f.carboidratos} onChange={(n) => set({ carboidratos: n })} />
        <NumberField label="Gord (g)" value={f.gordura} onChange={(n) => set({ gordura: n })} />
      </div>
      <label className="field">
        <span>Observação (opcional)</span>
        <input value={f.obs} placeholder="Ex.: sem lactose" onChange={(e) => set({ obs: e.target.value })} />
      </label>
      <button className="btn primary block" disabled={!valido} onClick={salvar}>
        Salvar alimento
      </button>
    </Sheet>
  );
}
