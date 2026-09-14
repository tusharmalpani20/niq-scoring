import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, message } from '../api';
import { ErrorNotice } from '../shared';
import { Button } from '../components/ui/button';
import { RuleEditor } from './RuleEditor';
import type { RuleDetail } from './rule-api';

export function RulePage({ id }: { id: string }) {
  const navigate = useNavigate();
  const [record, setRecord] = useState<RuleDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setRecord(null); setError('');
    request<RuleDetail>(`/admin/rules/${encodeURIComponent(id)}`).then(value => { if (current) setRecord(value); }).catch(cause => { if (current) setError(message(cause)); });
    return () => { current = false; };
  }, [id, attempt]);
  if (error) return <div className="space-y-3"><ErrorNotice error={error}/><Button variant="outline" onClick={() => navigate('/versions')}>Back to versions</Button><Button onClick={() => setAttempt(n => n + 1)}>Retry</Button></div>;
  if (!record) return <p role="status">Loading rule version…</p>;
  return <RuleEditor key={record.id} initial={record} onClose={() => navigate('/versions')} onSaved={() => {}}/>;
}
