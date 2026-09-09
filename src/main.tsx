import { useEffect, useState } from 'react'
import {
  Activity, ArrowUpRight, Award, Bell, BookOpen, Check, ChevronRight, CircleHelp,
  Flame, Footprints, Gauge, Home, Lock, Menu, MessageCircle, MoreHorizontal,
  Play, Plus, ShieldCheck, Swords, Target, Trophy, UserRound, Users, X, Zap,
} from 'lucide-react'
import './styles.css'

type Page = 'home' | 'ranking' | 'register' | 'challenges' | 'profile' | 'rules'
type ActivityType = 'Caminhada leve' | 'Caminhada rápida / inclinação' | 'Musculação moderada' | 'Musculação pesada' | 'Bike / spinning' | 'Natação' | 'Corrida' | 'Funcional / HIIT' | 'Yoga / alongamento'

const metValues: Record<ActivityType, number> = {
  'Caminhada leve': 3.5, 'Caminhada rápida / inclinação': 5, 'Musculação moderada': 4,
  'Musculação pesada': 6, 'Bike / spinning': 7, Natação: 7, Corrida: 8,
  'Funcional / HIIT': 8, 'Yoga / alongamento': 2.5,
}

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home }, { id: 'ranking', label: 'Ranking', icon: Trophy },
  { id: 'register', label: 'Registrar', icon: Plus }, { id: 'challenges', label: 'Desafios', icon: Swords },
  { id: 'profile', label: 'Perfil', icon: UserRound },
]

const leaderboard = [
  { pos: 1, name: 'Marina Costa', avatar: '🧡', points: 1048, streak: 19, consistency: 96, color: 'gold' },
  { pos: 2, name: 'Caio Mendes', avatar: '🦁', points: 1022, streak: 14, consistency: 91, color: 'silver' },
  { pos: 3, name: 'Bia Nunes', avatar: '⚡', points: 988, streak: 11, consistency: 87, color: 'bronze' },
  { pos: 4, name: 'Você', avatar: '🪩', points: 914, streak: 8, consistency: 84, color: 'you' },
  { pos: 5, name: 'Rafa Lima', avatar: '🌊', points: 897, streak: 6, consistency: 81, color: 'default' },
]

const feed = [
  { avatar: '🧡', name: 'Marina', action: 'bateu a meta de hoje', time: 'há 8 min', icon: '🔥' },
  { avatar: '🦁', name: 'Caio', action: 'passou você no ranking', time: 'há 32 min', icon: '🚀' },
  { avatar: '🌊', name: 'Rafa', action: 'entrou no Desafio Relâmpago', time: 'há 1 h', icon: '⚡' },
]

function App() {
  const [page, setPage] = useState<Page>('home')
  const [showRegister, setShowRegister] = useState(false)
  const [activityDone, setActivityDone] = useState(false)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    }
  }, [])

  const go = (next: Page) => { setPage(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="Ir para início"><span className="brand-mark"><Activity size={20} /></span><span>MOVE<span className="brand-dot">.</span></span></button>
      <div className="season-pill"><span className="live-dot" /> Temporada 03 <ChevronRight size={13} /></div>
      <div className="top-actions"><button className="icon-button" onClick={() => notify('Você está em dia!')} aria-label="Notificações"><Bell size={19} /><span className="notification-dot" /></button><button className="avatar-button" onClick={() => go('profile')}>🪩</button><button className="icon-button menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu"><Menu size={20} /></button></div>
    </header>
    {menuOpen && <div className="quick-menu"><button onClick={() => go('rules')}><BookOpen size={17} /> Como pontua</button><button onClick={() => notify('Tudo certo: seus dados estão protegidos.')}><ShieldCheck size={17} /> Privacidade</button></div>}

    <main className="content">{page === 'home' && <HomePage onNavigate={go} onRegister={() => setShowRegister(true)} done={activityDone} />}{page === 'ranking' && <RankingPage />}{page === 'register' && <RegisterPage onDone={() => { setActivityDone(true); notify('🔥 Meta batida! +10 pontos'); go('home') }} />}{page === 'challenges' && <ChallengesPage onAction={notify} />}{page === 'profile' && <ProfilePage onNavigate={go} onAction={notify} />}{page === 'rules' && <RulesPage />}</main>

    <nav className="bottom-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => id === 'register' ? setShowRegister(true) : go(id)}><span className="nav-icon"><Icon size={20} strokeWidth={page === id ? 2.5 : 1.8} />{id === 'register' && <span className="nav-plus">+</span>}</span><span>{label}</span></button>)}</nav>
    {showRegister && <RegisterModal onClose={() => setShowRegister(false)} onDone={() => { setActivityDone(true); setShowRegister(false); notify('🔥 Meta batida! +10 pontos') }} />}
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
  </div>
}

function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) { return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{detail && <p>{detail}</p>}</div> }
function SectionHeading({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) { return <div className="section-heading"><h2>{title}</h2>{action && <button onClick={onClick}>{action} <ChevronRight size={15} /></button>}</div> }

function HomePage({ onNavigate, onRegister, done }: { onNavigate: (page: Page) => void; onRegister: () => void; done: boolean }) {
  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">QUARTA, 09 SET · SEMANA 04</span><h1>Consistência que<br /><em>transforma.</em></h1><p>Você não compete contra o corpo do outro.<br />Compete contra sua versão de ontem.</p></div><div className="hero-orbit"><div className="orbit-ring" /><div className="hero-emoji">🪩</div><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span></div></section>
    <section className="stats-grid"><Stat icon={<Trophy />} label="posição" value="#4" accent="violet" /><Stat icon={<Zap />} label="pontos" value="914" accent="cyan" /><Stat icon={<Flame />} label="streak" value="8 dias" accent="orange" /></section>
    <section className={`today-card ${done ? 'completed' : ''}`}><div className="today-top"><div><span className="eyebrow">META DE HOJE</span><h2>{done ? 'Meta batida!' : 'Seu próximo movimento'}</h2></div><div className="progress-ring"><span>{done ? '100' : '62'}<small>%</small></span></div></div><div className="progress-line"><span style={{ width: done ? '100%' : '62%' }} /></div><div className="today-bottom"><span><Footprints size={16} /> {done ? '30 min completos' : '19 de 30 min'}</span><button className="primary-button compact" onClick={onRegister}>{done ? 'Registrar mais' : 'Registrar atividade'} <ArrowUpRight size={16} /></button></div></section>
    <SectionHeading title="Arena da semana" action="Ver tudo" onClick={() => onNavigate('challenges')} />
    <section className="arena-grid"><MiniChallenge icon={<Swords />} tag="BATALHA DA SEMANA" title="Time Aurora" progress="3 de 5 vitórias" color="purple" onClick={() => onNavigate('challenges')} /><MiniChallenge icon={<Zap />} tag="DESAFIO RELÂMPAGO" title="20 min sem parar" progress="+30 pts · 5h restantes" color="yellow" onClick={() => onNavigate('challenges')} /><MiniChallenge icon={<Users />} tag="DUELO 1x1" title="Você x Caio" progress="A 108 pts de distância" color="blue" onClick={() => onNavigate('challenges')} /></section>
    <SectionHeading title="Movimentos recentes" action="Ver ranking" onClick={() => onNavigate('ranking')} />
    <section className="feed-card">{feed.map(item => <div className="feed-item" key={item.name}><span className="feed-avatar">{item.avatar}</span><div><p><strong>{item.name}</strong> {item.action}</p><small>{item.time}</small></div><span className="feed-action">{item.icon}</span></div>)}<button className="feed-link" onClick={() => onNavigate('ranking')}>Ver todos os movimentos <ArrowUpRight size={15} /></button></section>
  </>
}
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) { return <div className="stat-card"><span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></div> }
function MiniChallenge({ icon, tag, title, progress, color, onClick }: { icon: React.ReactNode; tag: string; title: string; progress: string; color: string; onClick: () => void }) { return <button className={`mini-challenge ${color}`} onClick={onClick}><div className="challenge-icon">{icon}</div><span className="eyebrow">{tag}</span><h3>{title}</h3><p>{progress}</p><ChevronRight className="card-arrow" size={18} /></button> }

function RankingPage() { return <><PageTitle eyebrow="PLACAR DA TEMPORADA" title="Quem está se movendo?" detail="Semana 04 de 08 · atualizado agora" /><div className="ranking-hero"><div className="podium-item second"><span className="podium-avatar">🦁</span><strong>Caio</strong><small>1.022 pts</small><i>2</i></div><div className="podium-item first"><span className="crown">✦</span><span className="podium-avatar">🧡</span><strong>Marina</strong><small>1.048 pts</small><i>1</i></div><div className="podium-item third"><span className="podium-avatar">⚡</span><strong>Bia</strong><small>988 pts</small><i>3</i></div></div><div className="your-position"><div><span className="eyebrow">SUA POSIÇÃO</span><h2>#4 <small>de 24 pessoas</small></h2></div><div className="gap-copy"><strong>108 pts</strong><span>para alcançar Caio</span></div><div className="position-bar"><span /></div></div><SectionHeading title="Ranking geral" action="Semana 04" /><div className="leaderboard">{leaderboard.slice(0, 5).map(person => <div className={`rank-row ${person.color === 'you' ? 'current-user' : ''}`} key={person.name}><span className="rank-number">{person.pos}</span><span className="rank-avatar">{person.avatar}</span><div className="rank-person"><strong>{person.name}</strong><span><Flame size={13} /> {person.streak} dias <i /> {person.consistency}% consistência</span></div><strong className="rank-points">{person.points.toLocaleString('pt-BR')} <small>pts</small></strong></div>)}</div><div className="score-info"><CircleHelp size={18} /><div><strong>Como funciona o placar?</strong><p>Consistência vale mais que intensidade. Até 60 pts por semana nos dias completos, +15 pts por 5 dias e bônus de evolução e volume.</p></div><ChevronRight size={17} /></div></> }

function RegisterPage({ onDone }: { onDone: () => void }) { return <><PageTitle eyebrow="REGISTRO RÁPIDO" title="Qual foi o movimento?" detail="Registre uma atividade e mantenha seu ritmo." /><RegisterForm onDone={onDone} /></> }
function RegisterForm({ onDone }: { onDone: () => void }) { const [type, setType] = useState<ActivityType>('Caminhada rápida / inclinação'); const [minutes, setMinutes] = useState(30); const [steps, setSteps] = useState(0); const met = metValues[type]; const estimated = Math.min(20, Math.floor((met * minutes) / 40)) + (minutes >= 30 || steps >= 8000 ? 10 : 0); return <div className="form-panel"><label>Atividade<select value={type} onChange={e => setType(e.target.value as ActivityType)}>{Object.keys(metValues).map(item => <option key={item}>{item}</option>)}</select></label><div className="form-row"><label>Minutos<input type="number" min="1" value={minutes} onChange={e => setMinutes(Number(e.target.value))} /></label><label>Passos <span className="optional">opcional</span><input type="number" min="0" value={steps || ''} placeholder="0" onChange={e => setSteps(Number(e.target.value))} /></label></div><div className="estimate"><span className="estimate-icon"><Gauge size={22} /></span><div><span className="eyebrow">ESTIMATIVA DE PONTOS</span><strong>+{estimated} pts</strong><p>{met} MET · {Math.round(met * minutes)} MET-min</p></div></div><button className="primary-button full" onClick={onDone}>Confirmar atividade <Check size={17} /></button><p className="form-note"><Lock size={13} /> Seus dados são usados apenas para autenticação, competição e comunicação.</p></div> }

function ChallengesPage({ onAction }: { onAction: (message: string) => void }) { return <><PageTitle eyebrow="PLAYGROUND" title="Escolha seu próximo jogo." detail="Caminhos diferentes. A mesma vontade de evoluir." /><div className="challenge-list"><ChallengeCard icon={<Swords />} label="BATALHA DA SEMANA" title="Aurora vs. Eclipse" copy="Seu time está em 2º. Faltam 3 vitórias para virar." progress={68} action="Ver batalha" tone="purple" onClick={() => onAction('⚡ Batalha atualizada!')} /><ChallengeCard icon={<Zap />} label="DESAFIO RELÂMPAGO · 5H RESTANTES" title="Modo turbo" copy="Complete 20 minutos sem parar e ganhe pontos extras." progress={42} action="Entrar agora" tone="yellow" onClick={() => onAction('⚡ Desafio desbloqueado.')} /><ChallengeCard icon={<Users />} label="DUELO 1X1" title="Você x Caio" copy="A diferença é curta. Um movimento muda tudo." progress={79} action="Aceitar duelo" tone="blue" onClick={() => onAction('👊 Duelo aceito!')} /></div><SectionHeading title="Conquistas" action="Ver todas" /><div className="badge-grid"><Badge icon="🔥" title="Primeiro streak" unlocked /><Badge icon="🚀" title="Virada de jogo" unlocked /><Badge icon="🧭" title="Explorador" unlocked /><Badge icon="🌙" title="Sem desculpas" /></div></> }
function ChallengeCard({ icon, label, title, copy, progress, action, tone, onClick }: { icon: React.ReactNode; label: string; title: string; copy: string; progress: number; action: string; tone: string; onClick: () => void }) { return <div className={`challenge-card ${tone}`}><div className="challenge-card-top"><span className="large-challenge-icon">{icon}</span><span className="eyebrow">{label}</span><span className="card-kicker">+30 <small>pts</small></span></div><h2>{title}</h2><p>{copy}</p><div className="challenge-progress"><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><span>{progress}% completo</span></div><button className="text-button" onClick={onClick}>{action} <ArrowUpRight size={16} /></button></div> }
function Badge({ icon, title, unlocked = false }: { icon: string; title: string; unlocked?: boolean }) { return <div className={`badge ${unlocked ? 'unlocked' : ''}`}><span>{unlocked ? icon : '◌'}</span><strong>{title}</strong>{unlocked && <small>conquistado</small>}</div> }

function ProfilePage({ onNavigate, onAction }: { onNavigate: (page: Page) => void; onAction: (message: string) => void }) { return <><section className="profile-head"><div className="profile-avatar">🪩<span className="status-check"><Check size={11} /></span></div><div><span className="eyebrow">SEU PERFIL</span><h1>Alex Movimento</h1><p>@alexmove · entrou há 4 semanas</p></div><button className="icon-button"><MoreHorizontal size={20} /></button></section><div className="profile-stats"><div><strong>914</strong><span>pontos</span></div><div><strong>8</strong><span>dias de streak</span></div><div><strong>84%</strong><span>consistência</span></div></div><div className="evolution-card"><div><span className="eyebrow">SUA EVOLUÇÃO</span><h2>+18% <small>vs. baseline</small></h2></div><div className="sparkline"><span /><span /><span /><span /><span /><span /><span /><span /></div><p>Você está criando um ritmo novo. Continue assim.</p></div><SectionHeading title="Seus badges" action="Ver todos" onClick={() => onNavigate('challenges')} /><div className="badge-grid profile-badges"><Badge icon="🔥" title="Primeiro streak" unlocked /><Badge icon="🚀" title="Virada de jogo" unlocked /><Badge icon="🧭" title="Explorador" unlocked /></div><div className="settings-list"><button onClick={() => onAction('Notificações atualizadas.')}><Bell size={18} /><span>Notificações</span><small>Ativas</small><ChevronRight size={17} /></button><button onClick={() => onNavigate('rules')}><ShieldCheck size={18} /><span>Privacidade e LGPD</span><ChevronRight size={17} /></button></div></> }

function RulesPage() { return <><PageTitle eyebrow="MANUAL MOVE" title="O jogo é consistência." detail="Regras claras para uma competição leve, justa e divertida." /><div className="rules-intro"><Target size={22} /><p>A meta não é ser o mais intenso. É aparecer por você, um dia de cada vez.</p></div><RuleBlock title="Temporada" text="Cada temporada dura 8 semanas. A Semana 0 é dedicada ao onboarding e à definição do seu baseline. O 7º dia de cada semana é descanso e não pontua." /><RuleBlock title="Meta diária" text="Complete 30 minutos de atividade contínua ou alcance 8.000 passos. Você tem até 6 dias pontuáveis por semana." /><RuleBlock title="Como a pontuação é calculada" text="Consistência: 10 pontos por dia completo, até 60 por semana, mais 15 pontos ao completar 5 dias ou mais. Evolução: 1 ponto a cada 2% de melhoria contra seu baseline, até 25 pontos. Volume: 1 ponto a cada 40 MET-min, até 20 pontos. O teto semanal é 120 pontos." /><RuleBlock title="Coringas" text="Você recebe 2 coringas por temporada. Use um para neutralizar um dia perdido sem quebrar seu streak. Coringas não geram pontos, apenas protegem sua consistência." /><RuleBlock title="Jogo limpo e privacidade" text="O ranking nunca usa peso, IMC, gordura corporal, medidas ou aparência. Dados são usados apenas para autenticação, competição e comunicação. No modo Supabase, o cálculo final deve ser validado no servidor via RPC ou Edge Function, com baseline congelado, timestamp, janela de edição e trilha de auditoria." /></> }
function RuleBlock({ title, text }: { title: string; text: string }) { return <article className="rule-block"><span className="rule-number">{title.slice(0, 1)}</span><div><h2>{title}</h2><p>{text}</p></div></article> }

function RegisterModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) { return <div className="modal-backdrop" onMouseDown={onClose}><div className="register-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">NOVO MOVIMENTO</span><h2>Registre sua vitória.</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><RegisterForm onDone={onDone} /></div></div> }

export default App
