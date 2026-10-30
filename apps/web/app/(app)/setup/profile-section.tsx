'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstitutionProfile } from '@yucampus/types';
import { Button, Card, Field, Notice, SelectField } from '@yucampus/ui';
import { type InstitutionProfileInput, institutionProfileSchema } from '@yucampus/validation';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { api, errorMessage } from '@/lib/api';
import { ROOT_DOMAIN } from '@/lib/tenant';
import { SETUP_PROGRESS_KEY } from './setup-steps';

const PROFILE_KEY = ['institution', 'profile'];

export function ProfileSection() {
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: PROFILE_KEY, queryFn: () => api<InstitutionProfile>('/institution/profile') });
  const form = useForm({ resolver: zodResolver(institutionProfileSchema) });
  const { register, handleSubmit, formState, reset } = form;

  useEffect(() => {
    if (profile.data) {
      const { subdomain: _subdomain, ...values } = profile.data;
      reset({ ...values, city: values.city ?? '', aisheCode: values.aisheCode ?? '', affiliatingUniversity: values.affiliatingUniversity ?? '' });
    }
  }, [profile.data, reset]);

  const save = useMutation({
    mutationFn: (values: InstitutionProfileInput) => api<InstitutionProfile>('/institution/profile', { method: 'PUT', body: values }),
    onSuccess: (saved) => {
      queryClient.setQueryData(PROFILE_KEY, saved);
      void queryClient.invalidateQueries({ queryKey: SETUP_PROGRESS_KEY });
    },
  });

  return (
    <Card id="profile" className="scroll-mt-8">
      <h2 className="text-[17px] font-bold">Institution profile</h2>
      <p className="mt-1 text-sm text-muted">
        Used on every report. Your web address is <strong>{profile.data?.subdomain ?? '…'}.{ROOT_DOMAIN}</strong>; ask
        YuCampus support to change it.
      </p>
      {profile.isError ? (
        <Notice tone="error" className="mt-4">
          {errorMessage(profile.error)}
        </Notice>
      ) : (
        <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))} className="mt-5 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="College name" error={formState.errors.name?.message} {...register('name')} />
            </div>
            <SelectField label="Institution type" error={formState.errors.type?.message} {...register('type')}>
              <option value="affiliated">Affiliated college</option>
              <option value="autonomous">Autonomous college</option>
              <option value="university">University</option>
            </SelectField>
            <Field label="Affiliating university (if any)" {...register('affiliatingUniversity')} />
            <Field label="State" error={formState.errors.state?.message} {...register('state')} />
            <Field label="City or town" {...register('city')} />
            <Field label="AISHE code" hint="e.g. C-12345" {...register('aisheCode')} />
            <Field
              label="Year established"
              inputMode="numeric"
              error={formState.errors.establishedYear?.message}
              {...register('establishedYear', { setValueAs: (value) => (value === '' || value == null ? null : Number(value)) })}
            />
            <div className="sm:col-span-2">
              <SelectField
                label="Evidence approval"
                hint="Only finally approved evidence counts towards readiness and reports."
                {...register('approvalLevels', { valueAsNumber: true })}
              >
                <option value={2}>Two levels: HOD approves for the department, then IQAC gives final approval</option>
                <option value={1}>One level: IQAC approves</option>
              </SelectField>
            </div>
          </div>
          {save.isError ? <Notice tone="error">{errorMessage(save.error)}</Notice> : null}
          {save.isSuccess && !formState.isDirty ? <Notice tone="success">Profile saved.</Notice> : null}
          <div>
            <Button type="submit" disabled={save.isPending || profile.isPending}>
              {save.isPending ? 'Saving…' : 'Save profile'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
