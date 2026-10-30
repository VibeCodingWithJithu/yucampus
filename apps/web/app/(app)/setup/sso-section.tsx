'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SSO_PROVIDERS, SSO_PROVIDER_LABELS, type SsoSettingsView } from '@yucampus/types';
import { Button, Card, Checkbox, Field, Notice } from '@yucampus/ui';
import { ssoSettingsSchema } from '@yucampus/validation';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';

const SSO_KEY = ['institution', 'sso'];

/** Sign-in with Google or Microsoft (decided 2026-10-21): off by default, limited to the college's email domains. */
export function SsoSection() {
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: SSO_KEY, queryFn: () => api<SsoSettingsView>('/institution/sso') });
  const [google, setGoogle] = useState(false);
  const [microsoft, setMicrosoft] = useState(false);
  const [domains, setDomains] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setGoogle(settings.data.google);
      setMicrosoft(settings.data.microsoft);
      setDomains(settings.data.domains.join(', '));
    }
  }, [settings.data]);

  const save = useMutation({
    mutationFn: (body: unknown) => api<SsoSettingsView>('/institution/sso', { method: 'PUT', body }),
    onSuccess: (saved) => queryClient.setQueryData(SSO_KEY, saved),
  });

  const data = settings.data;
  const none = data && !data.available.google && !data.available.microsoft;
  return (
    <Card id="sso" className="scroll-mt-8">
      <h2 className="text-[17px] font-bold">Sign-in with Google or Microsoft</h2>
      <p className="mt-1 text-sm text-muted">
        Let people sign in with their college Google or Microsoft account. Only people already added in Users and roles can sign in, and only with an email
        on the domains below. Password and mobile-code sign-in keep working.
      </p>
      {settings.isError ? (
        <Notice tone="error" className="mt-4">
          {errorMessage(settings.error)}
        </Notice>
      ) : null}
      {none ? (
        <Notice tone="info" className="mt-4">
          Not available yet: YuCampus has not set up Google or Microsoft sign-in on this server.
        </Notice>
      ) : null}
      {data && !none ? (
        <form
          noValidate
          className="mt-5 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            const parsed = ssoSettingsSchema.safeParse({
              google,
              microsoft,
              domains: domains
                .split(/[\s,;]+/)
                .map((d) => d.trim())
                .filter(Boolean),
            });
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? 'Check the domains');
              return;
            }
            setError(null);
            save.mutate(parsed.data);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {SSO_PROVIDERS.map((provider) => (
              <Checkbox
                key={provider}
                label={`${SSO_PROVIDER_LABELS[provider]} accounts`}
                description={data.available[provider] ? undefined : 'Not set up on this server yet'}
                disabled={!data.available[provider]}
                checked={provider === 'google' ? google : microsoft}
                onChange={(e) => (provider === 'google' ? setGoogle : setMicrosoft)(e.target.checked)}
              />
            ))}
          </div>
          <Field
            label="Email domains allowed"
            hint="Separate several with commas, e.g. srec.ac.in, staff.srec.ac.in"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            error={error ?? undefined}
          />
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess ? <Notice tone="success">Saved.</Notice> : null}
          <div>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </form>
      ) : null}
    </Card>
  );
}
