import { useEffect, useState } from "react";
import { message, request } from "./api";

export type RuleUsage = { ruleVersionId: string | null; name: string; count: number };

export function useRuleUsage(clientId?: string) {
  const [rules, setRules] = useState<RuleUsage[] | null>(null);
  const [error, setError] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let active = true;
    setRules(null);
    setError("");
    const query = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
    void request<{ rules: RuleUsage[] }>(`/admin/usage/rules${query}`)
      .then(result => { if (active) setRules(result.rules); })
      .catch(cause => { if (active) setError(message(cause)); });
    return () => { active = false; };
  }, [clientId, retryCount]);

  return { rules, error, retry: () => setRetryCount(value => value + 1) };
}
