import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, ArrowUpRight, Award, Bell, BookOpen, Check, ChevronRight, CircleHelp,
  Flame, Footprints, Gauge, History, Home, Lock, Menu, MessageCircle, MoreHorizontal,
  Copy, Play, Plus, ShieldCheck, Swords, Target, Trophy, UserRound, Users, X, Zap, Smartphone
} from 'lucide-react'
import { AuthProvider, useAuth, type Profile } from './lib/auth'
import { supabase } from './lib/supabase'
import './styles.css'

type Page = 'home' | 'ranking' | 'register' | 'activities' | 'challenges' | 'groups' | 'profile' | 'rules' | 'privacy' | 'faq' | 'install' | 'admin' | 'enrollment'
type ActivityType = 'Caminhada leve' | 'Caminhada rápida / inclinação' | 'Musculação moderada' | 'Musculação pesada' | 'Bike / spinning' | 'Natação' | 'Corrida' | 'Funcional / HIIT' | 'Yoga / alongamento'
type ActivitySession = { id: string; activity_type: ActivityType; started_at: string; ended_at: string | null; status: 'active' | 'pending_validation' | 'validated' | 'rejected' | 'completed' | 'cancelled'; duration_seconds: number | null; paused_seconds?: number }
type CurrentSeason = { id: string; name: string; start_date: string; end_date: string; status: 'registration' | 'active' }

const metValues: Record<ActivityType, number> = {
  'Caminhada leve': 3.5, 'Caminhada rápida / inclinação': 5, 'Musculação moderada': 4,
  'Musculação pesada': 6, 'Bike / spinning': 7, Natação: 7, Corrida: 8,
  'Funcional / HIIT': 8, 'Yoga / alongamento': 2.5,
}

function moveToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (type: string) => parts.find(part => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

const navItems: { id: Page; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home }, { id: 'ranking', label: 'Ranking', icon: Trophy },
  { id: 'register', label: 'Registrar', icon: Play }, { id: 'activities', label: 'Minhas atividades', icon: History }, { id: 'challenges', label: 'Duelos', icon: Swords },
  { id: 'profile', label: 'Perfil', icon: UserRound },
]

class MoveErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return <div className="auth-shell">
        <div className="auth-card access-card">
          <span className="brand-mark"><CircleHelp size={20} /></span>
          <h1>Não foi possível abrir esta tela</h1>
          <p>{this.state.error.message}</p>
          <button className="primary-button full" onClick={() => window.location.reload()}>Recarregar</button>
        </div>
      </div>
    }
    return this.props.children
  }
}

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
    if (supabase && user) supabase.rpc('resolve_finished_duels')
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
      const today = moveToday()
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
    {menuOpen && <div className="quick-menu"><button onClick={() => go('rules')}><BookOpen size={17} /> Como pontua</button><button onClick={() => go('groups')}><Users size={17} /> Meus grupos</button><button onClick={() => go('install')}><Smartphone size={17} /> Instalar no celular</button><button onClick={() => go('faq')}><CircleHelp size={17} /> Perguntas frequentes</button><button onClick={() => go('privacy')}><ShieldCheck size={17} /> Privacidade</button>{profile?.role === 'admin' && <button onClick={() => go('admin')}><ShieldCheck size={17} /> Admin</button>}<button onClick={() => signOut()}><Lock size={17} /> Sair</button></div>}

    <main className="content">{page === 'home' && <HomePage userId={user.id} season={currentSeason} onNavigate={go} onRegister={() => setShowRegister(true)} done={activityDone} />}{page === 'ranking' && <RankingPage userId={user.id} />}{page === 'register' && <RegisterPage season={currentSeason} onCancelled={() => { setActiveSession(null); setCompletedSession(null) }} activeSession={activeSession} completedSession={completedSession} onStarted={setActiveSession} onCompleted={session => { setActiveSession(null); setCompletedSession(session) }} onDone={(session) => { setCompletedSession(null); setActivityDone(true); notify(`Atividade de ${formatDuration(session.duration_seconds ?? 0)} enviada para validação.`); go('home') }} />}{page === 'activities' && <ActivityHistoryPage userId={user.id} />}{page === 'challenges' && <DuelsPage userId={user.id} onAction={notify} />}{page === 'groups' && <GroupsPage userId={user.id} onAction={notify} />}{page === 'profile' && <ProfilePage profile={profile} onNavigate={go} onAction={notify} />}{page === 'rules' && <RulesPage />}{page === 'privacy' && <PrivacyPage />}{page === 'faq' && <FaqPage />}{page === 'install' && <InstallGuide />}{page === 'enrollment' && <EnrollmentPage />}{page === 'admin' && (profile?.role === 'admin' ? <AdminWorkspace /> : <AccessState title="Área restrita" detail="Apenas administradores podem acessar este espaço." onAction={() => go('home')} action="Voltar" />)}</main>

    <nav className="bottom-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={page === id ? 'active' : ''} onClick={() => id === 'register' ? setShowRegister(true) : go(id)}><span className="nav-icon"><Icon size={20} strokeWidth={page === id ? 2.5 : 1.8} /></span><span>{label}</span></button>)}</nav>
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
  const [baseMinutes, setBaseMinutes] = useState('')
  const [baseSteps, setBaseSteps] = useState('')
  const [declared, setDeclared] = useState<{ average_active_minutes: number; average_steps: number } | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  useEffect(() => {
    if (!supabase || !user) { setBusy(false); return }
    let cancelled = false
    const load = async () => {
      setBusy(true)
      setError('')
      try {
        const today = moveToday()

        // Keep the registration query explicit: registration is the season users can join.
        const { data: registrationSeason, error: registrationError } = await supabase
          .from('seasons')
          .select('id, name, description, entry_fee, pix_key, start_date, end_date')
          .eq('status', 'registration')
          .order('start_date', { ascending: true })
          .limit(1)
          .maybeSingle()

        if (cancelled) return

        // If there is no registration season, allow the current active season to be
        // displayed for an already enrolled participant. This does not open enrollment.
        let seasonData = registrationSeason
        if (!seasonData && !registrationError) {
          const { data: activeSeason } = await supabase
            .from('seasons')
            .select('id, name, description, entry_fee, pix_key, start_date, end_date')
            .eq('status', 'active')
            .lte('start_date', today)
            .gte('end_date', today)
            .order('start_date', { ascending: false })
            .limit(1)
            .maybeSingle()
          seasonData = activeSeason
        }

        if (registrationError) {
          setError(`Não foi possível carregar a temporada: ${registrationError.message}`)
          setSeason(null)
          setPayment(null)
          setDeclared(null)
          return
        }

        setSeason(seasonData)

        if (!seasonData) {
          setPayment(null)
          setDeclared(null)
          return
        }

        const [{ data: paymentData, error: paymentError }, { data: baselineData, error: baselineError }] = await Promise.all([
          supabase.from('payments')
            .select('id, amount, payment_status, proof_url')
            .eq('user_id', user.id)
            .eq('season_id', seasonData.id)
            .maybeSingle(),
          supabase.from('baseline_metrics')
            .select('average_active_minutes, average_steps')
            .eq('user_id', user.id)
            .eq('season_id', seasonData.id)
            .maybeSingle(),
        ])

        if (cancelled) return
        if (paymentError) setError(`Não foi possível carregar sua inscrição: ${paymentError.message}`)
        if (baselineError) setError(`Não foi possível carregar seu ponto de partida: ${baselineError.message}`)
        setPayment(paymentData)
        setDeclared(baselineData)
      } catch (caught) {
        if (!cancelled) {
          setError(`Não foi possível abrir a temporada: ${caught instanceof Error ? caught.message : 'erro inesperado'}`)
          setSeason(null)
          setPayment(null)
          setDeclared(null)
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [user])
  const fillMissing = async () => {
    if (!supabase) return
    if (baseMinutes.trim() === '') {
  setError('Informe seus minutos de atividade por dia.')
  return
}
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('set_missing_baseline', {
  p_average_active_minutes: Number(baseMinutes),
  p_average_steps: Number(baseSteps || 0),
})
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setDeclared(data as { average_active_minutes: number; average_steps: number }); setMessage('Ponto de partida registrado.') }
  }
  const request = async () => {
    if (!supabase || !season) return
   if (baseMinutes.trim() === '') {
  setError('Informe seus minutos de atividade por dia antes de se inscrever.')
  return
}
    setBusy(true); setError('')
   const { data, error: rpcError } = await supabase.rpc('request_season_participation', {
  p_season_id: season.id,
  p_average_active_minutes: Number(baseMinutes),
  p_average_steps: Number(baseSteps || 0),
}); setBusy(false); if (rpcError) setError(rpcError.message); else { setPayment(data); setMessage('Inscrição criada. Faça o PIX e confirme o envio do pagamento.') } }
  const confirmPix = async () => { if (!supabase || !payment) return; setBusy(true); setError(''); const { data, error: updateError } = await supabase.from('payments').update({ payment_status: 'submitted' }).eq('id', payment.id).select('id, amount, payment_status, proof_url').single(); setBusy(false); if (updateError) setError(updateError.message); else { setPayment(data); setMessage('Pagamento enviado. Aguardando aprovação.') } }
  const copyPixKey = async () => { if (!season.pix_key) return; try { await navigator.clipboard.writeText(season.pix_key); setMessage('Chave PIX copiada.') } catch { setError('Não foi possível copiar a chave PIX.') } }
  const uploadProof = async () => { const file = proofFile; if (!supabase || !payment || !user || !file) { setError('Escolha o arquivo do comprovante antes de enviar.'); return } setError(''); const allowed = ['image/jpeg', 'image/png', 'application/pdf']; if (!allowed.includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Envie somente JPG, JPEG, PNG ou PDF de até 5 MB.'); return }; setBusy(true); const path = `${user.id}/${payment.id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`; const upload = await supabase.storage.from('payment-proofs').upload(path, file, { upsert: false, contentType: file.type }); if (upload.error) { setBusy(false); setError(upload.error.message); return }; const { data, error: submitError } = await supabase.rpc('submit_payment_proof', { p_payment_id: payment.id, p_storage_path: path }); setBusy(false); if (submitError) setError(submitError.message); else { setProofFile(null); setPayment(data); setMessage('Comprovante enviado. A confirmação depende da revisão administrativa.') } }
  const statusLabel = payment?.payment_status === 'submitted' ? 'aguardando confirmação' : payment?.payment_status === 'confirmed' ? 'aprovado' : payment?.payment_status === 'rejected' ? 'rejeitado' : 'pagamento pendente'
  return <><PageTitle eyebrow="INSCRIÇÃO" title="Entre para a temporada." detail="Sua participação só fica ativa após a confirmação manual do PIX." />{busy && !season ? <div className="form-panel"><p>Carregando temporada disponível...</p></div> : !season ? <div className="score-info"><CircleHelp size={18} /><div><strong>Nenhuma temporada disponível no momento.</strong><p>Assim que uma temporada estiver em período de inscrição, ela aparecerá aqui.</p></div></div> : <div className="form-panel enrollment-panel"><span className="eyebrow">INSCRIÇÃO</span><h2>{season.name}</h2><p>{season.description ?? 'Consistência que transforma.'}</p><div className="enrollment-details"><span>Período <strong>{new Date(season.start_date).toLocaleDateString('pt-BR')} a {new Date(season.end_date).toLocaleDateString('pt-BR')}</strong></span><span>Taxa <strong>R$ {Number(season.entry_fee).toFixed(2).replace('.', ',')}</strong></span></div>{!payment ? <><div className="baseline-fields"><span className="eyebrow">SEU PONTO DE PARTIDA</span><p className="submit-hint">A evolução compara sua rotina atual com seu próprio ponto de partida. Informe quantos minutos de atividade você costuma fazer por dia. Esse dado fica congelado após a inscrição.</p><div className="form-row"><label>Minutos de atividade por dia<input type="number" min={0} max={480} placeholder="ex.: 20" value={baseMinutes} onChange={event => { setBaseMinutes(event.target.value); setError('') }} /></label><label>Passos diários<input type="number" min={0} max={100000} placeholder="ex.: 4500" value={baseSteps} onChange={event => { setBaseSteps(event.target.value); setError('') }} /></label></div></div><button className="primary-button full" disabled={busy} onClick={request}>{busy ? 'Criando inscrição...' : 'Participar da temporada'} <ArrowUpRight size={16} /></button></> : <><div className="pix-instructions"><strong>Pagamento PIX</strong><p>Envie R$ {Number(payment.amount).toFixed(2).replace('.', ',')} para a chave:</p><div className="pix-key-row"><strong>{season.pix_key ?? 'Chave PIX ainda não configurada'}</strong>{season.pix_key && <button className="icon-button" aria-label="Copiar chave PIX" title="Copiar chave PIX" onClick={copyPixKey}><Copy size={16} /></button>}</div><span>Status: {statusLabel}</span>{!declared && <div className="baseline-fields"><span className="eyebrow">FALTA SEU PONTO DE PARTIDA</span><p className="submit-hint">Sua inscrição foi criada antes deste campo existir. Informe quantos minutos de atividade você costuma fazer por dia para registrar seu ponto de partida.</p><div className="form-row"><label>Minutos de atividade por dia<input type="number" min={0} max={480} placeholder="ex.: 20" value={baseMinutes} onChange={event => { setBaseMinutes(event.target.value); setError('') }} /></label><label>Passos diários<input type="number" min={0} max={100000} placeholder="ex.: 4500" value={baseSteps} onChange={event => { setBaseSteps(event.target.value); setError('') }} /></label></div><button className="primary-button" disabled={busy} onClick={fillMissing}>{busy ? 'Salvando...' : 'Registrar ponto de partida'} <Check size={16} /></button></div>}{declared && <p className="submit-hint">Seu ponto de partida registrado: {declared.average_active_minutes} min/dia. Os passos são registrados separadamente, uma vez por dia. Se o ponto de partida estiver errado, fale com a organização.</p>}{payment?.payment_status === 'rejected' && <p className="submit-hint">Sua inscrição foi recusada. Verifique o valor e a chave, refaça o PIX e anexe o novo comprovante abaixo — a inscrição volta para análise automaticamente.</p>}</div>{payment.payment_status === 'pending' && <button className="primary-button full" disabled={busy} onClick={confirmPix}>{busy ? 'Enviando...' : 'Já fiz o PIX'} <Check size={16} /></button>}{payment.payment_status !== 'confirmed' && <label className="upload-proof">Anexar comprovante<input disabled={busy} type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" onChange={e => { setProofFile(e.target.files?.[0] ?? null); setError('') }} /><span className="submit-hint">{proofFile ? `Selecionado: ${proofFile.name}` : 'JPG, PNG ou PDF de até 5 MB.'}</span><button className="primary-button" disabled={busy || !proofFile} onClick={uploadProof}>{busy ? 'Enviando...' : 'Enviar comprovante'} <ArrowUpRight size={16} /></button></label>}{payment.payment_status === 'submitted' && <div className="form-success">Pagamento enviado. Aguardando aprovação.</div>}</>}{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</div>}</>
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


function ActivityHistoryPage({ userId }: { userId: string }) {
  const [activities, setActivities] = useState<Array<{
    id: string
    activity_type: ActivityType
    started_at: string
    ended_at: string | null
    status: string
    duration_seconds: number | null
    paused_seconds: number | null
    activity_proofs: Array<{ storage_path: string | null }>
  }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true
    const load = async () => {
      if (!supabase) {
        setLoading(false)
        return
      }

      const { data, error: queryError } = await supabase
        .from('activity_sessions')
        .select('id, activity_type, started_at, ended_at, status, duration_seconds, paused_seconds, activity_proofs(storage_path)')
        .eq('user_id', userId)
        .order('started_at', { ascending: false })
        .limit(50)

      if (!mounted) return
      if (queryError) setError('Não foi possível carregar seu histórico.')
      else setActivities((data ?? []) as typeof activities)
      setLoading(false)
    }

    void load()
    return () => { mounted = false }
  }, [userId])

  const statusLabel: Record<string, string> = {
    active: 'Em andamento',
    pending_validation: 'Aguardando validação',
    validated: 'Validada',
    completed: 'Concluída',
    rejected: 'Rejeitada',
    cancelled: 'Cancelada',
  }

  return (
    <>
      <section className="page-head">
        <span className="eyebrow">SEU HISTÓRICO</span>
        <h1>Minhas atividades</h1>
        <p>Veja seus treinos registrados, o status da validação e os comprovantes enviados.</p>
      </section>

      {error && <div className="form-error">{error}</div>}

      <section className="admin-review">
        <SectionHeading title="Atividades recentes" />
        <div className="admin-review-list">
          {loading ? <p className="admin-empty">Carregando histórico...</p>
            : activities.length === 0 ? <p className="admin-empty">Nenhuma atividade registrada ainda.</p>
            : activities.map(activity => {
              const proof = activity.activity_proofs?.find(item => item.storage_path)
              return (
                <div className="admin-review-row" key={activity.id}>
                  <div>
                    <strong>{activity.activity_type}</strong>
                    <span>
                      {new Date(activity.started_at).toLocaleString('pt-BR')}
                      {activity.duration_seconds !== null ? ` · ${formatDuration(activity.duration_seconds)}` : ''}
                    </span>
                    <small>{statusLabel[activity.status] ?? activity.status}</small>
                  </div>
                  {proof?.storage_path && (
                    <ProofLink bucket="activity-proofs" path={proof.storage_path} />
                  )}
                </div>
              )
            })}
        </div>
      </section>
    </>
  )
}

function ProofLink({ bucket, path }: { bucket: string; path: string }) {
  const [url, setUrl] = useState('')
  const open = async () => { if (!supabase) return; const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300); if (!error && data?.signedUrl) { setUrl(data.signedUrl); window.open(data.signedUrl, '_blank', 'noopener,noreferrer') } }
  return <button className="text-button" onClick={open}>{url ? 'Abrir comprovante' : 'Visualizar comprovante'}</button>
}

function AdminWorkspace() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'dashboard' | 'seasons' | 'participants' | 'payments' | 'activities' | 'ranking' | 'baselines' | 'payout' | 'settings'>('dashboard')
  const tabs = [['dashboard', 'Dashboard'], ['seasons', 'Temporadas'], ['participants', 'Participantes'], ['payments', 'Pagamentos PIX'], ['activities', 'Atividades pendentes'], ['ranking', 'Ranking'], ['baselines', 'Ponto de partida'], ['payout', 'Premiação'], ['settings', 'Configurações']] as const
  return <><nav className="admin-tabs">{tabs.map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav>{tab === 'dashboard' && <AdminPage />}{tab === 'seasons' && <AdminSeasons />}{tab === 'participants' && <AdminParticipants />}{tab === 'payments' && <AdminPayments />}{tab === 'activities' && <AdminActivities />}{tab === 'ranking' && user && <RankingPage userId={user.id} />}{tab === 'baselines' && <AdminBaselines />}{tab === 'payout' && <AdminPayout />}{tab === 'settings' && <AdminSettings />}</>
}

function AdminSeasons() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; description: string | null; start_date: string; end_date: string; status: string; entry_fee: number; pix_key: string | null }>>([])
  const [form, setForm] = useState({ id: '', name: '', description: '', start_date: '', end_date: '', status: 'draft', entry_fee: '0', pix_key: '' })
  const [message, setMessage] = useState(''); const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data } = await supabase.from('seasons').select('id, name, description, start_date, end_date, status, entry_fee, pix_key').order('start_date', { ascending: false }); setSeasons((data ?? []) as typeof seasons) }
  useEffect(() => { load() }, [])
  const save = async (event: React.FormEvent) => { event.preventDefault(); if (!supabase) return; setMessage(''); setError(''); const { data: saved, error: saveError } = await supabase.rpc('admin_upsert_season', { p_season_id: form.id || null, p_name: form.name, p_description: form.description || null, p_start_date: form.start_date, p_end_date: form.end_date, p_status: form.status, p_entry_fee: Number(form.entry_fee), p_pix_key: form.pix_key || null }); if (saveError) setError(saveError.message); else { setMessage(`Temporada salva: ${(saved as { name: string; status: string }).name} · ${(saved as { name: string; status: string }).status}.`); setForm({ id: '', name: '', description: '', start_date: '', end_date: '', status: 'draft', entry_fee: '0', pix_key: '' }); load() } }
  return <><PageTitle eyebrow="TEMPORADAS" title="Temporadas" detail="Crie e edite temporadas por operação administrativa server-side." /><form className="form-panel admin-season-form" onSubmit={save}><div className="form-grid"><label>Nome<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Status<select value={form.status} onChange={event => setForm({ ...form, status: event.target.value })}><option>draft</option><option>registration</option><option>active</option><option>finished</option><option>cancelled</option></select></label><label>Início<input required type="date" value={form.start_date} onChange={event => setForm({ ...form, start_date: event.target.value })} /></label><label>Fim<input required type="date" value={form.end_date} onChange={event => setForm({ ...form, end_date: event.target.value })} /></label><label>Valor<input required min="0" step="0.01" type="number" value={form.entry_fee} onChange={event => setForm({ ...form, entry_fee: event.target.value })} /></label><label>Chave PIX<input value={form.pix_key} onChange={event => setForm({ ...form, pix_key: event.target.value })} /></label></div><label>Descrição<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label><button className="primary-button" type="submit">{form.id ? 'Salvar alterações' : 'Criar temporada'} <Check size={16} /></button>{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</form><div className="admin-review-list">{seasons.map(season => <div className="admin-review-row" key={season.id}><div><strong>{season.name}</strong><span>{season.start_date} a {season.end_date} · {season.status} · R$ {Number(season.entry_fee).toFixed(2).replace('.', ',')}</span></div><button className="text-button" onClick={() => setForm({ id: season.id, name: season.name, description: season.description ?? '', start_date: season.start_date, end_date: season.end_date, status: season.status, entry_fee: String(season.entry_fee), pix_key: season.pix_key ?? '' })}>Editar</button></div>)}</div></>
}

function AdminParticipants() {
  const [rows, setRows] = useState<Array<{ id: string; user_id: string; status: string; joined_at: string; season_id: string; profiles: { full_name: string; avatar_emoji: string | null } | null; seasons: { name: string } | null }>>([])
  const [error, setError] = useState('')
  const [payments, setPayments] = useState<Record<string, string>>({})
  const load = async () => {
    if (!supabase) return
    const [participantResult, paymentResult] = await Promise.all([
      supabase.from('season_participants').select('id, user_id, season_id, status, joined_at, profiles!season_participants_user_id_fkey(full_name, avatar_emoji), seasons(name)').order('joined_at', { ascending: false }),
      supabase.from('payments').select('user_id, season_id, payment_status'),
    ])
    if (participantResult.error) { setError(participantResult.error.message); return }
    setError('')
    setPayments(Object.fromEntries(((paymentResult.data ?? []) as Array<{ user_id: string; season_id: string; payment_status: string }>).map(row => [`${row.user_id}:${row.season_id}`, row.payment_status])))
    setRows((participantResult.data ?? []) as unknown as typeof rows)
  }
  useEffect(() => { load() }, [])
  const changeStatus = async (userId: string, status: 'active' | 'blocked' | 'pending') => { if (!supabase) return; const { error: rpcError } = await supabase.rpc('admin_set_profile_status', { p_user_id: userId, p_status: status }); if (rpcError) setError(rpcError.message); else load() }
  return <><PageTitle eyebrow="PARTICIPANTES" title="Participantes" detail="Status de inscrição e pagamento vindos do Supabase." />{error && <div className="form-error">{error}</div>}<div className="admin-review-list">{rows.length === 0 ? <p className="admin-empty">Nenhum participante encontrado.</p> : rows.map(row => <div className="admin-review-row" key={row.id}><div><strong>{row.profiles?.avatar_emoji ?? '·'} {row.profiles?.full_name ?? 'Participante'}</strong><span>{row.seasons?.name ?? 'Temporada'} · inscrição {new Date(row.joined_at).toLocaleDateString('pt-BR')} · pagamento {payments[`${row.user_id}:${row.season_id}`] ?? 'pendente'}</span><small>Status: {row.status}</small></div><div className="review-actions"><button className="text-button" onClick={() => changeStatus(row.user_id, 'active')}>Ativar</button><button className="text-button reject" onClick={() => changeStatus(row.user_id, 'blocked')}>Bloquear</button></div></div>)}</div></>
}

function AdminPayments() {
  const [rows, setRows] = useState<AdminPayment[]>([])
  const [error, setError] = useState('')
  const load = async () => { if (!supabase) return; const { data, error: loadError } = await supabase.from('payments').select('id, amount, payment_status, created_at, proof_url, profiles!payments_user_id_fkey(full_name, email), seasons(name)').in('payment_status', ['pending', 'submitted']).order('created_at', { ascending: true }); if (loadError) setError(loadError.message); else { setError(''); setRows((data ?? []) as unknown as AdminPayment[]) } }
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
      supabase.from('payments').select('id, amount, payment_status, created_at, proof_url, profiles!payments_user_id_fkey(full_name, email), seasons(name)').in('payment_status', ['pending', 'submitted']).order('created_at', { ascending: true }),
      supabase.from('activity_sessions').select('id, activity_type, started_at, ended_at, duration_seconds, status, source, profiles(full_name, avatar_emoji), activity_proofs(proof_type, storage_path, external_reference)').eq('status', 'pending_validation').order('created_at', { ascending: true }),
    ])
    setStats({ seasons: seasons.count ?? 0, participants: participants.count ?? 0, pending: pending.count ?? 0, active: active.count ?? 0 })
    const failure = paymentResult.error ?? activityResult.error
    if (failure) setActionError(failure.message); else setActionError('')
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

type ScoreRow = { user_id: string; consistency_points: number; evolution_points: number; volume_points: number; bonus_points: number; completed_days: number; total_points: number; profiles?: { full_name: string; avatar_emoji?: string | null } | null }

type Nudge = { kind: string | null; tone?: string; text?: string }

type WeekChallenge = { code: string; name: string; description: string; icon: string; points: number; done: boolean; current: number; goal: number; unit: string }
type WeekChallenges = { week_number: number; days_left: number; challenges: WeekChallenge[] }

function WeekChallengesCard() {
  const [data, setData] = useState<WeekChallenges | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.rpc('my_week_challenges').then(({ data: result, error }) => {
      if (!error && result) setData(result as WeekChallenges)
      setLoading(false)
    })
  }, [])

  if (loading) return null
  const list = data?.challenges ?? []
  if (list.length === 0) return null

  const done = list.filter(item => item.done).length
  const available = list.reduce((sum, item) => sum + (item.done ? 0 : item.points), 0)

  return <section className="admin-review">
    <SectionHeading title={`Desafios da semana ${data?.week_number ?? ''}`} />
    <p className="submit-hint challenge-summary">
      {done === list.length
        ? 'Todos concluídos. Semana que vem tem outros.'
        : `${done} de ${list.length} concluídos · ${available} pontos ainda disponíveis`}
      {data && data.days_left > 0 ? ` · faltam ${data.days_left} dia(s)` : ''}
    </p>
    <div className="challenge-list">{list.map(item => {
      const pct = item.goal > 0 ? Math.min(100, Math.round((item.current / item.goal) * 100)) : 0
      return <div className={item.done ? 'challenge-card done' : 'challenge-card'} key={item.code}>
        <span className="challenge-icon">{item.icon}</span>
        <div className="challenge-body">
          <strong>{item.name}</strong>
          <span>{item.description}</span>
          {item.done
            ? <small className="challenge-earned">concluído · +{item.points} pontos</small>
            : <>
                <div className="challenge-progress"><span style={{ width: `${pct}%` }} /></div>
                <small>{item.current.toLocaleString('pt-BR')} de {item.goal.toLocaleString('pt-BR')}{item.unit ? ` ${item.unit}` : ''}</small>
              </>}
        </div>
        <span className={item.done ? 'status-pill status-validated' : 'status-pill'}>+{item.points}</span>
      </div>
    })}</div>
    <p className="submit-hint">Os pontos de desafio somam por fora do teto semanal, como os de duelo.</p>
  </section>
}

function NudgeBanner() {
  const [nudge, setNudge] = useState<Nudge | null>(null)
  useEffect(() => {
    if (!supabase) return
    supabase.rpc('my_nudge').then(({ data, error }) => { if (!error) setNudge(data as Nudge) })
  }, [])
  if (!nudge?.text) return null
  return <div className={`nudge nudge-${nudge.kind} tone-${nudge.tone ?? 'mid'}`}>{nudge.text}</div>
}





function DailyStepsCard({ userId }: { userId: string }) {
  const [goal, setGoal] = useState(8000)
  const [seasonId, setSeasonId] = useState<string | null>(null)
  const [seasonStart, setSeasonStart] = useState<string | null>(null)
  const [seasonEnd, setSeasonEnd] = useState<string | null>(null)
  const [steps, setSteps] = useState('')
  const [savedSteps, setSavedSteps] = useState<number | null>(null)
  const [proof, setProof] = useState<File | null>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'pending' | 'validated' | 'rejected'>('idle')
  const [error, setError] = useState('')

  const loadSeasonAndSteps = async () => {
    if (!supabase) return

    const today = moveToday()

    const { data: seasons, error: seasonError } = await supabase
      .from('seasons')
      .select('id, start_date, end_date, status, rules')
      .in('status', ['registration', 'active'])
      .order('start_date', { ascending: true })

    if (seasonError) {
      setError(seasonError.message)
      return
    }

    const list = (seasons ?? []) as Array<{
      id: string
      start_date: string
      end_date: string
      status: 'registration' | 'active'
      rules: Record<string, unknown> | null
    }>

    const season =
      list.find(item => item.start_date <= today && item.end_date >= today) ??
      list.find(item => item.status === 'registration' && item.start_date > today) ??
      null

    if (!season) {
      setSeasonId(null)
      setSeasonStart(null)
      setSeasonEnd(null)
      setGoal(8000)
      return
    }

    setSeasonId(season.id)
    setSeasonStart(season.start_date)
    setSeasonEnd(season.end_date)

    const configuredGoal = Number(
      season.rules?.daily_steps ?? 8000
    )

    setGoal(
      Number.isFinite(configuredGoal) && configuredGoal > 0
        ? configuredGoal
        : 8000
    )

    if (season.start_date > today) {
      setSavedSteps(null)
      setStatus('idle')
      return
    }

    const { data, error: stepsError } = await supabase
      .from('daily_steps')
      .select('steps, status')
      .eq('user_id', userId)
      .eq('season_id', season.id)
      .eq('step_date', today)
      .maybeSingle()

    if (stepsError) {
      setError(stepsError.message)
      return
    }

    if (!data) {
      setSavedSteps(null)
      setStatus('idle')
      return
    }

    setSavedSteps(Number(data.steps))

    if (data.status === 'validated') {
      setStatus('validated')
    } else if (data.status === 'rejected') {
      setStatus('rejected')
    } else {
      setStatus('pending')
    }
  }

  useEffect(() => {
    loadSeasonAndSteps()
  }, [userId])

  const current = savedSteps ?? (steps ? Number(steps) : 0)

  const progress = Math.min(
    100,
    Math.round((current / goal) * 100)
  )

  const remaining = Math.max(0, goal - current)

  const submit = async () => {
    if (!supabase) {
      setError('Supabase não configurado.')
      return
    }

    if (!seasonId || !seasonStart || !seasonEnd) {
      setError('Nenhuma temporada disponível.')
      return
    }

    const today = moveToday()

    if (seasonStart > today) {
      setError(
        `A temporada começa em ${new Date(`${seasonStart}T12:00:00`).toLocaleDateString('pt-BR')}.`
      )
      return
    }

    if (seasonEnd < today) {
      setError('Esta temporada já foi encerrada.')
      return
    }

    const value = Number(steps)

    if (!Number.isInteger(value) || value < 0 || value > 100000) {
      setError('Informe uma quantidade válida de passos.')
      return
    }

    if (!proof) {
      setError('Anexe um comprovante dos seus passos.')
      return
    }

    if (proof.size > 5 * 1024 * 1024) {
      setError('O comprovante deve ter no máximo 5 MB.')
      return
    }

    setStatus('uploading')
    setError('')

    const extension =
      proof.name.split('.').pop()?.toLowerCase() || 'jpg'

    const storagePath =
      `${userId}/steps-${Date.now()}.${extension}`

    const { error: uploadError } = await supabase.storage
      .from('activity-proofs')
      .upload(storagePath, proof, {
        upsert: false,
        contentType: proof.type || undefined,
      })

    if (uploadError) {
      setStatus('idle')
      setError(uploadError.message)
      return
    }

    const { data, error: rpcError } = await supabase.rpc(
      'submit_daily_steps',
      {
        p_step_date: today,
        p_steps: value,
        p_storage_path: storagePath,
      }
    )

    if (rpcError) {
      setStatus('idle')
      setError(rpcError.message)
      return
    }

    setSavedSteps(
      Number(data?.steps ?? value)
    )

    setSteps('')
    setProof(null)
    setStatus('pending')
  }

  if (!seasonId) {
    return (
      <section className="daily-steps-card">
        <div className="daily-steps-head">
          <div>
            <span className="eyebrow">PASSOS DO DIA</span>
            <h2>—</h2>
            <p>Nenhuma temporada disponível.</p>
          </div>
          <div className="daily-steps-icon">
            <Footprints size={28} />
          </div>
        </div>
      </section>
    )
  }

  const today = moveToday()
  const beforeSeason = Boolean(seasonStart && seasonStart > today)

  return (
    <section className="daily-steps-card">
      <div className="daily-steps-head">
        <div>
          <span className="eyebrow">PASSOS DO DIA</span>

          <h2>
            {(savedSteps ?? 0).toLocaleString('pt-BR')}
          </h2>

          <p>
            Meta da temporada:{' '}
            <strong>
              {goal.toLocaleString('pt-BR')} passos
            </strong>
          </p>
        </div>

        <div className="daily-steps-icon">
          <Footprints size={28} />
        </div>
      </div>

      <div className="daily-steps-progress">
        <div
          className="daily-steps-progress-fill"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="daily-steps-meta">
        <span>{progress}% da meta</span>
        <strong>
          {remaining.toLocaleString('pt-BR')} restantes
        </strong>
      </div>

      {beforeSeason && (
        <div className="steps-status pending">
          A temporada começa em{' '}
          {new Date(`${seasonStart}T12:00:00`).toLocaleDateString('pt-BR')}.
          <br />
          O lançamento dos passos estará disponível a partir do início.
        </div>
      )}

      {!beforeSeason && status === 'validated' && (
        <div className="steps-status success">
          ✓ Passos validados
          {savedSteps !== null && savedSteps >= goal
            ? ' · +10 pts de consistência'
            : ''}
        </div>
      )}

      {!beforeSeason && status === 'pending' && (
        <div className="steps-status pending">
          ⏳ Comprovante enviado. Aguardando validação.
        </div>
      )}

      {!beforeSeason && status === 'rejected' && (
        <div className="steps-status rejected">
          Comprovante recusado. Envie novamente.
        </div>
      )}

      {!beforeSeason &&
        (status === 'idle' || status === 'rejected') && (
          <div className="daily-steps-form">

            <label>
              Quantos passos você fez hoje?
              <input
                type="number"
                min="0"
                max="100000"
                step="1"
                inputMode="numeric"
                value={steps}
                onChange={event => {
                  setSteps(event.target.value)
                  setError('')
                }}
                placeholder={`Ex.: ${goal.toLocaleString('pt-BR')}`}
              />
            </label>

            <label>
              Comprovante dos passos
              <input
                type="file"
                accept="image/*,.pdf"
                onChange={event => {
                  setProof(event.target.files?.[0] ?? null)
                  setError('')
                }}
              />
            </label>

            {proof && (
              <p className="form-note">
                Arquivo: {proof.name}
              </p>
            )}

            {error && (
              <div className="form-error">
                {error}
              </div>
            )}

            <button
              className="primary-button"
              disabled={
                status === 'uploading' ||
                !steps ||
                !proof
              }
              onClick={submit}
            >
              {status === 'uploading'
                ? 'Enviando...'
                : 'Registrar meus passos'}
            </button>

            <p className="form-note">
              Ao atingir {goal.toLocaleString('pt-BR')} passos,
              você completa o dia de consistência após a validação.
            </p>
          </div>
        )}

      {error && status !== 'idle' && (
        <div className="form-error">
          {error}
        </div>
      )}

      {status === 'pending' && (
        <p className="form-note">
          Os passos entram na pontuação somente depois da validação.
        </p>
      )}
    </section>
  )
}


function HomePage({ userId, season, onNavigate, onRegister, done }: { userId: string; season: CurrentSeason | null; onNavigate: (page: Page) => void; onRegister: () => void; done: boolean }) {
  const [score, setScore] = useState({ points: 0, consistency: 0, evolution: 0, volume: 0, position: 0, total: 0, completedDays: 0 })
  const [seasonName, setSeasonName] = useState('')
  useEffect(() => { if (!supabase) return; const load = async () => { const { data: seasons } = await supabase.from('seasons').select('id, name, start_date, end_date, status').in('status', ['registration', 'active']).order('start_date', { ascending: false }); const today = moveToday(); const season = (seasons ?? []).find(item => item.start_date <= today && item.end_date >= today) as { id: string; name: string } | undefined; const displaySeason = season ?? (seasons ?? []).find(item => item.status === 'registration' && item.start_date > today) as { id: string; name: string } | undefined; setSeasonName(displaySeason?.name ?? ''); if (!season) return; const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points').eq('season_id', season.id); const rows = (data ?? []) as ScoreRow[]; const totals = new Map<string, ScoreRow>(); rows.forEach(row => { const existing = totals.get(row.user_id) ?? { ...row, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0 }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); const ordered = [...totals.values()].sort((a, b) => b.total_points - a.total_points); const mine = totals.get(userId); setScore({ points: mine?.total_points ?? 0, consistency: mine?.consistency_points ?? 0, evolution: mine?.evolution_points ?? 0, volume: mine?.volume_points ?? 0, position: mine ? ordered.findIndex(row => row.user_id === userId) + 1 : 0, total: ordered.length, completedDays: mine?.completed_days ?? 0 }) }; load() }, [userId])
  const progress = done ? 100 : 0
  return <>
    <NudgeBanner />
    <section className="hero"><div className="hero-copy"><span className="eyebrow">{new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' }).toUpperCase()}{seasonName ? ` · ${seasonName}` : ''}</span><h1>Consistência que<br /><em>transforma.</em></h1><p>Você não compete contra o corpo do outro.<br />Compete contra sua versão de ontem.</p></div><div className="hero-orbit"><div className="orbit-ring" /><div className="hero-emoji">🪩</div><span className="orbit-star star-one">✦</span><span className="orbit-star star-two">✧</span></div></section>
    <section className="stats-grid"><Stat icon={<Trophy />} label="posição" value={score.position ? `#${score.position}` : '-'} accent="violet" /><Stat icon={<Zap />} label="pontos" value={score.points.toLocaleString('pt-BR')} accent="cyan" /><Stat icon={<Flame />} label="dias concluídos" value={String(score.completedDays)} accent="orange" /></section>
    <section className={`today-card ${progress === 100 ? 'completed' : ''}`}><div className="today-top"><div><span className="eyebrow">META DE HOJE</span><h2>{progress === 100 ? 'Atividade registrada!' : 'Seu próximo movimento'}</h2></div><div className="progress-ring"><span>{progress}<small>%</small></span></div></div><div className="progress-line"><span style={{ width: `${progress}%` }} /></div><div className="today-bottom"><span><Footprints size={16} /> {progress === 100 ? '30 min registrados' : '30 min ou 8.000 passos'}</span><button className="primary-button compact" onClick={onRegister}>{progress === 100 ? 'Registrar mais' : 'Registrar atividade'} <ArrowUpRight size={16} /></button></div></section>
    <DailyStepsCard season={season} userId={userId} />
    <SectionHeading title="Arena da semana" action="Ver regras" onClick={() => onNavigate('rules')} /><section className="arena-grid"><MiniChallenge icon={<Target />} tag="PONTUAÇÃO OFICIAL" title="Consistência primeiro" progress={`${score.consistency} pts de consistência`} color="purple" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Zap />} tag="EVOLUÇÃO" title="Contra seu baseline" progress={`${score.evolution} pts de evolução`} color="yellow" onClick={() => onNavigate('rules')} /><MiniChallenge icon={<Gauge />} tag="VOLUME" title="Intensidade validada" progress={`${score.volume} pts de volume`} color="blue" onClick={() => onNavigate('rules')} /></section>
    <DailyStepsCard userId={userId} />
    <WeekChallengesCard />
    <SectionHeading title="Seu movimento" action="Ver ranking" onClick={() => onNavigate('ranking')} /><section className="feed-card"><div className="score-info"><Activity size={18} /><div><strong>Dados oficiais do Supabase</strong><p>{score.total ? `${score.total} participantes pontuando nesta temporada.` : 'Ainda não há pontuação registrada nesta temporada.'}</p></div></div><button className="feed-link" onClick={() => onNavigate('ranking')}>Ver ranking geral <ArrowUpRight size={15} /></button></section>
  </>
}
function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent: string }) { return <div className="stat-card"><span className={`stat-icon ${accent}`}>{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong></div> }
function MiniChallenge({ icon, tag, title, progress, color, onClick }: { icon: React.ReactNode; tag: string; title: string; progress: string; color: string; onClick: () => void }) { return <button className={`mini-challenge ${color}`} onClick={onClick}><div className="challenge-icon">{icon}</div><span className="eyebrow">{tag}</span><h3>{title}</h3><p>{progress}</p><ChevronRight className="card-arrow" size={18} /></button> }

function RankingPage({ userId }: { userId: string }) { const [rows, setRows] = useState<ScoreRow[]>([]); const [loading, setLoading] = useState(true); useEffect(() => { if (!supabase) { setLoading(false); return }; const load = async () => { const { data: season } = await supabase.from('seasons').select('id, name, start_date').eq('status', 'active').order('start_date', { ascending: false }).limit(1).maybeSingle(); if (!season) { setLoading(false); return }; const { data } = await supabase.from('weekly_scores').select('user_id, consistency_points, evolution_points, volume_points, bonus_points, completed_days, total_points, profiles(full_name, avatar_emoji)').eq('season_id', season.id); const totals = new Map<string, ScoreRow>(); (data ?? []).forEach(item => { const row = item as unknown as ScoreRow; const existing = totals.get(row.user_id) ?? { user_id: row.user_id, consistency_points: 0, evolution_points: 0, volume_points: 0, bonus_points: 0, completed_days: 0, total_points: 0, profiles: row.profiles }; existing.consistency_points += Number(row.consistency_points); existing.evolution_points += Number(row.evolution_points); existing.volume_points += Number(row.volume_points); existing.bonus_points += Number(row.bonus_points); existing.completed_days += Number(row.completed_days); existing.total_points += Number(row.total_points); totals.set(row.user_id, existing) }); setRows([...totals.values()].sort((a, b) => b.total_points - a.total_points)); setLoading(false) }; load() }, []); const position = rows.findIndex(row => row.user_id === userId) + 1; return <><PageTitle eyebrow="PLACAR DA TEMPORADA" title="Quem está se movendo?" detail="Pontuação oficial calculada e validada pelo Supabase." /><div className="your-position"><div><span className="eyebrow">SUA POSIÇÃO</span><h2>{position ? `#${position}` : '-'} <small>de {rows.length} pessoas</small></h2></div><div className="gap-copy"><strong>{rows[position - 2] ? `${(rows[position - 2].total_points - (rows[position - 1]?.total_points ?? 0)).toLocaleString('pt-BR')} pts` : 'No topo'}</strong><span>{rows[position - 2] ? 'para alcançar a posição acima' : 'continue consistente'}</span></div></div><SectionHeading title="Ranking geral" action="Pontuação total" /><div className="leaderboard">{loading ? <p className="admin-empty">Carregando ranking...</p> : rows.map((person, index) => <div className={`rank-row ${person.user_id === userId ? 'current-user' : ''}`} key={person.user_id}><span className="rank-number">{index + 1}</span><span className="rank-avatar">{person.profiles?.avatar_emoji || '✦'}</span><div className="rank-person"><strong>{person.profiles?.full_name ?? 'Participante'}</strong><span><Flame size={13} /> {person.completed_days} dias <i /> {person.consistency_points} pts consistência</span></div><strong className="rank-points">{person.total_points.toLocaleString('pt-BR')} <small>pts</small></strong></div>)}</div><SeasonResults /><div className="score-info"><CircleHelp size={18} /><div><strong>Como funciona o placar?</strong><p>Consistência, evolução e volume vêm de atividades validadas no servidor. Peso, IMC, gordura corporal, medidas e aparência não participam do ranking. Na premiação as categorias acumulam: quem vence mais de uma recebe todas.</p></div><ChevronRight size={17} /></div></> }

function RegisterPage({ season, activeSession, completedSession, onStarted, onCompleted, onCancelled, onDone }: { season: CurrentSeason | null; onCancelled: () => void; activeSession: ActivitySession | null; completedSession: ActivitySession | null; onStarted: (session: ActivitySession) => void; onCompleted: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <><PageTitle eyebrow="CHECK-IN MOVE" title={activeSession ? 'Atividade em andamento.' : completedSession ? 'Atividade concluída.' : 'Qual foi o movimento?'} detail={activeSession ? 'O tempo continua sendo contado pelo horário real do servidor.' : completedSession ? 'Revise os dados antes de enviar para validação.' : 'Comece uma sessão para registrar seu movimento.'} /><ActivitySessionForm season={season} activeSession={activeSession} completedSession={completedSession} onStarted={onStarted} onCompleted={onCompleted} onCancelled={onCancelled} onDone={onDone} /></> }
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
  useEffect(() => { if (!activeSession) return; const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(timer) }, [activeSession])
  useEffect(() => { if (!supabase || !activeSession) return; supabase.from('activity_pauses').select('pause_started_at').eq('activity_session_id', activeSession.id).is('pause_ended_at', null).maybeSingle().then(({ data }) => { setPaused(Boolean(data)); setPauseStartedAt(data?.pause_started_at ?? null) }) }, [activeSession])
  const elapsed = activeSession ? Math.max(0, Math.floor((now - Date.parse(activeSession.started_at)) / 1000) - (activeSession.paused_seconds ?? 0) - (paused && pauseStartedAt ? Math.floor((now - Date.parse(pauseStartedAt)) / 1000) : 0)) : completedSession?.duration_seconds ?? 0
  const reachedGoal = elapsed >= 30 * 60
  const start = async () => {
    if (!supabase) { setError('Configure o Supabase para iniciar uma sessão real.'); return }
    const today = moveToday()
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
    else { setPaused(false); setPauseStartedAt(null); setProofFile(null); setProofPreview(''); onCancelled() }
  }
  const selectProof = (file: File) => {
    if (!['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(file.type) || file.size > 5 * 1024 * 1024) { setError('Envie uma imagem ou PDF de até 5 MB.'); return }
    setProofFile(file); setProofPreview(file.type.startsWith('image/') ? URL.createObjectURL(file) : ''); setError('')
  }
  const submit = async () => {
    if (!supabase || !user || !completedSession || !proofFile) { setError('Anexe um comprovante antes de enviar para validação.'); return }
    setBusy(true); setError('')
    const path = `${user.id}/${completedSession.id}-${crypto.randomUUID()}-${proofFile.name.replace(/[^a-zA-Z0-9._-]/g, '-')}`
    const upload = await supabase.storage.from('activity-proofs').upload(path, proofFile, { upsert: false, contentType: proofFile.type })
    if (upload.error) { setBusy(false); setError(upload.error.message); return }
    const { data, error: rpcError } = await supabase.rpc('submit_activity_session_with_proof', { p_session_id: completedSession.id, p_storage_path: path, p_steps: null })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setProofFile(null); setProofPreview(''); onDone(data as ActivitySession) }
  }
  if (completedSession) return <div className="form-panel activity-session-panel completed-session"><div className="session-heading"><span className="eyebrow">🔥 ATIVIDADE CONCLUÍDA</span></div><h2>{completedSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">Início: {new Date(completedSession.started_at).toLocaleString('pt-BR')}<br />Término: {completedSession.ended_at ? new Date(completedSession.ended_at).toLocaleString('pt-BR') : '-'}</p>{reachedGoal ? <div className="goal-hit"><Check size={17} /> Meta diária: 30 min · meta atingida</div> : <div className="session-caption goal-missed">Meta diária: 30 min · ainda não atingida</div>}<p className="submit-hint">Meta diária: 30 minutos de atividade efetiva. Os passos são registrados separadamente, uma vez por dia.</p><label className="upload-proof">Comprovante da atividade<input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={event => event.target.files?.[0] && selectProof(event.target.files[0])} /></label>{proofPreview && <img className="proof-preview" src={proofPreview} alt="Pré-visualização do comprovante" />}{proofFile?.type === 'application/pdf' && <p className="form-note">PDF selecionado: {proofFile.name}</p>}<div className="review-actions"><button className="primary-button" disabled={busy || !proofFile} onClick={submit}>{busy ? 'Enviando...' : 'Enviar para validação'} <ArrowUpRight size={16} /></button></div>{error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> Depois do envio, horários, duração e comprovante ficam bloqueados.</p></div>
  return <div className={`form-panel activity-session-panel ${activeSession ? 'is-active' : ''}`}>{activeSession ? <><div className="session-heading"><span className="live-dot" /><span className="eyebrow">{paused ? '⏸ ATIVIDADE PAUSADA' : '🔥 ATIVIDADE EM ANDAMENTO'}</span></div><h2>{activeSession.activity_type}</h2><div className="session-clock">{formatDuration(elapsed)}</div><p className="session-caption">{paused ? 'tempo pausado não entra na duração efetiva' : 'tempo realizado · registrado pelo servidor'}</p>{reachedGoal && <div className="goal-hit"><Flame size={17} /> META BATIDA! Você pode continuar.</div>}<div className="session-goal"><div><span className="eyebrow">META DO DIA</span><strong>{Math.min(100, Math.round((elapsed / 1800) * 100))}%</strong></div><div className="progress-line"><span style={{ width: `${Math.min(100, (elapsed / 1800) * 100)}%` }} /></div><small>{formatDuration(Math.min(elapsed, 1800))} de 00:30:00</small></div><div className="review-actions"><button className="text-button" disabled={busy} onClick={togglePause}>{paused ? 'Continuar' : 'Pausar'}</button><button className="primary-button finish-button" disabled={busy} onClick={finish}>{busy ? 'Finalizando...' : 'Finalizar'} <Check size={17} /></button></div><button className="text-button discard-button" disabled={busy} onClick={cancel}>Descartar atividade</button></> : <><label>Atividade<select value={type} onChange={e => setType(e.target.value as ActivityType)}>{Object.keys(metValues).map(item => <option key={item}>{item}</option>)}</select></label><div className="estimate"><span className="estimate-icon"><Play size={21} /></span><div><span className="eyebrow">CHECK-IN COM HORÁRIO REAL</span><strong>Pronto para começar</strong><p>O servidor registra o início e calcula a duração no final.</p></div></div><button className="primary-button full" disabled={busy} onClick={start}>{busy ? 'Iniciando...' : 'Iniciar atividade'} <Play size={17} /></button></>} {error && <p className="form-error session-error">{error}</p>}<p className="form-note"><Lock size={13} /> A pontuação só é criada após validação.</p></div>
}

type DuelRow = {
  id: string; season_id: string; week_number: number; challenger_id: string; opponent_id: string
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'finished'
  proposed_at: string; expires_at: string; winner_id: string | null
  challenger_days: number | null; opponent_days: number | null; points_awarded: number
  challenger?: { full_name: string; avatar_emoji: string | null } | null
  opponent?: { full_name: string; avatar_emoji: string | null } | null
}
type DuelSuggestion = { user_id: string; full_name: string; avatar_emoji: string | null; last_week_points: number }

const duelStatusLabel: Record<DuelRow['status'], string> = {
  pending: 'aguardando resposta', accepted: 'em disputa', declined: 'recusado',
  expired: 'expirado', finished: 'encerrado',
}

type DuelBoard = {
  week_number: number; week_start: string; week_end: string; days_left: number
  challenger: { user_id: string; days: number; consistency: number; volume: number; dates: string[] }
  opponent: { user_id: string; days: number; consistency: number; volume: number; dates: string[] }
}

function DuelScoreboard({ duel, userId }: { key?: string; duel: DuelRow; userId: string }) {
  const [board, setBoard] = useState<DuelBoard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!supabase) return
    supabase.rpc('duel_scoreboard', { p_duel_id: duel.id }).then(({ data, error: rpcError }) => {
      if (rpcError) setError(rpcError.message); else setBoard(data as DuelBoard)
    })
  }, [duel.id])

  if (error) return <p className="form-error session-error">{error}</p>
  if (!board) return <p className="admin-empty">Carregando placar...</p>

  const iAmChallenger = duel.challenger_id === userId
  const me = iAmChallenger ? board.challenger : board.opponent
  const rival = iAmChallenger ? board.opponent : board.challenger
  const rivalName = (iAmChallenger ? duel.opponent : duel.challenger)?.full_name ?? 'Adversário'
  const start = new Date(`${board.week_start}T12:00:00`)
  const weekDays = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return date.toISOString().slice(0, 10)
  })
  const label = ['S', 'T', 'Q', 'Q', 'S', 'S']
  const lead = me.days - rival.days

  return <div className="duel-board">
    <div className="duel-score">
      <div><span className="eyebrow">VOCÊ</span><strong>{me.days}</strong></div>
      <span className="duel-versus">×</span>
      <div><span className="eyebrow">{rivalName.split(' ')[0].toUpperCase()}</span><strong>{rival.days}</strong></div>
    </div>
    <p className="duel-lead">{
      lead > 0 ? `Você está ${lead} dia${lead > 1 ? 's' : ''} à frente.`
      : lead < 0 ? `Você está ${-lead} dia${lead < -1 ? 's' : ''} atrás.`
      : 'Empatados por dias — desempate por consistência.'
    } {board.days_left > 0 ? `Faltam ${board.days_left} dia${board.days_left > 1 ? 's' : ''} pontuáveis.` : 'Semana encerrada, aguardando apuração.'}</p>
    <div className="duel-track">
      <span className="duel-track-name">você</span>
      {weekDays.map((date, index) => <i key={date} className={me.dates.includes(date) ? 'done' : ''}>{label[index]}</i>)}
    </div>
    <div className="duel-track">
      <span className="duel-track-name">{rivalName.split(' ')[0].toLowerCase()}</span>
      {weekDays.map((date, index) => <i key={date} className={rival.dates.includes(date) ? 'done' : ''}>{label[index]}</i>)}
    </div>
    <small className="duel-tiebreak">Desempate: consistência {me.consistency} × {rival.consistency} · volume {me.volume} × {rival.volume}</small>
  </div>
}

type GroupRow = { id: string; name: string; owner_id: string; invite_code: string }
type GroupMemberStanding = { user_id: string; full_name: string; avatar_emoji: string | null; points: number; days: number }
type GroupStanding = { season_name: string | null; members: GroupMemberStanding[] }

function GroupsPage({ userId, onAction }: { userId: string; onAction: (message: string) => void }) {
  const [groups, setGroups] = useState<GroupRow[]>([])
  const [standing, setStanding] = useState<Record<string, GroupStanding>>({})
  const [openId, setOpenId] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) { setLoading(false); return }
    const { data, error: loadError } = await supabase
      .from('group_members').select('groups(id, name, owner_id, invite_code)')
    if (loadError) { setError(loadError.message); setLoading(false); return }
    setError('')
    setGroups(((data ?? []) as unknown as Array<{ groups: GroupRow | null }>).map(row => row.groups).filter(Boolean) as GroupRow[])
    setLoading(false)
  }
  useEffect(() => { load() }, [userId])

  const openGroup = async (groupId: string) => {
    if (openId === groupId) { setOpenId(''); return }
    setOpenId(groupId)
    if (!supabase || standing[groupId]) return
    const { data, error: rpcError } = await supabase.rpc('group_standing', { p_group_id: groupId })
    if (rpcError) setError(rpcError.message)
    else setStanding(current => ({ ...current, [groupId]: data as GroupStanding }))
  }

  const create = async () => {
    if (!supabase || name.trim().length < 2) { setError('Dê um nome com pelo menos 2 letras.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('create_group', { p_name: name })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setName(''); onAction(`Grupo criado. Código: ${(data as GroupRow).invite_code}`); load() }
  }

  const join = async () => {
    if (!supabase || code.trim().length < 6) { setError('O código tem 6 caracteres.'); return }
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('join_group', { p_invite_code: code })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setCode(''); onAction(`Você entrou em ${(data as GroupRow).name}.`); load() }
  }

  const leave = async (group: GroupRow) => {
    if (!supabase) return
    if (!window.confirm(`Sair de ${group.name}?`)) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('leave_group', { p_group_id: group.id })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setOpenId(''); onAction(`Você saiu de ${group.name}.`); load() }
  }

  const share = (group: GroupRow) => {
    const text = `Entra no meu grupo "${group.name}" no MOVE 💪\nAcesse move-challenge-tau.vercel.app, vá no menu ☰ → Meus grupos e use o código: ${group.invite_code}`
    if (navigator.share) navigator.share({ text }).catch(() => undefined)
    else navigator.clipboard?.writeText(text).then(() => onAction('Convite copiado.')).catch(() => undefined)
  }

  return <>
    <PageTitle eyebrow="GRUPOS" title="Quem você acompanha." detail="Grupos não mudam a temporada nem a premiação. Servem para acompanhar de perto quem você conhece." />
    {error && <div className="form-error">{error}</div>}

    <div className="form-panel">
      <div className="form-row">
        <label>Criar um grupo<input maxLength={40} placeholder="Equipe trabalho" value={name} onChange={event => { setName(event.target.value); setError('') }} /></label>
        <label>Entrar com código<input maxLength={6} placeholder="A1B2C3" value={code} onChange={event => { setCode(event.target.value.toUpperCase()); setError('') }} /></label>
      </div>
      <div className="review-actions">
        <button className="primary-button compact" disabled={busy} onClick={create}>Criar <Plus size={15} /></button>
        <button className="text-button" disabled={busy} onClick={join}>Entrar no grupo</button>
      </div>
    </div>

    <section className="admin-review">
      <SectionHeading title="Seus grupos" />
      <div className="admin-review-list">{loading ? <p className="admin-empty">Carregando...</p>
        : groups.length === 0 ? <p className="admin-empty">Você ainda não faz parte de nenhum grupo. Crie um e mande o código para quem quiser acompanhar junto.</p>
        : groups.map(group => {
          const open = openId === group.id
          const rows = standing[group.id]?.members ?? []
          return <div key={group.id}>
            <button className="result-head" onClick={() => openGroup(group.id)}>
              <div>
                <strong>{group.name}</strong>
                <span>código {group.invite_code}{group.owner_id === userId ? ' · você criou' : ''}</span>
              </div>
              <ChevronRight size={18} className={open ? 'result-arrow open' : 'result-arrow'} />
            </button>
            {open && <div className="result-body">
              {rows.length === 0 ? <p className="admin-empty">Carregando ranking do grupo...</p>
                : rows.map((person, index) => <div className="result-row" key={person.user_id}>
                    <div>
                      <strong>{index + 1}º {person.avatar_emoji || '🪩'} {person.full_name}</strong>
                      <span>{person.points} pts · {person.days} dias</span>
                    </div>
                    {person.user_id === userId && <span className="status-pill status-validated">você</span>}
                  </div>)}
              <div className="review-actions">
                <button className="text-button" onClick={() => share(group)}>Convidar <Copy size={14} /></button>
                <button className="text-button reject" disabled={busy} onClick={() => leave(group)}>Sair do grupo</button>
              </div>
            </div>}
          </div>
        })}</div>
    </section>

    <div className="score-info"><CircleHelp size={18} /><div><strong>Como o grupo funciona</strong><p>A temporada, o valor e a premiação continuam sendo um só para todo mundo. O grupo é um recorte do ranking: você vê como está indo em relação a quem escolheu acompanhar. Dá para fazer parte de até 5 grupos.</p></div></div>
  </>
}

function DuelsPage({ userId, onAction }: { userId: string; onAction: (message: string) => void }) {
  const [duels, setDuels] = useState<DuelRow[]>([])
  const [suggestions, setSuggestions] = useState<DuelSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) { setLoading(false); return }
    await supabase.rpc('resolve_finished_duels')
    const [duelResult, suggestionResult] = await Promise.all([
      supabase.from('duels').select('id, season_id, week_number, challenger_id, opponent_id, status, proposed_at, expires_at, winner_id, challenger_days, opponent_days, points_awarded, challenger:profiles!duels_challenger_id_fkey(full_name, avatar_emoji), opponent:profiles!duels_opponent_id_fkey(full_name, avatar_emoji)').order('proposed_at', { ascending: false }).limit(30),
      supabase.rpc('suggest_duel_opponents', { p_limit: 5 }),
    ])
    setDuels((duelResult.data ?? []) as unknown as DuelRow[])
    setSuggestions((suggestionResult.data ?? []) as DuelSuggestion[])
    setLoading(false)
  }
  useEffect(() => { load() }, [userId])

  const propose = async (opponentId: string, name: string) => {
    if (!supabase) return
    if (!window.confirm(`Desafiar ${name} nesta semana?`)) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('propose_duel', { p_opponent_id: opponentId })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { onAction(`Duelo proposto para ${name}.`); load() }
  }

  const forfeit = async (duelId: string) => {
    if (!supabase) return
    if (!window.confirm('Desistir deste duelo? O adversário vence na hora e recebe os pontos.')) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('forfeit_duel', { p_duel_id: duelId })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { onAction('Você desistiu do duelo.'); load() }
  }

  const respond = async (duelId: string, accept: boolean) => {
    if (!supabase) return
    setBusy(true); setError('')
    const { error: rpcError } = await supabase.rpc('respond_duel', { p_duel_id: duelId, p_accept: accept })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { onAction(accept ? 'Duelo aceito. Boa semana!' : 'Duelo recusado.'); load() }
  }

  const invitations = duels.filter(d => d.status === 'pending' && d.opponent_id === userId)
  const ongoing = duels.filter(d => d.status === 'accepted' || (d.status === 'pending' && d.challenger_id === userId))
  const history = duels.filter(d => ['finished', 'declined', 'expired'].includes(d.status))

  const describe = (duel: DuelRow) => {
    const isChallenger = duel.challenger_id === userId
    const other = isChallenger ? duel.opponent : duel.challenger
    return { name: other?.full_name ?? 'Participante', emoji: other?.avatar_emoji || '🪩', isChallenger }
  }

  return <>
    <PageTitle eyebrow="DUELOS" title="Desafie alguém." detail="Uma semana, um adversário. Vence quem tiver mais dias concluídos." />
    {error && <div className="form-error">{error}</div>}

    {invitations.length > 0 && <section className="admin-review">
      <SectionHeading title="Convites para você" />
      <div className="admin-review-list">{invitations.map(duel => {
        const info = describe(duel)
        return <div className="admin-review-row" key={duel.id}>
          <div>
            <strong>{info.emoji} {info.name} desafiou você</strong>
            <span>Semana {duel.week_number} · responda até {new Date(duel.expires_at).toLocaleString('pt-BR')}</span>
          </div>
          <div className="review-actions">
            <button className="text-button" disabled={busy} onClick={() => respond(duel.id, true)}>Aceitar</button>
            <button className="text-button reject" disabled={busy} onClick={() => respond(duel.id, false)}>Recusar</button>
          </div>
        </div>
      })}</div>
    </section>}

    <section className="admin-review">
      <SectionHeading title="Em andamento" />
      <div className="admin-review-list">{loading ? <p className="admin-empty">Carregando duelos...</p>
        : ongoing.length === 0 ? <p className="admin-empty">Nenhum duelo ativo nesta semana.</p>
        : ongoing.map(duel => {
            const info = describe(duel)
            return <div className="admin-review-row" key={duel.id}>
              <div>
                <strong>{info.emoji} {info.name}</strong>
                <span>Semana {duel.week_number} · {duelStatusLabel[duel.status]}</span>
                <small>{info.isChallenger ? 'você propôs' : 'você aceitou'}</small>
              </div>
              <div className="review-actions">
                <span className={`status-pill status-${duel.status}`}>{duelStatusLabel[duel.status]}</span>
                {duel.status === 'accepted' && <button className="text-button reject" disabled={busy} onClick={() => forfeit(duel.id)}>Desistir</button>}
              </div>
            </div>
          })}</div>
      {ongoing.filter(duel => duel.status === 'accepted').map(duel =>
        <DuelScoreboard key={`board-${duel.id}`} duel={duel} userId={userId} />)}
    </section>

    <section className="admin-review">
      <SectionHeading title="Quem você pode desafiar" />
      <div className="admin-review-list">{loading ? <p className="admin-empty">Buscando adversários...</p>
        : suggestions.length === 0 ? <p className="admin-empty">Nenhum adversário disponível nesta semana. Duelos só podem ser propostos nos quatro primeiros dias.</p>
        : suggestions.map(person => <div className="admin-review-row" key={person.user_id}>
            <div>
              <strong>{person.avatar_emoji || '🪩'} {person.full_name}</strong>
              <span>{person.last_week_points} pts na semana passada</span>
            </div>
            <div className="review-actions">
              <button className="text-button" disabled={busy} onClick={() => propose(person.user_id, person.full_name)}>Desafiar</button>
            </div>
          </div>)}</div>
    </section>

    {history.length > 0 && <section className="admin-review">
      <SectionHeading title="Histórico" />
      <div className="admin-review-list">{history.map(duel => {
        const info = describe(duel)
        const mine = duel.challenger_id === userId ? duel.challenger_days : duel.opponent_days
        const theirs = duel.challenger_id === userId ? duel.opponent_days : duel.challenger_days
        const outcome = duel.status !== 'finished' ? duelStatusLabel[duel.status]
          : duel.winner_id === null ? 'empate'
          : duel.winner_id === userId ? `vitória · +${duel.points_awarded} pts` : 'derrota'
        return <div className="admin-review-row" key={duel.id}>
          <div>
            <strong>{info.emoji} {info.name}</strong>
            <span>Semana {duel.week_number}{duel.status === 'finished' ? ` · ${mine ?? 0} x ${theirs ?? 0} dias` : ''}</span>
          </div>
          <span className={`status-pill status-${duel.status}`}>{outcome}</span>
        </div>
      })}</div>
    </section>}

    <div className="score-info"><CircleHelp size={18} /><div><strong>Como o duelo é decidido</strong><p>Vence quem concluir mais dias na semana. Empate desempata por consistência e depois por volume. Os pontos do duelo somam por fora do teto semanal, e você pode duelar no máximo duas vezes com a mesma pessoa na temporada.</p></div></div>
  </>
}

type SeasonOption = { id: string; name: string; status: string; rules: Record<string, number> | null }
const ruleLabels: Array<[string, string]> = [
  ['daily_minutes', 'Minutos por dia'], ['daily_steps', 'Passos diários'],
  ['consistency_per_day', 'Pontos por dia'], ['weekly_consistency_cap', 'Teto de consistência'],
  ['bonus_days', 'Dias para bônus'], ['bonus_points', 'Pontos de bônus'],
  ['evolution_cap', 'Teto de evolução'], ['volume_cap', 'Teto de volume'],
  ['met_min_per_point', 'MET-min por ponto'], ['duel_points', 'Pontos por duelo'],
]

type PayoutAward = { type: string; label: string; user_id: string; full_name: string; amount: number }
type PayoutStanding = { position?: number; user_id: string; full_name: string; avatar_emoji: string | null; points: number; days: number; consistency: number; evolution: number; volume: number; consistency_percent: number }
type PayoutResult = {
  season: { id: string; name: string; status: string; weeks: number; max_days: number }
  pool: number; min_consistency_percent: number; accumulation: boolean
  standing: PayoutStanding[]; awards: PayoutAward[]
}

const money = (value: number) => `R$ ${Number(value).toFixed(2).replace('.', ',')}`

type PublishedResult = { season_id: string; published_at: string; payload: PayoutResult }

function SeasonResults() {
  const [results, setResults] = useState<PublishedResult[]>([])
  const [openId, setOpenId] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.from('season_results').select('season_id, published_at, payload').order('published_at', { ascending: false })
      .then(({ data }) => { setResults((data ?? []) as unknown as PublishedResult[]); setLoading(false) })
  }, [])

  if (loading || results.length === 0) return null

  return <section className="admin-review">
    <SectionHeading title="Temporadas encerradas" />
    <div className="admin-review-list">{results.map(result => {
      const open = openId === result.season_id
      const awards = result.payload.awards ?? []
      const byPerson = new Map<string, { name: string; total: number; items: PayoutAward[] }>()
      awards.forEach(award => {
        const entry = byPerson.get(award.user_id) ?? { name: award.full_name, total: 0, items: [] }
        entry.total += Number(award.amount); entry.items.push(award); byPerson.set(award.user_id, entry)
      })
      return <div key={result.season_id}>
        <button className="result-head" onClick={() => setOpenId(open ? '' : result.season_id)}>
          <div>
            <strong>{result.payload.season.name}</strong>
            <span>{money(result.payload.pool)} arrecadados · publicado em {new Date(result.published_at).toLocaleDateString('pt-BR')}</span>
          </div>
          <ChevronRight size={18} className={open ? 'result-arrow open' : 'result-arrow'} />
        </button>
        {open && <div className="result-body">
          <div className="result-block">
            <span className="eyebrow">PREMIAÇÃO</span>
            {byPerson.size === 0 ? <p className="admin-empty">Nenhum prêmio distribuído.</p>
              : [...byPerson.entries()].sort((a, b) => b[1].total - a[1].total).map(([userId, entry]) =>
                <div className="result-row" key={userId}>
                  <div><strong>{entry.name}</strong><span>{entry.items.map(item => item.label).join(' + ')}</span></div>
                  <span className="status-pill status-validated">{money(entry.total)}</span>
                </div>)}
          </div>
          <div className="result-block">
            <span className="eyebrow">CLASSIFICAÇÃO</span>
            {(result.payload.standing ?? []).map(person =>
              <div className="result-row" key={person.user_id}>
                <div>
                  <strong>{person.position}º {person.avatar_emoji || '🪩'} {person.full_name}</strong>
                  <span>{person.points} pts · {person.days} dias ({person.consistency_percent}%)</span>
                </div>
              </div>)}
          </div>
          <small className="result-note">Categorias acumulam: quem venceu mais de uma recebeu todas. Rateio de consistência a partir de {result.payload.min_consistency_percent}% dos dias.</small>
        </div>}
      </div>
    })}</div>
  </section>
}

type BaselineInfo = {
  season: { id: string; name: string; status: string; start_date: string } | null
  baseline: { average_active_minutes: number; average_steps: number; frozen_at: string | null } | null
}

function BaselineCard() {
  const [info, setInfo] = useState<BaselineInfo | null>(null)
  const [minutes, setMinutes] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) return
    const { data, error: rpcError } = await supabase.rpc('my_baseline')
    if (rpcError) { setError(rpcError.message); return }
    const result = data as BaselineInfo
    setInfo(result)
    if (result.baseline) {
      setMinutes(String(result.baseline.average_active_minutes))
      setSteps(String(result.baseline.average_steps))
    }
  }
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!supabase) return
    setBusy(true); setError(''); setMessage('')
    const { error: rpcError } = await supabase.rpc('upsert_baseline', {
      p_average_active_minutes: Number(minutes || 0),
      p_average_steps: Number(steps || 0),
    })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setMessage('Ponto de partida salvo.'); load() }
  }

  if (!info?.season) return null
  const frozen = Boolean(info.baseline?.frozen_at)

  return <section className="admin-review">
    <SectionHeading title="Seu ponto de partida" />
    <div className="form-panel">
      <p className="submit-hint">A evolução compara você com você mesmo. Informe como estava sua rotina nas duas semanas anteriores a {new Date(`${info.season.start_date}T12:00:00`).toLocaleDateString('pt-BR')}. Nada aqui envolve peso, medidas ou aparência.</p>
      <div className="baseline-readout">
        <div><span className="eyebrow">MINUTOS POR DIA</span><strong>{info.baseline ? info.baseline.average_active_minutes : '—'}</strong></div>
        <div><span className="eyebrow">PASSOS POR DIA</span><strong>{info.baseline ? Number(info.baseline.average_steps).toLocaleString('pt-BR') : '—'}</strong></div>
      </div>
      <p className="form-note"><Lock size={13} /> {frozen ? `Congelado em ${new Date(info.baseline!.frozen_at!).toLocaleDateString('pt-BR')}.` : 'Informado na inscrição.'} Este número não pode ser alterado — fale com a organização se estiver errado.</p>
      {error && <div className="form-error">{error}</div>}
    </div>
  </section>
}

type AdminBaselineRow = { id: string; user_id: string; average_active_minutes: number; average_steps: number; frozen_at: string | null; profiles: { full_name: string } | null }

function AdminBaselines() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [seasonId, setSeasonId] = useState('')
  const [rows, setRows] = useState<AdminBaselineRow[]>([])
  const [participants, setParticipants] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.from('seasons').select('id, name, status').order('start_date', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Array<{ id: string; name: string; status: string }>
        setSeasons(list)
        if (list.length && !seasonId) setSeasonId(list[0].id)
      })
  }, [])

  const load = async () => {
    if (!supabase || !seasonId) return
    const [baselineResult, countResult] = await Promise.all([
      supabase.from('baseline_metrics').select('id, user_id, average_active_minutes, average_steps, frozen_at, profiles!baseline_metrics_user_id_fkey(full_name)').eq('season_id', seasonId),
      supabase.from('season_participants').select('id', { count: 'exact', head: true }).eq('season_id', seasonId).eq('status', 'active'),
    ])
    if (baselineResult.error) { setError(baselineResult.error.message); return }
    setError('')
    const { data: missingData } = await supabase.rpc('admin_missing_baselines', { p_season_id: seasonId })
    setMissing((missingData ?? []) as Array<{ user_id: string; full_name: string; payment_status: string }>)
    setRows((baselineResult.data ?? []) as unknown as AdminBaselineRow[])
    setParticipants(countResult.count ?? 0)
  }
  useEffect(() => { load() }, [seasonId])

  const [missing, setMissing] = useState<Array<{ user_id: string; full_name: string; payment_status: string }>>([])
  const [draft, setDraft] = useState<Record<string, { minutes: string; steps: string }>>({})

  const saveFor = async (targetId: string, override?: { minutes: string; steps: string }) => {
    if (!supabase || !seasonId) return
    const entry = override ?? draft[targetId] ?? { minutes: '', steps: '' }
    if (entry.minutes.trim() === '' || entry.steps.trim() === '') { setError('Preencha minutos e passos.'); return }
    setBusy(true); setError(''); setMessage('')
    const { error: rpcError } = await supabase.rpc('admin_set_baseline', { p_season_id: seasonId, p_user_id: targetId, p_average_active_minutes: Number(entry.minutes), p_average_steps: Number(entry.steps) })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setMessage('Ponto de partida salvo.'); setDraft(current => ({ ...current, [targetId]: { minutes: '', steps: '' } })); load() }
  }

  const freeze = async () => {
    if (!supabase || !seasonId) return
    if (!window.confirm('Congelar os pontos de partida desta temporada? Depois disso ninguém pode mais alterar o próprio número.')) return
    setBusy(true); setError(''); setMessage('')
    const { data, error: rpcError } = await supabase.rpc('admin_freeze_baselines', { p_season_id: seasonId })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setMessage(`${data} ponto(s) de partida congelado(s).`); load() }
  }

  const pending = participants - rows.length

  return <>
    <PageTitle eyebrow="PONTO DE PARTIDA" title="Baseline da temporada." detail="A evolução de cada pessoa é medida contra o próprio número. Confira antes de congelar." />
    {message && <div className="form-success">{message}</div>}
    {error && <div className="form-error">{error}</div>}

    <div className="form-panel">
      <label>Temporada<select value={seasonId} onChange={event => setSeasonId(event.target.value)}>
        {seasons.map(season => <option key={season.id} value={season.id}>{season.name} · {season.status}</option>)}
      </select></label>
      <p className="submit-hint">{rows.length} de {participants} participantes ativos preencheram.{pending > 0 ? ` Faltam ${pending}. Quem não preencher fica com evolução zero.` : ' Todos preencheram.'}</p>
      <button className="primary-button" disabled={busy || rows.length === 0} onClick={freeze}>{busy ? 'Congelando...' : 'Congelar pontos de partida'} <Lock size={16} /></button>
    </div>

    {missing.length > 0 && <section className="admin-review">
      <SectionHeading title="Sem ponto de partida" />
      <div className="admin-review-list">{missing.map(person => <div className="admin-review-row" key={person.user_id}>
        <div>
          <strong>{person.full_name}</strong>
          <span>pagamento: {person.payment_status} · o PIX não pode ser aprovado sem este preenchimento</span>
          <div className="form-row">
            <label>Minutos/dia<input type="number" min={0} max={480} value={draft[person.user_id]?.minutes ?? ''} onChange={event => setDraft(current => ({ ...current, [person.user_id]: { minutes: event.target.value, steps: current[person.user_id]?.steps ?? '' } }))} /></label>
            <label>Passos/dia<input type="number" min={0} max={100000} value={draft[person.user_id]?.steps ?? ''} onChange={event => setDraft(current => ({ ...current, [person.user_id]: { minutes: current[person.user_id]?.minutes ?? '', steps: event.target.value } }))} /></label>
          </div>
        </div>
        <button className="text-button" disabled={busy} onClick={() => saveFor(person.user_id)}>Salvar</button>
      </div>)}</div>
    </section>}

    <section className="admin-review">
      <SectionHeading title="Declarações" />
      <div className="admin-review-list">{rows.length === 0 ? <p className="admin-empty">Ninguém preencheu ainda.</p>
        : rows.map(row => <div className="admin-review-row" key={row.id}>
            <div>
              <strong>{row.profiles?.full_name ?? 'Participante'}</strong>
              <span>{row.average_active_minutes} min/dia · {row.average_steps} passos/dia</span>
              <small>{row.frozen_at ? `congelado em ${new Date(row.frozen_at).toLocaleDateString('pt-BR')}` : 'ainda pode ser alterado'}</small>
            </div>
            <div className="review-actions">
              <span className={row.frozen_at ? 'status-pill status-validated' : 'status-pill'}>{row.frozen_at ? 'congelado' : 'aberto'}</span>
              {!row.frozen_at && <button className="text-button" disabled={busy} onClick={() => {
                const minutes = window.prompt(`Minutos por dia de ${row.profiles?.full_name ?? 'participante'}:`, String(row.average_active_minutes))
                if (minutes === null) return
                const steps = window.prompt('Passos diários:', String(row.average_steps))
                if (steps === null) return
                saveFor(row.user_id, { minutes, steps })
              }}>Corrigir</button>}
            </div>
          </div>)}</div>
    </section>
  </>
}

function AdminPayout() {
  const [seasons, setSeasons] = useState<Array<{ id: string; name: string; status: string }>>([])
  const [seasonId, setSeasonId] = useState('')
  const [result, setResult] = useState<PayoutResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [published, setPublished] = useState('')

  useEffect(() => {
    if (!supabase) return
    supabase.from('seasons').select('id, name, status').order('start_date', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as Array<{ id: string; name: string; status: string }>
        setSeasons(list)
        if (list.length && !seasonId) setSeasonId(list[0].id)
      })
  }, [])

  const run = async () => {
    if (!supabase || !seasonId) return
    setBusy(true); setError(''); setResult(null)
    const { data, error: rpcError } = await supabase.rpc('season_payout', { p_season_id: seasonId })
    setBusy(false)
    if (rpcError) setError(rpcError.message); else setResult(data as PayoutResult)
  }

  const publish = async () => {
    if (!supabase || !seasonId) return
    if (!window.confirm('Publicar este resultado para todos os participantes? Os números ficam congelados como estão agora.')) return
    setBusy(true); setError('')
    const { data, error: rpcError } = await supabase.rpc('publish_season_payout', { p_season_id: seasonId })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else setPublished(new Date((data as { published_at: string }).published_at).toLocaleString('pt-BR'))
  }

  const byPerson = new Map<string, { name: string; total: number; items: PayoutAward[] }>()
  ;(result?.awards ?? []).forEach(award => {
    const entry = byPerson.get(award.user_id) ?? { name: award.full_name, total: 0, items: [] }
    entry.total += Number(award.amount); entry.items.push(award)
    byPerson.set(award.user_id, entry)
  })
  const distributed = [...byPerson.values()].reduce((sum, entry) => sum + entry.total, 0)

  return <>
    <PageTitle eyebrow="PREMIAÇÃO" title="Apuração da temporada." detail="O cálculo não grava pagamento: você confere, paga por PIX e o registro fica no seu controle." />
    {error && <div className="form-error">{error}</div>}

    <div className="form-panel">
      <label>Temporada<select value={seasonId} onChange={event => { setSeasonId(event.target.value); setResult(null) }}>
        {seasons.map(season => <option key={season.id} value={season.id}>{season.name} · {season.status}</option>)}
      </select></label>
      <button className="primary-button" disabled={busy || !seasonId} onClick={run}>{busy ? 'Apurando...' : 'Apurar premiação'} <Trophy size={16} /></button>
    </div>

    {result && <>
      <section className="admin-review">
        <SectionHeading title="Resumo" />
        <div className="admin-grid">
          <Stat icon={<Trophy />} label="arrecadado" value={money(result.pool)} accent="violet" />
          <Stat icon={<Users />} label="participantes" value={String(result.standing.length)} accent="cyan" />
          <Stat icon={<Check />} label="a distribuir" value={money(distributed)} accent="cyan" />
          <Stat icon={<Flame />} label="semanas" value={String(result.season.weeks)} accent="orange" />
        </div>
        <p className="submit-hint">Sobra para a organização: {money(result.pool - distributed)}. Categorias acumulam — quem vence mais de uma recebe todas.</p>
        <button className="primary-button" disabled={busy} onClick={publish}>{busy ? 'Publicando...' : 'Publicar resultado para os participantes'} <ArrowUpRight size={16} /></button>
        {published && <p className="form-success">Resultado publicado em {published}. Todos os participantes já conseguem ver na aba Ranking.</p>}
      </section>

      <section className="admin-review">
        <SectionHeading title="Quem recebe" />
        <div className="admin-review-list">{byPerson.size === 0 ? <p className="admin-empty">Nenhum prêmio a distribuir nesta temporada.</p>
          : [...byPerson.entries()].sort((a, b) => b[1].total - a[1].total).map(([userId, entry]) =>
            <div className="admin-review-row" key={userId}>
              <div>
                <strong>{entry.name}</strong>
                <span>{entry.items.map(item => `${item.label} ${money(item.amount)}`).join(' · ')}</span>
                {entry.items.length > 1 && <small>acumulou {entry.items.length} categorias</small>}
              </div>
              <span className="status-pill status-validated">{money(entry.total)}</span>
            </div>)}</div>
      </section>

      <section className="admin-review">
        <SectionHeading title="Classificação final" />
        <div className="admin-review-list">{result.standing.map((person, index) =>
          <div className="admin-review-row" key={person.user_id}>
            <div>
              <strong>{index + 1}º {person.avatar_emoji || '🪩'} {person.full_name}</strong>
              <span>{person.points} pts · {person.days} dias ({person.consistency_percent}%) · evolução {person.evolution}</span>
              <small>{person.consistency_percent >= result.min_consistency_percent ? `dentro do rateio de consistência (mínimo ${result.min_consistency_percent}%)` : `fora do rateio de consistência`}</small>
            </div>
          </div>)}</div>
      </section>
    </>}
  </>
}

function AdminSettings() {
  const [seasons, setSeasons] = useState<SeasonOption[]>([])
  const [seasonId, setSeasonId] = useState('')
  const [rules, setRules] = useState<Record<string, string>>({})
  const [prizes, setPrizes] = useState({ champion: '40', second: '20', third: '10', evolution: '15', consistency: '15', minConsistency: '80' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) return
    const { data } = await supabase.from('seasons').select('id, name, status, rules').order('start_date', { ascending: false })
    const list = (data ?? []) as SeasonOption[]
    setSeasons(list)
    if (list.length && !seasonId) setSeasonId(list[0].id)
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!supabase || !seasonId) return
    const season = seasons.find(item => item.id === seasonId)
    const current = season?.rules ?? {}
    setRules(Object.fromEntries(ruleLabels.map(([key]) => [key, String(current[key] ?? '')])))
    supabase.from('season_prizes').select('*').eq('season_id', seasonId).maybeSingle().then(({ data }) => {
      if (!data) return
      setPrizes({
        champion: String(data.champion_percent), second: String(data.second_percent),
        third: String(data.third_percent), evolution: String(data.evolution_percent),
        consistency: String(data.consistency_percent), minConsistency: String(data.min_consistency_percent),
      })
    })
  }, [seasonId, seasons])

  const selected = seasons.find(item => item.id === seasonId)
  const isDraft = selected?.status === 'draft'
  const prizeTotal = ['champion', 'second', 'third', 'evolution', 'consistency']
    .reduce((sum, key) => sum + (Number(prizes[key as keyof typeof prizes]) || 0), 0)

  const saveRules = async () => {
    if (!supabase || !seasonId) return
    setBusy(true); setError(''); setMessage('')
    const payload = Object.fromEntries(Object.entries(rules).filter(([, value]) => String(value).trim() !== '').map(([key, value]) => [key, Number(value)]))
    const { error: rpcError } = await supabase.rpc('admin_set_season_rules', { p_season_id: seasonId, p_rules: payload })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setMessage('Parâmetros salvos.'); load() }
  }

  const savePrizes = async () => {
    if (!supabase || !seasonId) return
    setBusy(true); setError(''); setMessage('')
    const { error: rpcError } = await supabase.rpc('admin_upsert_season_prizes', {
      p_season_id: seasonId, p_champion: Number(prizes.champion), p_second: Number(prizes.second),
      p_third: Number(prizes.third), p_evolution: Number(prizes.evolution),
      p_consistency: Number(prizes.consistency), p_min_consistency: Number(prizes.minConsistency),
    })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else setMessage('Prêmios salvos.')
  }

  return <>
    <PageTitle eyebrow="CONFIGURAÇÕES" title="Regras e prêmios." detail="Alterações passam por RPC administrativa e ficam registradas em auditoria." />
    {message && <div className="form-success">{message}</div>}
    {error && <div className="form-error">{error}</div>}

    <div className="form-panel">
      <label>Temporada<select value={seasonId} onChange={event => setSeasonId(event.target.value)}>
        {seasons.map(season => <option key={season.id} value={season.id}>{season.name} · {season.status}</option>)}
      </select></label>
    </div>

    <section className="admin-review">
      <SectionHeading title="Prêmios da temporada" />
      <div className="form-panel">
        <div className="form-row">
          <label>Campeão (%)<input type="number" min={0} max={100} value={prizes.champion} onChange={e => setPrizes({ ...prizes, champion: e.target.value })} /></label>
          <label>Segundo (%)<input type="number" min={0} max={100} value={prizes.second} onChange={e => setPrizes({ ...prizes, second: e.target.value })} /></label>
        </div>
        <div className="form-row">
          <label>Terceiro (%)<input type="number" min={0} max={100} value={prizes.third} onChange={e => setPrizes({ ...prizes, third: e.target.value })} /></label>
          <label>Maior evolução (%)<input type="number" min={0} max={100} value={prizes.evolution} onChange={e => setPrizes({ ...prizes, evolution: e.target.value })} /></label>
        </div>
        <div className="form-row">
          <label>Rateio consistência (%)<input type="number" min={0} max={100} value={prizes.consistency} onChange={e => setPrizes({ ...prizes, consistency: e.target.value })} /></label>
          <label>Consistência mínima (%)<input type="number" min={0} max={100} value={prizes.minConsistency} onChange={e => setPrizes({ ...prizes, minConsistency: e.target.value })} /></label>
        </div>
        <p className="submit-hint">Soma atual: {prizeTotal}% do valor arrecadado. O restante fica com a organização.</p>
        <button className="primary-button" disabled={busy || prizeTotal > 100} onClick={savePrizes}>{busy ? 'Salvando...' : 'Salvar prêmios'} <Check size={16} /></button>
      </div>
    </section>

    <section className="admin-review">
      <SectionHeading title="Parâmetros de pontuação" />
      <div className="form-panel">
        {!isDraft && <p className="submit-hint">Esta temporada não é mais rascunho, então os parâmetros estão travados. Isso impede que o ranking de quem já competiu seja recalculado.</p>}
        <div className="form-row">{ruleLabels.map(([key, label]) => (
          <label key={key}>{label}<input type="number" min={0} disabled={!isDraft} value={rules[key] ?? ''} onChange={e => setRules({ ...rules, [key]: e.target.value })} /></label>
        ))}</div>
        <button className="primary-button" disabled={busy || !isDraft} onClick={saveRules}>{busy ? 'Salvando...' : 'Salvar parâmetros'} <Check size={16} /></button>
      </div>
    </section>

    <div className="score-info"><CircleHelp size={18} /><div><strong>O que não é editável</strong><p>O teto de 120 pontos por semana e o limite de 6 dias pontuáveis estão gravados na estrutura do banco e valem para todas as temporadas.</p></div></div>
  </>
}

function Badge({ icon, title, unlocked = false }: { icon: string; title: string; unlocked?: boolean }) { return <div className={`badge ${unlocked ? 'unlocked' : ''}`}><span>{unlocked ? icon : '◌'}</span><strong>{title}</strong>{unlocked && <small>conquistado</small>}</div> }

function ProfilePage({ profile, onNavigate, onAction }: { profile: Profile | null; onNavigate: (page: Page) => void; onAction: (message: string) => void }) { const { updateProfile } = useAuth(); const [name, setName] = useState(profile?.full_name ?? ''); const [phone, setPhone] = useState(profile?.phone ?? ''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState(''); useEffect(() => { setName(profile?.full_name ?? ''); setPhone(profile?.phone ?? '') }, [profile]); const save = async (event: React.FormEvent) => { event.preventDefault(); setBusy(true); setError(''); setMessage(''); const result = await updateProfile({ fullName: name, phone }); setBusy(false); if (result.error) setError(result.error.message); else setMessage('Perfil atualizado.') }; return <><section className="profile-head"><div className="profile-avatar">{profile?.avatar_emoji || '🪩'}<span className="status-check"><Check size={11} /></span></div><div><span className="eyebrow">SEU PERFIL</span><h1>{profile?.full_name ?? 'Seu perfil'}</h1><p>{profile?.email ?? 'Conta autenticada'} · participante {profile?.status === 'pending' ? 'pendente' : 'ativo'}</p></div><button className="icon-button" aria-label="Editar perfil"><MoreHorizontal size={20} /></button></section><form className="form-panel profile-edit-form" onSubmit={save}><label>Nome completo<input required minLength={2} maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label><label>Celular<input value={phone} onChange={event => setPhone(event.target.value)} autoComplete="tel" /></label><p className="form-note"><Lock size={13} /> E-mail, status e permissão são controlados pelo sistema.</p><button className="primary-button" disabled={busy}>{busy ? 'Salvando...' : 'Salvar perfil'} <Check size={16} /></button>{message && <div className="form-success">{message}</div>}{error && <div className="form-error">{error}</div>}</form><div className="profile-stats"><div><strong>Dados oficiais</strong><span>pontuação no ranking</span></div><div><strong>Privado</strong><span>sem dados corporais</span></div><div><strong>Seguro</strong><span>RLS ativo</span></div></div><BaselineCard /><WildcardsCard /><BadgesCard /><div className="settings-list"><button onClick={() => onAction('Notificações atualizadas.')}><Bell size={18} /><span>Notificações</span><small>Ativas</small><ChevronRight size={17} /></button><button onClick={() => onNavigate('privacy')}><ShieldCheck size={18} /><span>Privacidade e LGPD</span><ChevronRight size={17} /></button></div></> }

type WildcardInfo = {
  season: { id: string; name: string } | null
  used: number; remaining: number
  history: Array<{ used_on: string; reason: string }>
  open_days: string[]
}

type BadgeItem = { code: string; icon: string; name: string; hint: string; current: number; goal: number; earned_at: string | null }

function BadgesCard() {
  const [badges, setBadges] = useState<BadgeItem[]>([])
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!supabase) { setLoading(false); return }
    supabase.rpc('my_badges').then(({ data, error }) => {
      if (!error && data) setBadges(((data as { badges: BadgeItem[] }).badges ?? []))
      setLoading(false)
    })
  }, [])

  const earned = badges.filter(item => item.earned_at)
  const pending = badges.filter(item => !item.earned_at)
  const visible = showAll ? badges : [...earned, ...pending].slice(0, 6)

  return <section className="admin-review">
    <SectionHeading title="Suas medalhas" action={badges.length > 6 ? (showAll ? 'Ver menos' : 'Ver todas') : undefined} onClick={() => setShowAll(value => !value)} />
    {loading ? <p className="admin-empty">Carregando medalhas...</p> : <>
      <p className="submit-hint badge-summary">{earned.length} de {badges.length} conquistadas nesta temporada.</p>
      <div className="badge-grid profile-badges">{visible.map(item => {
        const done = Boolean(item.earned_at)
        const pct = item.goal > 0 ? Math.min(100, Math.round((item.current / item.goal) * 100)) : 0
        return <div className={done ? 'badge-card earned' : 'badge-card locked'} key={item.code}>
          <span className="badge-icon">{item.icon}</span>
          <strong>{item.name}</strong>
          {done
            ? <small>conquistada em {new Date(item.earned_at!).toLocaleDateString('pt-BR')}</small>
            : <><small>{item.hint}</small><div className="badge-progress"><span style={{ width: `${pct}%` }} /></div><small className="badge-count">{item.current} de {item.goal}</small></>}
        </div>
      })}</div>
    </>}
  </section>
}

function WildcardsCard() {
  const [info, setInfo] = useState<WildcardInfo | null>(null)
  const [day, setDay] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    if (!supabase) return
    const { data, error: rpcError } = await supabase.rpc('my_wildcards')
    if (rpcError) setError(rpcError.message); else setInfo(data as WildcardInfo)
  }
  useEffect(() => { load() }, [])

  const use = async () => {
    if (!supabase) return
    if (!day) { setError('Escolha o dia que você perdeu.'); return }
    if (reason.trim().length < 2) { setError('Escreva o motivo.'); return }
    if (!window.confirm(`Usar um coringa no dia ${new Date(`${day}T12:00:00`).toLocaleDateString('pt-BR')}? Você tem ${info?.remaining ?? 0} na temporada inteira.`)) return
    setBusy(true); setError(''); setMessage('')
    const { error: rpcError } = await supabase.rpc('use_wildcard', { p_used_on: day, p_reason: reason })
    setBusy(false)
    if (rpcError) setError(rpcError.message)
    else { setDay(''); setReason(''); setMessage('Coringa aplicado.'); load() }
  }

  if (!info?.season) return null

  return <section className="admin-review">
    <SectionHeading title="Coringas" />
    <div className="form-panel">
      <div className="wildcard-count">
        {[0, 1].map(index => <i key={index} className={index < info.remaining ? 'available' : 'spent'}>🧩</i>)}
        <span>{info.remaining} de 2 disponíveis nesta temporada</span>
      </div>
      <p className="submit-hint">O coringa protege um dia que você perdeu: ele conta como dia presente para o bônus semanal e para a consistência do prêmio, mas não gera pontos. Vale apenas para os últimos 7 dias e não entra em duelo.</p>

      {info.remaining > 0 && info.open_days.length > 0 && <>
        <div className="form-row">
          <label>Dia perdido<select value={day} onChange={event => { setDay(event.target.value); setError('') }}>
            <option value="">Selecione</option>
            {info.open_days.map(value => <option key={value} value={value}>{new Date(`${value}T12:00:00`).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit' })}</option>)}
          </select></label>
          <label>Motivo<input maxLength={240} placeholder="ex.: viagem de trabalho" value={reason} onChange={event => { setReason(event.target.value); setError('') }} /></label>
        </div>
        <button className="primary-button" disabled={busy} onClick={use}>{busy ? 'Aplicando...' : 'Usar coringa'} <Check size={16} /></button>
      </>}

      {info.remaining > 0 && info.open_days.length === 0 && <p className="form-note"><Check size={13} /> Nenhum dia em aberto nos últimos 7 dias. Nada a proteger por enquanto.</p>}
      {info.remaining === 0 && <p className="form-note"><Lock size={13} /> Seus dois coringas já foram usados nesta temporada.</p>}

      {info.history.length > 0 && <div className="wildcard-history">
        <span className="eyebrow">JÁ USADOS</span>
        {info.history.map(item => <div className="result-row" key={item.used_on}>
          <div><strong>{new Date(`${item.used_on}T12:00:00`).toLocaleDateString('pt-BR')}</strong><span>{item.reason}</span></div>
        </div>)}
      </div>}

      {message && <div className="form-success">{message}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  </section>
}

type SeasonRules = { id: string; name: string; start_date: string; end_date: string; rules: Record<string, number> | null }

function RulesPage() {
  const [season, setSeason] = useState<SeasonRules | null>(null)
  const [prizes, setPrizes] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!supabase) return
    supabase.from('seasons').select('id, name, start_date, end_date, rules')
      .in('status', ['registration', 'active']).order('start_date', { ascending: false }).limit(1).maybeSingle()
      .then(({ data }) => {
        const row = data as SeasonRules | null
        setSeason(row)
        if (row) supabase!.from('season_prizes').select('*').eq('season_id', row.id).maybeSingle()
          .then(({ data: prizeData }) => setPrizes(prizeData as Record<string, number> | null))
      })
  }, [])

  const rule = (key: string, fallback: number) => Number(season?.rules?.[key] ?? fallback)
  const weeks = season ? Math.max(1, Math.ceil(((new Date(season.end_date).getTime() - new Date(season.start_date).getTime()) / 86400000 + 1) / 7)) : 8
  const pct = (key: string, fallback: number) => Number(prizes?.[key] ?? fallback)

  return <>
    <PageTitle eyebrow="MANUAL MOVE" title="O jogo é consistência." detail={season ? `Regras da ${season.name}.` : 'Regras claras para uma competição leve, justa e divertida.'} />
    <div className="rules-intro"><Target size={22} /><p>A meta não é ser o mais intenso. É aparecer por você, um dia de cada vez.</p></div>

    <RuleBlock title="Temporada" text={`Esta temporada tem ${weeks} semana(s), de ${season ? new Date(`${season.start_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'} a ${season ? new Date(`${season.end_date}T12:00:00`).toLocaleDateString('pt-BR') : '—'}. Cada semana tem 6 dias que pontuam; o sétimo é descanso e não conta.`} />

    <RuleBlock title="Ponto de partida" text="Na inscrição você informa sua média de minutos de atividade por dia. É contra esse número que sua evolução é medida, e ele é congelado pela organização antes da temporada começar. Os passos não fazem parte do baseline: são registrados separadamente, uma vez por dia." />

    <RuleBlock title="Meta diária" text={`Complete ${rule('daily_minutes', 30)} minutos de atividade ou alcance ${rule('daily_steps', 8000).toLocaleString('pt-BR')} passos. A atividade precisa de comprovante e só conta depois de validada pela organização.`} />

    <RuleBlock title="Como a pontuação é calculada" text={`Consistência: ${rule('consistency_per_day', 10)} pontos por dia concluído, até ${rule('weekly_consistency_cap', 60)} por semana, mais ${rule('bonus_points', 15)} pontos ao fechar ${rule('bonus_days', 5)} dias ou mais. Um dia pode ser concluído por 30 minutos de atividade efetiva ou ${rule('daily_steps', 8000).toLocaleString('pt-BR')} passos validados; os passos são lançados uma única vez por dia. Evolução: 1 ponto a cada 2% de melhora sobre seu ponto de partida, usando no mínimo 10 minutos como baseline matemático, até ${rule('evolution_cap', 25)}. Volume: 1 ponto a cada ${rule('met_min_per_point', 40)} MET-min, até ${rule('volume_cap', 20)}. O teto é 120 pontos por semana.`} />

    <RuleBlock title="Duelos" text={`Você pode desafiar uma pessoa por semana, nos quatro primeiros dias. Ela tem 24 horas para aceitar ou recusar, sem penalidade se recusar. Vence quem concluir mais dias na semana; empate desempata por consistência e depois por volume. O vencedor ganha ${rule('duel_points', 10)} pontos que somam por fora do teto semanal. Dá para desistir a qualquer momento, e aí o adversário vence na hora. No máximo dois duelos com a mesma pessoa por temporada.`} />

    <RuleBlock title="Coringas" text="Você tem 2 coringas por temporada. Use um para proteger um dia que perdeu: ele conta como dia presente para o bônus semanal e para a consistência que qualifica ao prêmio, mas não gera pontos e não vale em duelo. Só pode ser usado nos últimos 7 dias, num dia que você não concluiu, e exige um motivo que fica registrado." />

    <RuleBlock title="Prêmios e acúmulo" text={`O valor arrecadado é dividido assim: ${pct('champion_percent', 40)}% para o campeão, ${pct('second_percent', 20)}% para o segundo, ${pct('third_percent', 10)}% para o terceiro, ${pct('evolution_percent', 15)}% para quem mais evoluiu e ${pct('consistency_percent', 15)}% rateados entre quem fechar pelo menos ${pct('min_consistency_percent', 80)}% dos dias. As categorias acumulam: quem for campeão e também tiver a maior evolução recebe as duas fatias, e quem está no pódio continua entrando no rateio. O melhor desempenho é premiado por inteiro, sem prêmio de consolo.`} />

    <RuleBlock title="Jogo limpo" text="O ranking nunca usa peso, IMC, gordura corporal, medidas ou aparência. Toda pontuação é calculada no servidor a partir de atividades validadas, com registro de quem aprovou o quê. Comprovante é obrigatório e o histórico fica disponível para consulta." />
  </>
}

const faqSections: Array<{ title: string; items: Array<{ q: string; a: string }> }> = [
  {
    title: 'Começando',
    items: [
      { q: 'Como entro na temporada?', a: 'Toque no nome da temporada no topo da tela. Você informa seu ponto de partida, faz o PIX no valor indicado, anexa o comprovante e espera a organização aprovar. Enquanto não for aprovado, você não consegue registrar atividade.' },
      { q: 'O que é o ponto de partida?', a: 'É a sua média de minutos de atividade por dia antes da temporada começar. Sua evolução é medida contra esse número, ou seja, você compete contra a sua própria versão anterior. O baseline é congelado pela organização e não pode ser alterado depois. Os passos são registrados separadamente.' },
      { q: 'Os passos contam para a classificação?', a: 'Sim. Você pode concluir um dia com 30 minutos de atividade efetiva ou com 8.000 passos validados. Os passos são informados uma única vez por dia, com comprovante, e também podem participar de desafios específicos.' },
      { q: 'Preciso informar peso ou medidas?', a: 'Não. Peso, altura, IMC, gordura corporal, medidas e fotos de corpo não são pedidos, não são guardados e não entram em nenhum cálculo.' },
      { q: 'Meu PIX foi recusado. E agora?', a: 'Abra a tela da temporada, confira o valor e a chave, refaça o pagamento e anexe o novo comprovante. A inscrição volta para análise automaticamente.' },
    ],
  },
  {
    title: 'Registrando atividade',
    items: [
      { q: 'Como registro uma atividade?', a: 'Toque no botão de play na barra de baixo, escolha o tipo de atividade e inicie. O tempo é contado pelo servidor, então você pode fechar o app, bloquear a tela ou usar outros aplicativos que a contagem continua correta.' },
      { q: 'Posso pausar no meio?', a: 'Pode. O tempo pausado não entra na duração, e você retoma quando quiser. Se esquecer pausado e finalizar, o app fecha a pausa sozinho e desconta o tempo parado.' },
      { q: 'Por que preciso anexar comprovante?', a: 'É o que mantém a competição justa, já que tem dinheiro envolvido. Vale print do relógio, do app de treino, foto do painel da esteira — qualquer coisa que mostre a atividade. JPG, PNG ou PDF de até 5 MB.' },
      { q: 'Esqueci o cronômetro rodando. O que faço?', a: 'Use o botão "Descartar atividade" na sessão em andamento. Só pode existir uma sessão ativa por vez, então descartar é o que libera você para começar outra.' },
      { q: 'Quando os pontos aparecem?', a: 'Depois que a organização validar a atividade. Até lá ela fica como "aguardando validação" em Minhas atividades. A data que conta é a do treino, não a da aprovação.' },
      { q: 'Bati a meta por passos mas treinei menos de 30 minutos. Conta?', a: 'Conta. A meta é atingida de duas formas: pelo tempo ou pelos passos. Informe o número de passos no momento de enviar a atividade para validação.' },
    ],
  },
  {
    title: 'Pontuação',
    items: [
      { q: 'Como eu pontuo?', a: 'Consistência é o principal: pontos por cada dia em que você bate a meta, mais um bônus se fechar a semana com vários dias. Evolução premia melhorar em relação ao seu ponto de partida. Volume considera a intensidade e a duração. Os valores exatos estão na tela de Regras, porque podem mudar de uma temporada para outra.' },
      { q: 'Treinei duas vezes no mesmo dia. Vale o dobro?', a: 'Em consistência não — um dia é um dia. Mas o volume das duas atividades soma, até o teto diário.' },
      { q: 'Existe dia de descanso?', a: 'Sim. Cada semana tem 6 dias que pontuam; o sétimo não conta e não prejudica ninguém.' },
      { q: 'O que é o coringa?', a: 'Você tem 2 por temporada. Ele protege um dia que você perdeu: conta como dia presente para o bônus da semana e para a consistência que dá direito ao rateio do prêmio, mas não gera pontos. Vale só para os últimos 7 dias e não vale em duelo. Fica no seu Perfil.' },
    ],
  },
  {
    title: 'Duelos',
    items: [
      { q: 'Como funciona um duelo?', a: 'Você desafia uma pessoa para a semana corrente. Ela tem 24 horas para aceitar ou recusar. Vence quem concluir mais dias naquela semana; empate desempata por consistência e depois por volume. O vencedor ganha pontos que somam por fora do teto semanal.' },
      { q: 'Por que não consigo desafiar ninguém?', a: 'Duelos só podem ser propostos nos quatro primeiros dias da semana, para sobrar tempo de competir. Também não dá se você já tiver um duelo na semana, se a pessoa já estiver em outro, ou se vocês já duelaram duas vezes na temporada.' },
      { q: 'Aceitei e não vou conseguir treinar. Posso sair?', a: 'Pode. Use "Desistir" no duelo em andamento. O adversário vence na hora e recebe os pontos, e a desistência fica registrada no histórico dos dois.' },
      { q: 'O placar do duelo está parado. É bug?', a: 'O placar conta apenas atividades já validadas. Se você treinou e a aprovação ainda não saiu, o dia ainda vai contar, mas só aparece depois que a organização validar.' },
    ],
  },
  {
    title: 'Grupos',
    items: [
      { q: 'Para que serve um grupo?', a: 'Para acompanhar de perto quem você conhece: família, colegas de trabalho, amigos. É um recorte do ranking, nada mais. A temporada, o valor e a premiação continuam sendo os mesmos para todo mundo.' },
      { q: 'Como chamo alguém para o meu grupo?', a: 'Crie o grupo em Meus grupos, no menu. Ele gera um código de 6 caracteres. Toque em "Convidar" para compartilhar direto pelo WhatsApp com a mensagem pronta, ou passe o código na mão. A pessoa digita o código no campo "Entrar com código" e pronto.' },
      { q: 'Preciso pagar de novo para entrar num grupo?', a: 'Não. Grupo não tem taxa, não tem prêmio próprio e não altera nada da sua inscrição.' },
      { q: 'De quantos grupos posso participar?', a: 'De até 5 ao mesmo tempo, com até 50 pessoas em cada. Grupos continuam existindo de uma temporada para outra.' },
      { q: 'Quem sai do grupo perde alguma coisa?', a: 'Nada. Sua pontuação é da temporada, não do grupo. Se o último membro sair, o grupo deixa de existir.' },
    ],
  },
  {
    title: 'Prêmios',
    items: [
      { q: 'Como o dinheiro é dividido?', a: 'Entre campeão, segundo, terceiro, quem mais evoluiu, e um rateio entre todos que mantiverem a consistência mínima. Os percentuais exatos aparecem na tela de Regras.' },
      { q: 'Dá para ganhar em mais de uma categoria?', a: 'Dá, e é proposital. Quem for campeão e também tiver a maior evolução recebe as duas fatias, e quem está no pódio continua entrando no rateio de consistência. O melhor desempenho é premiado por inteiro.' },
      { q: 'Onde vejo o resultado final?', a: 'Na aba Ranking, em "Temporadas encerradas". Assim que a organização publica, todo mundo vê quanto foi arrecadado, quem recebeu quanto e a classificação completa.' },
    ],
  },
  {
    title: 'Conta e app',
    items: [
      { q: 'Como troco meu emoji?', a: 'No Perfil, toque nos três pontinhos ao lado do seu nome e escolha "Trocar emoji". Você pode digitar ou colar qualquer emoji, não só os sugeridos.' },
      { q: 'O app não está atualizando no celular.', a: 'Feche o app completamente e abra de novo. Se persistir, remova da tela inicial e adicione outra vez.' },
      { q: 'Meus dados estão seguros?', a: 'A página Privacidade e LGPD, no menu, explica exatamente o que é coletado, quem vê o quê e como pedir exclusão.' },
    ],
  },
]

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

function detectPlatform() {
  if (typeof navigator === 'undefined') return { ios: false, android: false, inApp: false, installed: false }
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|WhatsApp|Snapchat|Twitter/i.test(ua)
  const installed = window.matchMedia?.('(display-mode: standalone)').matches
    || (navigator as unknown as { standalone?: boolean }).standalone === true
  return { ios, android, inApp, installed }
}

function InstallGuide() {
  const [platform] = useState(detectPlatform)
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const handler = (event: Event) => { event.preventDefault(); setPrompt(event as InstallPrompt) }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const install = async () => {
    if (!prompt) return
    await prompt.prompt()
    const choice = await prompt.userChoice
    if (choice.outcome === 'accepted') setDone(true)
    setPrompt(null)
  }

  const copyLink = () => {
    navigator.clipboard?.writeText(window.location.origin).catch(() => undefined)
  }

  if (platform.installed || done) return <>
    <PageTitle eyebrow="INSTALAR" title="Você já está no app." detail="O MOVE está instalado neste aparelho. Ele abre em tela cheia, guarda seu login e funciona igual a qualquer outro aplicativo." />
    <div className="score-info"><Check size={18} /><div><strong>Tudo certo</strong><p>Se quiser instalar em outro aparelho, abra o mesmo endereço nele e siga as instruções desta tela.</p></div></div>
  </>

  return <>
    <PageTitle eyebrow="INSTALAR" title="Coloque o MOVE na tela do celular." detail="Assim ele abre em tela cheia, com ícone próprio, sem barra de navegador e sem precisar digitar o endereço." />

    {platform.inApp && <div className="install-warning">
      <strong>Você está no navegador do WhatsApp</strong>
      <p>Aqui não é possível instalar. Toque nos três pontinhos no canto da tela e escolha "Abrir no navegador" — ou copie o endereço e cole no Safari (iPhone) ou Chrome (Android).</p>
      <button className="text-button" onClick={copyLink}>Copiar endereço <Copy size={14} /></button>
    </div>}

    {platform.ios && <section className="admin-review">
      <SectionHeading title="No iPhone ou iPad" />
      <ol className="install-steps">
        <li><strong>Abra no Safari.</strong> Precisa ser o Safari — pelo Chrome do iPhone a opção não aparece.</li>
        <li><strong>Toque no botão Compartilhar.</strong> É o quadrado com a seta para cima, na barra de baixo.</li>
        <li><strong>Role a lista e escolha "Adicionar à Tela de Início".</strong></li>
        <li><strong>Toque em "Adicionar", no canto superior direito.</strong></li>
      </ol>
      <p className="submit-hint">O ícone do MOVE aparece junto com seus outros aplicativos. A partir daí, abra sempre por ele.</p>
    </section>}

    {platform.android && <section className="admin-review">
      <SectionHeading title="No Android" />
      {prompt
        ? <div className="form-panel">
            <p className="submit-hint">Seu navegador já reconheceu o MOVE. É um toque só.</p>
            <button className="primary-button" onClick={install}>Instalar agora <ArrowUpRight size={16} /></button>
          </div>
        : <ol className="install-steps">
            <li><strong>Abra no Chrome.</strong></li>
            <li><strong>Toque nos três pontinhos</strong> no canto superior direito.</li>
            <li><strong>Escolha "Instalar aplicativo"</strong> ou "Adicionar à tela inicial".</li>
            <li><strong>Confirme em "Instalar".</strong></li>
          </ol>}
    </section>}

    {!platform.ios && !platform.android && <section className="admin-review">
      <SectionHeading title="No computador" />
      <ol className="install-steps">
        <li><strong>No Chrome ou Edge</strong>, procure o ícone de instalar na barra de endereço, à direita.</li>
        <li><strong>Ou abra o menu</strong> e escolha "Instalar MOVE".</li>
      </ol>
      <p className="submit-hint">No celular a experiência é melhor: abra <strong>{typeof window !== 'undefined' ? window.location.host : ''}</strong> no Safari (iPhone) ou Chrome (Android) e siga as instruções desta tela.</p>
    </section>}

    <div className="score-info"><CircleHelp size={18} /><div><strong>Por que instalar</strong><p>Além da tela cheia e do ícone, o app instalado mantém você logado e carrega mais rápido. Nada é baixado de loja nenhuma — é o mesmo endereço, só que atalhado.</p></div></div>
  </>
}

function FaqPage() {
  const [open, setOpen] = useState('')
  return <>
    <PageTitle eyebrow="AJUDA" title="Perguntas frequentes." detail="Se a sua dúvida não estiver aqui, fale com quem organiza a temporada." />
    {faqSections.map(section => <section className="admin-review" key={section.title}>
      <SectionHeading title={section.title} />
      <div className="admin-review-list">{section.items.map(item => {
        const id = `${section.title}-${item.q}`
        const isOpen = open === id
        return <div key={id}>
          <button className="result-head" onClick={() => setOpen(isOpen ? '' : id)}>
            <div><strong>{item.q}</strong></div>
            <ChevronRight size={18} className={isOpen ? 'result-arrow open' : 'result-arrow'} />
          </button>
          {isOpen && <div className="result-body"><p className="faq-answer">{item.a}</p></div>}
        </div>
      })}</div>
    </section>)}
  </>
}

function PrivacyPage() {
  return <>
    <PageTitle eyebrow="PRIVACIDADE" title="O que guardamos, e por quê." detail="Escrito em português claro, sem letra miúda." />

    <RuleBlock title="O que é coletado" text="Seu nome, e-mail e celular, informados no cadastro. Sua média de minutos de atividade declarada na inscrição. Os passos diários que você registra. As atividades que você registra, com horário de início e fim, duração e tipo. Os comprovantes que você anexa. Sua pontuação, duelos, coringas e grupos." />

    <RuleBlock title="O que não é coletado" text="Peso, altura, IMC, percentual de gordura, medidas corporais, fotos de corpo, dados de saúde e localização. Nada disso é pedido, guardado ou usado em qualquer cálculo." />

    <RuleBlock title="Comprovantes" text="O comprovante de PIX e o comprovante de atividade ficam guardados em arquivos privados. Só você e a organização da temporada conseguem abri-los. O comprovante de PIX costuma conter seu nome e o banco usado — se preferir, você pode ocultar dados sensíveis na imagem antes de anexar, desde que o valor e a data continuem legíveis." />

    <RuleBlock title="Quem vê o quê" text="Os outros participantes veem seu nome, seu emoji, sua pontuação, sua posição no ranking e os duelos de que você participa. Não veem seus comprovantes, seu e-mail, seu celular, seu ponto de partida nem o motivo dos seus coringas. A organização vê tudo isso, porque precisa aprovar pagamentos e validar atividades." />

    <RuleBlock title="Por quanto tempo" text="Os dados da temporada ficam guardados enquanto o app existir, para que o histórico e os resultados continuem consultáveis. Se você quiser apagar sua conta e seus dados, peça à organização: seus registros são removidos e seu nome sai dos rankings publicados." />

    <RuleBlock title="Segurança" text="O acesso é por e-mail e senha. O banco de dados aplica regras que impedem alguém de ler ou alterar dados de outra pessoa, e ações administrativas ficam registradas com data e autor. Nenhum dado é vendido, compartilhado com terceiros ou usado para publicidade." />

    <div className="score-info"><CircleHelp size={18} /><div><strong>Dúvidas</strong><p>Qualquer pergunta sobre seus dados, fale direto com quem organiza a temporada.</p></div></div>
  </>
}

function RuleBlock({ title, text }: { title: string; text: string }) { return <article className="rule-block"><span className="rule-number">{title.slice(0, 1)}</span><div><h2>{title}</h2><p>{text}</p></div></article> }

function RegisterModal({ season, activeSession, completedSession, onClose, onStarted, onCompleted, onCancelled, onDone }: { season: CurrentSeason | null; activeSession: ActivitySession | null; completedSession?: ActivitySession | null; onClose: () => void; onCancelled: () => void; onStarted: (session: ActivitySession) => void; onCompleted?: (session: ActivitySession) => void; onDone: (session: ActivitySession) => void }) { return <div className="modal-backdrop" onMouseDown={activeSession ? undefined : onClose}><div className="register-modal" onMouseDown={e => e.stopPropagation()}><div className="modal-head"><div><span className="eyebrow">{activeSession ? 'SESSÃO ATIVA' : 'NOVO MOVIMENTO'}</span><h2>{activeSession ? 'Continue no seu ritmo.' : 'Comece seu movimento.'}</h2></div>{!activeSession && <button className="icon-button" onClick={onClose}><X size={20} /></button>}</div><ActivitySessionForm season={season} activeSession={activeSession} completedSession={completedSession ?? null} onStarted={onStarted} onCompleted={onCompleted ?? (() => undefined)} onCancelled={onCancelled} onDone={onDone} /></div></div> }

export default App

createRoot(document.getElementById('root')!).render(<MoveErrorBoundary><AuthProvider><App /></AuthProvider></MoveErrorBoundary>)
