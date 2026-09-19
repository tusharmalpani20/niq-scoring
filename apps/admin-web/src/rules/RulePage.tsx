import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { versionUrl, versionLookup } from './version-url';
import { request, message } from '../api';
import { ErrorNotice } from '../shared';
import { Button } from '../components/ui/button';
import { RuleEditor } from './RuleEditor';
import type { RuleDetail } from './rule-api';

export function RulePage({ id }: { id: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [record, setRecord] = useState<RuleDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setRecord(null); setError('');
    Promise.resolve().then(() => request<RuleDetail>(versionLookup(id, location.search).endpoint)).then(value => {
      if (!current) return;
      setRecord(value);
    }).catch(cause => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [id, location.search, attempt]);
  // Wait for the saved state to render so the editor's unsaved-change guard is clear.
  useEffect(() => {
    if (!record) return;
    const canonical = versionUrl(record.version);
    if (location.pathname + location.search !== canonical) navigate(canonical, { replace: true });
  }, [record, navigate]);
  if (error) return <div className="space-y-3"><ErrorNotice error={error}/><Button variant="outline" onClick={() => navigate('/versions')}>Back to versions</Button><Button onClick={() => setAttempt(n => n + 1)}>Retry</Button></div>;
  if (!record) return <p role="status">Loading rule version…</p>;
  return <RuleEditor key={record.id} initial={record} onClose={() => navigate('/versions')} onSaved={setRecord}/>;
}
