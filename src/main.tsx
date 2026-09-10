function ActivityHistoryPage({ userId }: { userId: string }) {
  const [sessions, setSessions] = useState<Array<ActivitySession & { season_id: string; points: number | null; proof: string | null }>>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    const load = async () => {
      const { data } = await supabase.from('activity_sessions').select('id, activity_type, started_at, ended_at, status, duration_seconds, paused_seconds, season_id, activity_proofs(storage_path), activity_score_contributions(consistency_points, evolution_points, volume_points)').eq('user_id', userId).order('started_at', { ascending: false })
      const mapped = (data ?? []).map(item => { const row = item as unknown as ActivitySession & { season_id: string; activity_proofs?: { storage_path: string | null }[]; activity_score_contributions?: { consistency_points: number; evolution_points: number; volume_points: number }[] }; const contribution = row.activity_score_contributions?.[0]; return { ...row, points: contribution ? Number(contribution.consistency_points) + Number(contribution.evolution_points) + Number(contribution.volume_points) : null, proof: row.activity_proofs?.[0]?.storage_path ?? null } })
      setSessions(mapped); setLoading(false)
    }
    load()
  }, [userId])
  const groups = [['active', 'Em andamento'], ['pending_validation', 'Aguardando aprovação'], ['validated', 'Aprovadas'], ['rejected', 'Rejeitadas']] as const
  return <><PageTitle eyebrow="HISTÓRICO" title="Minhas atividades" detail="Atividades e validações vinculadas à sua conta." />{loading ? <div className="form-panel"><p>Carregando atividades...</p></div> : sessions.length === 0 ? <div className="score-info"><History size={18} /><div><strong>Nenhuma atividade registrada</strong><p>Quando você concluir uma atividade, ela aparecerá aqui.</p></div></div> : groups.map(([status, title]) => { const rows = sessions.filter(session => session.status === status); return <section className="activity-history-group" key={status}><SectionHeading title={`${title} · ${rows.length}`} />{rows.length === 0 ? <p className="admin-empty">Nenhuma atividade nesta categoria.</p> : rows.map(session => <article className="activity-history-row" key={session.id}><div><strong>{session.activity_type}</strong><span>{new Date(session.started_at).toLocaleDateString('pt-BR')} · {new Date(session.started_at).toLocaleTimeString('pt-BR')} {session.ended_at ? `até ${new Date(session.ended_at).toLocaleTimeString('pt-BR')}` : ''}</span><small>Duração: {formatDuration(session.duration_seconds ?? 0)}{session.points !== null ? ` · ${session.points} pontos` : ''}{session.proof ? ' · comprovante anexado' : ''}</small></div><span className={`status-badge ${status}`}>{title}</span></article>)}</section> })}</>
}
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowUpRight, Award, Bell, BookOpen, Check, ChevronRight, CircleHelp,
  Flame, Footprints, Gauge, History, Home, Lock, Menu, MessageCircle, MoreHorizontal,
  Copy, Play, Plus, ShieldCheck, Swords, Target, Trophy, UserRound, Users, X, Zap,
} from 'lucide-react'
import { AuthProvider, useAuth, type Profile } from './lib/auth'
import { supabase } from './lib/supabase'
import './styles.css'

type Page = 'home' | 'ranking' | 'register' | 'activities' | 'challenges' | 'profile' | 'rules' | 'admin' | 'enrollment'
type ActivityType = 'Caminhada leve' | 'Caminhada rápida / inclinação' | 'Musculação moderada' | 'Musculação pesada' | 'Bike / spinning' | 'Natação' | 'Corrida' | 'Funcional / HIIT' | 'Yoga / alongamento'
type ActivitySession = { id: string; activity_type: ActivityType; started_at: string; ended_at: string | null; status: 'active' | 'pending_validation' | 'validated' | 'rejected' | 'completed' | 'cancelled'; duration_seconds: number | null; paused_seconds?: number }
type CurrentSeason = { id: string; name: string; start_date: string; end_date: string; status: 'registration' | 'active' }

const metValues: Record<ActivityType, number> = {
  'Caminhada leve': 3.5, 'Caminhada rápida / inclinação': 5, 'Musculação moderada': 4,
  'Musculação pesada': 6, 'Bike / spinning': 7, Natação: 7, Corrida: 8,
  'Funcional / HIIT': 8, 'Yoga / alongamento': 2.5,
}

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home }, { id: 'ranking', label: 'Ranking', icon: Trophy },
  { id: 'register', label: 'Registrar', icon: Plus }, { id: 'activities', label: 'Minhas atividades', icon: History }, { id: 'challenges', label: 'Desafios', icon: Swords },
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
  const [currentSeason, setCurrentSeason] = useState<CurrentSeason | null>(null)

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
    if (!supabase || !user) return
    supabase.from('seasons').select('id, name, start_date, end_date, status').in('status', ['registration', 'active']).order('start_date', { ascending: true }).then(({ data }) => {
      const today = new Date().toISOString().slice(0, 10)
      const seasons = (data ?? []) as CurrentSeason[]
      setCurrentSeason(seasons.find(season => season.start_date <= today && season.end_date >= today) ?? seasons.find(season => season.status === 'registration' && season.start_date > today) ?? null)
    })
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
      <button className="season-pill" onClick={() => go('enrollment')}><span className="live-dot" /> {currentSeason?.name ?? 'Nenhuma temporada disponível'} <ChevronRight size={13} /></button>
      <div className="top-actions"><button className="icon-button" onClick={() => notify('Você está em dia!')} aria-label="Notificações"><Bell size={19} /><span className="notification-dot" /></button><button className="avatar-button" onClick={() => go('profile')}>{profile?.avatar_emoji || '🪩'}</button><button className="icon-button menu-button" onClick={() => setMenuOpen(!menuOpen)} aria-label="Abrir menu"><Menu size={20} /></button></div>
    </header>
    {menuOpen && <div className="quick-menu"><button onClick={() => go('rules')}><BookOpen size={17} /> Como pontua</button>{profile?.role === 'admin' && <button onClick={() => go('admin')}><ShieldCheck size={17} /> Admin</button>}<button onClick={() => notify('Tudo certo: seus dados estão protegidos.')}><ShieldCheck size={17} /> Privacidade</button><button onClick={() => signOut()}><Lock size={17} /> Sair</button></div>}

    <main className="content">{page === 'home' && <HomePage userId={user.id} onNavigate={go} onRegister={() => setShowRegister(true)} done={activityDone} />}{page === 'ranking' && <RankingPage userId={user.id} />}{page === 'register' && <RegisterPage onCancelled={() => { setActiveSession(null); setCompletedSession(null) }} activeSession={activeSession} completedSession={completedSession} onStarted={setActiveSession} onCompleted={session => { setActiveSession(null); setCompletedSession(session) }} onDone={(session) => { setCompletedSession(null); setActivityDone(true); notify(`Atividade de ${formatDuration(session.duration_seconds ?? 0)} enviada para validação.`); go('home') }} />}{page === 'activities' && <ActivityHistoryPage userId={user.id} />}{page === 'challenges' && <ChallengesPage onAction={notify} />}{page === 'profile' && <ProfilePage profile={profile} onNavigate={go} onAction={notify} />}{page === 'rules' && <RulesPage />}{page === 'enrollment' && <EnrollmentPage />}{page === 'admin' && (profile?.role === 'admin' ? <AdminWorkspace /> : <AccessState title="Área restrita" detail="Apenas administradores podem acessar este espaço." onAction={() => go('home')} action="Voltar" />)}</main>

    <nav className="bottom-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => id === 'register' ? setShowRegister(true) : go(id)}><span className="nav-icon"><Icon size={20} strokeWidth={page === id ? 2.5 : 1.8} />{id === 'register' && <span className="nav-plus">+</span>}</span><span>{label}</span></button>)}</nav>
    {(showRegister || activeSession || completedSession) && <RegisterModal onCancelled={() => { setActiveSession(null); setCompletedSession(null); setShowRegister(false) }} season={currentSeason} activeSession={activeSession} completedSession={completedSession} onClose={() => { setShowRegister(false); setCompletedSession(null) }} onStarted={setActiveSession} onCompleted={session => { setActiveSession(null); setCompletedSession(session) }} onDone={(session) => { setActiveSession(null); setCompletedSession(null); setActivityDone(true); setShowRegister(false); notify(`Atividade de ${formatDuration(session.duration_seconds ?? 0)} enviada para validação.`) }} />}
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
  const request = async () => { if (!supabase || !season) return; setBusy(true); setError(''); const { data, error: rpcError } = await supabase.rpc('request_season_participation', { p_season_id: season.id }); setBusy(false); if (rpcError) setError(rpcError.message); else { setPayment(data); setMessage('Inscrição criada. Faça o PIX e confirme o envio do pagamento.') } }
  const confirmPix = async () => { if (!supabase || !payment) return; setBusy(true); setError(''); const { data, error: updateError } = await supabase.from('payments').update({ payment_status: 'submitted' }).eq('id', payment.id).select('id, amount, payment_status, proof_url').single(); setBusy(false); if (updateError) setError(updateError.message); else { setPayment(data); setMessage('Pagamento enviado. Aguardando aprovação.') } }
  const copyPixKey = async () => { if (!season.pix_key) return; try { await navigator.clipboard.writeText(season.pix_key); setMessage('Chave PIX copiada.') } catch { setError('Não foi possível copiar a chave PIX.') } }
  const uploadProof = async (file: File) => { if (!supabase || !payment || !user) return; setError(''); const allowed = ['image/jpeg', 'image/png', 'application/pdf']; if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Envie somente JPG, JPEG, PNG ou PDF de até 5 MB.'); return }; setBusy(true); const path = `${user.id}/${payment.id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const upload = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false, contentType: file.type }); if (upload.error) { setBusy(false); setError(upload.error.message); return }; const { data, error: submitError } = await supabase.rpc('submit_payment_proof', { p_payment_id: payment.id, p_storage_path: path }); setBusy(false); if (submitError) setError(submitError.message); else { setPayment(data); setMessage('Comprovante enviado. A confirmação depende da revisão administrativa.') } }
  const statusLabel = payment?.payment_status === 'submitted' ? 'aguardando confirmação' : payment?.payment_status === 'confirmed' ? 'aprovado' : payment?.payment_status === 'rejected' ? 'rejeitado' : 'pagamento pendente'
  return <><PageTitle eyebrow="INSCRIÇÃO" title="Entre para a temporada." detail="Sua participação só fica ativa após a confirmação manual do PIX." />{busy && !season ? <div className="form-panel"><p>Carregando temporada disponível...</p></div> : !season ? <div className="score-info"><CircleHelp size={18} /><div><strong>Nenhuma temporada disponível no momento.</strong><p>Assim que uma temporada estiver em período de inscrição, ela aparecerá aqui.</p></div></div> : <div className="form-panel enrollment-panel"><span className="eyebrow">INSCRIÇÃO</span><h2>{season.name}</h2><p>{season.description ?? 'Consistência que transforma.'}</p><div className="enrollment-details"><span>Período <strong>{new Date(season.start_date).toLocaleDateString('pt-BR')} a {new Date(season.end_date).toLocaleDateString('pt-BR')}</strong></span><span>Taxa <strong>R$ {Number(season.entry_fee).toFixed(2).replace('.', ',')}</strong></span></div>{!payment ? <button className="primary-button full" disabled={busy} onClick={request}>{busy ? 'Criando inscrição...' : 'Participar da temporada'} <ArrowUpRight size={16} /></button> : <><div className="pix-instructions"><strong>Pagamento PIX</strong><p>Envie R$ {Number(payment.amount).toFixed(2).replace('.', ',')} para a chave:</p><div className="pix-key-row"><strong>{season.pix_key ?? 'Chave PIX ainda não configurada'}</strong>{season.pix_key && <button className="icon-button" aria-label="Copiar chave PIX" title="Copiar chave PIX" onClick={copyPixKey}><Copy size={16} /></button>}</div><span>Status: {statusLabel}</span></div>{payment.payment_status === 'pending' && <button className="primary-button full" disabled={busy} onClick={confirmPix}>{busy ? 'Enviando...' : 'Já fiz o PIX'} <Check size={16} /></button>}{payment.payment_status !== 'confirmed' && <label className="upload-proof">Anexar comprovante<input disabled={busy} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={e => e.target.files?.[0] && uploadProof(e.target.files[0])} /></label>}{payment.payment_status === 'submitted' && <div className="form-success">Pagamento enviado. Aguardando aprovação.</div>}</>}{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</div>}</>
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
type AdminActivity = { id: string; activity_type: string; started_at: string; ended_at: string | null; duration_seconds: number | null; status: string; source: string; profiles: { full_name: string; avatar_emoji?: string | null } | null; activity_proofs: { proof_type: string; storage_path: string | null; external_reference: string | null }[] }

function ProofLink({ bucket, path }: { bucket: string; path: string }) {
  const [url, setUrl] = useState('')
  const open = async () => { if (!supabase) return; const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300); if (!error && data?.signedUrl) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank', 'noopener,noreferrer') } }
  return <button className="text-button" onClick={open}>{url ? 'Abrir comprovante' : 'Visualizar comprovante'}</button>
}

function AdminWorkspace() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'dashboard' | 'seasons' | 'participants' | 'payments' | 'activities' | 'ranking' | 'settings'>('dashboard')
  const tabs = [['dashboard', 'Dashboard'], ['seasons', 'Temporadas'], ['participants', 'Participantes'], ['payments', 'Pagamentos PIX'], ['activities', 'Atividades pendentes'], ['ranking', 'Ranking'], ['settings', 'Configurações']] as const
  return <><nav className="admin-tabs">{tabs.map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav>{tab === 'dashboard' && <AdminPage />}{tab === 'seasons' && <AdminSeasons />}{tab === 'participants' && <AdminParticipants />}{tab === 'payments' && <AdminPayments />}{tab === 'activities' && <AdminActivities />}{tab === 'ranking' && user && <RankingPage userId={user.id} />}{tab === 'settings' && <><PageTitle eyebrow="CONFIGURAÇÕES" title="Configurações" detail="Acesso administrativo protegido pelo Supabase." /><div className="form-panel"><p>As alterações de competição são feitas por RPCs administrativas e registradas em auditoria.</p></div></>}</>
}

function AdminSeasons() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; description: string | null; start_date: string; end_date: string; status: string; entry_fee: number; pix_key: string | null }>>([])
  const [form, setForm] = useState({ id: '', name: '', description: '', start_date: '', end_date: '', status: 'draft', entry_fee: '0', pix_key: '' })
  const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data } = await supabase.from('seasons').select('id, name, description, start_date, end_date, status, entry_fee, pix_key').order('start_date', { ascending: false }); setSeasons((data ?? []) as typeof seasons) }
  useEffect(() => { load() }, [])
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (!supabase) return; setMessage(''); setError(''); const { error: saveError } = await supabase.rpc('admin_upsert_season', { p_season_id: form.id || null, p_name: form.name, p_description: form.description || null, p_start_date: form.start_date, p_end_date: form.end_date, p_status: form.status, p_entry_fee: Number(form.entry_fee), p_pix_key: form.pix_key || null }); if (saveError) setError(saveError.message); else { setMessage('Temporada salva.'); setForm({ id: '', name: '', description: '', start_date: '', end_date: '', status: 'draft', entry_fee: '0', pix_key: '' }); load() } }
  return <><PageTitle eyebrow="TEMPORADAS" title="Temporadas" detail="Crie e edite temporadas por operação administrativa server-side." /><form className="form-panel admin-season-form" onSubmit={save}><div className="form-grid"><label>Nome<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option>draft</option><option>registration</option><option>active</option><option>finished</option><option>cancelled</option></select></label><label>Início<input required type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} /></label><label>Fim<input required type="date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} /></label><label>Valor<input required min="0" step="0.01" type="number" value={form.entry_fee} onChange={event => setForm({ ...form, entry_fee: event.target.value })} /></label><label>Chave PIX<input value={form.pix_key} onChange={event => setForm({ ...form, pix_key: event.target.value })} /></label></div><label>Descrição<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label><button className="primary-button" type="submit">{form.id ? 'Salvar alterações' : 'Criar temporada'} <Check size={16} /></button>{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</form><div className="admin-review-list">{seasons.map(season => <div className="admin-review-row" key={season.id}><div><strong>{season.name}</strong><span>{season.start_date} a {season.end_date} · {season.status} · R$ {Number(season.entry_fee).toFixed(2).replace('.', ',')}</span></div><button className="text-button" onClick={() => setForm({ id: season.id, name: season.name, description: season.description ?? '', start_date: season.start_date, end_date: season.end_date, status: season.status, entry_fee: String(season.entry_fee), pix_key: season.pix_key ?? '' })}>Editar</button></div>)}</div></>
}

function AdminParticipants() {
  const [rows, setRows] = useState<Array<{ id: string; user_id: string; status: string; joined_at: string; profiles: { full_name: string; avatar_emoji: string | null } | null; seasons: { name: string } | null; payments: { payment_status: string }[] }>>([])
  const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data } = await supabase.from('season_participants').select('id, user_id, status, joined_at, profiles(full_name, avatar_emoji), seasons(name), payments(payment_status)').order('joined_at', { ascending: false }); setRows((data ?? []) as unknown as typeof rows) }
  useEffect(() => { load() }, [])
  const changeStatus = async (userId: string, status: 'active' | 'blocked' | 'pending') => { if (!supabase) return; const { error: rpcError } = await supabase.rpc('admin_set_profile_status', { p_user_id: userId, p_status: status }); if (rpcError) setError(rpcError.message); else load() }
  return <><PageTitle eyebrow="PARTICIPANTES" title="Participantes" detail="Status de inscrição e pagamento vindos do Supabase." />{error && <div className="form-error">{error}</div>}<div className="admin-review-list">{rows.length === 0 ? <p className="admin-empty">Nenhum participante encontrado.</p> : rows.map(row => <div className="admin-review-row" key={row.id}><div><strong>{row.profiles?.avatar_emoji ?? '·'} {row.profiles?.full_name ?? 'Participante'}</strong><span>{row.seasons?.name ?? 'Temporada'} · inscrição {new Date(row.joined_at).toLocaleDateString('pt-BR')} · pagamento {row.payments?.[0]?.payment_status ?? 'pendente'}</span><small>Status: {row.status}</small></div><div className="review-actions"><button className="text-button" onClick={() => changeStatus(row.user_id, 'active')}>Ativar</button><button className="text-button reject" onClick={() => changeStatus(row.user_id, 'blocked')}>Bloquear</button></div></div>)}</div></>
}

function AdminPayments() {
  const [rows, setRows] = useState<AdminPayment[]>([])
  const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data } = await supabase.from('payments').select('id, amount, payment_status, created_at, proof_url, profiles(full_name, email), seasons(name)').in('payment_status', ['pending', 'submitted']).order('created_at', { ascending: true }); setRows((data ?? []) as unknown as AdminPayment[]) }
  useEffect(() => { load() }, [])
  const review = async (id: string, approved: boolean) => { if (!supabase) return; const reason = approved ? null : window.prompt('Informe o motivo da rejeição:'); if (!approved && !reason?.trim()) return; const result = approved ? await supabase.rpc('confirm_payment', { p_payment_id: id }) : await supabase.rpc('reject_payment', { p_payment_id: id, p_reason: reason }); if (result.error) setError(result.error.message); else load() }
  return <><PageTitle eyebrow="PAGAMENTOS PIX" title="Pagamentos PIX" detail="Aprovação manual com atualização server-side da participação." />{error && <div className="form-error">{error}</div>}<div className="admin-review-list">{rows.length === 0 ? <p className="admin-empty">Nenhum pagamento pendente.</p> : rows.map(row => <div className="admin-review-row" key={row.id}><div><strong>{row.profiles?.full_name ?? 'Participante'}</strong><span>{row.seasons?.name ?? 'Temporada'} · R$ {Number(row.amount).toFixed(2).replace('.', ',')} · {row.payment_status}</span><small>{new Date(row.created_at).toLocaleString('pt-BR')}</small></div><div className="review-actions">{row.proof_url && <ProofLink bucket="payment-proofs" path={row.proof_url} />}<button className="text-button" onClick={() => review(row.id, true)}>Aprovar</button><button className="text-button reject" onClick={() => review(row.id, false)}>Rejeitar</button></div></div>)}</div></>
}

function AdminActivities() {
  const [rows, setRows] = useState<AdminActivity[]>([])
  const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data } = await supabase.from('activity_sessions').select('id, activity_type, started_at, ended_at, duration_seconds, status, source, profiles(full_name, avatar_emoji), activity_proofs(proof_type, storage_path, external_reference)').eq('status', 'pending_validation').order('created_at', { ascending: true }); setRows((data ?? []) as unknown as AdminActivity[]) }
  useEffect(() => { load() }, [])
  const review = async (id: string, approved: boolean) => { if (!supabase) return; const reason = approved ? null : window.prompt('Informe o motivo da rejeição:'); if (!approved && !reason?.trim()) return; const result = await supabase.rpc('admin_validate_activity', { p_session_id: id, p_approved: approved, p_rejection_reason: reason }); if (result.error) setError(result.error.message); else load() }
  return <><PageTitle eyebrow="ATIVIDADES" title="Atividades pendentes" detail="Somente atividades aprovadas entram no cálculo server-side." />{error && <div className="form-error">{error}</div>}<div className="admin-review-list">{rows.length === 0 ? <p className="admin-empty">Nenhuma atividade aguardando validação.</p> : rows.map(row => <div className="admin-review-row" key={row.id}><div><strong>{row.profiles?.avatar_emoji ?? '·'} {row.profiles?.full_name ?? 'Participante'} · {row.activity_type}</strong><span>{new Date(row.started_at).toLocaleString('pt-BR')} até {row.ended_at ? new Date(row.ended_at).toLocaleString('pt-BR') : '-'} · {formatDuration(row.duration_seconds ?? 0)}</span><small>Status: {row.status}</small></div><div className="review-actions">{row.activity_proofs?.[0]?.storage_path && <ProofLink bucket="activity-proofs" path={row.activity_proofs[0].storage_path} />}<button className="text-button" onClick={() => review(row.id, true)}>Aprovar</button><button className="text-button reject" onClick={() => review(row.id, false)}>Rejeitar</button></div></div>)}</div></>
}

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
  return <><PageTitle eyebrow="ADMINISTRAÇÃO" title="Visão da temporada." detail="Validações e pagamentos passam por operações protegidas no servidor." /><div className="admin-grid"><Stat icon={<Trophy />} label="temporadas em andamento" value={loading ? '...' : String(stats.seasons)} accent="violet" /><Stat icon={<Users />} label="participantes" value={loading ? '...' : String(stats.participants)} accent="cyan" /><Stat icon={<Bell />} label="inscrições pendentes" value={loading ? '...' : String(stats.pending)} accent="orange" /><Stat icon={<Check />} label="participantes ativos" value={loading ? '...' : String(stats.active)} accent="cyan" /></div>{actionError && <div className="form-error">{actionError}</div>}<AdminReview title="Pagamentos pendentes" empty="Nenhum pagamento aguardando confirmação.">{payments.map(payment => <div className="admin-review-row" key={payment.id}><div><strong>{payment.profiles?.full_name ?? 'Participante'}</strong><span>{payment.seasons?.name ?? 'Temporada não encontrada'} · R$ {Number(payment.amount).toFixed(2).replace('.', ',')} · {payment.payment_status}</span><small>{new Date(payment.created_at).toLocaleString('pt-BR')}{payment.proof_url ? ' · comprovante anexado' : ''}</small></div><div className="review-actions"><button className="text-button" onClick={() => reviewPayment(payment.id, true)}>Confirmar</button><button className="text-button reject" onClick={() => reviewPayment(payment.id, false)}>Rejeitar</button></div></div>)}</AdminReview><AdminReview title="Atividades para validação" empty="Nenhuma atividade aguardando validação.">{activities.map(activity => <div className="admin-review-row" key={activity.id}><div><strong>{activity.profiles?.full_name ?? 'Participante'} · {activity.activity_type}</strong><span>{new Date(activity.started_at).toLocaleString('pt-BR')} até {activity.ended_at ? new Date(activity.ended_at).toLocaleString('pt-BR') : '-'} · {formatDuration(activity.duration_seconds ?? 0)}</span><small>Status: {activity.status} · origem: {activity.source}{activity.activity_proofs?.length ? ' · comprovante disponível' : ''}</small></div><div className="review-actions"><button className="text-button" onClick={() => reviewActivity(activity.id, true)}>Validar</button><button className="text-button reject" onClick={() => reviewActivity(activity.id, false)}>Rejeitar</button></div></div>)}</AdminReview></>
}

function AdminReview({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) { return <section className="admin-review"><SectionHeading title={title} /><div className="admin-review-list">{children || <p className="admin-empty">{empty}</p>}</div></section> }

function PageTitle({ eyebrow, title, detail }: { eyebrow: string; title: string; detail?: string }) { return <div className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{detail && <p>{detail}</p>}</div> }
function SectionHeading({ title, action, onClick }: { title: string; action?: string; onClick?: () => void }) { return <div className="section-heading"><h2>{title}</h2>{action && <button onClick={onClick}>{action} <ChevronRight size={15} /></button>}</div> }

type ScoreRow = { user_id: string; consistency_points: number; evolution_points: number; volume_points: number; bonus_points: number; completed_days: number; total_points: number; profiles?: { full_name: string } | null }

function HomePage({ userId, onNavigate, onRegister, done }: { userId: string; onNavigate: (page: Page) => void; onRegister: () => void; done: boolean }) {
  const [score, setScore] = useState({ points: 0, consistency: 0, evolution: 0, volume: 0, position: 0, total: 0, completedDays: 0 })
  const [seasonName, setSeasonName] = useState('')
  useEffect(() => { if (!supabase) return; const load = async () => { const { data: seasons } = await supabase.from('seasons').select('id, name, start_date, end_date, status').in('status', ['registration', 'active']).order('start_date', { ascending: false }); const today = new Date().toISOString().slice(0, 10); const season = (seasons ?? []).find(item => item.start_date <= today && item.end_date >= today) as { id: string; name: string } | undefined; if (!season) return; setSeasonName(season.name); const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points').eq('season_id', season.id); const rows = (data ?? []) as ScoreRow[]; const totals = new Map<string, ScoreRow>(); rows.forEach(row => { const existing = totals.get(row.user_id) ?? { ...row, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0 }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); const ordered = [...totals.values()].sort((a, b) => b.total_points - a.total_points); const mine = totals.get(userId); setScore({ points: mine?.total_points ?? 0, consistency: mine?.consistency_points ?? 0, evolution: mine?.evolution_points ?? 0, volume: mine?.volume_points ?? 0, position: mine ? ordered.findIndex(row => row.user_id === userId) + 1 : 0, total: ordered.length, completedDays: mine?.completed_days ?? 0 }) }; load() }, [userId])
  const progress = done || score.completedDays > 0 ? 100 : 0
  return <>
    <section className="hero"><div className="hero-copy"><span className="eyebrow">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).toUpperCase()}{seasonName ? ` · ${seasonName}` : ''}</span><h1>Consistência que<br /><em>transforma.</em></h1><p>Você não compete contra o corpo do outro.<br />Compete contra sua versão de ontem.</p></div><div className="hero-orbit"><div className="orbit-ring" /><div className="hero-emoji">🪩</div><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span></div></section>
    <section className="stats-grid"><Stat icon={<Trophy />} label="posição" value={score.position ? `#${score.position}` : '-'} accent="violet" /><Stat icon={<Zap />} label="pontos" value={score.points.toLocaleString('pt-BR')} accent="cyan" /><Stat icon={<Flame />} label="dias concluídos" value={String(score.completedDays)} accent="orange" /></section>
    <section className={`today-card ${progress === 100 ? 'completed' : ''}`}><div className="today-top"><div><span className="eyebrow">META DE HOJE</span><h2>{progress === 100 ? 'Meta batida!' : 'Seu próximo movimento'}</h2></div><div className="progress-ring"><span>{progress}<small>%</small></span></div></div><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><div className="today-bottom"><span><Footprints size={16} /> {progress === 100 ? '30 min completos' : 'Comece uma atividade'}</span><button className="primary-button compact" onClick={onRegister}>{progress === 100 ? 'Registrar mais' : 'Registrar atividade'} <ArrowUpRight size={16} /></button></div></section>
    <SectionHeading title="Arena da semana" action="Ver regras" onClick={() => onNavigate('rules')} /><section className="arena-grid"><MiniChallenge icon={<Target />} tag="PONTUAÇÃO OFICIAL" title="Consistência primeiro" progress={`${score.consistency} pts de consistência`} color="purple" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Zap />} tag="EVOLUÇÃO" title="Contra seu baseline" progress={`${score.evolution} pts de evolução`} color="yellow" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Gauge />} tag="VOLUME" title="Intensidade validada" progress={`${score.volume} pts de volume`} color="blue" onClick={() => onNavigate('rules')} /></section>
    <SectionHeading title="Seu movimento" action="Ver ranking" onClick={() => onNavigate('ranking')} /><section className="feed-card"><div className="score-info"><Activity size={18} /><div><strong>Dados oficiais do Supabase</strong><p>{score.total ? `${score.total} participantes pontuando nesta temporada.` : 'Ainda não há pontuação registrada nesta temporada.'}</p></div></div><button className="feed-link" onClick={() => onNavigate('ranking')}>Ver ranking geral <ArrowUpRight size={15} /></button></section>
  </>
}
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) { return <div className="stat-card"><span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></div> }
function MiniChallenge({ icon, tag, title, progress, color, onClick }: { icon: React.ReactNode; tag: string; title: string; progress: string; color: string; onClick: () => void }) { return <button className={`mini-challenge ${color}`} onClick={onClick}><div className="challenge-icon">{icon}</div><span className="eyebrow">{tag}</span><h3>{title}</h3><p>{progress}</p><ChevronRight className="card-arrow" size={18} /></button> }

function RankingPage({ userId }: { userId: string }) { const [rows, setRows] = useState<ScoreRow[]>([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!supabase) { setLoading(false); return }; const load = async () => { const { data: season } = await supabase.from('seasons').select('id, name, start_date').eq('status', 'active').order('start_date', { ascending: false }).limit(1).maybeSingle(); if (!season) { setLoading(false); return }; const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points, profiles(full_name)').eq('season_id', season.id); const totals = new Map<string, ScoreRow>(); (data ?? []).forEach(item => { const row = item as unknown as ScoreRow; const existing = totals.get(row.user_id) ?? { user_id: row.user_id, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0, profiles: row.profiles }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); setRows([...totals.values()].sort((a, b) => b.total_points - a.total_points)); setLoading(false) }; load() }, []); const position = rows.findIndex(row => row.user_id === userId) + 1; return <><PageTitle eyebrow="PLACAR DA TEMPORADA" title="Quem está se movendo?" detail="Pontuação oficial calculada e validada pelo Supabase." /><div className="your-position"><div><span className="eyebrow">SUA POSIÇÃO</span><h2>{position ? `#${position}` : '-'} <small>de {rows.length} pessoas</small></h2></div><div className="gap-copy"><strong>{rows[position - 2] ? `${(rows[position - 2].total_points - (rows[position - 1]?.total_points ?? 0)).toLocaleString('pt-BR')} pts` : 'No topo'}</strong><span>{rows[position - 2] ? 'para alcançar a posição acima' : 'continue consistente'}</span></div></div><SectionHeading title="Ranking geral" action="Pontuação total" /><div className="leaderboard">{loading ? <p className="admin-empty">Carregando ranking...</p> : rows.map((person, index) => <div className={`rank-row ${person.user_id === userId ? 'current-user' : ''}`} key={person.user_id}><span className="rank-number">{index + 1}</span><span className="rank-avatar">{person.user_id === userId ? '🪩' : '✦'}</span><div className="rank-person"><strong>{person.profiles?.full_name ?? 'Participante'}</strong><span><Flame size={13} /> {person.completed_days} dias <i /> {person.consistency_points} pts consistência</span></div><strong className="rank-points">{person.total_points.toLocaleString('pt-BR')} <small>pts</small></strong></div>)}</div><div className="score-info"><CircleHelp size={18} /><div><strong>Como funciona o placar?</strong><p>Consistência, evolução e volume vêm de atividades validadas no servidor. Peso, IMC, gordura corporal, medidas e aparência não participam do ranking.</p></div><ChevronRight size={17} /></div></> }

function RegisterPage({ activeSession, completedSession, onStarted, onCompleted, onCancelled, onDone }: { onCancelled: () => void; activeSession: ActivitySession | null; completedSession: ActivitySession | null; onStarted: (session: ActivitySession) => void; onCompleted: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <><PageTitle eyebrow="CHECK-IN MOVE" title={activeSession ? 'Atividade em andamento.' : completedSession ? 'Atividade concluída.' : 'Qual foi o movimento?'} detail={activeSession ? 'O tempo continua sendo contado pelo horário real do servidor.' : completedSession ? 'Revise os dados antes de enviar para validação.' : 'Comece uma sessão para registrar seu movimento.'} /><ActivitySessionForm activeSession={activeSession} completedSession={completedSession} onStarted={onStarted} onCompleted={onCompleted} onCancelled={onCancelled} onDone={onDone} /></> }
function formatDuration(totalSeconds: number) { const safeSeconds = Math.max(0, totalSeconds); const hours = Math.floor(safeSeconds / 3600).toString().padStart(2, '0'); const minutes = Math.floor((safeSeconds % 3600) / 60).toString().padStart(2, '0'); const seconds = Math.floor(safeSeconds % 60).toString().padStart(2, '0'); return `${hours}:${minutes}:${seconds}` }
function ActivitySessionForm({ season, activeSession, completedSession, onStarted, onCompleted, onCancelled, onDone }: { season?: CurrentSeason | null; activeSession: ActivitySession | null; completedSession: ActivitySession | null; onStarted: (session: ActivitySession) => void; onCompleted: (session: ActivitySession) => void; onCancelled: () => void; onDone: (session: ActivitySession) => void }) {
  const { user } = useAuth()
  const [type, setType] = useState<ActivityType>('Caminhada rápida / inclinação')
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [pauseStartedAt, setPauseStartedAt] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [proofPreview, setProofPreview] = useState('')
  const [steps, setSteps] = useState('')
  useEffect(() => { if (!activeSession) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [activeSession])
  useEffect(() => { if (!supabase || !activeSession) return; supabase.from('activity_pauses').select('pause_started_at').eq('activity_session_id', activeSession.id).is('pause_ended_at', null).maybeSingle().then(({ data }) => { setPaused(Boolean(data)); setPauseStartedAt(data?.pause_started_at ?? null) }) }, [activeSession])
  const elapsed = activeSession ? Math.max(0, Math.floor((now - Date.parse(activeSession.started_at)) / 1000) - (activeSession.paused_seconds ?? 0) - (paused && pauseStartedAt ? Math.floor((now - Date.parse(pauseStartedAt)) / 1000) : 0)) : completedSession?.duration_seconds ?? 0
  const stepsNumber = steps.trim() === '' ? null : Number(steps)
  const reachedGoal = elapsed >= 30 * 60 || (stepsNumber !== null && stepsNumber >= 8000)
  const start = async () => {
    if (!supabase) { setError('Configure o Supabase para iniciar uma sessão real.'); return }
    const today = new Date().toISOString().slice(0, 10)
    if (!season || season.start_date > today) { setError(season ? `A temporada começa em ${new Date(`${season.start_date}T12:00:00`).toLocaleDateString('pt-BR')}. Seus registros estarão disponíveis a partir do início da temporada.` : 'Nenhuma temporada disponível para registro no momento.'); return }
    if (season.end_date < today) { setError('Esta temporada já foi encerrada.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('start_activity_session', { p_activity_type: type })
    setBusy(false)
    if (rpcError) setError(rpcError.message.includes('no active season') ? 'Nenhuma temporada em andamento está disponível no momento. Aguarde a organização abrir uma temporada.' : rpcError.message.includes('active participation required') ? 'Sua participação ainda não está liberada. Conclua a inscrição e aguarde a confirmação.' : rpcError.message)
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
  const cancel = async () => {
    if (!supabase || !activeSession) return
    if (!window.confirm('Descartar esta atividade? Ela não será enviada nem pontuada.')) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('cancel_activity_session', { p_session_id: activeSession.id })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setPaused(false); setPauseStartedAt(null); setSteps(''); setProofFile(null); setProofPreview(''); onCancelled() }
  }
  const selectProof = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Envie uma imagem ou PDF de até 5 MB.'); return }
    setProofFile(file); setProofPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : ''); setError('')
  }
  const submit = async () => {
    if (!supabase || !user || !completedSession || !proofFile) { setError('Anexe um comprovante antes de enviar para validação.'); return }
    if (stepsNumber !== null && (!Number.isInteger(stepsNumber) || stepsNumber < 0 || stepsNumber > 200000)) { setError('Informe um número de passos válido (0 a 200000).'); return }
    setBusy(true); setError('')
    const path = `${user.id}/${completedSession.id}-${crypto.randomUUID()}-${proofFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const upload = await supabase.storage.from('activity-proofs').upload(path, proofFile, { upsert: false, contentType: proofFile.type })
    if (upload.error) { setBusy(false); setError(upload.error.message); return }
    const { data, error: rpcError } = await supabase.rpc('submit_activity_session_with_proof', { p_session_id: completedSession.id, p_storage_path: path, p_steps: stepsNumber })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setSteps(''); setProofFile(null); setProofPreview(''); onDone(data as ActivitySession) }
  }
  if (completedSession) return <div className="form-panel activity-session-panel completed-session"><div className="session-heading"><span className="eyebrow">🔥 ATIVIDADE CONCLUÍDA</span></div><h2>{completedSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">Início: {new Date(completedSession.started_at).toLocaleString('pt-BR')}<br />Término: {completedSession.ended_at ? new Date(completedSession.ended_at).toLocaleString('pt-BR') : '-'}</p>{reachedGoal ? <div className="goal-hit"><Check size={17} /> Meta diária: 30 min · meta atingida</div> : <div className="session-caption goal-missed">Meta diária: 30 min · ainda não atingida</div>}<label className="upload-proof">Passos <span className="optional">opcional</span><input type="number" min={0} max={200000} step={1} inputMode="numeric" placeholder="ex.: 8500" value={steps} disabled={busy} onChange={event => { setSteps(event.target.value); setError('') }} /></label><p className="submit-hint">Informe os passos se bateu a meta de 8.000 sem chegar a 30 minutos.</p><label className="upload-proof">Comprovante da atividade<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => event.target.files?.[0] && selectProof(event.target.files[0])} /></label>{proofPreview && <img className="proof-preview" src={proofPreview} alt="Pré-visualização do comprovante" />}{proofFile?.type === 'application/pdf' && <p className="form-note">PDF selecionado: {proofFile.name}</p>}<div className="review-actions"><button className="primary-button" disabled={busy || !proofFile} onClick={submit}>{busy ? 'Enviando...' : 'Enviar para validação'} <ArrowUpRight size={16} /></button></div>{error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> Depois do envio, horários, duração e comprovante ficam bloqueados.</p></div>
  return <div className={`form-panel activity-session-panel ${activeSession ? 'is-active' : ''}`}>{activeSession ? <><div className="session-heading"><span className="live-dot" /><span className="eyebrow">{paused ? '⏸ ATIVIDADE PAUSADA' : '🔥 ATIVIDADE EM ANDAMENTO'}</span></div><h2>{activeSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">{paused ? 'tempo pausado não entra na duração efetiva' : 'tempo realizado · registrado pelo servidor'}</p>{reachedGoal && <div className="goal-hit"><Flame size={17} /> META BATIDA! Você pode continuar.</div>}<div className="session-goal"><div><span className="eyebrow">META DO DIA</span><strong>{Math.min(100, Math.round((elapsed / 1800) * 100))}%</strong></div><div className="progress-line"><span style={{ width: `${Math.min(100, (elapsed / 1800) * 100)}%` }} /></div><small>{formatDuration(Math.min(elapsed, 1800))} de 00:30:00</small></div><div className="review-actions"><button className="text-button" disabled={busy} onClick={togglePause}>{paused ? 'Continuar' : 'Pausar'}</button><button className="primary-button finish-button" disabled={busy} onClick={finish}>{busy ? 'Finalizando...' : 'Finalizar'} <Check size={17} /></button></div><button className="text-button discard-button" disabled={busy} onClick={cancel}>Descartar atividade</button></> : <><label>Atividade<select value={type} onChange={e => setType(e.target.value as ActivityType)}>{Object.keys(metValues).map(item => <option key={item}>{item}</option>)}</select></label><div className="estimate"><span className="estimate-icon"><Play size={21} /></span><div><span className="eyebrow">CHECK-IN COM HORÁRIO REAL</span><strong>Pronto para começar</strong><p>O servidor registra o início e calcula a duração no final.</p></div></div><button className="primary-button full" disabled={busy} onClick={start}>{busy ? 'Iniciando...' : 'Iniciar atividade'} <Play size={17} /></button></>} {error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> A pontuação só é criada após validação.</p></div>
}

function ChallengesPage({ onAction }: { onAction: (message: string) => void }) { const [challenges, setChallenges] = useState<Array<{ id: string; name: string; description: string | null; objective: number; points: number; progress: number; status: string }>>([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!supabase) { setLoading(false); return }; const load = async () => { const { data } = await supabase.from('challenges').select('id, name, description, objective, points, challenge_progress(progress, status)').eq('is_active', true).order('starts_at'); const mapped = (data ?? []).map(item => { const row = item as unknown as { id: string; name: string; description: string | null; objective: number; points: number; challenge_progress: Array<{ progress: number; status: string }> }; const progress = row.challenge_progress?.[0]; return { id: row.id, name: row.name, description: row.description, objective: Number(row.objective), points: Number(row.points), progress: Number(progress?.progress ?? 0), status: progress?.status ?? 'joined' } }); setChallenges(mapped); setLoading(false) }; load() }, []); const join = async (id: string) => { if (!supabase) return; const { error } = await supabase.rpc('join_challenge', { p_challenge_id: id }); if (error) onAction(error.message); else onAction('Desafio iniciado.'); }; return <><PageTitle eyebrow="PLAYGROUND" title="Escolha seu próximo jogo." detail="Desafios e progresso oficiais da temporada." />{loading ? <div className="form-panel"><p>Carregando desafios...</p></div> : challenges.length === 0 ? <div className="score-info"><CircleHelp size={18} /><div><strong>Nenhum desafio ativo</strong><p>Os próximos desafios aparecerão aqui quando forem configurados pela organização.</p></div></div> : <div className="challenge-list">{challenges.map((challenge, index) => <ChallengeCard key={challenge.id} icon={index % 2 ? <Zap /> : <Swords />} label={`${challenge.points} PONTOS`} title={challenge.name} copy={challenge.description ?? 'Desafio oficial da temporada.'} progress={Math.min(100, Math.round((challenge.progress / challenge.objective) * 100))} action={challenge.status === 'joined' ? 'Participar' : challenge.status === 'completed' ? 'Concluído' : 'Continuar'} tone={index % 2 ? 'yellow' : 'purple'} onClick={() => challenge.status === 'joined' && join(challenge.id)} />)}</div>}</> }
function ChallengeCard({ icon, label, title, copy, progress, action, tone, onClick }: { icon: React.ReactNode; label: string; title: string; copy: string; progress: number; action: string; tone: string; onClick: () => void }) { return <div className={`challenge-card ${tone}`}><div className="challenge-card-top"><span className="large-challenge-icon">{icon}</span><span className="eyebrow">{label}</span><span className="card-kicker">+30 <small>pts</small></span></div><h2>{title}</h2><p>{copy}</p><div className="challenge-progress"><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><span>{progress}% completo</span></div><button className="text-button" onClick={onClick}>{action} <ArrowUpRight size={16} /></button></div> }
function Badge({ icon, title, unlocked = false }: { icon: string; title: string; unlocked?: boolean }) { return <div className={`badge ${unlocked ? 'unlocked' : ''}`}><span>{unlocked ? icon : '◌'}</span><strong>{title}</strong>{unlocked && <small>conquistado</small>}</div> }

function ProfilePage({ profile, onNavigate, onAction }: { profile: Profile | null; onNavigate: (page: Page) => void; onAction: (message: string) => void }) { const { updateProfile } = useAuth(); const [name, setName] = useState(profile?.full_name ?? ''); const [phone, setPhone] = useState(profile?.phone ?? ''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); useEffect(() => { setName(profile?.full_name ?? ''); setPhone(profile?.phone ?? '') }, [profile]); const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const result = await updateProfile({ fullName: name, phone }); setBusy(false); if (result.error) setError(result.error.message); else setMessage('Perfil atualizado.') }; return <><section className="profile-head"><div className="profile-avatar">{profile?.avatar_emoji || '🪩'}<span className="status-check"><Check size={11} /></span></div><div><span className="eyebrow">SEU PERFIL</span><h1>{profile?.full_name ?? 'Seu perfil'}</h1><p>{profile?.email ?? 'Conta autenticada'} · participante {profile?.status === 'pending' ? 'pendente' : 'ativo'}</p></div><button className="icon-button" aria-label="Editar perfil"><MoreHorizontal size={20} /></button></section><form className="form-panel profile-edit-form" onSubmit={save}><label>Nome completo<input required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Celular<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><p className="form-note"><Lock size={13} /> E-mail, status e permissão são controlados pelo sistema.</p><button className="primary-button" disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'} <Check size={16} /></button>{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</form><div className="profile-stats"><div><strong>Dados oficiais</strong><span>pontuação no ranking</span></div><div><strong>Privado</strong><span>sem dados corporais</span></div><div><strong>Seguro</strong><span>RLS ativo</span></div></div><SectionHeading title="Seus badges" action="Ver todos" onClick={() => onNavigate('challenges')} /><div className="badge-grid profile-badges"><Badge icon="🔥" title="Primeiro streak" unlocked /><Badge icon="🚀" title="Virada de jogo" unlocked /><Badge icon="🧭" title="Explorador" unlocked /></div><div className="settings-list"><button onClick={() => onAction('Notificações atualizadas.')}><Bell size={18} /><span>Notificações</span><small>Ativas</small><ChevronRight size={17} /></button><button onClick={() => onNavigate('rules')}><ShieldCheck size={18} /><span>Privacidade e LGPD</span><ChevronRight size={17} /></button></div></> }

function RulesPage() { return <><PageTitle eyebrow="MANUAL MOVE" title="O jogo é consistência." detail="Regras claras para uma competição leve, justa e divertida." /><div className="rules-intro"><Target size={22} /><p>A meta não é ser o mais intenso. É aparecer por você, um dia de cada vez.</p></div><RuleBlock title="Temporada" text="Cada temporada dura 8 semanas. A Semana 0 é dedicada ao onboarding e à definição do seu baseline. O 7º dia de cada semana é descanso e não pontua." /><RuleBlock title="Meta diária" text="Complete 30 minutos de atividade contínua ou alcance 8.000 passos. Você tem até 6 dias pontuáveis por semana." /><RuleBlock title="Como a pontuação é calculada" text="Consistência: 10 pontos por dia completo, até 60 por semana, mais 15 pontos ao completar 5 dias ou mais. Evolução: 1 ponto a cada 2% de melhoria contra seu baseline, até 25 pontos. Volume: 1 ponto a cada 40 MET-min, até 20 pontos. O teto semanal é 120 pontos." /><RuleBlock title="Coringas" text="Você recebe 2 coringas por temporada. Use um para neutralizar um dia perdido sem quebrar seu streak. Coringas não geram pontos, apenas protegem sua consistência." /><RuleBlock title="Jogo limpo e privacidade" text="O ranking nunca usa peso, IMC, gordura corporal, medidas ou aparência. Dados são usados apenas para autenticação, competição e comunicação. No modo Supabase, o cálculo final deve ser validado no servidor via RPC ou Edge Function, com baseline congelado, timestamp, janela de edição e trilha de auditoria." /></> }
function RuleBlock({ title, text }: { title: string; text: string }) { return <article className="rule-block"><span className="rule-number">{title.slice(0, 1)}</span><div><h2>{title}</h2><p>{text}</p></div></article> }

function RegisterModal({ season, activeSession, completedSession, onClose, onStarted, onCompleted, onCancelled, onDone }: { season: CurrentSeason | null; activeSession: ActivitySession | null; completedSession?: ActivitySession | null; onClose: () => void; onCancelled: () => void; onStarted: (session: ActivitySession) => void; onCompleted?: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <div className="modal-backdrop" onMouseDown={activeSession ? undefined : onClose}><div className="register-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{activeSession ? 'SESSÃO ATIVA' : 'NOVO MOVIMENTO'}</span><h2>{activeSession ? 'Continue no seu ritmo.' : 'Comece seu movimento.'}</h2></div>{!activeSession && <button className="icon-button" onClick={onClose}><X size={20} /></button>}</div><ActivitySessionForm season={season} activeSession={activeSession} completedSession={completedSession ?? null} onStarted={onStarted} onCompleted={onCompleted ?? (() => undefined)} onCancelled={onCancelled} onDone={onDone} /></div></div> }

export default App

createRoot(document.getElementById('root')!).render(<AuthProvider><App /></AuthProvider>)
