'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DepartmentView, EvidenceDetail, TaskView } from '@yucampus/types';
import { Button, Card, Field, Notice, SelectField, buttonClasses, cn } from '@yucampus/ui';
import { EVIDENCE_FILE_TYPE_NAMES, MAX_EVIDENCE_BYTES } from '@yucampus/validation';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/components/auth-provider';
import { MetricPicker } from '@/components/metric-links';
import { PageHeader } from '@/components/page-header';
import { api, errorMessage } from '@/lib/api';
import { EVIDENCE_ACCEPT, formatBytes, prepareFile, uploadFile } from '@/lib/upload';

type Phase = { name: 'form' } | { name: 'sending'; progress: number } | { name: 'done'; item: EvidenceDetail };

/** Faculty upload, built for phones first: pick or photograph a file, give it a title and date, send. */
export function UploadScreen() {
  const queryClient = useQueryClient();
  const { user, can } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  // A title typed by the person is kept; one suggested from the file name follows the chosen file.
  const [titleTyped, setTitleTyped] = useState(false);
  const [documentDate, setDocumentDate] = useState('');
  const [description, setDescription] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  // Opened from a metric's page: the metric (and document) are filled in.
  const params = useSearchParams();
  const [link, setLink] = useState({
    metricId: params.get('metric') ?? '',
    documentKey: params.get('document') || null,
  });
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'form' });
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const descriptionId = useId();

  const departments = useQuery({ queryKey: ['departments'], queryFn: () => api<DepartmentView[]>('/departments') });
  const myDepartmentIds = [...new Set(user?.roles.map((role) => role.departmentId).filter(Boolean))] as string[];
  const myDepartments = departments.data?.filter((department) => myDepartmentIds.includes(department.id)) ?? [];

  // Opened from a task's "Upload" button: the upload is for that task, and takes its metric and title.
  const taskId = params.get('task');
  const task = useQuery({
    queryKey: ['tasks', taskId],
    queryFn: () => api<TaskView>(`/tasks/${taskId}`),
    enabled: Boolean(taskId),
  });
  useEffect(() => {
    if (!task.data) return;
    if (task.data.metric) setLink((current) => (current.metricId ? current : { metricId: task.data.metric!.id, documentKey: task.data.documentKey }));
    setTitle((current) => current || task.data.title);
  }, [task.data]);

  if (!can('evidence.upload')) {
    return (
      <>
        <PageHeader title="Upload evidence" />
        <Card>Your role cannot upload evidence. Ask your college admin if you need to.</Card>
      </>
    );
  }

  function choose(chosen: File | undefined) {
    setError(null);
    if (!chosen) return;
    setFile(chosen);
    if (!titleTyped)
      setTitle(
        chosen.name
          .replace(/\.[^.]+$/, '')
          .replace(/[_-]+/g, ' ')
          .slice(0, 200),
      );
  }

  async function send() {
    setError(null);
    if (!file) return setError('Choose a file or take a photo first.');
    if (title.trim().length < 3) return setError('Give the evidence a short title.');
    try {
      setPhase({ name: 'sending', progress: 0 });
      const prepared = await prepareFile(file);
      const uploadToken = await uploadFile(prepared.file, prepared.type, (progress) =>
        setPhase({ name: 'sending', progress }),
      );
      const item = await api<EvidenceDetail>('/evidence', {
        method: 'POST',
        body: {
          uploadToken,
          title,
          description: description || null,
          documentDate: documentDate || null,
          departmentId: departmentId || null,
          metricId: link.metricId || null,
          documentKey: link.metricId ? link.documentKey : null,
          taskId: task.data?.id ?? null,
        },
      });
      void queryClient.invalidateQueries({ queryKey: ['evidence'] });
      void queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setPhase({ name: 'done', item });
    } catch (caught) {
      setError(errorMessage(caught));
      setPhase({ name: 'form' });
    }
  }

  function reset() {
    setFile(null);
    setTitle('');
    setTitleTyped(false);
    setDocumentDate('');
    setDescription('');
    setError(null);
    setPhase({ name: 'form' });
  }

  if (phase.name === 'done') {
    return (
      <>
        <PageHeader title="Uploaded" />
        <Card className="flex flex-col gap-4">
          <Notice tone="success">
            “{phase.item.title}” is uploaded. {phase.item.stage.label}.
          </Notice>
          <p className="text-sm text-secondary">You will see here when it is approved or if anything needs fixing.</p>
          <div className="flex flex-wrap gap-3">
            <Button onClick={reset}>Upload another</Button>
            <Link href="/evidence/mine" className={buttonClasses({ variant: 'secondary' })}>
              See my uploads
            </Link>
            {task.data ? (
              <Link href="/tasks" className={buttonClasses({ variant: 'secondary' })}>
                Back to tasks
              </Link>
            ) : null}
          </div>
        </Card>
      </>
    );
  }

  const sending = phase.name === 'sending';
  return (
    <>
      <PageHeader
        breadcrumb={[{ label: 'My uploads', href: '/evidence/mine' }, { label: 'Upload' }]}
        title="Upload evidence"
        description="A certificate, report, photo or minutes. Your HOD and IQAC check it before it counts."
      />
      <Card className="flex max-w-2xl flex-col gap-5">
        {task.data ? (
          <Notice tone="info">
            For your task “{task.data.title}”{task.data.documentName ? ` (${task.data.documentName})` : ''}. When it is approved, the
            task is done.
          </Notice>
        ) : null}
        {task.isError ? <Notice tone="error">{errorMessage(task.error)}</Notice> : null}
        <div className="flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-muted">File</span>
          {file ? (
            <div className="flex items-center justify-between gap-3 rounded-control border border-border bg-bg px-3.5 py-3">
              <span className="min-w-0 text-sm">
                <span className="block truncate font-semibold">{file.name}</span>
                <span className="text-muted">{formatBytes(file.size)}</span>
              </span>
              <Button variant="ghost" onClick={() => setFile(null)} disabled={sending}>
                Change
              </Button>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <Button size="lg" variant="secondary" onClick={() => fileInput.current?.click()}>
                Choose a file
              </Button>
              <Button size="lg" variant="secondary" onClick={() => cameraInput.current?.click()}>
                Take a photo
              </Button>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept={EVIDENCE_ACCEPT}
            className="sr-only"
            aria-label="Choose a file"
            tabIndex={-1}
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <input
            ref={cameraInput}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            aria-label="Take a photo"
            tabIndex={-1}
            onChange={(event) => choose(event.target.files?.[0])}
          />
          <p className="text-[13px] text-muted">
            {EVIDENCE_FILE_TYPE_NAMES}, up to {MAX_EVIDENCE_BYTES / 1024 / 1024} MB. Large photos are made smaller
            before sending.
          </p>
        </div>

        <Field
          label="Title"
          placeholder="e.g. FDP certificate · Machine Learning"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            setTitleTyped(true);
          }}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Date on the document"
            type="date"
            hint="e.g. the workshop or event date"
            value={documentDate}
            onChange={(e) => setDocumentDate(e.target.value)}
          />
          {myDepartments.length > 1 ? (
            <SelectField label="Department" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
              {myDepartments.map((department) => (
                <option key={department.id} value={department.id}>
                  {department.code} · {department.name}
                </option>
              ))}
            </SelectField>
          ) : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={descriptionId} className="text-[13px] font-semibold text-muted">
            Note for the reviewer (optional)
          </label>
          <textarea
            id={descriptionId}
            rows={3}
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <MetricPicker value={link} onChange={setLink} label="Counts for metric (optional)" />
          <p className="text-[13px] text-muted">If you are not sure, leave it; the reviewer can link it.</p>
        </div>
        {error ? <Notice tone="error">{error}</Notice> : null}
        {sending ? (
          <div className="flex flex-col gap-2" role="status">
            <div className="h-2 overflow-hidden rounded-full bg-track" aria-hidden="true">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${Math.round(phase.progress * 100)}%` }}
              />
            </div>
            <span className="text-sm text-muted">Uploading… {Math.round(phase.progress * 100)}%</span>
          </div>
        ) : null}
        <div>
          <Button size="lg" onClick={() => void send()} disabled={sending} className={cn('w-full sm:w-auto')}>
            {sending ? 'Uploading…' : 'Upload'}
          </Button>
        </div>
      </Card>
    </>
  );
}
