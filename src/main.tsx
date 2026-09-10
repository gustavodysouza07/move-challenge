import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowUpRight, Award, Bell, BookOpen, Check, ChevronRight, CircleHelp,
  Flame, Footprints, Gauge, Home, Lock, Menu, MessageCircle, MoreHorizontal,
  Play, Plus, ShieldCheck, Swords, Target, Trophy, UserRound, Users, X, Zap,
} from 'lucide-react'
import { AuthProvider, useAuth, type Profile } from './lib/auth'
import { supabase } from './lib/supabase'
import './styles.css'

type Page = 'home' | 'ranking' | 'register' | 'challenges' | 'profile' | 'rules' | 'admin' | 'enrollment'
type ActivityType = 'Caminhada leve' | 'Caminhada rápida / inclinação' | 'Musculação moderada' | 'Musculação pesada' | 'Bike / spinning' | 'Natação' | 'Corrida' | 'Funcional / HIIT' | 'Yoga / alongamento'
type ActivitySession = { id: string; activity_type: ActivityType; started_at: string; ended_at: string | null; status: 'active' | 'pending_validation' | 'validated' | 'rejected' | 'completed' | 'cancelled'; duration_seconds: number | null; paused_seconds?: number }

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

function App() {
  const { user, profile, loading, configured, signOut } = useAuth()
  const [page, setPage] = useState<Page>(() => window.location.pathname === '/admin' ? 'admin' : 'home')
  const [showRegister, setShowRegister] = useState(false)
  const [activityDone, setActivityDone] = useState(false)
  const [toast, setToast] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeSession, setActiveSession] = useState<ActivitySession | null>(null)
  const [completedSession, setCompletedSession] = useState<ActivitySession | null>(null)

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    if (!supabase || !user) return
    supabase.from('activity_sessions').select('id, activity_type, started_at, ended_at, status, duration_seconds, paused_seconds').eq('user_id', user.id).eq('status', 'active').maybeSingle().then(({ data }) => setActiveSession(data as ActivitySession | null))
  }, [user])

  useEffect(() => {
    const handlePopState = () => setPage(window.location.pathname === '/admin' ? 'admin' : 'home')
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  if (loading) return <LoadingScreen />
  if (!user) return <AuthScreen configured={configured} />
  if (profile?.status === 'blocked') return <AccessState title="Acesso pausado" detail="Sua conta está bloqueada. Fale com a organização da temporada para saber mais." onAction={() => signOut()} action="Sair" />

  const go = (next: Page) => {
    const path = next === 'admin' ? '/admin' : '/'
    if (window.location.pathname !== path) window.history.pushState({}, '', path)
    setPage(next); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2800) }

  return <div className="app-shell">
    <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="Ir para início"><span className="brand-mark"><Activity size={20} /></span><span>MOVE<span className="brand-dot">.</span></span></button>
      <button className="season-pill" onClick={() => go('enrollment')}><span className="live-dot" /> Temporada 03 <ChevronRight size={13} /></button>
      <div className="top-actions"><button className="icon-button" onClick={() => notify('Você está em dia!')} aria-label="Notificações"><Bell size={19} /><span className="notification-dot" /></button><button className="avatar-button" onClick={() => go('profile')}>🪩</button><button className="icon-button menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu"><Menu size={20} /></button></div>
    </header>
    {menuOpen && <div className="quick-menu"><button onClick={() => go('rules')}><BookOpen size={17} /> Como pontua</button>{profile?.role === 'admin' && <button onClick={() => go('admin')}><ShieldCheck size={17} /> Admin</button>}<button onClick={() => notify('Tudo certo: seus dados estão protegidos.')}><ShieldCheck size={17} /> Privacidade</button><button onClick={() => signOut()}><Lock size={17} /> Sair</button></div>}

    <main className="content">{page === 'home' && <HomePage userId={user.id} onNavigate={go} onRegister={() => setShowRegister(true)} done={activityDone} />}{page === 'ranking' && <RankingPage userId={user.id} />}{page === 'register' && <RegisterPage activeSession={activeSession} completedSession={completedSession} onStarted={setActiveSession} onCompleted={setCompletedSession} onDone={(session) => { setCompletedSession(null); setActivityDone(true); notify(`Atividade de ${formatDuration(session.duration_seconds ?? 0)} enviada para validação.`); go('home') }} />}{page === 'challenges' && <ChallengesPage onAction={notify} />}{page === 'profile' && <ProfilePage profile={profile} onNavigate={go} onAction={notify} />}{page === 'rules' && <RulesPage />}{page === 'enrollment' && <EnrollmentPage />}{page === 'admin' && (profile?.role === 'admin' ? <AdminPage /> : <AccessState title="Área restrita" detail="Apenas administradores podem acessar este espaço." onAction={() => go('home')} action="Voltar" />)}</main>

    <nav className="bottom-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => id === 'register' ? setShowRegister(true) : go(id)}><span className="nav-icon"><Icon size={20} strokeWidth={page === id ? 2.5 : 1.8} />{id === 'register' && <span className="nav-plus">+</span>}</span><span>{label}</span></button>)}</nav>
    {(showRegister || activeSession || completedSession) && <RegisterModal activeSession={activeSession} completedSession={completedSession} onClose={() => { setShowRegister(false); setCompletedSession(null) }} onStarted={setActiveSession} onCompleted={setCompletedSession} onDone={(session) => { setActiveSession(null); setCompletedSession(null); setActivityDone(true); setShowRegister(false); notify(`Atividade de ${formatDuration(session.duration_seconds ?? 0)} enviada para validação.`) }} />}
    {toast && <div className="toast"><Check size={17} /> {toast}</div>}
  </div>
}

function LoadingScreen() { return <div className="auth-shell"><div className="auth-card loading-card"><span className="brand-mark"><Activity size={20} /></span><h1>Carregando seu movimento...</h1><span className="loading-bar" /></div></div> }

function AccessState({ title, detail, action, onAction }: { title: string; detail: string; action: string; onAction: () => void }) { return <div className="auth-shell"><div className="auth-card access-card"><span className="brand-mark"><ShieldCheck size={20} /></span><h1>{title}</h1><p>{detail}</p><button className="primary-button full" onClick={onAction}>{action}</button></div></div> }

function EnrollmentPage() {
  const { user } = useAuth()
  const [season, setSeason] = useState<{ id: string; name: string; description: string | null; entry_fee: number; pix_key: string | null; start_date: string; end_date: string } | null>(null)
  const [payment, setPayment] = useState<{ id: string; amount: number; payment_status: string; proof_url: string | null } | null>(null)
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  useEffect(() => { if (!supabase || !user) { setBusy(false); return }; const load = async () => { const { data: seasonData } = await supabase.from('seasons').select('id, name, description, entry_fee, pix_key, start_date, end_date').eq('status', 'registration').order('start_date', { ascending: true }).limit(1).maybeSingle(); setSeason(seasonData); if (seasonData) { const { data: paymentData } = await supabase.from('payments').select('id, amount, payment_status, proof_url').eq('user_id', user.id).eq('season_id', seasonData.id).maybeSingle(); setPayment(paymentData) }; setBusy(false) }; load() }, [user])
  const request = async () => { if (!supabase || !season) return; setBusy(true); const { data, error: rpcError } = await supabase.rpc('request_season_participation', { p_season_id: season.id }); setBusy(false); if (rpcError) setError(rpcError.message); else { setPayment(data); setMessage('Inscrição enviada. Aguarde a confirmação para participar da temporada.') } }
  const uploadProof = async (file: File) => { if (!supabase || !payment || !user) return; setError(''); const allowed = ['image/jpeg', 'image/png', 'application/pdf']; if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Envie somente JPG, JPEG, PNG ou PDF de até 5 MB.'); return }; setBusy(true); const path = `${user.id}/${payment.id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const upload = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false, contentType: file.type }); if (upload.error) { setBusy(false); setError(upload.error.message); return }; const { data, error: submitError } = await supabase.rpc('submit_payment_proof', { p_payment_id: payment.id, p_storage_path: path }); setBusy(false); if (submitError) setError(submitError.message); else { setPayment(data); setMessage('Comprovante enviado. A confirmação depende da revisão administrativa.') } }
  const statusLabel = payment?.payment_status === 'submitted' ? 'aguardando confirmação' : payment?.payment_status === 'confirmed' ? 'aprovado' : payment?.payment_status === 'rejected' ? 'rejeitado' : 'pagamento pendente'
  return <><PageTitle eyebrow="INSCRIÇÃO" title="Entre para a temporada." detail="Sua participação só fica ativa após a confirmação manual do PIX." />{busy && !season ? <div className="form-panel"><p>Carregando temporada disponível...</p></div> : !season ? <div className="score-info"><CircleHelp size={18} /><div><strong>Nenhuma temporada aberta</strong><p>Assim que uma temporada estiver em período de inscrição, ela aparecerá aqui.</p></div></div> : <div className="form-panel enrollment-panel"><span className="eyebrow">PRÓXIMA TEMPORADA</span><h2>{season.name}</h2><p>{season.description ?? 'Consistência que transforma.'}</p><div className="enrollment-details"><span>Início <strong>{new Date(season.start_date).toLocaleDateString('pt-BR')}</strong></span><span>Taxa <strong>R$ {Number(season.entry_fee).toFixed(2).replace('.', ',')}</strong></span></div>{!payment ? <button className="primary-button full" disabled={busy} onClick={request}>{busy ? 'Criando inscrição...' : 'Solicitar participação'} <ArrowUpRight size={16} /></button> : <><div className="pix-instructions"><strong>PIX manual</strong><p>Envie o valor de R$ {Number(payment.amount).toFixed(2).replace('.', ',')} para a chave PIX:</p><strong>{season.pix_key ?? 'Chave PIX ainda não configurada'}</strong><span>Status: {statusLabel}</span></div>{payment.payment_status !== 'confirmed' && <label className="upload-proof">Anexar comprovante<input disabled={busy} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={e => e.target.files?.[0] && uploadProof(e.target.files[0])} /></label>}</>}{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</div>}</>
}

function AuthScreen({ configured }: { configured: boolean }) {
  const { signIn, signUp, resetPassword } = useAuth()
  const [view, setView] = useState<'login' | 'signup' | 'recovery'>('login')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setMessage('')
    if (!configured) { setError('O Supabase ainda não foi configurado neste ambiente.'); return }
    if (view === 'signup' && password !== confirmation) { setError('As senhas precisam ser iguais.'); return }
    setBusy(true)
    const result = view === 'login' ? await signIn(email, password) : view === 'signup' ? await signUp({ fullName, email, phone, password }) : await resetPassword(email)
    setBusy(false)
    if (result.error) setError(result.error.message)
    else { setMessage(result.message ?? 'Tudo certo.'); if (view === 'recovery') setView('login') }
  }
  return <div className="auth-shell"><div className="auth-presentation"><button className="brand auth-brand"><span className="brand-mark"><Activity size={20} /></span><span>MOVE<span className="brand-dot">.</span></span></button><span className="eyebrow">CONSISTÊNCIA QUE TRANSFORMA.</span><h1>Seu próximo<br /><em>movimento</em><br />começa aqui.</h1><p>Uma competição social para evoluir junto, no seu ritmo e do seu jeito.</p><div className="auth-orbit">🪩<span>✦</span></div></div><div className="auth-card"><div className="auth-card-head"><span className="eyebrow">{view === 'login' ? 'BEM-VINDO DE VOLTA' : view === 'signup' ? 'ENTRE PARA O MOVE' : 'RECUPERAR ACESSO'}</span><h2>{view === 'login' ? 'Vamos nos mover.' : view === 'signup' ? 'Crie sua conta.' : 'Volte para o jogo.'}</h2></div>{!configured && <div className="setup-note"><CircleHelp size={16} /><span>Modo de autenticação aguardando configuração do Supabase.</span></div>}{error && <div className="form-error">{error}</div>}{message && <div className="form-success">{message}</div>}<form onSubmit={submit}>{view === 'signup' && <><label>Nome completo<input required value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" /></label><label>Celular<input required value={phone} onChange={e => setPhone(e.target.value)} autoComplete="tel" /></label></>}{<label>E-mail<input required type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" /></label>}{view !== 'recovery' && <label>Senha<input required minLength={8} type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} /></label>}{view === 'signup' && <label>Confirmar senha<input required minLength={8} type="password" value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" /></label>}<button className="primary-button full" disabled={busy}>{busy ? 'Aguarde...' : view === 'login' ? 'Entrar' : view === 'signup' ? 'Criar conta' : 'Enviar link de recuperação'} <ArrowUpRight size={16} /></button></form><div className="auth-links">{view === 'login' && <><button onClick={() => setView('recovery')}>Esqueci minha senha</button><button onClick={() => setView('signup')}>Ainda não tenho conta</button></>}{view !== 'login' && <button onClick={() => setView('login')}>Voltar para o login</button>}</div><small className="privacy-copy"><Lock size={12} /> Seus dados são usados para autenticação, competição e comunicação.</small></div></div>
}

type AdminPayment = { id: string; amount: number; payment_status: string; created_at: string; proof_url: string | null; profiles: { full_name: string; email: string } | null; seasons: { name: string } | null }
type AdminActivity = { id: string; activity_type: string; started_at: string; ended_at: string | null; duration_seconds: number | null; status: string; source: string; profiles: { full_name: string } | null; activity_proofs: { proof_type: string; storage_path: string | null; external_reference: string | null }[] }

function AdminPage() {
  const [stats, setStats] = useState({ seasons: 0, participants: 0, pending: 0, active: 0 })
  const [payments, setPayments] = useState<AdminPayment[]>([])
  const [activities, setActivities] = useState<AdminActivity[]>([])
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')
  const loadAdminData = async () => {
    if (!supabase) return
    const [seasons, participants, pending, active, paymentResult, activityResult] = await Promise.all([
      supabase.from('seasons').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('season_participants').select('id', { count: 'exact', head: true }),
      supabase.from('season_participants').select('id', { count: 'exact', head: true }).in('status', ['pending_payment', 'pending_approval']),
      supabase.from('season_participants').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('payments').select('id, amount, payment_status, created_at, proof_url, profiles(full_name, email), seasons(name)').in('payment_status', ['pending', 'submitted']).order('created_at', { ascending: true }),
      supabase.from('activity_sessions').select('id, activity_type, started_at, ended_at, duration_seconds, status, source, profiles(full_name), activity_proofs(proof_type, storage_path, external_reference)').eq('status', 'pending_validation').order('created_at', { ascending: true }),
    ])
    setStats({ seasons: seasons.count ?? 0, participants: participants.count ?? 0, pending: pending.count ?? 0, active: active.count ?? 0 })
    setPayments((paymentResult.data ?? []) as unknown as AdminPayment[])
    setActivities((activityResult.data ?? []) as unknown as AdminActivity[])
    setLoading(false)
  }
  useEffect(() => { loadAdminData() }, [])
  const reviewPayment = async (id: string, approved: boolean) => { if (!supabase) return; setActionError(''); const reason = approved ? null : window.prompt('Informe o motivo da rejeição do pagamento:'); if (!approved && !reason?.trim()) return; const { error } = approved ? await supabase.rpc('confirm_payment', { p_payment_id: id }) : await supabase.rpc('reject_payment', { p_payment_id: id, p_reason: reason }); if (error) setActionError(error.message); else loadAdminData() }
  const reviewActivity = async (id: string, approved: boolean) => { if (!supabase) return; setActionError(''); const reason = approved ? null : window.prompt('Informe o motivo da rejeição da atividade:'); if (!approved && !reason?.trim()) return; const { error } = await supabase.rpc('admin_validate_activity', { p_session_id: id, p_approved: approved, p_rejection_reason: reason }); if (error) setActionError(error.message); else loadAdminData() }
  return <><PageTitle eyebrow="ADMINISTRAÇÃO" title="Visão da temporada." detail="Validações e pagamentos passam por operações protegidas no servidor." /><div className="admin-grid"><Stat icon={<Trophy />} label="temporada ativa" value={loading ? '...' : String(stats.seasons)} accent="violet" /><Stat icon={<Users />} label="participantes" value={loading ? '...' : String(stats.participants)} accent="cyan" /><Stat icon={<Bell />} label="inscrições pendentes" value={loading ? '...' : String(stats.pending)} accent="orange" /><Stat icon={<Check />} label="participantes ativos" value={loading ? '...' : String(stats.active)} accent="cyan" /></div>{actionError && <div className="form-error">{actionError}</div>}<AdminReview title="Pagamentos pendentes" empty="Nenhum pagamento aguardando confirmação.">{payments.map(payment => <div className="admin-review-row" key={payment.id}><div><strong>{payment.profiles?.full_name ?? 'Participante'}</strong><span>{payment.seasons?.name ?? 'Temporada'} · R$ {Number(payment.amount).toFixed(2).replace('.', ',')} · {payment.payment_status}</span><small>{new Date(payment.created_at).toLocaleString('pt-BR')}{payment.proof_url ? ' · comprovante anexado' : ''}</small></div><div className="review-actions"><button className="text-button" onClick={() => reviewPayment(payment.id, true)}>Confirmar</button><button className="text-button reject" onClick={() => reviewPayment(payment.id, false)}>Rejeitar</button></div></div>)}</AdminReview><AdminReview title="Atividades para validação" empty="Nenhuma atividade aguardando validação.">{activities.map(activity => <div className="admin-review-row" key={activity.id}><div><strong>{activity.profiles?.full_name ?? 'Participante'} · {activity.activity_type}</strong><span>{new Date(activity.started_at).toLocaleString('pt-BR')} até {activity.ended_at ? new Date(activity.ended_at).toLocaleString('pt-BR') : '-'} · {formatDuration(activity.duration_seconds ?? 0)}</span><small>Status: {activity.status} · origem: {activity.source}{activity.activity_proofs?.length ? ' · comprovante disponível' : ''}</small></div><div className="review-actions"><button className="text-button" onClick={() => reviewActivity(activity.id, true)}>Validar</button><button className="text-button reject" onClick={() => reviewActivity(activity.id, false)}>Rejeitar</button></div></div>)}</AdminReview></>
}

function AdminReview({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <section className="admin-review"><SectionHeading title={title} /><div className="admin-review-list">{children || <p className="admin-empty">{empty}</p>}</div></section> }

function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) { return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{detail && <p>{detail}</p>}</div> }
function SectionHeading({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) { return <div className="section-heading"><h2>{title}</h2>{action && <button onClick={onClick}>{action} <ChevronRight size={15} /></button>}</div> }

type ScoreRow = { user_id: string; consistency_points: number; evolution_points: number; volume_points: number; bonus_points: number; completed_days: number; total_points: number; profiles?: { full_name: string } | null }

function HomePage({ userId, onNavigate, onRegister, done }: { userId: string; onNavigate: (page: Page) => void; onRegister: () => void; done: boolean }) {
  const [score, setScore] = useState({ points: 0, consistency: 0, evolution: 0, volume: 0, position: 0, total: 0, completedDays: 0 })
  const [seasonName, setSeasonName] = useState('Temporada ativa')
  useEffect(() => { if (!supabase) return; const load = async () => { const { data: season } = await supabase.from('seasons').select('id, name').eq('status', 'active').order('start_date', { ascending: false }).limit(1).maybeSingle(); if (!season) return; setSeasonName(season.name); const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points').eq('season_id', season.id); const rows = (data ?? []) as ScoreRow[]; const totals = new Map<string, ScoreRow>(); rows.forEach(row => { const existing = totals.get(row.user_id) ?? { ...row, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0 }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); const ordered = [...totals.values()].sort((a, b) => b.total_points - a.total_points); const mine = totals.get(userId); setScore({ points: mine?.total_points ?? 0, consistency: mine?.consistency_points ?? 0, evolution: mine?.evolution_points ?? 0, volume: mine?.volume_points ?? 0, position: mine ? ordered.findIndex(row => row.user_id === userId) + 1 : 0, total: ordered.length, completedDays: mine?.completed_days ?? 0 }) }; load() }, [userId])
  const progress = done || score.completedDays > 0 ? 100 : 0
  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).toUpperCase()} · {seasonName}</span><h1>Consistência que<br /><em>transforma.</em></h1><p>Você não compete contra o corpo do outro.<br />Compete contra sua versão de ontem.</p></div><div className="hero-orbit"><div className="orbit-ring" /><div className="hero-emoji">🪩</div><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span></div></section>
    <section className="stats-grid"><Stat icon={<Trophy />} label="posição" value={score.position ? `#${score.position}` : '-'} accent="violet" /><Stat icon={<Zap />} label="pontos" value={score.points.toLocaleString('pt-BR')} accent="cyan" /><Stat icon={<Flame />} label="dias concluídos" value={String(score.completedDays)} accent="orange" /></section>
    <section className={`today-card ${progress === 100 ? 'completed' : ''}`}><div className="today-top"><div><span className="eyebrow">META DE HOJE</span><h2>{progress === 100 ? 'Meta batida!' : 'Seu próximo movimento'}</h2></div><div className="progress-ring"><span>{progress}<small>%</small></span></div></div><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><div className="today-bottom"><span><Footprints size={16} /> {progress === 100 ? '30 min completos' : 'Comece uma atividade'}</span><button className="primary-button compact" onClick={onRegister}>{progress === 100 ? 'Registrar mais' : 'Registrar atividade'} <ArrowUpRight size={16} /></button></div></section>
    <SectionHeading title="Arena da semana" action="Ver regras" onClick={() => onNavigate('rules')} /><section className="arena-grid"><MiniChallenge icon={<Target />} tag="PONTUAÇÃO OFICIAL" title="Consistência primeiro" progress={`${score.consistency} pts de consistência`} color="purple" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Zap />} tag="EVOLUÇÃO" title="Contra seu baseline" progress={`${score.evolution} pts de evolução`} color="yellow" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Gauge />} tag="VOLUME" title="Intensidade validada" progress={`${score.volume} pts de volume`} color="blue" onClick={() => onNavigate('rules')} /></section>
    <SectionHeading title="Seu movimento" action="Ver ranking" onClick={() => onNavigate('ranking')} /><section className="feed-card"><div className="score-info"><Activity size={18} /><div><strong>Dados oficiais do Supabase</strong><p>{score.total ? `${score.total} participantes pontuando nesta temporada.` : 'Ainda não há pontuação registrada nesta temporada.'}</p></div></div><button className="feed-link" onClick={() => onNavigate('ranking')}>Ver ranking geral <ArrowUpRight size={15} /></button></section>
  </>
}
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) { return <div className="stat-card"><span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></div> }
function MiniChallenge({ icon, tag, title, progress, color, onClick }: { icon: React.ReactNode; tag: string; title: string; progress: string; color: string; onClick: () => void }) { return <button className={`mini-challenge ${color}`} onClick={onClick}><div className="challenge-icon">{icon}</div><span className="eyebrow">{tag}</span><h3>{title}</h3><p>{progress}</p><ChevronRight className="card-arrow" size={18} /></button> }

function RankingPage({ userId }: { userId: string }) { const [rows, setRows] = useState<ScoreRow[]>([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!supabase) { setLoading(false); return }; const load = async () => { const { data: season } = await supabase.from('seasons').select('id, name, start_date').eq('status', 'active').order('start_date', { ascending: false }).limit(1).maybeSingle(); if (!season) { setLoading(false); return }; const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points, profiles(full_name)').eq('season_id', season.id); const totals = new Map<string, ScoreRow>(); (data ?? []).forEach(item => { const row = item as unknown as ScoreRow; const existing = totals.get(row.user_id) ?? { user_id: row.user_id, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0, profiles: row.profiles }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); setRows([...totals.values()].sort((a, b) => b.total_points - a.total_points)); setLoading(false) }; load() }, []); const position = rows.findIndex(row => row.user_id === userId) + 1; return <><PageTitle eyebrow="PLACAR DA TEMPORADA" title="Quem está se movendo?" detail="Pontuação oficial calculada e validada pelo Supabase." /><div className="your-position"><div><span className="eyebrow">SUA POSIÇÃO</span><h2>{position ? `#${position}` : '-'} <small>de {rows.length} pessoas</small></h2></div><div className="gap-copy"><strong>{rows[position - 2] ? `${(rows[position - 2].total_points - (rows[position - 1]?.total_points ?? 0)).toLocaleString('pt-BR')} pts` : 'No topo'}</strong><span>{rows[position - 2] ? 'para alcançar a posição acima' : 'continue consistente'}</span></div></div><SectionHeading title="Ranking geral" action="Pontuação total" /><div className="leaderboard">{loading ? <p className="admin-empty">Carregando ranking...</p> : rows.map((person, index) => <div className={`rank-row ${person.user_id === userId ? 'current-user' : ''}`} key={person.user_id}><span className="rank-number">{index + 1}</span><span className="rank-avatar">{person.user_id === userId ? '🪩' : '✦'}</span><div className="rank-person"><strong>{person.profiles?.full_name ?? 'Participante'}</strong><span><Flame size={13} /> {person.completed_days} dias <i /> {person.consistency_points} pts consistência</span></div><strong className="rank-points">{person.total_points.toLocaleString('pt-BR')} <small>pts</small></strong></div>)}</div><div className="score-info"><CircleHelp size={18} /><div><strong>Como funciona o placar?</strong><p>Consistência, evolução e volume vêm de atividades validadas no servidor. Peso, IMC, gordura corporal, medidas e aparência não participam do ranking.</p></div><ChevronRight size={17} /></div></> }

function RegisterPage({ activeSession, completedSession, onStarted, onCompleted, onDone }: { activeSession: ActivitySession | null; completedSession: ActivitySession | null; onStarted: (session: ActivitySession) => void; onCompleted: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <><PageTitle eyebrow="CHECK-IN MOVE" title={activeSession ? 'Atividade em andamento.' : completedSession ? 'Atividade concluída.' : 'Qual foi o movimento?'} detail={activeSession ? 'O tempo continua sendo contado pelo horário real do servidor.' : completedSession ? 'Revise os dados antes de enviar para validação.' : 'Comece uma sessão para registrar seu movimento.'} /><ActivitySessionForm activeSession={activeSession} completedSession={completedSession} onStarted={onStarted} onCompleted={onCompleted} onDone={onDone} /></> }
function formatDuration(totalSeconds: number) { const safeSeconds = Math.max(0, totalSeconds); const hours = Math.floor(safeSeconds / 3600).toString().padStart(2, '0'); const minutes = Math.floor((safeSeconds % 3600) / 60).toString().padStart(2, '0'); const seconds = Math.floor(safeSeconds % 60).toString().padStart(2, '0'); return `${hours}:${minutes}:${seconds}` }
function ActivitySessionForm({ activeSession, completedSession, onStarted, onCompleted, onDone }: { activeSession: ActivitySession | null; completedSession: ActivitySession | null; onStarted: (session: ActivitySession) => void; onCompleted: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) {
  const [type, setType] = useState<ActivityType>('Caminhada rápida / inclinação')
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseStartedAt, setPauseStartedAt] = useState<string | null>(null)
  useEffect(() => { if (!activeSession) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [activeSession])
  useEffect(() => { if (!supabase || !activeSession) return; supabase.from('activity_pauses').select('pause_started_at').eq('activity_session_id', activeSession.id).is('pause_ended_at', null).maybeSingle().then(({ data }) => { setPaused(Boolean(data)); setPauseStartedAt(data?.pause_started_at ?? null) }) }, [activeSession])
  const elapsed = activeSession ? Math.max(0, Math.floor((now - Date.parse(activeSession.started_at)) / 1000) - (activeSession.paused_seconds ?? 0) - (paused && pauseStartedAt ? Math.floor((now - Date.parse(pauseStartedAt)) / 1000) : 0)) : completedSession?.duration_seconds ?? 0
  const reachedGoal = elapsed >= 30 * 60
  const start = async () => {
    if (!supabase) { setError('Configure o Supabase para iniciar uma sessão real.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('start_activity_session', { p_activity_type: type })
    setBusy(false)
    if (rpcError) setError(rpcError.message.includes('no active season') ? 'Nenhuma temporada ativa está disponível no momento. Aguarde a organização abrir uma temporada.' : rpcError.message.includes('active participation required') ? 'Sua participação ainda não está ativa. Conclua a inscrição e aguarde a confirmação.' : rpcError.message)
    else onStarted(data as ActivitySession)
  }
  const finish = async () => {
    if (!supabase || !activeSession) return
    if (!window.confirm('Você concluiu sua atividade?')) return
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('finish_activity_session', { p_session_id: activeSession.id })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else onCompleted(data as ActivitySession)
  }
  const togglePause = async () => {
    if (!supabase || !activeSession) return
    setBusy(true); setError('')
    const { data, error: rpcError } = paused ? await supabase.rpc('resume_activity_session', { p_session_id: activeSession.id }) : await supabase.rpc('pause_activity_session', { p_session_id: activeSession.id })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else if (paused) { setPaused(false); setPauseStartedAt(null); onStarted(data as ActivitySession) }
    else { setPaused(true); setPauseStartedAt((data as { pause_started_at: string }).pause_started_at) }
  }
  const submit = async () => {
    if (!supabase || !completedSession) return
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('submit_activity_session', { p_session_id: completedSession.id })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else onDone(data as ActivitySession)
  }
  if (completedSession) return <div className="form-panel activity-session-panel completed-session"><div className="session-heading"><span className="eyebrow">🔥 ATIVIDADE CONCLUÍDA</span></div><h2>{completedSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">Início: {new Date(completedSession.started_at).toLocaleString('pt-BR')}<br />Término: {completedSession.ended_at ? new Date(completedSession.ended_at).toLocaleString('pt-BR') : '-'}</p>{reachedGoal ? <div className="goal-hit"><Check size={17} /> Meta diária: 30 min · meta atingida</div> : <div className="session-caption goal-missed">Meta diária: 30 min · ainda não atingida</div>}<div className="review-actions"><button className="primary-button" disabled={busy} onClick={submit}>{busy ? 'Enviando...' : 'Enviar para validação'} <ArrowUpRight size={16} /></button></div>{error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> Horários, duração e tipo ficam bloqueados após a finalização.</p></div>
  return <div className={`form-panel activity-session-panel ${activeSession ? 'is-active' : ''}`}>{activeSession ? <><div className="session-heading"><span className="live-dot" /><span className="eyebrow">{paused ? '⏸ ATIVIDADE PAUSADA' : '🔥 ATIVIDADE EM ANDAMENTO'}</span></div><h2>{activeSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">{paused ? 'tempo pausado não entra na duração efetiva' : 'tempo realizado · registrado pelo servidor'}</p>{reachedGoal && <div className="goal-hit"><Flame size={17} /> META BATIDA! Você pode continuar.</div>}<div className="session-goal"><div><span className="eyebrow">META DO DIA</span><strong>{Math.min(100, Math.round((elapsed / 1800) * 100))}%</strong></div><div className="progress-line"><span style={{ width: `${Math.min(100, (elapsed / 1800) * 100)}%` }} /></div><small>{formatDuration(Math.min(elapsed, 1800))} de 00:30:00</small></div><div className="review-actions"><button className="text-button" disabled={busy} onClick={togglePause}>{paused ? 'Continuar' : 'Pausar'}</button><button className="primary-button finish-button" disabled={busy || paused} onClick={finish}>{busy ? 'Finalizando...' : 'Finalizar'} <Check size={17} /></button></div></> : <><label>Atividade<select value={type} onChange={e => setType(e.target.value as ActivityType)}>{Object.keys(metValues).map(item => <option key={item}>{item}</option>)}</select></label><div className="estimate"><span className="estimate-icon"><Play size={21} /></span><div><span className="eyebrow">CHECK-IN COM HORÁRIO REAL</span><strong>Pronto para começar</strong><p>O servidor registra o início e calcula a duração no final.</p></div></div><button className="primary-button full" disabled={busy} onClick={start}>{busy ? 'Iniciando...' : 'Iniciar atividade'} <Play size={17} /></button></>} {error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> A pontuação só é criada após validação.</p></div>
}

function ChallengesPage({ onAction }: { onAction: (message: string) => void }) { const [challenges, setChallenges] = useState<Array<{ id: string; name: string; description: string | null; objective: number; points: number; progress: number; status: string }>>([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!supabase) { setLoading(false); return }; const load = async () => { const { data } = await supabase.from('challenges').select('id, name, description, objective, points, challenge_progress(progress, status)').eq('is_active', true).order('starts_at'); const mapped = (data ?? []).map(item => { const row = item as unknown as { id: string; name: string; description: string | null; objective: number; points: number; challenge_progress: Array<{ progress: number; status: string }> }; const progress = row.challenge_progress?.[0]; return { id: row.id, name: row.name, description: row.description, objective: Number(row.objective), points: Number(row.points), progress: Number(progress?.progress ?? 0), status: progress?.status ?? 'joined' } }); setChallenges(mapped); setLoading(false) }; load() }, []); const join = async (id: string) => { if (!supabase) return; const { error } = await supabase.rpc('join_challenge', { p_challenge_id: id }); if (error) onAction(error.message); else onAction('Desafio iniciado.'); }; return <><PageTitle eyebrow="PLAYGROUND" title="Escolha seu próximo jogo." detail="Desafios e progresso oficiais da temporada." />{loading ? <div className="form-panel"><p>Carregando desafios...</p></div> : challenges.length === 0 ? <div className="score-info"><CircleHelp size={18} /><div><strong>Nenhum desafio ativo</strong><p>Os próximos desafios aparecerão aqui quando forem configurados pela organização.</p></div></div> : <div className="challenge-list">{challenges.map((challenge, index) => <ChallengeCard key={challenge.id} icon={index % 2 ? <Zap /> : <Swords />} label={`${challenge.points} PONTOS`} title={challenge.name} copy={challenge.description ?? 'Desafio oficial da temporada.'} progress={Math.min(100, Math.round((challenge.progress / challenge.objective) * 100))} action={challenge.status === 'joined' ? 'Participar' : challenge.status === 'completed' ? 'Concluído' : 'Continuar'} tone={index % 2 ? 'yellow' : 'purple'} onClick={() => challenge.status === 'joined' && join(challenge.id)} />)}</div>}</> }
function ChallengeCard({ icon, label, title, copy, progress, action, tone, onClick }: { icon: React.ReactNode; label: string; title: string; copy: string; progress: number; action: string; tone: string; onClick: () => void }) { return <div className={`challenge-card ${tone}`}><div className="challenge-card-top"><span className="large-challenge-icon">{icon}</span><span className="eyebrow">{label}</span><span className="card-kicker">+30 <small>pts</small></span></div><h2>{title}</h2><p>{copy}</p><div className="challenge-progress"><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><span>{progress}% completo</span></div><button className="text-button" onClick={onClick}>{action} <ArrowUpRight size={16} /></button></div> }
function Badge({ icon, title, unlocked = false }: { icon: string; title: string; unlocked?: boolean }) { return <div className={`badge ${unlocked ? 'unlocked' : ''}`}><span>{unlocked ? icon : '◌'}</span><strong>{title}</strong>{unlocked && <small>conquistado</small>}</div> }

function ProfilePage({ profile, onNavigate, onAction }: { profile: Profile | null; onNavigate: (page: Page) => void; onAction: (message: string) => void }) { const { updateProfile } = useAuth(); const [name, setName] = useState(profile?.full_name ?? ''); const [phone, setPhone] = useState(profile?.phone ?? ''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); useEffect(() => { setName(profile?.full_name ?? ''); setPhone(profile?.phone ?? '') }, [profile]); const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const result = await updateProfile({ fullName: name, phone }); setBusy(false); if (result.error) setError(result.error.message); else setMessage('Perfil atualizado.') }; return <><section className="profile-head"><div className="profile-avatar">🪩<span className="status-check"><Check size={11} /></span></div><div><span className="eyebrow">SEU PERFIL</span><h1>{profile?.full_name ?? 'Seu perfil'}</h1><p>{profile?.email ?? 'Conta autenticada'} · participante {profile?.status === 'pending' ? 'pendente' : 'ativo'}</p></div><button className="icon-button" aria-label="Editar perfil"><MoreHorizontal size={20} /></button></section><form className="form-panel profile-edit-form" onSubmit={save}><label>Nome completo<input required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Celular<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><p className="form-note"><Lock size={13} /> E-mail, status e permissão são controlados pelo sistema.</p><button className="primary-button" disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'} <Check size={16} /></button>{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</form><div className="profile-stats"><div><strong>Dados oficiais</strong><span>pontuação no ranking</span></div><div><strong>Privado</strong><span>sem dados corporais</span></div><div><strong>Seguro</strong><span>RLS ativo</span></div></div><SectionHeading title="Seus badges" action="Ver todos" onClick={() => onNavigate('challenges')} /><div className="badge-grid profile-badges"><Badge icon="🔥" title="Primeiro streak" unlocked /><Badge icon="🚀" title="Virada de jogo" unlocked /><Badge icon="🧭" title="Explorador" unlocked /></div><div className="settings-list"><button onClick={() => onAction('Notificações atualizadas.')}><Bell size={18} /><span>Notificações</span><small>Ativas</small><ChevronRight size={17} /></button><button onClick={() => onNavigate('rules')}><ShieldCheck size={18} /><span>Privacidade e LGPD</span><ChevronRight size={17} /></button></div></> }

function RulesPage() { return <><PageTitle eyebrow="MANUAL MOVE" title="O jogo é consistência." detail="Regras claras para uma competição leve, justa e divertida." /><div className="rules-intro"><Target size={22} /><p>A meta não é ser o mais intenso. É aparecer por você, um dia de cada vez.</p></div><RuleBlock title="Temporada" text="Cada temporada dura 8 semanas. A Semana 0 é dedicada ao onboarding e à definição do seu baseline. O 7º dia de cada semana é descanso e não pontua." /><RuleBlock title="Meta diária" text="Complete 30 minutos de atividade contínua ou alcance 8.000 passos. Você tem até 6 dias pontuáveis por semana." /><RuleBlock title="Como a pontuação é calculada" text="Consistência: 10 pontos por dia completo, até 60 por semana, mais 15 pontos ao completar 5 dias ou mais. Evolução: 1 ponto a cada 2% de melhoria contra seu baseline, até 25 pontos. Volume: 1 ponto a cada 40 MET-min, até 20 pontos. O teto semanal é 120 pontos." /><RuleBlock title="Coringas" text="Você recebe 2 coringas por temporada. Use um para neutralizar um dia perdido sem quebrar seu streak. Coringas não geram pontos, apenas protegem sua consistência." /><RuleBlock title="Jogo limpo e privacidade" text="O ranking nunca usa peso, IMC, gordura corporal, medidas ou aparência. Dados são usados apenas para autenticação, competição e comunicação. No modo Supabase, o cálculo final deve ser validado no servidor via RPC ou Edge Function, com baseline congelado, timestamp, janela de edição e trilha de auditoria." /></> }
function RuleBlock({ title, text }: { title: string; text: string }) { return <article className="rule-block"><span className="rule-number">{title.slice(0, 1)}</span><div><h2>{title}</h2><p>{text}</p></div></article> }

function RegisterModal({ activeSession, onClose, onStarted, onDone }: { activeSession: ActivitySession | null; onClose: () => void; onStarted: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <div className="modal-backdrop" onMouseDown={activeSession ? undefined : onClose}><div className="register-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{activeSession ? 'SESSÃO ATIVA' : 'NOVO MOVIMENTO'}</span><h2>{activeSession ? 'Continue no seu ritmo.' : 'Comece seu movimento.'}</h2></div>{!activeSession && <button className="icon-button" onClick={onClose}><X size={20} /></button>}</div><ActivitySessionForm activeSession={activeSession} onStarted={onStarted} onDone={onDone} /></div></div> }

export default App

createRoot(document.getElementById('root')!).render(<AuthProvider><App /></AuthProvider>)
