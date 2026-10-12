import { useState } from 'react'
import { Eye, EyeSlash } from '@phosphor-icons/react'

/**
 * A password input with a reveal toggle.
 *
 * Shared by sign-in and registration so the control behaves identically in
 * both: same icon, same hit area, same wording. Two screens with two slightly
 * different reveal buttons is the kind of thing nobody notices until a demo.
 *
 * Accessibility and safety notes, because a reveal button is easy to get wrong:
 *
 *  - The button is `type="button"`. Inside a form, the default is `submit`, so
 *    without this, clicking the eye would attempt a sign-in with a
 *    half-typed password.
 *  - `aria-pressed` carries the state and `aria-label` says what the click will
 *    do, so a screen-reader user is told whether the password is currently
 *    visible rather than having to infer it from an icon.
 *  - The field reverts to hidden on every mount. Revealing is a deliberate act
 *    for one moment of typing; it is never remembered across navigations.
 *  - `autoComplete` is passed through rather than hardcoded: the browser needs
 *    `current-password` on sign-in and `new-password` on registration, and
 *    getting that wrong makes password managers offer the wrong thing.
 */
export default function PasswordField({
  id,
  label = 'Password',
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder,
  required,
}) {
  const [shown, setShown] = useState(false)

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div style={{ position: 'relative', display: 'flex' }}>
        <input
          id={id}
          className="input"
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          value={value}
          onChange={onChange}
          // Room on the right for the button, so a long password never runs
          // underneath the icon.
          style={{ minHeight: 48, paddingRight: 48, background: 'var(--s1)' }}
        />
        <button
          type="button"
          onClick={() => setShown((s) => !s)}
          aria-pressed={shown}
          aria-label={shown ? 'Hide password' : 'Show password'}
          title={shown ? 'Hide password' : 'Show password'}
          style={{
            position: 'absolute', right: 4, top: 4, bottom: 4, width: 40,
            display: 'grid', placeItems: 'center',
            background: 'none', border: 0, borderRadius: 8,
            color: shown ? 'var(--gold)' : 'var(--mu)', cursor: 'pointer',
            font: 'inherit', padding: 0,
          }}
        >
          {shown ? <EyeSlash size={18} /> : <Eye size={18} />}
        </button>
      </div>
    </div>
  )
}
