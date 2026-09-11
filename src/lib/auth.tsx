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

type AuthResult = {
  error: Error | null
  message?: string
}

type AuthContextValue = {
  user: User | null
  profile: Profile | null
  session: Session | null
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (input: {
    fullName: string
    email: string
    phone: string
    password: string
  }) => Promise<AuthResult>
  resetPassword: (email: string) => Promise<AuthResult>
  signOut: () => Promise<AuthResult>
  refreshProfile: () => Promise<void>
  updateProfile: (input: {
    fullName?: string
    phone?: string
    avatarEmoji?: string | null
  }) => Promise<AuthResult>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

function toError(error: unknown) {
  return error instanceof Error
    ? error
    : new Error('Não foi possível concluir a operação.')
}

const profileEmojis = [
  '🏃',
  '🚴',
  '🏋️',
  '🧘',
  '🏊',
  '⚽',
  '🥊',
  '🤸',
  '🔥',
  '⚡',
  '💪',
  '🚀',
  '🌟',
  '💎',
  '🎯',
  '🏆',
  '🦁',
  '🐯',
  '🐺',
  '🦊',
  '🐼',
  '🦄',
  '🐢',
  '🪩',
]

function firstEmoji(value: string): string | null {
  const trimmed = value.trim()

  if (!trimmed) {
    return null
  }

  if (
    typeof Intl !== 'undefined' &&
    'Segmenter' in Intl
  ) {
    try {
      const Segmenter = (
        Intl as unknown as {
          Segmenter: new (
            locale: string,
            options: { granularity: 'grapheme' },
          ) => {
            segment: (
              input: string,
            ) => Iterable<{ segment: string }>
          }
        }
      ).Segmenter

      const segmenter = new Segmenter('pt-BR', {
        granularity: 'grapheme',
      })

      const first = [...segmenter.segment(trimmed)][0]?.segment

      if (!first || first.length > 16) {
        return null
      }

      return /\p{Extended_Pictographic}/u.test(first)
        ? first
        : null
    } catch {
      // fallback abaixo
    }
  }

  const first = Array.from(trimmed)[0]

  if (!first) {
    return null
  }

  return /\p{Extended_Pictographic}/u.test(first)
    ? first
    : null
}

function ProfileMenuOverlay() {
  const {
    profile,
    updateProfile,
    signOut,
  } = useAuth()

  const [open, setOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [selectedEmoji, setSelectedEmoji] = useState(
    profile?.avatar_emoji ?? '🪩',
  )
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setSelectedEmoji(profile?.avatar_emoji ?? '🪩')
  }, [profile?.avatar_emoji])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Element | null

      if (!target) {
        return
      }

      if (target.closest('[aria-label="Editar perfil"]')) {
        setOpen(value => !value)
        setEmojiOpen(false)
        setError('')
        return
      }

      if (
        !target.closest('.profile-action-menu') &&
        !target.closest('.profile-emoji-modal')
      ) {
        setOpen(false)
        setEmojiOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClick)

    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [])

  const saveEmoji = async (emoji: string) => {
    const selectedEmoji = emoji

    setSelectedEmoji(selectedEmoji)
    setBusy(true)
    setError('')

    const result = await updateProfile({ avatarEmoji: selectedEmoji })

    setBusy(false)

    if (result.error) {
      setError('Não foi possível atualizar seu emoji.')
      return
    }

    setEmojiOpen(false)
    setOpen(false)
    setCustom('')
  }

  const applyCustom = async () => {
    const emoji = firstEmoji(custom)

    if (!emoji) {
      setError('Digite ou cole um emoji.')
      return
    }

    await saveEmoji(emoji)
  }

  const logout = async () => {
    setBusy(true)
    setError('')

    const result = await signOut()

    setBusy(false)

    if (result.error) {
      setError('Não foi possível sair agora. Tente novamente.')
      return
    }

    setOpen(false)
    setEmojiOpen(false)
  }

  if (!profile) {
    return null
  }

  const preview =
    firstEmoji(custom) ??
    selectedEmoji ??
    profile.avatar_emoji ??
    '🪩'

  return (
    <>
      {open && (
        <div
          className="profile-action-menu"
          role="menu"
          aria-label="Ações do perfil"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)

              window.setTimeout(() => {
                document
                  .querySelector<HTMLInputElement>(
                    '.profile-edit-form input',
                  )
                  ?.focus()
              }, 0)
            }}
          >
            Editar perfil
          </button>

          <button
            type="button"
            className="profile-save-label"
            aria-label="Salvar alterações do perfil"
            hidden
          >
            Salvar
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setEmojiOpen(true)
              setError('')
              setCustom('')
            }}
          >
            Trocar emoji
          </button>

                    <button type="button" role="menuitem" disabled={busy} onClick={logout}>Sair</button>

          {error && (
            <span
              className="profile-menu-error"
              role="alert"
            >
              {error}
            </span>
          )}
        </div>
      )}

      {emojiOpen && (
        <div
          className="profile-emoji-modal"
          role="dialog"
          aria-modal="true"
          aria-label="Escolher emoji"
          onMouseDown={() => {
            if (!busy) {
              setEmojiOpen(false)
            }
          }}
        >
          <div
            className="profile-emoji-panel"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="modal-head">
              <div>
                <span className="eyebrow">SEU AVATAR</span>
                <h2>Escolha seu emoji.</h2>
              </div>

              <button
                type="button"
                className="icon-button"
                aria-label="Fechar"
                onClick={() => setEmojiOpen(false)}
              >
                ×
              </button>
            </div>

            <div className="emoji-custom">
              <span
                className="emoji-custom-preview"
                aria-hidden="true"
              >
                {preview}
              </span>

              <label>
                Qualquer emoji

                <input
                  value={custom}
                  onChange={event => {
                    setCustom(event.target.value)
                    setError('')
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      void applyCustom()
                    }
                  }}
                  placeholder="Digite ou cole aqui"
                  aria-label="Digite ou cole um emoji"
                  autoComplete="off"
                />
              </label>

              <button
                type="button"
                className="primary-button compact"
                disabled={busy || !firstEmoji(custom)}
                onClick={() => void applyCustom()}
              >
                {busy ? 'Salvando...' : 'Usar'}
              </button>
            </div>

            <p className="emoji-hint">
              No celular, abra o teclado de emojis. No computador,
              use <kbd>Win</kbd>+<kbd>.</kbd> ou{' '}
              <kbd>Ctrl</kbd>+<kbd>Cmd</kbd>+<kbd>Espaço</kbd>.
            </p>

            <span className="eyebrow emoji-divider">
              SUGESTÕES
            </span>

            <div className="emoji-grid">
              {profileEmojis.map(emoji => (
                <button
                  type="button"
                  key={emoji}
                  disabled={busy}
                  aria-label={`Usar ${emoji}`}
                  className={
                    selectedEmoji === emoji
                      ? 'is-current'
                      : ''
                  }
                  onClick={() => void saveEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>

            {error && (
              <span
                className="profile-menu-error"
                role="alert"
              >
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </>
  )
}

export function AuthProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [session, setSession] =
    useState<Session | null>(null)

  const [profile, setProfile] =
    useState<Profile | null>(null)

  const [loading, setLoading] =
    useState(Boolean(supabase))

  const refreshProfile = async () => {
    if (!supabase || !session?.user) {
      return
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!error) {
      setProfile(data as Profile | null)
    }
  }

  useEffect(() => {
    if (!supabase) {
      setLoading(false)
      return
    }

    let mounted = true

    const loadInitialSession = async () => {
      const { data } = await supabase.auth.getSession()

      if (!mounted) {
        return
      }

      setSession(data.session)

      if (data.session) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', data.session.user.id)
          .maybeSingle()

        if (mounted) {
          setProfile(
            profileData as Profile | null,
          )
        }
      } else {
        setProfile(null)
      }

      if (mounted) {
        setLoading(false)
      }
    }

    void loadInitialSession()

    const {
      data: listener,
    } = supabase.auth.onAuthStateChange(
      async (
        event: AuthChangeEvent,
        nextSession,
      ) => {
        if (!mounted) {
          return
        }

        setSession(nextSession)

        if (!nextSession) {
          setProfile(null)
          setLoading(false)
          return
        }

        if (
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED'
        ) {
          const { data: profileData } =
            await supabase
              .from('profiles')
              .select('*')
              .eq('id', nextSession.user.id)
              .maybeSingle()

          if (mounted) {
            setProfile(
              profileData as Profile | null,
            )
          }
        }

        if (mounted) {
          setLoading(false)
        }
      },
    )

    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      profile,
      session,
      loading,
      configured: Boolean(supabase),

      refreshProfile,

      updateProfile: async ({
        fullName,
        phone,
        avatarEmoji,
      }) => {
        if (!supabase || !session?.user) {
          return {
            error: new Error(
              'Você precisa estar autenticado para editar o perfil.',
            ),
          }
        }

        const changes: Record<string, unknown> = {
          ...(fullName !== undefined
            ? {
                full_name: fullName.trim(),
              }
            : {}),

          ...(phone !== undefined
            ? {
                phone: phone.trim() || null,
              }
            : {}),

          ...(avatarEmoji !== undefined
            ? {
                avatar_emoji: avatarEmoji,
              }
            : {}),
        }

        const { error } = await supabase
          .from('profiles')
          .update(changes)
          .eq('id', session.user.id)

        if (error) {
          return {
            error: toError(error),
          }
        }

        await refreshProfile()

        return {
          error: null,
        }
      },

      signIn: async (
        email,
        password,
      ) => {
        if (!supabase) {
          return {
            error: new Error(
              'Configure o Supabase para entrar na sua conta.',
            ),
          }
        }

        const { error } =
          await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
          })

        return {
          error: error ? toError(error) : null,
        }
      },

      signUp: async ({
        fullName,
        email,
        phone,
        password,
      }) => {
        if (!supabase) {
          return {
            error: new Error(
              'Configure o Supabase para criar sua conta.',
            ),
          }
        }

        const { data, error } =
          await supabase.auth.signUp({
            email: email.trim(),
            password,
            options: {
              data: {
                full_name: fullName.trim(),
                phone: phone.trim(),
              },
            },
          })

        if (error) {
          return {
            error: toError(error),
          }
        }

        return {
          error: null,
          message: data.session
            ? 'Conta criada. Bem-vindo ao MOVE.'
            : 'Conta criada. Confirme seu e-mail para entrar.',
        }
      },

      resetPassword: async email => {
        if (!supabase) {
          return {
            error: new Error(
              'Configure o Supabase para recuperar sua senha.',
            ),
          }
        }

        const { error } =
          await supabase.auth.resetPasswordForEmail(
            email.trim(),
            {
              redirectTo:
                `${window.location.origin}/`,
            },
          )

        return {
          error: error ? toError(error) : null,
          message:
            'Se o e-mail existir, você receberá um link de recuperação.',
        }
      },

      signOut: async () => {
        if (!supabase) {
          return {
            error: null,
          }
        }

        const { error } =
          await supabase.auth.signOut()

        return {
          error: error ? toError(error) : null,
        }
      },
    }),
    [
      loading,
      profile,
      session,
    ],
  )

  return (
    <AuthContext.Provider value={value}>
      <ProfileMenuOverlay />
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error(
      'useAuth precisa estar dentro de AuthProvider',
    )
  }

  return context
}