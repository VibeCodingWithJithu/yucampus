'use client';

import type { PlatformChallenge, PlatformSession } from '@yucampus/types';
import { Button, Checkbox, Field, Notice } from '@yucampus/ui';
import { useEffect, useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';

/** The authenticator QR code, made in the browser; the secret never leaves this page except to the app. */
function SecretQr({ url }: { url: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void import('qrcode').then((qr) =>
      qr.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((text) => {
        if (!cancelled) setSvg(text);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (!svg) return <div className="size-44 animate-pulse rounded-control bg-row" />;
  return <div role="img" aria-label="QR code for your authenticator app" className="size-44 bg-white p-1" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * Step two of team sign-in: a code from the authenticator app, or a recovery code. On first sign-in it sets the app
 * up and then shows the recovery codes once, before continuing.
 */
export function MfaStep({ challenge, onSignedIn, onRestart }: { challenge: PlatformChallenge; onSignedIn: (session: PlatformSession) => void; onRestart: () => void }) {
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [saved, setSaved] = useState<PlatformSession | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (saved?.recoveryCodes) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="success">Your authenticator app is set up.</Notice>
        <div>
          <h2 className="text-[17px] font-bold">Save your recovery codes</h2>
          <p className="mt-1 text-sm text-secondary">
            If you lose your phone, each code signs you in once instead of the app. Keep them somewhere safe, such as a password manager. They are shown only now.
          </p>
        </div>
        <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-2 rounded-control border border-border bg-bg p-4 font-mono text-[15px]">
          {saved.recoveryCodes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button variant="secondary" onClick={() => void navigator.clipboard?.writeText(saved.recoveryCodes!.join('\n'))}>
          Copy the codes
        </Button>
        <Checkbox label="I have saved these codes" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <Button size="lg" disabled={!confirmed} onClick={() => onSignedIn({ ...saved, recoveryCodes: undefined })}>
          Continue
        </Button>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="flex flex-col gap-4">
        <Notice tone="error">That took too long. Please sign in again.</Notice>
        <Button size="lg" onClick={onRestart}>
          Sign in again
        </Button>
      </div>
    );
  }

  const enroll = challenge.step === 'enroll' ? challenge.enroll : undefined;
  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const value = code.replace(/\s/g, '');
        if (useRecovery ? !/^[a-z2-7]{4}-?[a-z2-7]{4}$/i.test(value) : !/^\d{6}$/.test(value)) {
          setError(useRecovery ? 'Enter a recovery code like k7qm-3xdp' : 'Enter the 6-digit code from your app');
          return;
        }
        setError(null);
        setBusy(true);
        try {
          const session = await platformApi<PlatformSession>('/auth/mfa', { method: 'POST', body: { ticket: challenge.ticket, code: value }, auth: false });
          if (session.recoveryCodes) setSaved(session);
          else onSignedIn(session);
        } catch (caught) {
          if (caught instanceof ApiError && caught.code === 'ticket_expired') setExpired(true);
          else setError(errorMessage(caught));
        } finally {
          setBusy(false);
        }
      }}
    >
      {enroll ? (
        <>
          <div>
            <h2 className="text-[17px] font-bold">Set up your authenticator app</h2>
            <p className="mt-1 text-sm text-secondary">
              Team sign-in needs a code from an app such as Google Authenticator or Microsoft Authenticator. Scan this QR code with it, or type the key.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <SecretQr url={enroll.otpauthUrl} />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted">Key</p>
              <p className="font-mono text-sm break-all" aria-label="Setup key">
                {enroll.secret.match(/.{1,4}/g)!.join(' ')}
              </p>
            </div>
          </div>
        </>
      ) : (
        <p className="text-[15px] text-secondary">{useRecovery ? 'Enter one of your recovery codes.' : 'Enter the 6-digit code from your authenticator app.'}</p>
      )}
      <Field
        label={useRecovery ? 'Recovery code' : '6-digit code'}
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        error={error ?? undefined}
      />
      <Button type="submit" size="lg" disabled={busy}>
        {busy ? 'Checking…' : enroll ? 'Confirm and sign in' : 'Sign in'}
      </Button>
      {!enroll ? (
        <button
          type="button"
          className="flex min-h-11 cursor-pointer items-center self-start text-sm font-semibold text-primary"
          onClick={() => {
            setUseRecovery(!useRecovery);
            setCode('');
            setError(null);
          }}
        >
          {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
        </button>
      ) : null}
    </form>
  );
}
