import type { Rule } from '../../api/types';

/** Reglas activas del reto; la que introduce este reto se resalta. */
export function RuleList({ rules, newRuleKey }: { rules: Rule[]; newRuleKey?: string | null }) {
  if (rules.length === 0) {
    return <p className="muted">Todavía no hay reglas: este primer reto es libre.</p>;
  }
  return (
    <ol className="rules" aria-label="Reglas activas">
      {rules.map((rule) => (
        <li key={rule.key} className={rule.key === newRuleKey ? 'rule rule--new' : 'rule'}>
          {rule.description}
          {rule.key === newRuleKey && <span className="badge">Nueva</span>}
        </li>
      ))}
    </ol>
  );
}
