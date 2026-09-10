import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import '../profile-menu.css'

export type Profile = {
  id: string
  full_name: string
  email: string
  phone: string | null
  avatar_url: string | null
  avatar_emoji: string | null
  role: 'participant' | 'admin'
  status: 'pending' | 'active' | 'blocked'
  created_at: string
  updated_at: string
}

type AuthResult = { error: Error | null; message?: string }
type AuthContextValue = {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (input: { fullName: string; email: string; phone: string; password: string }) => Promise<AuthResult>
  resetPassword: (email: string) => Promise<AuthResult>
  signOut: () => Promise<AuthResult>
  refreshProfile: () => Promise<void>
  updateProfile: (input: { fullName?: string; phone?: string; avatarEmoji?: string | null }) => Promise<AuthResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toError(error: unknown) {
  return error instanceof Error ? error : new Error('Não foi possível concluir a operação.')
}

const profileEmojis = ['🏃', '🚴', '🏋️', '🔥', '⚡', '💪', '🦁', '🐯', '🐺', '🦊', '🐼', '🚀', '🌟', '💎', '🎯', '🏆']

function ProfileMenuOverlay() {
  const { profile, signOut, updateProfile } = useAuth()
  const [open, setOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element
      if (target.closest('[aria-label="Editar perfil"]')) {
        setOpen(value => !value)
        setEmojiOpen(false)
        return
      }
      if (!target.closest('.profile-action-menu') && !target.closest('.profile-emoji-modal')) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    const emoji = profile?.avatar_emoji || '🪩'
    document.querySelectorAll<HTMLElement>('.profile-avatar, .avatar-button').forEach(element => {
      if (element.firstChild) element.firstChild.nodeValue = emoji
    })
  }, [profile?.avatar_emoji])

  const chooseEmoji = async (emoji: string) => {
    setBusy(true)
    setError('')
    const result = await updateProfile({ avatarEmoji: emoji })
    setBusy(false)
    if (result.error) setError('Não foi possível atualizar seu emoji.')
    else { setEmojiOpen(false); setOpen(false) }
  }

  const logout = async () => {
    setBusy(true)
    setError('')
    const result = await signOut()
    setBusy(false)
    if (result.error) setError('Não foi possível sair agora. Tente novamente.')
    else setOpen(false)
  }

  if (!profile) return null
  return <>
    {open && <div className="profile-action-menu" role="menu" aria-label="Ações do perfil">
      <button role="menuitem" onClick={() => { setOpen(false); document.querySelector<HTMLInputElement>('.profile-edit-form input')?.focus() }}>Editar perfil</button>
      <button role="menuitem" onClick={() => { setEmojiOpen(true); setError('') }}>Trocar emoji</button>
      <button role="menuitem" disabled={busy} onClick={logout}>Sair</button>
      {error && <span className="profile-menu-error" role="alert">{error}</span>}
    </div>}
    {emojiOpen && <div className="profile-emoji-modal" role="dialog" aria-modal="true" aria-label="Escolher emoji" onMouseDown={() => setEmojiOpen(false)}>
      <div className="profile-emoji-panel" onMouseDown={event => event.stopPropagation()}>
        <div className="modal-head"><div><span className="eyebrow">SEU AVATAR</span><h2>Escolha seu emoji.</h2></div><button className="icon-button" aria-label="Fechar" onClick={() => setEmojiOpen(false)}>×</button></div>
        <div className="emoji-grid">{profileEmojis.map(emoji => <button key={emoji} disabled={busy} aria-label={`Usar ${emoji}`} onClick={() => chooseEmoji(emoji)}>{emoji}</button>)}</div>
      </div>
    </div>}
  </>
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))

  const refreshProfile = async () => {
    if (!supabase || !session?.user) return
    const { data, error } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
    if (!error) setProfile(data as Profile | null)
  }

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) {
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', data.session.user.id).maybeSingle()
        if (mounted) setProfile(profileData as Profile | null)
      }
      if (mounted) setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange(async (event: AuthChangeEvent, nextSession) => {
      setSession(nextSession)
      if (!nextSession) setProfile(null)
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        const { data: profileData } = await supabase.from('profiles').select('*').eq('id', nextSession?.user.id).maybeSingle()
        setProfile(profileData as Profile | null)
      }
      setLoading(false)
    })
    return () => { mounted = false; listener.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    user: session?.user ?? null, profile, session, loading, configured: Boolean(supabase), refreshProfile,
    updateProfile: async ({ fullName, phone, avatarEmoji }) => {
      if (!supabase || !session?.user) return { error: new Error('Você precisa estar autenticado para editar o perfil.') }
      const changes = {
        ...(fullName !== undefined ? { full_name: fullName.trim() } : {}),
        ...(phone !== undefined ? { phone: phone.trim() || null } : {}),
        ...(avatarEmoji !== undefined ? { avatar_emoji: avatarEmoji } : {}),
      }
      const { error } = await supabase.from('profiles').update(changes).eq('id', session.user.id)
      if (!error) await refreshProfile()
      return { error: error ? toError(error) : null }
    },
    signIn: async (email, password) => {
      if (!supabase) return { error: new Error('Configure o Supabase para entrar na sua conta.') }
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      return { error: error ? toError(error) : null }
    },
    signUp: async ({ fullName, email, phone, password }) => {
      if (!supabase) return { error: new Error('Configure o Supabase para criar sua conta.') }
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name: fullName, phone } } })
      if (error) return { error: toError(error) }
      return { error: null, message: data.session ? 'Conta criada. Bem-vindo ao MOVE.' : 'Conta criada. Confirme seu e-mail para entrar.' }
    },
    resetPassword: async (email) => {
      if (!supabase) return { error: new Error('Configure o Supabase para recuperar sua senha.') }
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/` })
      return { error: error ? toError(error) : null, message: 'Se o e-mail existir, você receberá um link de recuperação.' }
    },
    signOut: async () => {
      if (!supabase) return { error: null }
      const { error } = await supabase.auth.signOut()
      return { error: error ? toError(error) : null }
    },
  }), [loading, profile, session])

  return <AuthContext.Provider value={value}><ProfileMenuOverlay />{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth precisa estar dentro de AuthProvider')
  return context
}
